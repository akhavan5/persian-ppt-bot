/**
 * کلاینت API رسمی Gamma (https://developers.gamma.app) — فقط fetch، بدون وابستگی.
 *
 * - احراز هویت: هدر X-API-KEY (کلید از Gamma ← Settings ← API Keys؛ به‌صورت secret: wrangler secret put GAMMA_API_KEY).
 *   هزینه از کردیت صاحب کلید کم می‌شود. بدون GAMMA_API_KEY همه‌ی قابلیت‌ها خاموش است (gammaEnabled).
 * - دو خانواده‌ی ساخت:
 *   Classic: POST /generations (+ from-template) ← GET /generations/{id}. کنترل کامل: ابعاد کارت، زبان، تصویر، قالب.
 *   Agent (Gamma 5): POST /agent/generations ← GET /agent/generations/{id}. ورودی ساده‌تر (prompt)، بدون textOptions/cardOptions/imageOptions.
 * - export: خودِ ساخت با exportAs یا بعداً با POST /gammas/{id}/export ← GET /exports/{id} (pdf | pptx | png؛ PNG چندکارتی = zip).
 * - کاربرد فعلی پروژه: ۸ خروجی «همراه ارائه» فقط برای مدیر در تلگرام (GAMMA_SPECS پایین فایل؛ دکمه‌های زیر ارائه، extras.ts)؛ دستور /gamma حذف شده است.
 * - فهرست‌ها: /me (کردیت)، /themes، /folders، /templates/search، /gammas/search؛ آپلود: POST /uploads.
 *
 * شکل پاسخ‌های /me، /themes، /folders، /exports و جستجوها در مستندات کامل نبود؛ پس پاسخ‌ها عمداً سست‌تایپ (any) و با چند نام فیلد جایگزین خوانده می‌شوند.
 * خطاها همیشه GammaError با status و کد مشخص‌اند (۴۰۱ کلید نامعتبر، ۴۰۲/۴۰۳ نبودن کردیت، ۴۲۹ سقف نرخ/هم‌زمانی با retryAfter).
 */
import type { Env } from "./env";

const DEFAULT_BASE = "https://public-api.gamma.app/v1.0";
const TIMEOUT_MS = 30_000;

export type GammaFormat = "presentation" | "document" | "social" | "webpage";
export type GammaExport = "pdf" | "pptx" | "png";
/** مقادیر مستندشده‌ی cardOptions.dimensions (Classic). برای کاروسل اینستاگرام: 4x5 یا 1x1 یا 9x16 */
export type GammaDimensions = "16x9" | "1x1" | "4x3" | "4x5" | "9x16" | "a4" | "fluid" | "letter" | "pageless";

export interface GammaTextOptions { tone?: string; audience?: string; language?: string; amount?: "brief" | "medium" | "detailed" | "extensive" | string }
export interface GammaImageOptions { source?: string; model?: string; style?: string }
export interface GammaCardOptions { dimensions?: GammaDimensions; headerFooter?: unknown }

export interface GammaGenerateInput {
  inputText?: string;
  pages?: unknown[];
  textMode?: "generate" | "condense" | "preserve";
  format?: GammaFormat;
  numCards?: number;
  cardSplit?: string;
  themeId?: string;
  title?: string;
  exportAs?: GammaExport;
  folderId?: string;
  sharingOptions?: Record<string, unknown>;
  textOptions?: GammaTextOptions;
  imageOptions?: GammaImageOptions;
  cardOptions?: GammaCardOptions;
  /** راهنمای کلی ظاهر و زبان (حداکثر ۵۰۰۰ نویسه) */
  additionalInstructions?: string;
}

export interface GammaAgentInput {
  prompt: string;
  format?: Exclude<GammaFormat, "webpage">;
  numCards?: number;
  quality?: "lite" | "standard" | "max";
  themeId?: string;
  templateId?: string;
  sourceUrls?: string[];
  files?: string[];
  additionalInstructions?: string;
  exportAs?: GammaExport;
  sharingOptions?: Record<string, unknown>;
  folderId?: string;
  disableConnectors?: boolean;
  pace?: string;
}

