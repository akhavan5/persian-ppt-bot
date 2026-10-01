/** تولید سرفصل و محتوای اسلایدها با API سازگار با OpenAI یا Claude (یا حالت نمایشی بدون کلید). */
import type { Env } from "./env";
import type { Deck, Outline, OutlineItem, Slide, Layout } from "./types";
import { TONES } from "./themes";

export const LAYOUTS: Layout[] = ["title", "section", "bullets", "image_text", "two_column", "stats", "closing"];

export class LlmError extends Error {
  constructor(message: string, public fatal = false) {
    super(message);
  }
}

const SYSTEM =
  "You are an expert presentation designer and a native Persian (Farsi) writer. " +
  "Write natural, fluent Persian: correct use of half-space (نیم‌فاصله) e.g. «می‌شود», no literal " +
  "translation from English, no unnecessary English words. Bullets are short (max ~12 words). " +
  "Never invent statistics, quotes or sources; if you are not confident about a number, do not use it. " +
  "Return ONLY one valid JSON object, no markdown fences, no commentary.";

function useOpenAI(env: Env): boolean {
  const p = (env.LLM_PROVIDER || "").toLowerCase();
  return p === "openai" || (!!env.OPENAI_API_KEY && p !== "anthropic");
}

export function hasKey(env: Env): boolean {
  return useOpenAI(env) ? !!env.OPENAI_API_KEY : !!env.ANTHROPIC_API_KEY;
}

async function failFrom(r: Response, who: string): Promise<never> {
  const body = (await r.text()).slice(0, 300);
  // خطاهای ۴xx (جز ۴۰۸/۴۲۹) با تلاش مجدد درست نمی‌شوند: کلید نادرست، مدل ناموجود، ...
  const fatal = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429;
  throw new LlmError(`${who} ${r.status}: ${body}`, fatal);
}

