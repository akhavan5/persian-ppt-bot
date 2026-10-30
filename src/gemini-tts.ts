/**
 * تبدیل متن به صدا با Gemini TTS (Interactions API) و چرخش بین چند کلید.
 *
 * متغیر GEMINI_API_KEYS در داشبورد کلودفلر: چند کلید با خط جدید / «;» / «,» / فاصله (خط‌های شروع‌شده با # نادیده گرفته می‌شوند).
 *  • چرخش: هر کلید ۳ درخواست می‌گیرد (GEMINI_KEY_STEP)، بعد نوبت کلید بعدی است؛ پس از آخرین کلید دوباره از اولی.
 *    شمارنده یک «بلیت» اتمی در D1 است (INSERT … RETURNING)، پس بین Workflowها و درخواست‌های هم‌زمان هم دقیق می‌ماند.
 *  • خطا: با ۴۲۹ / ۴۰۱ / ۴۰۳ / ۴۰۰ / ۵xx / تایم‌اوت / پاسخ بدون صدا، همان درخواست فوراً با کلید بعدی تکرار می‌شود
 *    و کلید خراب برای مدتی «کولدان» می‌گیرد تا بلیت‌های بعدی هدر نروند (ولی کنار گذاشته نمی‌شود؛ اگر همه کولدان بودند باز امتحان می‌شود).
 */
import type { Env } from "./env";
import { DEFAULT_FORMAT, mergeWav, pcmToWav } from "./wav";

export class GeminiError extends Error {
  constructor(message: string, public fatal = false) { super(message); }
}

const DEFAULT_MODEL = "gemini-3.8-flash-tts"; // ارزان‌تر: gemini-3.8-flash-lite-tts
const MAX_KEYS = 30;
const CD_PREFIX = "gem:cd:";