export interface GammaStatus {
  id: string;
  /** pending = در حال ساخت؛ completed؛ failed */
  state: "pending" | "completed" | "failed";
  raw: any;
  gammaId?: string;
  gammaUrl?: string;
  exportUrl?: string;
  creditsDeducted?: number;
  creditsRemaining?: number;
  percent?: number;
  error?: string;
  warnings?: unknown[];
}

export class GammaError extends Error {
  constructor(message: string, public status: number, public code?: string, public retryAfter?: number, public body?: unknown) {
    super(message);
    this.name = "GammaError";
  }
  /** خطاهایی که تکرار همان درخواست شاید جواب بدهد (نه کلید/کردیت/ورودی نامعتبر) */
  get retryable() { return this.status === 429 || this.status >= 500 || this.status === 0; }
  get noCredits() { return this.status === 402 || this.status === 403 || this.code === "insufficient_credits"; }
}

export const gammaEnabled = (env: Env) => !!env.GAMMA_API_KEY?.trim();
const base = (env: Env) => (env.GAMMA_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, "");

type Query = Record<string, string | number | boolean | undefined>;

async function call<T = any>(env: Env, method: "GET" | "POST" | "DELETE", path: string, opts: { body?: unknown; query?: Query; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const key = env.GAMMA_API_KEY?.trim();
  if (!key) throw new GammaError("GAMMA_API_KEY تنظیم نشده است", 0, "no_key");
  const url = new URL(base(env) + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { "X-API-KEY": key, Accept: "application/json", ...opts.headers };
  let body: BodyInit | undefined = opts.raw;
  if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new GammaError(`ارتباط با Gamma برقرار نشد: ${String(e).slice(0, 120)}`, 0, "network");
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* پاسخ غیر JSON */ }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.message ?? (typeof json?.error === "string" ? json.error : "") ?? "";
    const code = json?.error?.code ?? json?.error?.reason ?? json?.code;
    const ra = Number(res.headers.get("Retry-After"));
    throw new GammaError(`Gamma HTTP ${res.status}${msg ? `: ${String(msg).slice(0, 200)}` : text ? `: ${text.slice(0, 120)}` : ""}`, res.status, code ? String(code) : undefined, Number.isFinite(ra) && ra > 0 ? ra : undefined, json ?? text);
  }
  return json as T;
}

// ---------- ساخت ----------
/** Classic: POST /generations */
export async function createGeneration(env: Env, input: GammaGenerateInput): Promise<{ generationId: string; warnings?: unknown[] }> {
  const r = await call<any>(env, "POST", "/generations", { body: input });
  const id = r?.generationId ?? r?.id;
  if (!id) throw new GammaError("پاسخ Gamma شناسه‌ی ساخت ندارد", 502, "bad_response", undefined, r);
  return { generationId: String(id), warnings: r?.warnings };
}
/** Classic از روی قالب: POST /generations/from-template (gammaId = قالب) */
export async function createFromTemplate(env: Env, input: { gammaId: string; prompt: string; themeId?: string; folderId?: string; exportAs?: GammaExport; imageOptions?: GammaImageOptions; sharingOptions?: Record<string, unknown> }): Promise<{ generationId: string; warnings?: unknown[] }> {
  const r = await call<any>(env, "POST", "/generations/from-template", { body: input });
  const id = r?.generationId ?? r?.id;
  if (!id) throw new GammaError("پاسخ Gamma شناسه‌ی ساخت ندارد", 502, "bad_response", undefined, r);
  return { generationId: String(id), warnings: r?.warnings };
}
/** Gamma 5 agent: POST /agent/generations */
export async function createAgentGeneration(env: Env, input: GammaAgentInput): Promise<{ generationId: string; warnings?: unknown[] }> {
  const r = await call<any>(env, "POST", "/agent/generations", { body: input });
  const id = r?.generationId ?? r?.id;
  if (!id) throw new GammaError("پاسخ Gamma شناسه‌ی ساخت ندارد", 502, "bad_response", undefined, r);
  return { generationId: String(id), warnings: r?.warnings };
}

