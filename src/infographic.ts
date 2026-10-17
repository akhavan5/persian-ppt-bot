/**
 * اینفوگرافیک تک‌صفحه‌ای (پوستر) همراه ارائه؛ اجرا در DeckWorkflow (workflow.ts).
 * مسیر: تحقیق (Tavily) ← JSON ساختاریافته از مدل (همین فایل) ← قالب HTML (infographic-html.ts) ← اسکرین‌شات با Browser Rendering ← ارسال PNG.
 * متن فارسی را مرورگر می‌نویسد (اتصال حروف و راست‌به‌چپ درست)، پس مدل تصویری فقط برای یک تصویر تزئینی استفاده می‌شود، نه برای متن.
 */
import type { Env } from "./env";
import { TONES } from "./themes";
import { toEn } from "./util";
import { LlmError, askJson, hasKey } from "./llm";
import { launchWithRetry } from "./pdf";

/** wide = افقی سه‌ستونه (شبیه NotebookLM)؛ tall = عمودی دوستونه (مناسب اشتراک در پیام‌رسان) */
export type IgLayout = "wide" | "tall";

export interface IgStat { value: string; label: string }
export interface IgStep { label: string; text: string }
export interface IgBar { label: string; value: number; text: string }
export type IgBlock =
  | { type: "definition" | "keyfact" | "example" | "formula"; label: string; text: string }
  | { type: "bullets"; label: string; items: string[] }
  | { type: "stats"; items: IgStat[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "steps"; label: string; items: IgStep[] }
  | { type: "compare"; left: { title: string; items: string[] }; right: { title: string; items: string[] } }
  | { type: "bars"; label: string; items: IgBar[] };
export interface IgSection { title: string; blocks: IgBlock[] }
export interface Infographic { title: string; subtitle: string; sections: IgSection[]; takeaway: string; image_query: string }

// ---------- پاک‌سازی خروجی مدل ----------
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : [];

function coerceBlock(b: any): IgBlock | null {
  const type = str(b?.type).toLowerCase();
  const label = str(b?.label).slice(0, 40);
  const text = str(b?.text).slice(0, 420);
  switch (type) {
    case "definition": case "keyfact": case "example": case "formula":
      return text ? { type, label, text } : null;
    case "bullets": {
      const items = strArr(b?.items).slice(0, 6).map((s) => s.slice(0, 220));
      return items.length ? { type, label, items } : null;
    }
    case "stats": {
      const items = (Array.isArray(b?.items) ? b.items : [])
        .map((s: any) => ({ value: str(s?.value).slice(0, 24), label: str(s?.label).slice(0, 70) }))
        .filter((s: IgStat) => s.value).slice(0, 4);
      return items.length ? { type, items } : null;
    }
    case "table": {
      const headers = strArr(b?.headers).slice(0, 4).map((s) => s.slice(0, 40));
      if (headers.length < 2) return null;
      const rows = (Array.isArray(b?.rows) ? b.rows : [])
        .map((r: unknown) => strArr(r).slice(0, headers.length).map((s) => s.slice(0, 80)))
        .filter((r: string[]) => r.length)
        .map((r: string[]) => { while (r.length < headers.length) r.push("—"); return r; })
        .slice(0, 6);
      return rows.length ? { type, headers, rows } : null;
    }
    case "steps": {
      const items = (Array.isArray(b?.items) ? b.items : [])
        .map((s: any) => ({ label: str(s?.label).slice(0, 60), text: str(s?.text).slice(0, 200) }))
        .filter((s: IgStep) => s.label || s.text).slice(0, 5);
      return items.length >= 2 ? { type, label, items } : null;
    }
    case "compare": {
      const side = (x: any) => ({ title: str(x?.title).slice(0, 50), items: strArr(x?.items).slice(0, 4).map((s) => s.slice(0, 120)) });
      const left = side(b?.left), right = side(b?.right);
      return left.items.length && right.items.length ? { type, left, right } : null;
    }
    case "bars": {
      const items = (Array.isArray(b?.items) ? b.items : [])
        .map((s: any) => ({ label: str(s?.label).slice(0, 50), value: Number(toEn(String(s?.value ?? "")).replace(/[,٬،%\s]/g, "")), text: str(s?.text).slice(0, 30) }))
        .filter((s: IgBar) => s.label && Number.isFinite(s.value) && s.value >= 0).slice(0, 6);
      return items.length >= 2 ? { type, label, items } : null;
    }
    default: { // نوع ناشناخته: هر چه متن یا فهرست دارد نگه داشته می‌شود
      if (text) return { type: "keyfact", label, text };
      const items = strArr(b?.items).slice(0, 6);
      return items.length ? { type: "bullets", label, items } : null;
    }
  }
}

export function normalizeInfographic(data: any, topic: string): Infographic {
  const sections: IgSection[] = (Array.isArray(data?.sections) ? data.sections : []).slice(0, 6)
    .map((s: any): IgSection => ({
      title: str(s?.title).slice(0, 90),
      blocks: (Array.isArray(s?.blocks) ? s.blocks : []).map(coerceBlock).filter((x: IgBlock | null): x is IgBlock => !!x).slice(0, 3),
    }))
    .filter((s: IgSection) => s.title && s.blocks.length);
  if (sections.length < 2) throw new Error("model returned no valid infographic");
  return {
    title: str(data?.title).slice(0, 140) || topic,
    subtitle: str(data?.subtitle).slice(0, 200),
    sections,
    takeaway: str(data?.takeaway).slice(0, 300),
    image_query: str(data?.image_query).slice(0, 200),
  };
}

// ---------- تولید محتوا ----------
const SCHEMA = `{
  "title": "short Persian title (max 14 words)",
  "subtitle": "one Persian line that says who it is for or what it covers",
  "image_query": "English description of ONE concrete decorative scene that matches the topic (objects, setting; no abstract words; max 14 words)",
  "sections": [
    { "title": "Persian panel title (max 8 words)", "blocks": [ <1 to 3 blocks> ] }
  ],
  "takeaway": "one Persian sentence: the single thing to remember"
}
Block types (use "type" exactly as written):
{"type":"definition","label":"تعریف","text":"..."}            a term and its meaning
{"type":"keyfact","label":"نکته‌ی کلیدی","text":"..."}         the most important point of the panel
{"type":"bullets","label":"","items":["...","...","..."]}      3-4 short bullets
{"type":"stats","items":[{"value":"۱۷","label":"..."}]}        2-3 big numbers, ONLY if the notes or reliable knowledge give them
{"type":"table","headers":["...","..."],"rows":[["...","..."]]}   2-4 columns, 2-5 rows, short cells
{"type":"steps","label":"","items":[{"label":"...","text":"..."}]} 3-5 ordered steps
{"type":"compare","left":{"title":"...","items":["..."]},"right":{"title":"...","items":["..."]}}
{"type":"example","label":"مثال","text":"..."}                 a worked example; numbers must be consistent
{"type":"formula","label":"","text":"..."}                     a short formula or calculation line
{"type":"bars","label":"","items":[{"label":"...","value":12,"text":"%"}]} comparison of numbers, ONLY with known numbers`;

export async function makeInfographic(env: Env, topic: string, o: { layout: IgLayout; tone?: string; model?: string; research?: string }): Promise<Infographic> {
  if (!hasKey(env)) throw new LlmError("کلید API تنظیم نشده است", true);
  const sections = o.layout === "wide" ? "5 or 6 panels" : "4 or 5 panels";
  const notes = o.research
    ? `\nBackground notes from a live web search (short snippets; may be partial). They are MORE up to date than your own knowledge, so for current rules, dates and figures trust them over your memory. Use a number or rule only if the notes or your reliable knowledge support it; if two sources conflict, avoid the disputed detail. Never copy sentences, never mention "search" or "notes". Ignore snippets unrelated to the topic.\n${o.research}\n`
    : "";
  const prompt = `Design the content of ONE single-page Persian infographic (in the style of a Google NotebookLM infographic: a title bar, then ${sections}, each panel with 1 to 3 compact blocks of different types, then one takeaway line).
Topic: ${topic}
Tone: ${TONES[o.tone ?? ""] ?? TONES.educational}
${notes}
Rules:
- Natural, fluent Persian with correct half-spaces (نیم‌فاصله). Every text is SHORT: a bullet or cell is at most ~12 words; a definition, key fact or example at most ~30 words.
- Order the panels as one story that fits the topic (for example: what it is → how it works → numbers/conditions → example → what to do). Mix block types across the page; do not use only bullets. Use a "table", "steps", "compare" or "example" block where the content really has that shape.
- Never invent statistics, rules, names, quotes or sources. If a figure is not in the notes and you are not sure, leave it out or stay general.
- Use "stats" and "bars" only with real figures. Numbers in an "example" must add up.
- Output language is Persian; only "image_query" is English.
Return ONLY one JSON object with exactly this shape:
${SCHEMA}`;
  const data = await askJson(env, prompt, o.layout === "wide" ? 5200 : 4600, o.model);
  return normalizeInfographic(data, topic);
}

// ---------- تبدیل HTML به تصویر ----------
export interface IgImage { data: Uint8Array; mime: "image/png" | "image/jpeg"; ext: "png" | "jpg" }

/** سقف تلگرام برای sendPhoto ۱۰ مگابایت است؛ بزرگ‌تر از این به JPEG تبدیل می‌شود */
const MAX_PNG = 9_000_000;

export async function renderInfographicImage(env: Env, html: string, width: number): Promise<IgImage> {
  if (!env.BROWSER) throw new Error("Browser Rendering (BROWSER) تعریف نشده است");
  const browser = await launchWithRetry(env);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1.5 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 40_000 });
    await page.evaluate("document.fonts.ready.then(function(){return 1})"); // فونت وب کامل بارگذاری شود
    const png = new Uint8Array((await page.screenshot({ type: "png", fullPage: true })) as any);
    if (png.byteLength < 2000) throw new Error("screenshot is empty");
    if (png.byteLength <= MAX_PNG) return { data: png, mime: "image/png", ext: "png" };
    const jpg = new Uint8Array((await page.screenshot({ type: "jpeg", quality: 92, fullPage: true })) as any);
    return { data: jpg, mime: "image/jpeg", ext: "jpg" };
  } finally {
    await browser.close().catch(() => {});
  }
}
