/**
 * تبدیل WAV به MP3 با مرورگر کلودفلر (Browser Rendering) + lamejs (public/lame.min.js).
 * Worker پیاده‌سازی بومی MP3 ندارد؛ پس PCM داخل یک صفحه‌ی خالی در مرورگر بدون‌سر ریخته، همان‌جا با lamejs فشرده و MP3 برگردانده می‌شود.
 * اگر binding نبود/کار نکرد (یا BROWSER_MODE=api)، همین کار با حساب‌های پشتیبان BROWSER_ACCOUNTS از راه REST (/content + addScriptTag) انجام می‌شود (encodeRemote در پایین).
 * کل کار بهترین‌تلاش است: اگر مرورگری نبود، سقف مرورگر (پلن رایگان ۱۰ دقیقه در روز) پر شد یا هر خطای دیگری آمد، برای آن فایل null برمی‌گردد
 * و فراخوان‌کننده همان WAV را تحویل می‌دهد؛ یعنی هیچ‌وقت ساخت پادکست/اسلاید صوتی به‌خاطر MP3 شکست نمی‌خورد.
 * یک نشست مرورگر برای همه‌ی فایل‌های یک فراخوانی؛ هر بار فقط یک WAV در حافظه‌ی Worker است (load به‌صورت تنبل صدا زده می‌شود).
 *
 * متغیرهای اختیاری: AUDIO_FORMAT=wav (خاموش‌کردن MP3)، MP3_KBPS (۳۲ تا ۱۶۰؛ پیش‌فرض ۶۴ برای گفتار تک‌کاناله کافی است).
 */
import type { Env } from "./env";
import { launchWithRetry } from "./pdf";
import { hasBrowser, hasRemoteBrowser, remoteMp3, useBindingForRender } from "./browser-api";
import { parseWav } from "./wav";

const KBPS_OK = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160]; // مشترک بین MPEG-1 و MPEG-2 Layer III
export const mp3Kbps = (env: Env): number => { const n = Number(env.MP3_KBPS); return KBPS_OK.includes(n) ? n : 64; };
/** MP3 با binding مرورگر یا (از راه REST و /content) با حساب‌های پشتیبانِ BROWSER_ACCOUNTS ممکن است */
export const mp3Enabled = (env: Env): boolean => hasBrowser(env) && String(env.AUDIO_FORMAT ?? "").trim().toLowerCase() !== "wav";

/** تعداد فریم MP3 (هرکدام ۱۱۵۲ نمونه) در هر درخواست REST: ≈ ۱۰۰ ثانیه‌ی ۲۴کیلوهرتز تک‌کاناله (≈ ۴٫۸ مگابایت PCM، ≈ ۶٫۴ مگابایت base64). مضرب فریم تا فقط انتهای فایل پد شود. */
const REMOTE_FRAMES = 2080;

const RAW_CHUNK = 1_500_000; // بایت در هر رفت‌وبرگشت به صفحه (≈ ۲ مگابایت base64)

const PAGE_HTML = `<!doctype html><html><body><script>
const J = {};
window.__begin = (id, sr, ch, kbps) => { J[id] = { sr, ch, kbps, parts: [], n: 0, out: null }; return 1; };
window.__feed = (id, b64) => {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  J[id].parts.push(u); J[id].n += u.length; return J[id].n;
};
window.__encode = async (id) => {
  const j = J[id], all = new Uint8Array(j.n);
  let o = 0; for (const p of j.parts) { all.set(p, o); o += p.length; }
  j.parts = [];
  const pcm = new Int16Array(all.buffer, 0, Math.floor(all.length / 2)), ch = j.ch, frames = Math.floor(pcm.length / ch);
  const enc = new lamejs.Mp3Encoder(ch, j.sr, j.kbps), out = [], BLOCK = 1152 * 32;
  let total = 0;
  const keep = (b) => { if (b.length) { out.push(new Uint8Array(b.buffer, b.byteOffset, b.length).slice()); total += b.length; } };
  for (let i = 0, k = 0; i < frames; i += BLOCK, k++) {
    const end = Math.min(frames, i + BLOCK);
    if (ch === 1) keep(enc.encodeBuffer(pcm.subarray(i, end)));
    else {
      const L = new Int16Array(end - i), R = new Int16Array(end - i);
      for (let x = 0; x < end - i; x++) { L[x] = pcm[(i + x) * 2]; R[x] = pcm[(i + x) * 2 + 1]; }
      keep(enc.encodeBuffer(L, R));
    }
    if (k % 8 === 7) await new Promise((r) => setTimeout(r, 0));
  }
  keep(enc.flush());
  const res = new Uint8Array(total); o = 0;
  for (const p of out) { res.set(p, o); o += p.length; }
  j.out = res; return total;
};
window.__take = (id, off, len) => {
  const u = J[id].out.subarray(off, off + len); let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
window.__free = (id) => { delete J[id]; return 1; };
window.__ready = true;
</script></body></html>`;