// ---------- وضعیت ----------
function normalize(id: string, r: any): GammaStatus {
  const s = String(r?.status ?? "").toLowerCase();
  const state: GammaStatus["state"] = s === "completed" || s === "complete" || s === "done" || s === "succeeded" ? "completed" : s === "failed" || s === "error" ? "failed" : "pending";
  const credits = r?.credits ?? {};
  const errMsg = r?.error ? [r.error.reason, r.error.message].filter(Boolean).join(": ") || String(r.error) : undefined;
  return {
    id, state, raw: r,
    gammaId: r?.gamma?.gammaId ?? r?.gammaId,
    gammaUrl: r?.gamma?.gammaUrl ?? r?.gammaUrl,
    exportUrl: r?.exportUrl ?? r?.gamma?.exportUrl,
    creditsDeducted: typeof credits.deducted === "number" ? credits.deducted : undefined,
    creditsRemaining: typeof credits.remaining === "number" ? credits.remaining : undefined,
    percent: typeof r?.progress?.percent === "number" ? r.progress.percent : undefined,
    error: state === "failed" ? (errMsg ?? "ساخت ناموفق بود") : undefined,
    warnings: r?.warnings,
  };
}
export async function getGeneration(env: Env, id: string): Promise<GammaStatus> {
  return normalize(id, await call(env, "GET", `/generations/${encodeURIComponent(id)}`));
}
export async function getAgentGeneration(env: Env, id: string): Promise<GammaStatus> {
  return normalize(id, await call(env, "GET", `/agent/generations/${encodeURIComponent(id)}`));
}

// ---------- export ----------
/** درخواست export بعد از ساخت (وقتی exportAs در ساخت نبوده). سپس getExport را poll کنید. */
export async function exportGamma(env: Env, gammaId: string, exportAs: GammaExport): Promise<{ exportId?: string; exportUrl?: string; raw: any }> {
  const r = await call<any>(env, "POST", `/gammas/${encodeURIComponent(gammaId)}/export`, { body: { exportAs } });
  return { exportId: r?.exportId ?? r?.id, exportUrl: r?.exportUrl ?? r?.url, raw: r };
}
export async function getExport(env: Env, exportId: string): Promise<{ state: GammaStatus["state"]; exportUrl?: string; error?: string; raw: any }> {
  const r = await call<any>(env, "GET", `/exports/${encodeURIComponent(exportId)}`);
  const n = normalize(exportId, r);
  return { state: n.state, exportUrl: n.exportUrl ?? r?.url, error: n.error, raw: r };
}
/** دانلود فایل export (لینک حدود یک هفته معتبر است؛ بدون هدر کلید) */
export async function downloadExport(url: string, maxBytes = 40 * 1024 * 1024): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new GammaError(`دانلود فایل Gamma ناموفق بود (HTTP ${res.status})`, res.status, "download");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new GammaError("فایل Gamma از سقف حجم بزرگ‌تر است", 413, "too_large");
  return buf;
}

// ---------- حساب و فهرست‌ها ----------
export const getMe = (env: Env) => call<any>(env, "GET", "/me");
export const listThemes = (env: Env, query: Query = {}) => call<any>(env, "GET", "/themes", { query });
export const listFolders = (env: Env, query: Query = {}) => call<any>(env, "GET", "/folders", { query });
export const searchTemplates = (env: Env, query: Query) => call<any>(env, "GET", "/templates/search", { query });
export const searchGammas = (env: Env, query: Query) => call<any>(env, "GET", "/gammas/search", { query });

// ---------- آپلود (ورودی فایل برای agent) ----------
/** POST /uploads: بدنه‌ی octet-stream؛ mimeType در query، نام فایل (percent-encoded) در هدر x-harness-upload-name. سقف مستندشده: ۲۵۰ مگابایت */
export async function uploadFile(env: Env, data: Uint8Array, filename: string, mimeType: string): Promise<{ uploadId: string; filename?: string; name?: string; mimeType?: string; size?: number }> {
  const r = await call<any>(env, "POST", "/uploads", {
    query: { mimeType },
    headers: { "Content-Type": "application/octet-stream", "x-harness-upload-name": encodeURIComponent(filename), "Content-Length": String(data.byteLength) },
    raw: data as unknown as BodyInit,
  });
  if (!r?.uploadId) throw new GammaError("پاسخ آپلود Gamma شناسه ندارد", 502, "bad_response", undefined, r);
  return r;
}

