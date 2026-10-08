/**
 * فرایند واحد «شروع یک ارائه» برای همه‌ی کانال‌ها (وب و تلگرام).
 * کانال‌ها فقط ورودی را آماده می‌کنند و خروجی را نشان می‌دهند؛ قوانین (سقف اسلاید/تصویر بر اساس پلن، اعتبار، قفل، برگشت اعتبار)
 * فقط اینجاست. اجرای اصلی همان DeckWorkflow است که از قبل مشترک بود.
 */
import type { Env } from "./env";
import type { DeckParams, Settings } from "./types";
import {
  FREE_MAX_IMAGES, FREE_MAX_SLIDES, acquireLock, bumpStat, clampSlides, getSettings, isLocked, maxImagesFor, maxSlidesFor,
  refundCredit, releaseLock, spendCredit,
} from "./settings";
import { PLANS } from "./payment";
import { toFa } from "./util";
import { supportLink, type Uid } from "./settings";
import { createLoginToken } from "./link";

export const siteUrl = (env: Env) => (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");

export const BUY_SITE_NOTE = "💰 پلن‌های پلاس و پرو (اسلاید، تصویر و اعتبار بیشتر) با دکمه‌ی زیر در سایت خریداری می‌شوند؛ با همین حساب تلگرامت خودکار وارد می‌شوی و پلن همین‌جا هم فعال می‌شود.";
/** دکمه‌های خرید: لینک ورود یک‌بارمصرف (کاربر بدون ثبت‌نام، واردشده به سایت می‌رسد)؛ tgId نبود ⇒ لینک ساده‌ی سایت */
export async function buyKbFor(env: Env, uid: Uid, tgId?: number) {
  return { reply_markup: { inline_keyboard: [
    [{ text: "🌐 خرید پلن در سایت (ورود خودکار)", url: await siteLoginUrl(env, tgId, "buy") }],
    [{ text: "💬 پیام به پشتیبانی", url: supportLink(tgId ?? uid) }],
  ] } };
}
/** آدرس سایت با ورود خودکار برای این تلگرام؛ به مقصد to می‌رود (buy = پنجره‌ی پلن‌ها) */
export async function siteLoginUrl(env: Env, tgId: number | undefined, to: "buy" | "home" = "home"): Promise<string> {
  const base = siteUrl(env);
  const t = tgId === undefined ? null : await createLoginToken(env, tgId).catch(() => null);
  return t ? `${base}/api/auth/tg?t=${t}&to=${to}` : to === "buy" ? `${base}/?buy=1` : base;
}

export const imagesLimitMsg = (max: number) => max <= FREE_MAX_IMAGES
  ? `در پلن رایگان حداکثر ${toFa(String(FREE_MAX_IMAGES))} تصویر در هر ارائه می‌گیری؛ برای تصویر بیشتر پلن پلاس (تا ${toFa(String(PLANS[0].maxImages))} تصویر) یا پرو (تا ${toFa(String(PLANS[1].maxImages))} تصویر) را بگیر.`
  : `سقف پلن تو ${toFa(String(max))} تصویر در هر ارائه است.`;
export const slidesLimitMsg = (max: number) => max <= FREE_MAX_SLIDES
  ? `در پلن رایگان حداکثر ${toFa(String(FREE_MAX_SLIDES))} اسلاید می‌توانی بسازی؛ برای تعداد بیشتر پلن پلاس (تا ${toFa(String(PLANS[0].maxSlides))} اسلاید) یا پرو (تا ${toFa(String(PLANS[1].maxSlides))} اسلاید) را بگیر.`
  : `پلن فعلی تو حداکثر ${toFa(String(max))} اسلاید در هر ارائه را پشتیبانی می‌کند؛ برای تعداد بیشتر پلن را ارتقا بده.`;

/** قفل «در حال ساخت» در KV نگه داشته می‌شود و KV سازگاری نهایی دارد: حذف قفل (که Workflow پس از اتمام انجام می‌دهد) تا حدود یک دقیقه
 *  در بعضی نقاط هنوز دیده می‌شود. وضعیت قطعی از خود Workflow (سازگاری قوی) خوانده می‌شود: اگر کار قبلی تمام/خطادار شده باشد،
 *  قفل باقی‌مانده نادیده گرفته می‌شود. */
export async function runningJob(env: Env, userId: string | number): Promise<{ busy: boolean; jobId: string | null }> {
  if (!(await isLocked(env, userId))) return { busy: false, jobId: null };
  const jobId = await env.KV.get(`wj:${userId}`);
  if (jobId) {
    const inst = await env.DECK_WORKFLOW.get(jobId).catch(() => null);
    const st = inst ? await inst.status().catch(() => null) : null;
    if (st && (st.status === "complete" || st.status === "errored" || st.status === "terminated")) {
      await releaseLock(env, userId).catch(() => {});
      return { busy: false, jobId: null };
    }
  }
  return { busy: true, jobId };
}

/** متن فایل آپلودی: حذف نویسه‌های کنترلی و نشانگرهای پرامپت، فشرده‌سازی فاصله‌ها، سقف ۱۲ هزار نویسه */
export const MAX_SOURCE_CHARS = 12000;
export function cleanSource(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/<<<DOCUMENT|DOCUMENT>>>/g, " ")
    .replace(/\r\n?/g, "\n").replace(/[ \t\u00A0]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim().slice(0, MAX_SOURCE_CHARS);
}

export interface Denied { error: string; status: number; needPlan?: boolean; noCredit?: boolean; busy?: boolean }
type Quota = Awaited<ReturnType<typeof spendCredit>>;
export type Begin =
  | { ok: true; topic: string; source: string; settings: Settings; imageCount: number; quota: Quota; undo: () => Promise<void> }
  | { ok: false; denied: Denied };

const deny = (error: string, status: number, extra: Partial<Denied> = {}): Begin => ({ ok: false, denied: { error, status, ...extra } });

/**
 * اعتبارسنجی + کسر اعتبار + قفل. uid: شناسه‌ی اصلی کاربر (حساب وب یا تلگرامِ بدون اتصال).
 * بعد از موفقیت، فراخواننده باید یا launchDeck را صدا بزند یا (در صورت خطا) undo را.
 */
export async function beginDeck(env: Env, uid: string | number, topicRaw: string, want: { slides?: number; imageCount?: number; source?: unknown } = {}): Promise<Begin> {
  const topic = topicRaw.replace(/\s+/g, " ").trim();
  if (topic.length < 3) return deny("موضوع خیلی کوتاه است؛ کمی کامل‌تر بنویس.", 400);
  if (topic.length > 600) return deny("موضوع بیش از حد طولانی است (حداکثر ۶۰۰ کاراکتر).", 400);

  const source = cleanSource(want.source);
  if (want.source && source.length < 30) return deny("متن فایل خیلی کوتاه یا خالی است؛ فایل دیگری را امتحان کن.", 400);

  const [maxSlides, maxImg] = await Promise.all([maxSlidesFor(env, uid), maxImagesFor(env, uid)]);
  const wantSlides = typeof want.slides === "number" && Number.isFinite(want.slides) ? Math.round(want.slides) : undefined;
  if (wantSlides !== undefined && wantSlides > maxSlides) return deny(slidesLimitMsg(maxSlides), 403, { needPlan: true });
  const wantImgs = typeof want.imageCount === "number" && Number.isFinite(want.imageCount) ? Math.round(want.imageCount) : undefined;
  if (wantImgs !== undefined && wantImgs > maxImg) return deny(imagesLimitMsg(maxImg), 403, { needPlan: true });

  if ((await runningJob(env, uid)).busy) return deny("ارائه‌ی قبلی هنوز در حال ساخته شدن است؛ کمی صبر کن.", 409, { busy: true });

  const quota = await spendCredit(env, uid);
  if (!quota.ok) return deny("اعتبارت تمام شده است.", 402, { noCredit: true });
  await acquireLock(env, uid);

  const settings = await getSettings(env, uid);
  settings.slides = wantSlides !== undefined ? clampSlides(wantSlides, maxSlides) : Math.min(settings.slides, maxSlides);
  const imgWanted = wantImgs ?? (settings.imageCount ?? (settings.images ? FREE_MAX_IMAGES : 0));
  const imageCount = Math.max(0, Math.min(imgWanted, maxImg));
  settings.images = imageCount > 0;
  if (settings.mode === "student") settings.slides = Math.max(settings.slides, 8); // ساختار دانشجویی حداقل ۸ اسلاید می‌خواهد

  let undone = false;
  const undo = async () => { // idempotent: دوبار صدا زدن اعتبار را دوبار برنمی‌گرداند
    if (undone) return;
    undone = true;
    await refundCredit(env, uid, quota.source, quota.day).catch((e) => console.error("refund", e));
    await releaseLock(env, uid).catch((e) => console.error("unlock", e));
  };
  return { ok: true, topic, source, settings, imageCount, quota, undo };
}

export interface Delivery { chatId: number; statusMessageId: number; channel: "web" | "telegram"; tgId?: number }

/** ساخت نمونه‌ی Workflow. شناسه‌ی کار = شناسه‌ی نمونه‌ی Workflow. در صورت شکست، اعتبار برمی‌گردد و false برمی‌گرداند. */
export async function launchDeck(env: Env, b: Extract<Begin, { ok: true }>, uid: string | number, jobId: string, d: Delivery): Promise<boolean> {
  const params: DeckParams = {
    chatId: d.chatId, statusMessageId: d.statusMessageId, userId: uid, channel: d.channel, tgId: d.tgId,
    topic: b.topic, ...(b.source ? { source: b.source } : {}), settings: b.settings, maxImages: b.imageCount, credit: b.quota.source, day: b.quota.day,
  };
  try {
    if (d.channel === "web") await env.KV.put(`job:${jobId}`, "⏳ در صف…", { expirationTtl: 3600 });
    await env.KV.put(`wj:${uid}`, jobId, { expirationTtl: 900 });
    await env.DECK_WORKFLOW.create({ id: jobId, params });
  } catch (e) {
    console.error("workflow create failed", e);
    await b.undo();
    return false;
  }
  await bumpStat(env, "started").catch(() => {});
  return true;
}
