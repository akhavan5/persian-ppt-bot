/** فایل‌های «نمونه»: مدیر هر فایلی را که ساخته با دکمه‌ی «⭐ نمونه کردن» در ربات به نمونه تبدیل می‌کند.
 *  بایت‌ها بدون هیچ تغییری و بدون انقضا در KV واقعی (FILES) با کلید sample:<id> ذخیره می‌شوند؛ فهرست در D1 (samples:list).
 *  شناسه‌ی نمونه با پسوند نوع تمام می‌شود (…-podcast / …-audio) تا تشخیص نوع در وب و Mini App (audioKind) بدون تغییر کار کند. */
import type { Env } from "./env";
import { FONT_URL } from "./themes";
import { toFa } from "./util";
import { cachedPdf } from "./pdf";
import { loadFile, type FileEntry } from "./files";
import type { Uid } from "./settings";

export type SampleKind = "deck" | "audio" | "podcast" | "poster" | "handout" | "pdf";
export interface SampleEntry { id: string; kind: SampleKind; name: string; title: string; slides: number; t: number; /** منبع (کاربر:فایل) برای جلوگیری از تکرار */ src: string }

export const SAMPLE_BADGE = "نمونه";
const MAX_SAMPLES = 24;
const MAX_BYTES = 24 * 1024 * 1024; // سقف مقدار در KV ۲۵ مگابایت است
const LIST_KEY = "samples:list";
const bytesKey = (id: string) => `sample:${id}`;

const MIME: Record<SampleKind, string> = {
  deck: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  audio: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  podcast: "audio/wav", poster: "image/png", handout: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf",
};
const LABEL: Record<SampleKind, string> = { deck: "📥 ارائه", audio: "🔊 اسلاید صوتی", podcast: "🎙 پادکست", poster: "🖼 پوستر", handout: "📝 جزوه (Word)", pdf: "📄 PDF" };
const FONT_NOTE = `\n\n🔤 برای نمایش درست، فونت <a href="${FONT_URL}">Vazirmatn</a> را روی دستگاهت نصب کن؛ یا در /settings فونت Tahoma را انتخاب کن.`;
const escH = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const isSampleId = (id: string) => /^sample-[a-z0-9]+-(deck|poster|handout|audio|podcast|pdf)$/.test(id);
export const sampleMime = (e: SampleEntry) => (e.kind === "poster" && /\.jpe?g$/i.test(e.name) ? "image/jpeg" : MIME[e.kind]);
export const sampleLabel = (e: SampleEntry) => (e.kind === "audio" && e.slides ? `${LABEL.audio} · ${toFa(String(e.slides))} اسلاید` : e.kind === "deck" && e.slides ? `${LABEL.deck} · ${toFa(String(e.slides))} اسلاید` : LABEL[e.kind]);

/** کپشن آماده‌ی ارسال در ربات (HTML) */
export function sampleCaption(e: SampleEntry): string {
  const t = escH(e.title);
  switch (e.kind) {
    case "podcast": return `🎙 <b>${t}</b>`;
    case "audio": return `🔊 <b>${t}</b>\nصدای ${e.slides ? toFa(String(e.slides)) + " " : ""}اسلاید داخل خود اسلایدها گذاشته شده است؛ در حالت نمایش (Slide Show) خودکار پخش می‌شود و بعد از پایان صدا اسلاید عوض می‌شود.${FONT_NOTE}`;
    case "poster": return `🖼 <b>${t}</b>\nپوستر (اینفوگرافیک)`;
    case "handout": return `📝 <b>${t}</b>\nجزوه‌ی Word${FONT_NOTE}`;
    case "pdf": return `📄 <b>${t}</b>\nنسخه‌ی PDF`;
    default: return `✅ <b>${t}</b>${FONT_NOTE}`;
  }
}

export async function listSamples(env: Env): Promise<SampleEntry[]> {
  const raw = (await env.KV.get(LIST_KEY, "json").catch(() => null)) as SampleEntry[] | null;
  return Array.isArray(raw) ? raw.filter((x) => x && isSampleId(x.id)) : [];
}
export async function sampleById(env: Env, id: string): Promise<SampleEntry | undefined> {
  return isSampleId(id) ? (await listSamples(env)).find((x) => x.id === id) : undefined;
}