async function complete(env: Env, prompt: string, maxTokens: number): Promise<string> {
  if (useOpenAI(env)) {
    const base = (env.OPENAI_BASE_URL || "https://api.gapgpt.app/v1").replace(/\/+$/, "");
    const body: Record<string, unknown> = {
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      max_tokens: Math.min(maxTokens, 8000),
      temperature: 0.5,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
      response_format: { type: "json_object" },
    };
    const headers = { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` };
    const call = () => fetch(`${base}/chat/completions`, {
      method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
    });
    let r = await call();
    if (r.status === 400) { // برخی سرویس‌ها response_format را نمی‌پذیرند
      delete body.response_format;
      r = await call();
    }
    if (!r.ok) await failFrom(r, "LLM");
    const j = (await r.json()) as any;
    return j?.choices?.[0]?.message?.content ?? "";
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: maxTokens,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) await failFrom(r, "Anthropic");
  const j = (await r.json()) as any;
  return (j?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

export function parseJson(text: string): any {
  const t = text.replace(/```(?:json)?/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("no JSON in model output");
  return JSON.parse(t.slice(a, b + 1));
}

async function ask(env: Env, prompt: string, maxTokens = 6000): Promise<any> {
  let last: unknown;
  for (let i = 0; i < 2; i++) { // یک بار تلاش مجدد در صورت JSON نامعتبر
    const text = await complete(env, prompt, maxTokens);
    try { return parseJson(text); } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("invalid JSON");
}

// ---------- ابزارهای پاک‌سازی خروجی مدل ----------
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : [];

function coerceSlide(x: any): Slide {
  const layout = LAYOUTS.includes(x?.layout) ? (x.layout as Layout) : "bullets";
  return {
    layout,
    title: str(x?.title),
    subtitle: str(x?.subtitle) || undefined,
    bullets: strArr(x?.bullets),
    columns: Array.isArray(x?.columns)
      ? x.columns.map((c: any) => ({ heading: str(c?.heading), bullets: strArr(c?.bullets) }))
      : [],
    stats: Array.isArray(x?.stats)
      ? x.stats.map((s: any) => ({ value: str(s?.value), label: str(s?.label) })).filter((s: any) => s.value)
      : [],
    image_query: str(x?.image_query) || undefined,
    notes: str(x?.notes) || undefined,
  };
}

/** ترمیم خروجی‌های ناقص مدل‌های ضعیف‌تر (مثلاً اسلایدی که به‌جای شیء به لیست رشته‌ها تبدیل شده). */
export function normalizeDeck(data: any, outline: OutlineItem[]): Deck {
  const keys = new Set(["layout", "title", "subtitle", "bullets", "image_query", "notes"]);
  const slides: any[] = [];
  const flat: string[] = [];
  for (const x of Array.isArray(data?.slides) ? data.slides : []) {
    if (x && typeof x === "object" && !Array.isArray(x)) slides.push(x);
    else if (typeof x === "string") flat.push(x.trim());
  }
  const d: Record<string, string> = {};
  for (let i = 0; i < flat.length - 1;) {
    if (keys.has(flat[i])) { d[flat[i]] = flat[i + 1]; i += 2; } else i += 1;
  }
  if (d.title) slides.push(d);
  if (!slides.length) throw new Error("model returned no valid slides");

  const out = slides.slice(0, 30).map(coerceSlide);
  for (const o of outline.slice(out.length)) { // اگر مدل اسلایدی جا انداخت
    out.push(coerceSlide({ layout: "bullets", title: o.title, bullets: [o.summary] }));
  }
  return { title: str(data?.title), slides: out.slice(0, 30) };
}

export function normalizeOutline(data: any, topic: string): Outline {
  const slides: OutlineItem[] = (Array.isArray(data?.slides) ? data.slides : [])
    .map((s: any) => (typeof s === "string" ? { title: s.trim(), summary: "" } : { title: str(s?.title), summary: str(s?.summary) }))
    .filter((s: OutlineItem) => s.title);
  if (slides.length < 2) throw new Error("model returned no valid outline");
  return { title: str(data?.title) || topic, slides };
}

// ---------- تولید ----------
export async function makeOutline(env: Env, topic: string, n: number, tone: string, audience = ""): Promise<Outline> {
  if (!hasKey(env)) return mockOutline(topic, n);
  const data = await ask(env, `Create the outline of a presentation in Persian.
Topic: ${topic}
Number of slides (including title and closing): ${n}
Tone: ${TONES[tone] ?? tone}
Audience: ${audience || "general"}
Return JSON: {"title": "...", "slides": [{"title": "...", "summary": "one sentence: what this slide covers"}]}
The first slide is the title slide and the last is a closing slide.`, 2000);
  return normalizeOutline(data, topic);
}

export async function makeDeck(env: Env, topic: string, title: string, outline: OutlineItem[], tone: string, audience = ""): Promise<Deck> {
  if (!hasKey(env)) return mockDeck(title || topic, outline);
  const data = await ask(env, `Write the full content of this Persian presentation.
Topic: ${topic}
Title: ${title}
Tone: ${TONES[tone] ?? tone}
Audience: ${audience || "general"}
Outline (keep this order and count): ${JSON.stringify(outline)}

Return JSON: {"title": "...", "slides": [{
  "layout": "title|section|bullets|image_text|two_column|stats|closing",
  "title": "...", "subtitle": "optional",
  "bullets": ["..."],
  "columns": [{"heading": "...", "bullets": ["..."]}, {"heading": "...", "bullets": ["..."]}],
  "stats": [{"value": "...", "label": "..."}],
  "image_query": "short English photo search query",
  "notes": "speaker notes in Persian, 2-3 sentences"}]}

Layout rules:
- first slide "title" (title + subtitle), last slide "closing" (short thanks/CTA in title, optional bullets).
- "bullets": 3-5 bullets. "image_text": 3-4 bullets + image_query (use for concrete, visual topics).
- "two_column": exactly 2 columns (comparison, pros/cons), 2-4 bullets each.
- "stats": 2-4 items ONLY if the numbers are well-known and reliable, otherwise use another layout.
- "section": only for a divider between big parts, and only in decks of 10+ slides.
- Vary layouts; do not use the same one more than 3 times in a row.
- Include "notes" for every slide.
- "slides" MUST be an array of JSON objects, one object per slide. Never flatten a slide into a list of strings.`);
  const deck = normalizeDeck(data, outline);
  if (!deck.title) deck.title = title || topic;
  return deck;
}

// ---------- حالت نمایشی (بدون کلید API) ----------
function mockOutline(topic: string, n: number): Outline {
  const names = ["مقدمه", "تعریف و مفاهیم پایه", "اهمیت موضوع", "کاربردها", "فرصت‌ها و چالش‌ها",
    "نمونه‌های موفق", "روندهای آینده", "توصیه‌ها", "نکات کلیدی", "جمع‌بندی"];
  const slides: OutlineItem[] = [{ title: topic, summary: "اسلاید عنوان" }];
  for (let i = 0; i < Math.max(0, n - 2); i++) slides.push({ title: names[i % names.length], summary: `بخش ${i + 1}` });
  slides.push({ title: "با تشکر", summary: "پایان" });
  return { title: topic, slides };
}

function mockDeck(title: string, outline: OutlineItem[]): Deck {
  const slides = outline.map((o, i): Slide => {
    if (i === 0) return coerceSlide({ layout: "title", title, subtitle: "نمونه خروجی (حالت نمایشی)" });
    if (i === outline.length - 1) return coerceSlide({ layout: "closing", title: o.title, subtitle: "پرسش و پاسخ" });
    return coerceSlide({
      layout: "bullets", title: o.title, notes: "یادداشت نمونه",
      bullets: ["برای محتوای واقعی، کلید API مدل زبانی را تنظیم کنید", o.summary, "این متن فقط برای نمایش ساختار است"],
    });
  });
  return { title, slides };
}
