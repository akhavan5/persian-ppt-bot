/**
 * فرایند واحد «شروع یک ارائه» برای همه‌ی کانال‌ها (وب و تلگرام).
 * کانال‌ها فقط ورودی را آماده می‌کنند و خروجی را نشان می‌دهند؛ قوانین (سقف اسلاید/تصویر بر اساس پلن، اعتبار، قفل، برگشت اعتبار)
 * فقط اینجاست. اجرای اصلی همان DeckWorkflow است که از قبل مشترک بود.
 */
import type { Env } from "./env";
import type { DeckParams, Mode, Settings } from "./types";
import { MODES, isMode } from "./themes";
import {
  EXTRA_MODE_MSG, FREE_MAX_IMAGES, FREE_MAX_SLIDES, acquireLock, botPlatform, bumpStat, canUseMode, clampSlides, getSettings, imageCountFor, hasPlanAccess, isLocked, maxImagesFor, maxSlidesFor,
  refundCredit, releaseLock, spendCredit, type Platform,
} from "./settings";
import { PLANS } from "./payment";
import { toFa } from "./util";
import { hasBrowser } from "./browser-api";
import { supportLink, type Uid } from "./settings";
import { createLoginToken } from "./link";
import { isEitaaId } from "./eitaa-format";
import { googleSlidesEnabled } from "./auth";
import { ttsEnabled } from "./gemini-tts";