const toB64 = (u8: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

let LAME: string | null = null;
/** متن lamejs از فایل‌های استاتیک پروژه (public/lame.min.js)؛ بیرون از شبکه‌ی عمومی (CDN) وابسته نیست */
async function lameSource(env: Env): Promise<string> {
  if (LAME) return LAME;
  const r = await env.ASSETS.fetch(new Request("https://assets.local/lame.min.js"));
  if (!r.ok) throw new Error(`lame.min.js ${r.status}`);
  const t = await r.text();
  if (!t.includes("Mp3Encoder")) throw new Error("lame.min.js invalid");
  return (LAME = t);
}

type Page = { evaluate: (expr: string) => Promise<any> };

async function encodeOne(page: Page, id: string, wav: Uint8Array, kbps: number): Promise<Uint8Array | null> {
  const { fmt, data } = parseWav(wav);
  if (fmt.bits !== 16 || (fmt.channels !== 1 && fmt.channels !== 2) || data.length < 2) return null;
  const q = JSON.stringify(id);
  await page.evaluate(`window.__begin(${q},${fmt.sampleRate},${fmt.channels},${kbps})`);
  try {
    for (let o = 0; o < data.length; o += RAW_CHUNK) await page.evaluate(`window.__feed(${q},${JSON.stringify(toB64(data.subarray(o, o + RAW_CHUNK)))})`);
    const total = Number(await page.evaluate(`window.__encode(${q})`));
    if (!Number.isFinite(total) || total < 1000) return null;
    const out = new Uint8Array(total);
    for (let o = 0; o < total; o += RAW_CHUNK) out.set(fromB64(String(await page.evaluate(`window.__take(${q},${o},${RAW_CHUNK})`))), o);
    return out[0] === 0xff ? out : null; // سرآغاز فریم MP3
  } finally {
    await page.evaluate(`window.__free(${q})`).catch(() => {});
  }
}

/**
 * count فایل WAV (هرکدام با load(k) تنبل خوانده می‌شود) ⇒ آرایه‌ی MP3 هم‌اندازه؛ جای هر فایل ناموفق (یا کل آرایه، اگر مرورگر نبود) null.
 * هر چیزی که null شد باید با همان WAV تحویل داده شود.
 */
export async function wavsToMp3(env: Env, count: number, load: (k: number) => Promise<Uint8Array | null>): Promise<(Uint8Array | null)[]> {
  const res: (Uint8Array | null)[] = Array.from({ length: count }, () => null);
  if (!count || !mp3Enabled(env)) return res;
  const kbps = mp3Kbps(env);
  let lib: string;
  try { lib = await lameSource(env); } catch (e) { console.error("mp3 lame", String(e instanceof Error ? e.message : e).slice(0, 300)); return res; }

  // ۱) binding (مگر BROWSER_MODE=api و حساب پشتیبان داشته باشیم)؛ اگر نشد یا فایلی null ماند ⇒ ۲) حساب‌های پشتیبان
  let bindingOk = false;
  if (useBindingForRender(env)) {
    let browser: Awaited<ReturnType<typeof launchWithRetry>> | null = null;
    try {
      browser = await launchWithRetry(env, hasRemoteBrowser(env));
      const page = await browser.newPage();
      await page.setContent(PAGE_HTML, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.addScriptTag({ content: lib });
      if ((await page.evaluate("typeof lamejs !== 'undefined' && window.__ready === true")) !== true) throw new Error("lamejs not loaded in page");
      bindingOk = true;
      for (let k = 0; k < count; k++) {
        try {
          const wav = await load(k);
          if (wav) res[k] = await encodeOne(page, `j${k}`, wav, kbps);
        } catch (e) {
          console.error("mp3 encode", k, String(e instanceof Error ? e.message : e).slice(0, 300)); // این فایل WAV می‌ماند (یا با حساب پشتیبان تلاش می‌شود)
        }
      }
    } catch (e) {
      console.error("mp3 browser", String(e instanceof Error ? e.message : e).slice(0, 300));
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  if (hasRemoteBrowser(env)) {
    for (let k = 0; k < count; k++) {
      if (res[k]) continue;
      try {
        const wav = await load(k);
        if (wav) res[k] = await encodeRemote(env, lib, wav, kbps);
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        if (/too many subrequests/i.test(msg)) break; // سقف زیردرخواست پر است؛ بقیه‌ی تکه‌ها هم همین‌طور رد می‌شوند (فراخواننده به نمونه‌ی بعد می‌دهد)، لاگ نمی‌خواهد
        console.error("mp3 remote", k, msg.slice(0, 300));
      }
    }
  } else if (!bindingOk) {
    console.error("mp3: no browser available");
  }
  return res;
}

/** یک WAV ← MP3 با REST؛ PCM تکه‌تکه (هر تکه یک درخواست) و MP3 تکه‌ها پشت‌سرهم چسبانده می‌شود. هر تکه ناموفق ⇒ null (WAV تحویل می‌شود). */
async function encodeRemote(env: Env, lib: string, wav: Uint8Array, kbps: number): Promise<Uint8Array | null> {
  const { fmt, data } = parseWav(wav);
  if (fmt.bits !== 16 || (fmt.channels !== 1 && fmt.channels !== 2) || data.length < 2) return null;
  const step = REMOTE_FRAMES * 1152 * 2 * fmt.channels; // بایت‌های یک تکه (۱۶ بیت)
  const parts: Uint8Array[] = [];
  for (let o = 0; o < data.length; o += step) {
    const out = await remoteMp3(env, lib, data.subarray(o, o + step), { sampleRate: fmt.sampleRate, channels: fmt.channels, kbps });
    if (!out) return null;
    parts.push(out);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { all.set(p, off); off += p.length; }
  return all;
}
