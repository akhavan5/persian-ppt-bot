/** تولید سرفصل و محتوای اسلایدها با API سازگار با OpenAI یا Claude (یا حالت نمایشی بدون کلید). */
import type { Env } from "./env";
import type { Deck, Outline, OutlineItem, Slide, Layout, Table, Chart, SlideKind } from "./types";
import { TONES } from "./themes";
import { toEn } from "./util";

export const LAYOUTS: Layout[] = ["title", "section", "bullets", "image_text", "two_column", "stats", "table", "chart", "sources", "questions", "closing"];

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

/** مدل‌هایی که پیش‌فرض «فکر» می‌کنند و باید برای خروجی JSON خاموش شوند */
const THINKERS = /qwen3|qwen-3|glm|gemma-?4/i;

function useOpenAI(env: Env): boolean {
  const p = (env.LLM_PROVIDER || "").toLowerCase();
  return p === "openai" || (!!env.OPENAI_API_KEY && p !== "anthropic");
}

export interface ModelOption { id: string; name: string; model: string; brand: string }
/** برند مدل (برای نمایش لوگو در وب)؛ از روی نام مدل تشخیص داده می‌شود. ترتیب مهم است: «deepseek-…-qwen» باید deepseek حساب شود. */
export function brandOf(id: string): string {
  if (/deepseek/i.test(id)) return "deepseek";
  if (/qwen|qwq/i.test(id)) return "qwen";
  if (/zai|glm/i.test(id)) return "zai";
  if (/openai|gpt|(^|\/)o\d/i.test(id)) return "openai";
  if (/claude|anthropic/i.test(id)) return "anthropic";
  return "other";
}
const shortName = (id: string) => id.split("/").pop() || id;
/**
 * فهرست مدل‌های قابل انتخاب. متغیر OPENAI_MODELS (در کلودفلر) یکی از این دو شکل را می‌پذیرد:
 *   ۱) متن ساده: هر مدل با کاما یا خط جدید جدا شود؛ نام نمایشی اختیاری با «|»:   gpt-4o-mini|سریع, gpt-4o|دقیق
 *   ۲) JSON: ["gpt-4o-mini", {"model":"gpt-4o","name":"دقیق"}]
 * مدل اول = «مدل رایگان» (برای همه‌ی کاربران وب و پیش‌فرض)؛ بقیه‌ی مدل‌ها فقط برای اعضای پلن پلاس/پرو باز می‌شوند.
 * اگر OPENAI_MODELS خالی باشد، از OPENAI_MODEL (و OPENAI_MODEL_2) استفاده می‌شود.
 */
export function modelList(env: Env): ModelOption[] {
  if (!useOpenAI(env)) { const m = env.ANTHROPIC_MODEL || "claude-sonnet-5-5"; return [{ id: m, name: m, model: m, brand: "anthropic" }]; }
  const out: ModelOption[] = [];
  const add = (model: unknown, name?: unknown) => {
    const m = String(model ?? "").trim();
    if (m && !out.some((o) => o.id === m)) out.push({ id: m, name: String(name ?? "").trim() || shortName(m), model: m, brand: brandOf(m) });
  };
  const raw = (env.OPENAI_MODELS ?? "").trim();
  if (raw.startsWith("[")) {
    try {
      for (const x of JSON.parse(raw)) typeof x === "string" ? add(x) : add(x?.model ?? x?.id, x?.name);
    } catch { /* JSON نامعتبر: نادیده گرفته می‌شود و فهرست پیش‌فرض به کار می‌رود */ }
  } else {
    for (const part of raw.split(/[,\n;]+/)) { const [m, ...n] = part.split("|"); add(m, n.join("|")); }
  }
  if (!out.length) { add(env.OPENAI_MODEL || "gpt-4o-mini"); add(env.OPENAI_MODEL_2); }
  return out.slice(0, 12);
}
export const resolveModel = (env: Env, id?: string): ModelOption => {
  const l = modelList(env);
  return l.find((m) => m.id === id) ?? l[0];
};

export function hasKey(env: Env): boolean {
  return useOpenAI(env) ? !!env.OPENAI_API_KEY : !!env.ANTHROPIC_API_KEY;
}