export const siteUrl = (env: Env) => (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");
/** نام دامنه‌ی سایت (مثل pptsaz.ir)؛ برای واترمارک فایل‌ها و افزودن آدرس سایت به نام فایل‌ها */
export const siteHost = (env: Env) => { try { return new URL(siteUrl(env)).hostname.replace(/^www\./, "") || "pptsaz.ir"; } catch { return "pptsaz.ir"; } };
/** نام فایل خروجی با آدرس سایت: «عنوان - pptsaz.ir.pptx»؛ part = بخش میانی اختیاری (مثل «جزوه»). عنوان از نویسه‌های ممنوعِ نام فایل پاک و کوتاه می‌شود. */
export function fileNameWithSite(env: Env, title: string, ext: string, part = "", max = 50): string {
  const base = title.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || "presentation";
  return `${base}${part ? ` - ${part}` : ""} - ${siteHost(env)}.${ext}`;
}
/** آدرس Mini App تلگرام: مستقیم Worker (بدون پروکسی/دامنه‌ی میانی) تا اتصال کمترین واسطه را داشته باشد. API ها همان‌جا (هم‌مبدأ) صدا زده می‌شوند. */
export const miniappUrl = (env: Env) => (env.MINIAPP_URL || "https://persian-ppt-bot.umz1.workers.dev").replace(/\/+$/, "");

export const BUY_SITE_NOTE = "💰 پلن‌های پلاس و پرو (اسلاید، تصویر و اعتبار بیشتر) با دکمه‌ی زیر در سایت خریداری می‌شوند؛ با همین حساب تلگرامت خودکار وارد می‌شوی و پلن همین‌جا هم فعال می‌شود.\n🎁 هر روز ۱ اعتبار رایگان هم هدیه می‌گیری (ربات برایت پیام می‌دهد).";
/** دکمه‌های خرید: لینک ورود یک‌بارمصرف (کاربر بدون ثبت‌نام، واردشده به سایت می‌رسد)؛ tgId نبود ⇒ لینک ساده‌ی سایت */
export async function buyKbFor(env: Env, uid: Uid, tgId?: number) {
  return { reply_markup: { inline_keyboard: [
    [{ text: "🌐 خرید پلن در سایت (ورود خودکار)", url: await siteLoginUrl(env, tgId, "buy") }],
    [{ text: "💬 پیام به پشتیبانی", url: supportLink(tgId ?? uid) }],
  ] } };
}
/** آدرس سایت با ورود خودکار برای این تلگرام؛ به مقصد to می‌رود (buy = پنجره‌ی پلن‌ها، files = بخش فایل‌ها و در صورت دادن fileId همان فایل) */
export async function siteLoginUrl(env: Env, tgId: number | undefined, to: "buy" | "home" | "files" = "home", fileId?: string): Promise<string> {
  const base = siteUrl(env);
  const f = to === "files" && fileId && /^[\w-]{1,100}$/.test(fileId) ? fileId : "1"; // «1» = فقط بخش فایل‌ها
  const t = tgId === undefined ? null : await createLoginToken(env, tgId).catch(() => null);
  return t ? `${base}/api/auth/tg?t=${t}&to=${to}${to === "files" ? `&f=${encodeURIComponent(f)}` : ""}`
    : to === "buy" ? `${base}/?buy=1` : to === "files" ? `${base}/?files=${encodeURIComponent(f)}` : base;
}

/** کیبورد پیام «فایل آماده شد» (Mini App): دکمه‌ی باز کردن اپ؛ برای کاربر ایتا دکمه‌ی «مشاهده در سایت» هم اضافه می‌شود
 *  (لینک ورود یک‌بارمصرف مستقیم روی همان فایل؛ در ایتا هر دکمه به یک خط لینک زیر پیام تبدیل می‌شود). */
export async function appReadyMarkup(env: Env, tgChat: number, fileId?: string, slides = false): Promise<{ reply_markup: { inline_keyboard: unknown[][] } }> {
  const rows: unknown[][] = [[{ text: "📱 باز کردن اپ", web_app: { url: `${miniappUrl(env)}/app` } }]];
  const slidesOk = slides && !!fileId && googleSlidesEnabled(env); // slides = پیام «ارائه آماده شد» (نه پوستر/جزوه/صوت)
  if (slidesOk && slidesOnChat(env, tgChat)) rows.push(slidesRow(fileId as string));
  if (isEitaaId(tgChat)) {
    // ایتا: دکمه‌ی callback ندارد؛ همین یک لینک ورود یک‌بارمصرف (مستقیم روی همان فایل) هم برای مشاهده و هم برای Google Slides است (دو لینک با یک توکن نمی‌شود)
    const url = await siteLoginUrl(env, tgChat, "files", fileId).catch(() => "");
    if (url) rows.push([{ text: slidesOk ? "🌐 مشاهده در سایت و ساخت Google Slides" : "🌐 مشاهده در سایت", url }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

/** دکمه‌ی «Google Slides» (callback) زیر ارائه در ربات تلگرام، بله، سروش‌پلاس و روبیکا، و فقط وقتی Client ID گوگل تنظیم است.
 *  ایتا دکمه‌ی callback ندارد (فقط متن + لینک)؛ برای ایتا لینک «مشاهده در سایت» در appReadyMarkup با همین هدف برچسب می‌خورد. */
export const slidesOnChat = (env: Env, chatId: number): boolean => googleSlidesEnabled(env) && !isEitaaId(chatId);

/** دکمه‌ی «Google Slides»؛ با زدن آن ربات لینک ورود تازه می‌فرستد (لینک ورود یک‌ساعته است ولی دکمه‌ی زیر ارائه ۲۴ ساعت می‌ماند، پس لینک هنگام زدن ساخته می‌شود) */
export const slidesRow = (id: string): { text: string; callback_data: string }[] => [{ text: "📑 ساخت در Google Slides", callback_data: `gs:${id}` }];

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

/** متن فایل آپلودی: حذف نویسه‌های کنترلی و نشانگرهای پرامپت، فشرده‌سازی فاصله‌ها، سقف ۵۰ هزار نویسه */
export const MAX_SOURCE_CHARS = 120000; // یک سقف ثابت برای همه‌ی مدل‌ها (کوچک‌ترین پنجره ۱۲۸هزار توکن؛ فارسی ≈ ۲ کاراکتر/توکن) // سقف ذخیره؛ سقف واقعی هر مدل در llm.ts (sourceCapFor) اعمال می‌شود
export function cleanSource(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/<<<DOCUMENT|DOCUMENT>>>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // نشانگر تصویر مارک‌داون (بی‌متن) منبع حساب نشود
    .replace(/\r\n?/g, "\n").replace(/[ \t\u00A0]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim().slice(0, MAX_SOURCE_CHARS);
}

export interface Denied { error: string; status: number; needPlan?: boolean; noCredit?: boolean; /** کمبود اعتبار برای همراهان (پوستر/جزوه/اسلاید صوتی/پادکست): متن خطا برای نمایش در پنجره‌ی پلن آماده است */ extras?: boolean; busy?: boolean }
type Quota = Awaited<ReturnType<typeof spendCredit>>;
export type Begin =
  | { ok: true; topic: string; source: string; settings: Settings; imageCount: number; quota: Quota; /** کسر جداگانه‌ی اعتبار پوستر (فقط وقتی پوستر خواسته شده) */ posterQuota: Quota | null; /** کسر جداگانه‌ی اعتبار جزوه (Word) */ handoutQuota: Quota | null; /** کسر جداگانه‌ی اعتبار اسلاید صوتی */ audioQuota: Quota | null; /** کسر جداگانه‌ی اعتبار پادکست */ podcastQuota: Quota | null; undo: () => Promise<void> }
  | { ok: false; denied: Denied };

type Extra = "poster" | "handout" | "audio" | "podcast";
const EXTRA_NAMES: Record<Extra, string> = { poster: "پوستر", handout: "جزوه", audio: "اسلاید صوتی", podcast: "پادکست" };
const deny = (error: string, status: number, extra: Partial<Denied> = {}): Begin => ({ ok: false, denied: { error, status, ...extra } });

/**
 * اعتبارسنجی + کسر اعتبار + قفل. uid: شناسه‌ی اصلی کاربر (حساب وب یا تلگرامِ بدون اتصال).
 * بعد از موفقیت، فراخواننده باید یا launchDeck را صدا بزند یا (در صورت خطا) undo را.
 */
export async function beginDeck(env: Env, uid: string | number, topicRaw: string, want: { slides?: number; /** اسلاید تصویر داشته باشد؟ (تعداد از روی تعداد اسلاید محاسبه می‌شود) */ images?: boolean; /** تصویر «زیاد» (فقط پلن‌دارها): نرمال + ۱ */ imagesMany?: boolean; mode?: Mode; source?: unknown; /** پوستر همراه ارائه: ۱ اعتبار دیگر */ poster?: boolean; /** جزوه‌ی Word همراه ارائه: ۱ اعتبار دیگر */ handout?: boolean; /** اسلاید صوتی همراه ارائه: ۱ اعتبار دیگر */ audio?: boolean; /** پادکست همراه ارائه: ۱ اعتبار دیگر */ podcast?: boolean } = {}): Promise<Begin> {
  const topic = topicRaw.replace(/\s+/g, " ").trim();
  if (topic.length < 3) return deny("موضوع خیلی کوتاه است؛ کمی کامل‌تر بنویس.", 400);
  if (topic.length > 600) return deny("موضوع بیش از حد طولانی است (حداکثر ۶۰۰ کاراکتر).", 400);

  const source = cleanSource(want.source);
  if (want.source && source.length < 30) return deny("متن فایل خیلی کوتاه یا خالی است؛ فایل دیگری را امتحان کن.", 400);

  const [maxSlides, maxImg] = await Promise.all([maxSlidesFor(env, uid), maxImagesFor(env, uid)]);
  const wantSlides = typeof want.slides === "number" && Number.isFinite(want.slides) ? Math.round(want.slides) : undefined;
  if (wantSlides !== undefined && wantSlides > maxSlides) return deny(slidesLimitMsg(maxSlides), 403, { needPlan: true });
  if (want.mode && isMode(want.mode) && !(await canUseMode(env, uid, want.mode))) return deny(EXTRA_MODE_MSG.replace("🔒 ", ""), 403, { needPlan: true }); // حالت‌های دارای حداقل اسلاید فقط برای پلن‌دارها
  const wantImgFlag = typeof want.images === "boolean" ? want.images : undefined;
  const wantManyFlag = typeof want.imagesMany === "boolean" ? want.imagesMany : undefined;

  // ۱) قفل اتمی «یک ارائه در هر لحظه» پیش از کسر اعتبار: درخواست‌های موازی فقط یکی‌شان قفل را می‌گیرد.
  const busy = () => deny("ارائه‌ی قبلی هنوز در حال ساخته شدن است؛ کمی صبر کن.", 409, { busy: true });
  if (!(await acquireLock(env, uid))) {
    // قفل مانده از کاری که Workflowش تمام شده باشد آزاد می‌شود (runningJob)؛ بعد یک بار دیگر تلاش می‌کنیم
    if ((await runningJob(env, uid)).busy || !(await acquireLock(env, uid))) return busy();
  }

  // ۲) از اینجا قفل مال ماست: هر خروجِ زودهنگام یا خطا باید قفل (و اعتبار کسرشده) را برگرداند
  let spent: Quota | null = null;
  const extras: Record<Extra, Quota | null> = { poster: null, handout: null, audio: null, podcast: null };
  const refundExtras = async () => {
    for (const q of Object.values(extras)) if (q) await refundCredit(env, uid, q.source, q.day).catch((e) => console.error("refund", e));
  };
  try {
    const quota = await spendCredit(env, uid);
    if (!quota.ok) {
      await releaseLock(env, uid).catch((e) => console.error("unlock", e));
      return deny("اعتبارت تمام شده است.", 402, { noCredit: true });
    }
    spent = quota;
    // همراهان اختیاری ارائه (پوستر، جزوه، اسلاید صوتی، پادکست): هر کدام ۱ اعتبار جدا. اگر موجودی کافی نبود، همه‌ی کسرها برمی‌گردد و هیچ کاری شروع نمی‌شود
    const wanted = ([want.poster && posterEnabled(env) ? "poster" : null, want.handout ? "handout" : null, want.audio && audioEnabled(env) ? "audio" : null, want.podcast && audioEnabled(env) ? "podcast" : null].filter(Boolean)) as Extra[];
    for (const k of wanted) {
      const q = await spendCredit(env, uid);
      if (!q.ok) {
        await refundCredit(env, uid, quota.source, quota.day).catch((e) => console.error("refund", e));
        spent = null;
        await refundExtras();
        await releaseLock(env, uid).catch((e) => console.error("unlock", e));
        const labels = wanted.map((w) => EXTRA_NAMES[w]);
        const names = labels.length > 1 ? `${labels.slice(0, -1).join("، ")} و ${labels[labels.length - 1]}` : labels[0];
        return deny(`ارائه‌ی همراه با ${names} ${toFa(String(1 + wanted.length))} اعتبار می‌خواهد (۱ اعتبار ارائه + ۱ اعتبار برای هر همراه) و اعتبارت کافی نیست. ${wanted.length > 1 ? "یکی از همراه‌ها را حذف کن" : "همراه را خاموش کن"} یا اعتبار بگیر.`, 402, { noCredit: true, extras: true });
      }
      extras[k] = q;
    }
    const lastSpent = wanted.length ? extras[wanted[wanted.length - 1]] : null; // آخرین کسر کمترین «باقی‌مانده» را دارد

    const settings = await getSettings(env, uid);
    settings.slides = wantSlides !== undefined ? clampSlides(wantSlides, maxSlides) : Math.min(settings.slides, maxSlides);
    const useImgs = wantImgFlag ?? settings.images; // پیش‌فرض: بله
    if (want.mode && isMode(want.mode)) settings.mode = want.mode; // حالتِ نوشته‌شده در متن کاربر؛ فقط برای همین ارائه (ذخیره نمی‌شود)
    settings.slides = Math.max(settings.slides, MODES[settings.mode].minSlides); // حالت‌های دانشجویی/کسب‌وکار/معلم حداقل ۸ و دفاع پایان‌نامه حداقل ۱۰ اسلاید می‌خواهند (فقط پلن‌دارها؛ سقف رایگان ۶ است)
    const useMany = useImgs && (wantManyFlag ?? settings.imagesMany === true) && (await hasPlanAccess(env, uid)); // «زیاد» فقط برای پلن‌دارها؛ وگرنه نرمال
    const imageCount = useImgs ? imageCountFor(settings.slides, maxImg, useMany) : 0; // تعداد تصویر ضمنی از روی تعداد اسلاید (زیاد = نرمال + ۱)
    settings.images = useImgs;
    settings.imagesMany = useMany;

    let undone = false;
    const undo = async () => { // idempotent: دوبار صدا زدن اعتبار را دوبار برنمی‌گرداند
      if (undone) return;
      undone = true;
      await refundCredit(env, uid, quota.source, quota.day).catch((e) => console.error("refund", e));
      await refundExtras();
      await releaseLock(env, uid).catch((e) => console.error("unlock", e));
    };
    return { ok: true, topic, source, settings, imageCount, quota: lastSpent ? { ...quota, left: lastSpent.left } : quota, posterQuota: extras.poster, handoutQuota: extras.handout, audioQuota: extras.audio, podcastQuota: extras.podcast, undo };
  } catch (e) {
    if (spent) await refundCredit(env, uid, spent.source, spent.day).catch((err) => console.error("refund", err));
    await refundExtras();
    await releaseLock(env, uid).catch((err) => console.error("unlock", err));
    throw e;
  }
}

/** پوستر (اینفوگرافیک) همراه ارائه: فقط به Browser Rendering نیاز دارد (همان که PDF استفاده می‌کند)؛ بدون آن، گزینه‌ی پوستر نمایش داده نمی‌شود */
export const posterEnabled = (env: Env) => hasBrowser(env);
/** اسلاید صوتی و پادکست: نیاز به کلید Gemini (TTS) و Workflow جدا (persian-ppt-audio)؛ بدون آن‌ها گزینه‌هایش نمایش داده نمی‌شود */
export const audioEnabled = (env: Env) => !!env.AUDIO_WORKFLOW && ttsEnabled(env);
export interface PosterWant { layout: "wide" | "tall" }

export interface Delivery { chatId: number; statusMessageId: number; channel: "web" | "telegram"; tgId?: number; /** پلتفرم مبدأ برای آمار؛ خالی = از روی کانال و شناسه */ plat?: Platform; /** نسخه‌ی اپ و اندروید (فقط از اپ) برای گزارش مدیر */ appv?: string; andv?: string; /** اعلان پایان کار در تلگرام (Mini App) */ notify?: boolean; /** متن اصلی کاربر برای گزارش مدیر */ orig?: string }

/** ساخت نمونه‌ی Workflow. شناسه‌ی کار = شناسه‌ی نمونه‌ی Workflow. در صورت شکست، اعتبار برمی‌گردد و false برمی‌گرداند. */
export async function launchDeck(env: Env, b: Extract<Begin, { ok: true }>, uid: string | number, jobId: string, d: Delivery, poster?: PosterWant): Promise<boolean> {
  // متن اصلی کاربر برای گزارش مدیر (مثل تلگرام برای وب هم ثبت می‌شود). اگر فایل گذاشته، با 📎 مشخص می‌شود (و اگر متنی نداده، نام/موضوع فایل)
  const typed = (d.orig ?? (d.channel === "web" ? b.topic : "")).replace(/\s+/g, " ").trim();
  const orig = (b.source ? `📎 ${typed || b.topic}` : typed).slice(0, 300);
  const plat: Platform = d.plat ?? (d.channel === "web" ? "web" : botPlatform(d.tgId ?? uid));
  const params: DeckParams = {
    chatId: d.chatId, statusMessageId: d.statusMessageId, userId: uid, channel: d.channel, tgId: d.tgId, plat, ...(d.appv ? { appv: d.appv } : {}), ...(d.andv ? { andv: d.andv } : {}), ...(d.notify ? { notify: true } : {}),
    topic: b.topic, ...(orig ? { orig } : {}), ...(b.source ? { source: b.source } : {}), settings: b.settings, maxImages: b.imageCount, credit: b.quota.source, day: b.quota.day,
    // پوستر همراه ارائه (همین Workflow؛ ۱ اعتبار جدا که beginDeck کسر کرده) با تصویر تزئینی ثابت
    ...(poster && b.posterQuota ? { poster: { layout: poster.layout, credit: b.posterQuota.source, day: b.posterQuota.day } } : {}),
    // جزوه‌ی Word همراه ارائه (۱ اعتبار جدا که beginDeck کسر کرده)
    ...(b.handoutQuota ? { handout: { credit: b.handoutQuota.source, day: b.handoutQuota.day } } : {}),
    // اسلاید صوتی و پادکست همراه ارائه (AudioWorkflow جدا بعد از تحویل ارائه؛ هرکدام ۱ اعتبار جدا که beginDeck کسر کرده)
    ...(b.audioQuota ? { audio: { credit: b.audioQuota.source, day: b.audioQuota.day } } : {}),
    ...(b.podcastQuota ? { podcast: { credit: b.podcastQuota.source, day: b.podcastQuota.day } } : {}),
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
  await bumpStat(env, "started", plat).catch(() => {});
  return true;
}