// ---------- خروجی‌های Gamma زیر ارائه (کاروسل، پست، استوری، بنر، تصویر بازاریابی، اینفوگرافیک، اسلاید تک‌کارتی، سند) ----------
/** شناسه‌ی هر خروجی؛ هم نوع «همراه» (extras.ts) و هم بخش پایانی شناسه‌ی کار است */
export type GammaKind = "gpost" | "gcarousel" | "gstory" | "gbanner" | "gimage" | "ginfo" | "gslide" | "gdoc";

/** قیمت هر خروجی برای کاربر: ۱ اعتبار (مثل جزوه و پادکست) */
export const GAMMA_CREDIT_COST = 1;

/**
 * کمترین هزینه‌ی ممکن در Gamma (Classic: هزینه = تعداد کارت × ۱ تا ۳ + تعداد تصویر × قیمت مدل تصویر):
 *  • مدل تصویر ارزان‌ترین مدل (۲ کردیت برای هر تصویر)، نه انتخاب خودکار Gamma که ممکن است مدل گران بردارد؛
 *  • هیچ مدل هوش مصنوعی دیگری در کار نیست: فقط «متن منبع» (محتوای ارائه) و دستور طراحی به Gamma داده می‌شود
 *    و نوشتن متن و طراحی کامل با خودِ Gamma است (textMode=generate)؛
 *  • تعداد کارت با numCards ثابت می‌شود و برای همه‌ی خروجی‌ها کوچک‌ترین تعداد، یعنی ۱ کارت است.
 */
export const GAMMA_CHEAPEST_IMAGE_MODEL = "flux-1-quick";