export function parseGeminiKeys(env: Env): string[] {
  const raw = (env.GEMINI_API_KEYS ?? "").replace(/#[^\n]*/g, " ");
  const out: string[] = [];
  for (const k of raw.split(/[\s,;]+/)) if (k && !out.includes(k)) out.push(k);
  return out.slice(0, MAX_KEYS);
}
export const ttsEnabled = (env: Env) => parseGeminiKeys(env).length > 0;

export interface TtsVoices { narrator: string; A: string; B: string }
export const ttsVoices = (env: Env): TtsVoices => ({
  narrator: (env.GEMINI_TTS_VOICE || "Kore").trim(), // Kore محکم و شفاف؛ برای سخنرانی مناسب است
  A: (env.GEMINI_TTS_VOICE_A || "Achird").trim(), // مجری (مرد، صمیمی)
  B: (env.GEMINI_TTS_VOICE_B || "Sulafat").trim(), // مهمان (زن، گرم)
});

const stepSize = (env: Env) => Math.max(1, Math.min(50, Math.floor(Number(env.GEMINI_KEY_STEP) || 3)));
const baseUrl = (env: Env) => (env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
const sampleRate = (env: Env) => { const n = Number(env.GEMINI_TTS_SAMPLE_RATE); return [8000, 16000, 24000].includes(n) ? n : 0; };

/** بلیت اتمی: ۱، ۲، ۳، … ؛ اگر D1 در دسترس نبود، شروع تصادفی (چرخش تقریبی می‌شود ولی کار متوقف نمی‌شود) */
async function nextTicket(env: Env): Promise<number> {
  try {
    await env.KV.ready();
    const r = await env.DB.prepare(
      "INSERT INTO kv (k, v, exp) VALUES ('gem:ticket', '1', NULL) ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(v AS INTEGER) + 1 AS TEXT) RETURNING v",
    ).all<{ v: string }>();
    const n = Number(r.results?.[0]?.v);
    if (Number.isFinite(n) && n > 0) return n;
  } catch (e) {
    console.error("gemini ticket", String(e).slice(0, 200));
  }
  return Math.floor(Math.random() * 1_000_000) + 1;
}

/** اثر انگشت کوتاه کلید (برای کولدان؛ خود کلید جایی ذخیره نمی‌شود) */
async function fingerprint(key: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return [...d.subarray(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Verdict { cooldown: number; why: string }
/** همه‌ی خطاها به کلید بعدی می‌روند؛ فقط مدت کولدان فرق می‌کند. */
function classify(status: number, body: string): Verdict {
  const msg = body.replace(/\s+/g, " ").slice(0, 220);
  if (status === 429) return { cooldown: /per.?day|daily|PerDay/i.test(body) ? 3600 : 120, why: `429 سقف درخواست: ${msg}` };
  if (status === 401 || status === 403 || (status === 400 && /api[ _-]?key|API_KEY_INVALID|expired|credential/i.test(body))) return { cooldown: 3600, why: `${status} کلید نامعتبر/مسدود: ${msg}` };
  if (status === 0) return { cooldown: 20, why: `شبکه/تایم‌اوت: ${msg}` };
  if (status === 204) return { cooldown: 20, why: `پاسخ بدون صدا: ${msg}` };
  if (status >= 500 || status === 408 || status === 409) return { cooldown: 20, why: `${status} خطای سرویس: ${msg}` };
  return { cooldown: 60, why: `${status}: ${msg}` };
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** آخرین بخش {type:"audio", data:"…base64…"} در هر جای پاسخ (steps[].content[]) */
function findAudio(node: unknown): string | null {
  let found: string | null = null;
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === "audio" && typeof n.data === "string" && n.data) found = n.data;
    for (const k of Object.keys(n)) if (n[k] && typeof n[k] === "object") walk(n[k]);
  };
  walk(node);
  return found;
}

async function callOnce(env: Env, key: string, body: unknown): Promise<{ ok: true; wav: Uint8Array } | { ok: false; status: number; text: string }> {
  let r: Response;
  try {
    r = await fetch(`${baseUrl(env)}/v1beta/interactions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    return { ok: false, status: 0, text: String(e instanceof Error ? e.message : e) };
  }
  if (!r.ok) return { ok: false, status: r.status, text: await r.text().catch(() => "") };
  let j: unknown;
  try { j = await r.json(); } catch (e) { return { ok: false, status: 204, text: "invalid JSON from Gemini" }; }
  const b64 = findAudio(j);
  if (!b64) return { ok: false, status: 204, text: JSON.stringify(j).slice(0, 300) };
  const bytes = b64ToBytes(b64);
  // خروجی معمولی WAV است؛ اگر PCM خام آمد (حالت استریم) هدر اضافه می‌شود
  const isWav = bytes.length > 12 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF";
  return { ok: true, wav: isWav ? bytes : pcmToWav(bytes, { ...DEFAULT_FORMAT, sampleRate: sampleRate(env) || DEFAULT_FORMAT.sampleRate }) };
}

/** بدنه‌ی درخواست را با کلید چرخشی می‌فرستد و WAV برمی‌گرداند */
async function generate(env: Env, body: unknown): Promise<Uint8Array> {
  const keys = parseGeminiKeys(env);
  if (!keys.length) throw new GeminiError("متغیر GEMINI_API_KEYS تنظیم نشده است.", true);
  const K = keys.length;
  const ticket = await nextTicket(env);
  const start = Math.floor((ticket - 1) / stepSize(env)) % K;

  const prints = await Promise.all(keys.map(fingerprint));
  const cooled = new Set((await env.KV.list({ prefix: CD_PREFIX }).catch(() => ({ keys: [] as { name: string }[] }))).keys.map((k) => k.name.slice(CD_PREFIX.length)));
  const order = keys.map((_, i) => (start + i) % K);
  const tryOrder = [...order.filter((i) => !cooled.has(prints[i])), ...order.filter((i) => cooled.has(prints[i]))]; // کلیدهای کولدان آخرین فرصت‌اند

  const errors: string[] = [];
  const statuses: number[] = [];
  for (const i of tryOrder) {
    const res = await callOnce(env, keys[i], body);
    if (res.ok) {
      if (cooled.has(prints[i])) await env.KV.delete(CD_PREFIX + prints[i]).catch(() => {});
      return res.wav;
    }
    const v = classify(res.status, res.text);
    statuses.push(res.status);
    errors.push(`#${i + 1}: ${v.why}`);
    console.error("gemini key skipped", `#${i + 1}`, v.why.slice(0, 160));
    await env.KV.put(CD_PREFIX + prints[i], "1", { expirationTtl: v.cooldown }).catch(() => {});
  }
  // اگر همه‌ی کلیدها فقط ۴۰۰/۴۰۴ دادند، مشکل از خود درخواست/مدل/منطقه است و تلاش مجدد بی‌فایده است
  const fatal = statuses.length > 0 && statuses.every((s) => s === 400 || s === 404);
  const hint = /location is not supported|not available in your country/i.test(errors.join(" ")) ? " (منطقه‌ی اجرای Worker پشتیبانی نمی‌شود؛ GEMINI_BASE_URL را روی یک پروکسی بگذار)" : "";
  throw new GeminiError(`همه‌ی ${K} کلید ناموفق بودند${hint} — ${errors.join(" | ").slice(0, 600)}`, fatal);
}

const ann = (o: { speaker?: string; style?: string }) => {
  const a: Record<string, string> = { type: "speech_metadata" };
  if (o.speaker) a.speaker = o.speaker;
  if (o.style) a.style = o.style;
  return Object.keys(a).length > 1 ? [a] : undefined;
};
const responseFormat = (env: Env) => ({ type: "audio", ...(sampleRate(env) ? { sample_rate: sampleRate(env) } : {}) });
const model = (env: Env) => (env.GEMINI_TTS_MODEL || DEFAULT_MODEL).trim();

/** یک گوینده؛ متن بلند خودکار تکه می‌شود و تکه‌ها به هم می‌چسبند */
export async function ttsSpeak(env: Env, texts: string[], o: { voice?: string; style?: string } = {}): Promise<Uint8Array> {
  const voice = o.voice || ttsVoices(env).narrator;
  const wavs: Uint8Array[] = [];
  for (const text of texts) {
    wavs.push(await generate(env, {
      model: model(env),
      input: [{ type: "user_input", content: [{ type: "text", text, annotations: ann({ style: o.style }) }] }],
      response_format: responseFormat(env),
      generation_config: { speech_config: [{ voice }] },
    }));
  }
  return wavs.length === 1 ? wavs[0] : mergeWav(wavs, 250);
}

export interface Turn { speaker: "A" | "B"; text: string }
const LABEL = { A: "Ali", B: "Sara" } as const;

/** گفت‌وگوی دو‌نفره در «یک» درخواست (حداکثر دو گوینده با صدای آماده‌ی Gemini). اگر فقط یک نفر حرف می‌زند، حالت تک‌گوینده. */
export async function ttsDialogue(env: Env, turns: Turn[], o: { styleA?: string; styleB?: string } = {}): Promise<Uint8Array> {
  const v = ttsVoices(env);
  const who = new Set(turns.map((t) => t.speaker));
  if (who.size === 1) {
    const s = turns[0].speaker;
    return ttsSpeak(env, [turns.map((t) => t.text).join(" ")], { voice: v[s], style: s === "A" ? o.styleA : o.styleB });
  }
  return generate(env, {
    model: model(env),
    input: [{
      type: "user_input",
      content: turns.map((t) => ({ type: "text", text: t.text, annotations: ann({ speaker: LABEL[t.speaker], style: t.speaker === "A" ? o.styleA : o.styleB }) })),
    }],
    response_format: responseFormat(env),
    generation_config: { speech_config: { speakers: [{ speaker: LABEL.A, voice: v.A }, { speaker: LABEL.B, voice: v.B }] } },
  });
}