async function failFrom(r: Response, who: string): Promise<never> {
  const body = (await r.text()).slice(0, 300);
  // خطاهای ۴xx (جز ۴۰۸/۴۲۹) با تلاش مجدد درست نمی‌شوند: کلید نادرست، مدل ناموجود، ...
  const fatal = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429;
  throw new LlmError(`${who} ${r.status}: ${body}`, fatal);
}

async function complete(env: Env, prompt: string, maxTokens: number, modelId?: string): Promise<string> {
  if (useOpenAI(env)) {
    const base = (env.OPENAI_BASE_URL || "https://api.gapgpt.app/v1").replace(/\/+$/, "");
    const body: Record<string, unknown> = {
      model: resolveModel(env, modelId).model,
      // مدل‌های «استدلالی» (GLM، Gemma 4، Qwen3) بخشی از توکن‌ها را صرف فکر کردن می‌کنند؛ با سقف کم، پاسخ نیمه‌کاره/خالی می‌ماند
      max_tokens: Math.min(THINKERS.test(resolveModel(env, modelId).model) ? maxTokens * 2 : maxTokens, 8000),
      temperature: 0.5,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
      response_format: { type: "json_object" },
    };
    // این مدل‌ها به‌طور پیش‌فرض قبل از پاسخ هزاران توکن «فکر» می‌کنند و یا تایم‌اوت می‌شوند یا پاسخ (content) خالی می‌ماند؛ برای تولید JSON لازم نیست
    if (THINKERS.test(String(body.model))) body.chat_template_kwargs = { enable_thinking: false };
    const headers = { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` };
    const call = () => fetch(`${base}/chat/completions`, {
      method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
    });
    let r = await call();
    if (r.status === 400) { // برخی سرویس‌ها response_format را نمی‌پذیرند
      delete body.response_format; // برخی سرویس‌ها response_format یا chat_template_kwargs را نمی‌پذیرند
      delete body.chat_template_kwargs;
      r = await call();
    }
    if (!r.ok) await failFrom(r, "LLM");
    const j = (await r.json()) as any;
    const ch = j?.choices?.[0], msg = ch?.message;
    const part = (c: unknown) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((x: any) => x?.text ?? "").join("") : "");
    let text = part(msg?.content);
    // برخی مدل‌های استدلالی پاسخ را در reasoning_content/reasoning می‌گذارند و content خالی می‌ماند
    if (!text.trim()) text = part(msg?.reasoning_content) || part(msg?.reasoning);
    if (!text.trim() || !text.includes("{")) {
      console.error("llm empty/non-json output", body.model, "finish:", ch?.finish_reason, "usage:", JSON.stringify(j?.usage ?? {}), "text:", text.slice(0, 200));
    }
    return text;
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
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error(`no JSON in model output (${t ? "«" + t.slice(0, 120).replace(/\s+/g, " ") + "»" : "خروجی خالی"})`);
  return JSON.parse(t.slice(a, b + 1));
}

async function ask(env: Env, prompt: string, maxTokens = 6000, modelId?: string): Promise<any> {
  let last: unknown;
  for (let i = 0; i < 2; i++) { // یک بار تلاش مجدد در صورت JSON نامعتبر
    const text = await complete(env, prompt, maxTokens, modelId);
    try { return parseJson(text); } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("invalid JSON");
}

/** یک بار تلاش مجدد برای خطای گذرا (تایم‌اوت، ۴۲۹، ۵xx)؛ خطای قطعی (کلید/مدل نادرست) بلافاصله پرتاب می‌شود. */
async function askRetry(env: Env, prompt: string, maxTokens: number, modelId?: string): Promise<any> {
  try { return await ask(env, prompt, maxTokens, modelId); }
  catch (e) {
    if (e instanceof LlmError && e.fatal) throw e;
    await new Promise((r) => setTimeout(r, 3000));
    return ask(env, prompt, maxTokens, modelId);
  }
}

// ---------- ابزارهای پاک‌سازی خروجی مدل ----------
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : [];

function coerceTable(t: any): Table | undefined {
  const headers = strArr(t?.headers).slice(0, 5);
  if (headers.length < 2) return undefined;
  const rows = (Array.isArray(t?.rows) ? t.rows : [])
    .map((r: any) => strArr(r).slice(0, headers.length))
    .filter((r: string[]) => r.length)
    .map((r: string[]) => { while (r.length < headers.length) r.push("—"); return r; })
    .slice(0, 7);
  return rows.length ? { headers, rows } : undefined;
}

function coerceChart(c: any): Chart | undefined {
  const type = ["bar", "line", "pie"].includes(c?.type) ? (c.type as Chart["type"]) : "bar";
  const labels = strArr(c?.labels).slice(0, 8);
  if (labels.length < 2) return undefined;
  const series = (Array.isArray(c?.series) ? c.series : []).slice(0, type === "pie" ? 1 : 3)
    .map((se: any) => ({
      name: str(se?.name),
      values: (Array.isArray(se?.values) ? se.values : []).slice(0, labels.length)
        .map((v: any) => Number(toEn(String(v)).replace(/[,٬،%\s]/g, ""))),
    }))
    .filter((se: { values: number[] }) => se.values.length === labels.length && se.values.every(Number.isFinite));
  return series.length ? { type, labels, series } : undefined;
}

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
    table: coerceTable(x?.table),
    chart: coerceChart(x?.chart),
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
    .map((s: any): OutlineItem => typeof s === "string"
      ? { title: s.trim(), summary: "" }
      : { title: str(s?.title), summary: str(s?.summary), kind: s?.kind === "sources" || s?.kind === "questions" ? (s.kind as SlideKind) : undefined })
    .filter((s: OutlineItem) => s.title);
  if (slides.length < 2) throw new Error("model returned no valid outline");
  return { title: str(data?.title) || topic, slides };
}

// ---------- تولید ----------
export interface ContentOpts { model?: string; audience?: string; mode?: "normal" | "student"; sources?: boolean; questions?: boolean; maxImages?: number }
const wantSources = (o: ContentOpts) => o.mode === "student" || !!o.sources;
const wantQuestions = (o: ContentOpts) => !!o.questions;

/** اگر مدل اسلاید منابع/پرسش را جا انداخت، پیش از اسلاید پایانی اضافه می‌شود. */
function ensureKinds(slides: OutlineItem[], o: ContentOpts): OutlineItem[] {
  const has = (k: SlideKind) => slides.some((s) => s.kind === k);
  const closeAt = () => Math.max(1, slides.length - 1);
  if (wantQuestions(o) && !has("questions")) {
    const i = slides.findIndex((s) => s.kind === "sources");
    slides.splice(i >= 0 ? i : closeAt(), 0, { title: "پرسش‌های پایانی", summary: "چند پرسش برای بحث و پرسش‌وپاسخ", kind: "questions" });
  }
  if (wantSources(o) && !has("sources")) {
    slides.splice(closeAt(), 0, { title: "منابع", summary: "منابع پیشنهادی برای مطالعه‌ی بیشتر", kind: "sources" });
  }
  return slides.slice(0, 37); // سقف پلن ۳۵ + حداکثر ۲ اسلاید منابع/پرسش که مدل جا انداخته باشد
}

function structureRules(o: ContentOpts): string {
  const q = wantQuestions(o) ? ` Include one slide of discussion questions for the audience (kind "questions") right before the sources/closing slide.` : "";
  const src = wantSources(o) ? ` Include one slide of recommended sources (kind "sources") right before the closing slide.` : "";
  if (o.mode === "student") {
    return `Use an academic student-presentation structure, in this exact order: (1) title slide; (2) agenda slide "فهرست مطالب"; (3) introduction "مقدمه" (problem statement and goals); (4) the body slides (main content split logically, as many as needed); (5) conclusion "نتیجه‌گیری" (key takeaways).${q} Then the sources slide (kind "sources"), and the last slide is a short closing/thanks slide.`;
  }
  return `The first slide is the title slide and the last is a closing slide.${q}${src}`;
}

export async function makeOutline(env: Env, topic: string, n: number, tone: string, o: ContentOpts = {}): Promise<Outline> {
  if (!hasKey(env)) return mockOutline(topic, n, o);
  const data = await ask(env, `Create the outline of a presentation in Persian.
Topic: ${topic}
Number of slides (including title and closing): ${n}
Tone: ${TONES[tone] ?? tone}
Audience: ${o.audience || (o.mode === "student" ? "university class" : "general")}
Return JSON: {"title": "...", "slides": [{"title": "...", "summary": "one sentence: what this slide covers", "kind": "sources|questions (ONLY on those special slides, otherwise omit)"}]}
${structureRules(o)}`, Math.min(8000, 800 + n * 150), o.model); // ۳۵ اسلاید با ۲۵۰۰ توکن جا نمی‌شد
  const out = normalizeOutline(data, topic);
  out.slides = ensureKinds(out.slides, o);
  return out;
}

export async function makeDeck(env: Env, topic: string, title: string, outline: OutlineItem[], tone: string, o: ContentOpts = {}): Promise<Deck> {
  if (!hasKey(env)) return mockDeck(title || topic, outline);
  const student = o.mode === "student";

  // محتوا به دسته‌های کوچک (۳ تا ۴ اسلاید) شکسته می‌شود و دسته‌ها هم‌زمان ساخته می‌شوند:
  // هر درخواست کوتاه و سریع است، پس مدل‌های کندتر (مثل Qwen) روی یک درخواست بلند تایم‌اوت نمی‌شوند.
  const size = student ? 3 : 4;
  const batches: [number, number][] = [];
  if (outline.length <= 6) batches.push([0, outline.length]);
  else for (let a = 0; a < outline.length; a += size) batches.push([a, Math.min(outline.length, a + size)]);
  const nb = batches.length;
  // تعداد تصویر: پیش‌فرض ۱؛ ۰ = بدون تصویر؛ هرگز بیشتر از (تعداد اسلایدها − ۲)
  const wantImages = Math.max(0, Math.min(o.maxImages ?? 1, Math.max(1, outline.length - 2)));
  const ctx = outline.map((x, i) => `${i + 1}. ${x.title}`).join(" | ");

  const parts = await Promise.all(batches.map(async ([a, z], bi) => {
    const slice = outline.slice(a, z);
    const tableOk = nb === 1 || bi % 2 === 0, chartOk = bi === Math.min(1, nb - 1);
    // سهم این دسته از تصاویر: تصاویر به‌طور مساوی بین دسته‌ها پخش می‌شوند (اسلاید عنوان/پایانی تصویر نمی‌گیرند)
    const imgQuota = Math.min(Math.floor(wantImages / nb) + (bi < wantImages % nb ? 1 : 0), Math.max(0, slice.length - (a === 0 ? 1 : 0) - (z === outline.length ? 1 : 0)));
    const scope = nb === 1 ? "" : `\nThe deck has ${outline.length} slides in total: ${ctx}\nWrite ONLY slides ${a + 1} to ${z} (${slice.length} slides) — return exactly ${slice.length} slide objects, in this order.\n`;
    const edges = [a === 0 ? `- the first slide is "title" (title + subtitle).` : "", z === outline.length ? `- the last slide is "closing" (short thanks/CTA in title, optional bullets).` : ""].filter(Boolean).join("\n");
    const data = await askRetry(env, `Write the full content of this Persian presentation.
Topic: ${topic}
Title: ${title}
Tone: ${TONES[tone] ?? tone}
Audience: ${o.audience || (student ? "university class" : "general")}${scope}
Outline of the slides to write (keep this order and count): ${JSON.stringify(slice)}

Return JSON: {"title": "...", "slides": [{
  "layout": "title|section|bullets|image_text|two_column|stats|table|chart|sources|questions|closing",
  "title": "...", "subtitle": "optional",
  "bullets": ["..."],
  "columns": [{"heading": "...", "bullets": ["..."]}, {"heading": "...", "bullets": ["..."]}],
  "stats": [{"value": "...", "label": "..."}],
  "table": {"headers": ["..."], "rows": [["..."]]},
  "chart": {"type": "bar|line|pie", "labels": ["..."], "series": [{"name": "...", "values": [1, 2]}]},
  "image_query": "English description of ONE concrete visual scene for this slide (objects, setting; no abstract words), max 12 words. It must directly depict the subject of THIS presentation topic (e.g. solar panels and wind turbines for renewable energy); never generic landmarks, mosques, buildings or cultural stereotypes unless the topic itself is about them",
  "notes": "speaker notes in Persian"}]}

Layout rules:
${edges}
- "bullets": ${student ? "4-6 bullets (up to ~18 words each; define terms, add a concrete example where useful)" : "3-5 bullets"}. "image_text": 3-4 bullets + image_query. ${imgQuota > 0 ? `Use it EXACTLY ${imgQuota} time${imgQuota > 1 ? "s" : ""} here, on the most concrete, visual topics (never on the title/closing slide), each with a different image_query depicting a different scene${imgQuota > 1 ? "; do not put two image slides next to each other" : ""}.` : 'Do NOT use "image_text" in this part.'}
- "two_column": exactly 2 columns (comparison, pros/cons), 2-4 bullets each.
- "stats": 2-4 items ONLY if the numbers are well-known and reliable, otherwise use another layout.
- "table": 2-4 columns, 3-6 rows, very short cells (max 6 words). Use for comparisons, classifications or timelines. ${tableOk ? "Use at most once here." : 'Do NOT use "table" in this part.'}
- "chart": ONLY when you know real, widely reported figures (rounded is fine); labels 3-8; "pie" has exactly one series. Optionally 1-2 bullets with the takeaway. NEVER invent data: if unsure, use "table" or "bullets" instead. ${chartOk ? "Use at most once here." : 'Do NOT use "chart" in this part.'}
- "sources" (only for outline items with kind "sources"): 3-6 entries in "bullets". Only real, well-known references you are highly confident exist (famous books with author, official organizations or their websites by name, widely known reports). No URLs, no page numbers, no invented titles; if unsure, write the organization or field name instead of a specific title.
- "questions" (only for outline items with kind "questions"): 3-5 thought-provoking questions for the audience in "bullets", each one sentence ending with «؟».
- "section": only for a divider between big parts, and only in decks of 10+ slides.
- Vary layouts; do not use the same one more than 3 times in a row.
- Include "notes" for every slide: ${student ? "a full speaking script of 4-6 sentences" : "2-3 sentences"}.
- "slides" MUST be an array of JSON objects, one object per slide. Never flatten a slide into a list of strings.`,
      (student ? 900 : 700) * slice.length + 500, o.model);
    return normalizeDeck(data, slice).slides.slice(0, slice.length); // normalizeDeck کمبود را از روی سرفصل پر می‌کند ⇒ ترتیب دسته‌ها به‌هم نمی‌خورد
  }));

  const deck: Deck = { title: title || topic, slides: parts.flat() };
  deck.slides.forEach((sl, i) => { const k = outline[i]?.kind; if (k) sl.layout = k; }); // چیدمان اسلایدهای ویژه ثابت است
  // تعداد اسلایدهای تصویری باید دقیقاً wantImages باشد: اضافه‌ها به bullets برمی‌گردند و کمبود از اسلایدهای bullets دارای image_query جبران می‌شود
  let have = 0;
  for (const sl of deck.slides) {
    if (sl.layout !== "image_text") continue;
    if (sl.image_query && have < wantImages) have++;
    else sl.layout = "bullets";
  }
  for (let i = 1; i < deck.slides.length - 1 && have < wantImages; i++) {
    const c = deck.slides[i];
    if (c.layout === "bullets" && c.image_query && !outline[i]?.kind) { c.layout = "image_text"; c.bullets = c.bullets.slice(0, 4); have++; }
  }
  return deck;
}

// ---------- حالت نمایشی (بدون کلید API) ----------
function mockOutline(topic: string, n: number, o: ContentOpts = {}): Outline {
  const names = ["مقدمه", "تعریف و مفاهیم پایه", "اهمیت موضوع", "کاربردها", "فرصت‌ها و چالش‌ها",
    "نمونه‌های موفق", "روندهای آینده", "توصیه‌ها", "نکات کلیدی", "جمع‌بندی"];
  const slides: OutlineItem[] = [{ title: topic, summary: "اسلاید عنوان" }];
  for (let i = 0; i < Math.max(0, n - 2); i++) slides.push({ title: names[i % names.length], summary: `بخش ${i + 1}` });
  slides.push({ title: "با تشکر", summary: "پایان" });
  return { title: topic, slides: ensureKinds(slides, o) };
}

function mockDeck(title: string, outline: OutlineItem[]): Deck {
  const slides = outline.map((o, i): Slide => {
    if (i === 0) return coerceSlide({ layout: "title", title, subtitle: "نمونه خروجی (حالت نمایشی)" });
    if (i === outline.length - 1) return coerceSlide({ layout: "closing", title: o.title, subtitle: "پرسش و پاسخ" });
    return coerceSlide({
      layout: o.kind ?? "bullets", title: o.title, notes: "یادداشت نمونه",
      bullets: ["برای محتوای واقعی، کلید API مدل زبانی را تنظیم کنید", o.summary, "این متن فقط برای نمایش ساختار است"],
    });
  });
  return { title, slides };
}