export interface GammaKindSpec {
  kind: GammaKind;
  /** کد کوتاه دکمه‌ی تلگرام: ex:<کد>:<شناسه‌ی ارائه> (همه با «g» شروع می‌شوند تا از کدهای قدیمی جدا بمانند) */
  code: string;
  /** نام فارسی (در پیام‌ها) و متن دکمه */
  name: string;
  button: string;
  format: GammaFormat;
  /** باید با format سازگار باشد: social ← 1x1 | 4x5 | 9x16، presentation ← 16x9، document ← a4 | pageless */
  dimensions: GammaDimensions;
  /** تعداد کارت‌هایی که Gamma می‌سازد (min…max)؛ مقدار max به‌عنوان numCards فرستاده می‌شود و هزینه‌ی کارت‌ها را تعیین می‌کند */
  cards: { min: number; max: number };
  exportAs: GammaExport;
  /** شرح خروجی برای Gamma (additionalInstructions؛ انگلیسی، خروجی فارسی است) */
  brief: string;
  /** پسوند و نوع فایل تحویلی وقتی خروجی یک فایل است (pptx/pdf) */
  file?: { ext: "pptx" | "pdf"; mime: string };
}

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const GAMMA_SPECS: GammaKindSpec[] = [
  {
    kind: "gpost", code: "gp", name: "پست", button: "📸 پست", format: "social", dimensions: "1x1", cards: { min: 1, max: 1 }, exportAs: "png",
    brief: "ONE square Instagram post card: a short bold headline (max 8 words), one supporting line (max 18 words) and one tiny call-to-action line. Scroll-stopping, minimal, lots of white space.",
  },
  {
    kind: "gcarousel", code: "gc", name: "کاروسل", button: "🎠 کاروسل", format: "social", dimensions: "4x5", cards: { min: 1, max: 1 }, exportAs: "png",
    brief: "ONE single Instagram carousel card (4:5) that summarises the whole topic: a hooking title (max 8 words), then 3 short key points (max 8 words each) and a tiny call-to-action line (save, share, follow).",
  },
  {
    kind: "gstory", code: "gs", name: "استوری", button: "📱 استوری", format: "social", dimensions: "9x16", cards: { min: 1, max: 1 }, exportAs: "png",
    brief: "ONE single vertical Instagram STORY frame (9:16): a hook question or bold claim, the key answer or fact with one number or keyword highlighted, and a tiny call to action. Very little text (max 20 words in total), big type.",
  },
  {
    kind: "gbanner", code: "gb", name: "بنر", button: "🏷 بنر", format: "presentation", dimensions: "16x9", cards: { min: 1, max: 1 }, exportAs: "png",
    brief: "ONE wide web BANNER (16:9): a strong headline (max 7 words), a one-line subheadline (max 12 words) and a short button-style call to action (2-3 words). Nothing else.",
  },
  {
    kind: "gimage", code: "gm", name: "تصویر بازاریابی", button: "🎯 تصویر بازاریابی", format: "social", dimensions: "1x1", cards: { min: 1, max: 1 }, exportAs: "png",
    brief: "ONE square MARKETING image (ad creative): the single most persuasive benefit as a big headline (max 6 words), a one-line proof or hook (max 12 words) and a call to action (2-3 words). Visual-first: describe in the headline's neighbourhood a strong, concrete product/scene feel; promotional tone, no clutter.",
  },
  {
    kind: "ginfo", code: "gn", name: "اینفوگرافیک", button: "📊 اینفوگرافیک", format: "document", dimensions: "pageless", cards: { min: 1, max: 1 }, exportAs: "png",
    brief: "ONE tall single-page INFOGRAPHIC: a title, then 4-6 compact sections in a logical flow (what it is → how it works → key numbers → tips/mistakes → quick summary). Use short phrases, numbered steps, comparisons or key figures; only real figures that appear in the source.",
  },
  {
    kind: "gslide", code: "gl", name: "اسلاید تک‌کارتی", button: "🖥 اسلاید تکی", format: "presentation", dimensions: "16x9", cards: { min: 1, max: 1 }, exportAs: "pptx",
    brief: "ONE single presentation slide (16:9) that summarises the whole topic: a clear title, then 3-4 short key points (max 10 words each) or a small 3-step process.",
    file: { ext: "pptx", mime: PPTX_MIME },
  },
  {
    kind: "gdoc", code: "gd", name: "سند", button: "📄 سند", format: "document", dimensions: "a4", cards: { min: 1, max: 1 }, exportAs: "pdf",
    brief: "ONE single A4 page DOCUMENT (one card): a title, a two-line summary, then 3-4 short headed sections with concise paragraphs or bullets (about 120-160 Persian words in total) and a one-line takeaway.",
    file: { ext: "pdf", mime: "application/pdf" },
  },
];
export const GAMMA_KINDS: GammaKind[] = GAMMA_SPECS.map((s) => s.kind);
export const gammaSpec = (kind: string): GammaKindSpec | undefined => GAMMA_SPECS.find((s) => s.kind === kind);
export const isGammaKind = (k: unknown): k is GammaKind => GAMMA_SPECS.some((s) => s.kind === k);

/** تنها دو محافظ لازم؛ بقیه‌ی طراحی و نوشتن با خلاقیت خودِ Gamma است: وفاداری به واقعیت‌های منبع، و تصویر بدون حروف (حروف فارسیِ تصویرهای AI خراب می‌شود) */
const GUARD_RULES = "Use only facts from the source; do not invent statistics, names or quotes. Images must not contain any letters, words or numbers.";

/**
 * ساخت یک خروجی Gamma با ارزان‌ترین تنظیمات (Classic).
 * source = متن منبع (محتوای ارائه) که همین‌طور به Gamma داده می‌شود؛ هیچ مدل دیگری بین راه نیست.
 */
export async function createGammaExtra(env: Env, spec: GammaKindSpec, source: string, title?: string): Promise<{ generationId: string; warnings?: unknown[] }> {
  const input: GammaGenerateInput = {
    inputText: source.trim().slice(0, 14000),
    textMode: "generate",
    format: spec.format,
    numCards: spec.cards.max,
    cardOptions: { dimensions: spec.dimensions },
    textOptions: { language: "fa", amount: "brief" },
    imageOptions: { source: "aiGenerated", model: GAMMA_CHEAPEST_IMAGE_MODEL, style: "flat minimal illustration, no text" },
    exportAs: spec.exportAs,
    additionalInstructions: GUARD_RULES,
    ...(title ? { title: title.slice(0, 200) } : {}),
  };
  return createGeneration(env, input);
}