/** نوع فایل از روی شناسه و پسوند: poster/handout/audio/podcast پسوند شناسه دارند؛ بقیه ارائه‌اند */
function kindOf(srcId: string, name: string, asPdf: boolean): SampleKind | null {
  if (asPdf) return "pdf";
  if (/-audio-s\d+$/.test(srcId)) return null; // صدای تک‌اسلاید نمونه نمی‌شود
  if (/-podcast(-\d+)?$/.test(srcId)) return "podcast";
  if (/-audio$/.test(srcId)) return "audio";
  if (/-poster$/.test(srcId) || /\.(png|jpe?g)$/i.test(name)) return "poster";
  if (/-handout$/.test(srcId) || /\.docx$/i.test(name)) return "handout";
  if (/\.pptx$/i.test(name)) return "deck";
  return null;
}

/** فایل کاربر را (بدون تغییر) نمونه‌ی دائمی می‌کند. asPdf: PDF ذخیره‌شده‌ی همان ارائه. دوباره زدن، همان نمونه را به‌روز می‌کند. */
export async function addSample(env: Env, userId: Uid, srcId: string, asPdf = false): Promise<{ ok: true; entry: SampleEntry; replaced: boolean } | { ok: false; error: string }> {
  const f = await loadFile(env, userId, srcId);
  if (!f) return { ok: false, error: "این فایل دیگر در دسترس نیست (فایل‌ها ۲۴ ساعت نگه داشته می‌شوند)." };
  const kind = kindOf(srcId, f.entry.name, asPdf);
  if (!kind) return { ok: false, error: "این نوع فایل را نمی‌شود نمونه کرد." };
  let data: ArrayBuffer | Uint8Array = f.data, name = f.entry.name;
  if (asPdf) {
    const pdf = await cachedPdf(env, userId, srcId);
    if (!pdf) return { ok: false, error: "برای این ارائه هنوز PDF ساخته نشده؛ اول دکمه‌ی «📄 PDF» را بزن." };
    data = pdf; name = f.entry.name.replace(/\.[^.]+$/, "") + ".pdf";
  }
  if (data.byteLength > MAX_BYTES) return { ok: false, error: "حجم فایل از سقف ۲۴ مگابایت بیشتر است." };
  const src = `${userId}:${srcId}${asPdf ? ":pdf" : ""}`;
  const list = await listSamples(env);
  const prev = list.find((x) => x.src === src);
  const id = prev?.id ?? `sample-${Date.now().toString(36)}-${kind}`;
  if (!prev && list.length >= MAX_SAMPLES) return { ok: false, error: `حداکثر ${toFa(String(MAX_SAMPLES))} نمونه می‌شود؛ اول یکی را با /samples حذف کن.` };
  const entry: SampleEntry = { id, kind, name, title: f.entry.title, slides: kind === "pdf" || kind === "deck" || kind === "audio" ? f.entry.slides : 0, t: prev?.t ?? Date.now(), src };
  await env.FILES.put(bytesKey(id), data as ArrayBuffer, { metadata: { name, title: entry.title.slice(0, 120), slides: entry.slides, t: entry.t } }); // بدون expirationTtl = دائمی
  await env.KV.put(LIST_KEY, JSON.stringify(prev ? list.map((x) => (x.id === id ? entry : x)) : [...list, entry]));
  return { ok: true, entry, replaced: !!prev };
}

export async function removeSample(env: Env, id: string): Promise<boolean> {
  const list = await listSamples(env);
  if (!list.some((x) => x.id === id)) return false;
  await env.KV.put(LIST_KEY, JSON.stringify(list.filter((x) => x.id !== id)));
  await env.FILES.delete(bytesKey(id)).catch(() => {});
  return true;
}

/** بایت‌های نمونه برای دانلود/ارسال؛ فقط اگر در فهرست باشد */
export async function loadSample(env: Env, id: string): Promise<{ entry: FileEntry; data: ArrayBuffer } | null> {
  const s = await sampleById(env, id);
  if (!s) return null;
  const data = await env.FILES.get(bytesKey(id), "arrayBuffer");
  return data ? { entry: { id, name: s.name, title: s.title, slides: s.slides, t: s.t }, data } : null;
}
