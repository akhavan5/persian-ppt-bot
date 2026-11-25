/** اعلان‌های چرخه‌ی عمر کاربر (یک cron ساعتی)؛ مکمل activation-reminder.ts / plan-notify.ts / plan-feedback.ts و بدون تغییر در آن‌ها.
 *
 *  کارها (هر کدام یک «Job» با یک پرس‌وجوی D1 و نشانگر «فرستاده شد» در KV):
 *    pay  پیگیری پرداخت نیمه‌کاره: ۳۰ دقیقه تا ۲۴ ساعت بعد از شروع پرداختی که تمام نشد (وضعیت pending/failed) و کاربر پلن فعال ندارد.
 *    low  هشدار کم‌شدن اعتبار پلن: فقط ۱ اعتبار مانده، پلن بیش از ۲ روز دیگر فعال است و کاربر در ۴۸ ساعت اخیر ارائه ساخته (تا پاداش دعوتِ تک‌اعتباری هشدار نگیرد).
 *    ex   ترویج پوستر/جزوه/اسلاید صوتی/پادکست: ۳ تا ۲۰ ساعت بعد از ارائه (متن ارائه فقط ۲۴ ساعت می‌ماند)، اگر برای آن ارائه همراهی نساخته و اعتبار دارد (ارائه‌ی ۱ تا ۵ کاربر).
 *    nx   «ارائه‌ی بعدی»: ۲ تا ۴ روز بعد از ارائه‌ی اول یا دوم، با یک نکته‌ی کاربردی.
 *    wb   بازگشت کاربر غیرفعال: ۱۴ و ۳۰ روز بعد از آخرین ارائه (فقط بدون پلن فعال)، با موضوع فصلی (ماه شمسی).
 *    buy  پیشنهاد خرید پلن: ۴۸ ساعت یا بیشتر بعد از آخرین ارائه (حداکثر ۵ کاربر در هر اجرا و ۶۰ در روز، تازه‌ترین‌ها اول)، فقط برای کسی که هرگز پرداخت موفق نداشته و پلن فعال ندارد (کاربران قدیمی هم، بدون سقف بالا)؛ یک‌بار برای هر حساب و در «همه‌ی» کانال‌های موجود (ربات + اعلان وب + ایمیل).
 *    fl   «فایل‌هایت آماده است»: حدود ۱ ساعت بعد از ساخت ارائه (تا ۲۰ ساعت بعد، چون فایل‌ها ۲۴ ساعت می‌مانند)؛ در همه‌ی کانال‌ها (ربات + اعلان وب + اپ + ایمیل با پیوست PPTX).
 *         این کار سقف «۱ اعلان در ۲۰ ساعت» را مصرف نمی‌کند (noCap)، وگرنه پیام ترویج همراه‌ها (ex، ۳ تا ۲۰ ساعت بعد از ارائه) برای همه حذف می‌شد.
 *    inv  دعوت دوستان: یک‌بار برای کسی که ۲ تا ۶ ارائه ساخته و هنوز کسی را دعوت نکرده (فقط ربات؛ لینک دعوت مخصوص ربات است).
 *    pf   هدیه‌ی تکمیل پروفایل: یک‌بار، ۲۶ ساعت تا ۸ روز بعد از آخرین ارائه (نه در بدو ورود)، برای کسی که موبایل یا ایمیلش ثبت نیست و هدیه‌ی آن مورد را هنوز نگرفته؛ با ثبت و تایید هر مورد ۱ اعتبار (profile.ts).
 *    rfn  یادآوری نرم به دعوت‌شده‌ای که با لینک دوست آمده ولی ۳ تا ۴۸ ساعت بعد هنوز ارائه‌ای نساخته (دعوتِ دوستش به ارائه‌ی او بسته است).
 *
 *    cf   «یک قهوه مهمانم کن»: یک‌بار برای کسی که حداقل ۲ ارائه ساخته و ۲۴ ساعت یا بیشتر از آخرین ارائه‌اش گذشته (قدیمی‌ها هم، با سقف هر اجرا و روزانه)؛ لینک صفحه‌ی /support.
 *
 *  کانال: هر اعلان به «همه‌ی» کانال‌هایی که کاربر دارد می‌رسد: ربات (تلگرام/بله/روبیکا/ایتا) + اعلان وب (webpush.ts) + اپ اندروید (FCM) + ایمیل؛ موفق = حداقل یک کانال رسید. پیوست ایمیل (n.attach) فقط در کانال ایمیل می‌رود. نوت‌های only:"email" (در صورت وجود) فقط ایمیل‌اند.
 *  سقف: غیر از پیگیری پرداخت، هر کاربر در ۲۰ ساعت حداکثر یک اعلان از این ماژول می‌گیرد (lcl:<حساب>)؛ فقط ساعت ۹ تا ۲۱ تهران.
 *  سقف زیردرخواست: هر اجرای Worker در پلن رایگان ۵۰ زیردرخواست دارد؛ همه‌ی کارها یک «بودجه‌ی» مشترک دارند و اگر تمام شود، بقیه به اجرای ساعت بعد می‌رود.
 *  هرگز خطا پرتاب نمی‌کند. env باید با withStore ساخته شده باشد. */
import type { Env } from "./env";
import { emailOtpEnabled, otpEnabled, type WebUser } from "./auth";
import { esc as tgEsc, sendMessage } from "./telegram";
import { BRAND, emailEnabled, sendEmail, siteOf, toBase64 } from "./email";
import { loadFileDirect } from "./files";
import { inSendHours } from "./activation-reminder";
import { faDate, firstName, render } from "./plan-notify";
import { buyKbFor, miniappUrl } from "./deck-service";
import { extraButtons } from "./extras";
import { PLANS } from "./payment";
import { CONTACT_CREDITS, CONTACT_REWARD_NOTE, DAILY_FREE_CREDITS, FREE_MAX_IMAGES, FREE_MAX_SLIDES } from "./settings";
import { botUsername, inviteBody, inviteLinkFor, inviteMarkup, invitePlatform, webInviteLink } from "./invite-msg";
import type { RefId } from "./settings";
import { sendWebPush, webPushEnabled, type WebPushMsg } from "./webpush";
import { parseFcmCol, pushEnabled, sendPushToUser } from "./push";
import { isBaleId } from "./bale-format";
import { isRubikaId } from "./rubika-format";
import { isEitaaId } from "./eitaa-format";
import { isSplusId } from "./splus-format";
import { toFa } from "./util";
import { chanOf, isChan } from "./link";


/** cron ساعتی (دقیقه‌ی ۳۷)؛ باید با triggers.crons در wrangler.jsonc یکی باشد */
export const LIFECYCLE_CRON = "37 * * * *";

const MIN = 60_000, HOUR = 3_600_000, DAY = 24 * HOUR;
const SUBREQUEST_BUDGET = 44;   // سقف ۵۰ زیردرخواست در پلن رایگان؛ ۶ تا برای ready()/خطاهای غیرمنتظره کنار گذاشته شده
const MAX_ROWS = 8;             // حداکثر ردیف هر کار در هر اجرا
const FL_MAX_BYTES = 15 * 1024 * 1024; // سقف پیوست (Resend: ۴۰ مگابایت بعد از base64؛ حافظه‌ی Worker هم محدود است)
const BUY_TTL = 3650 * 86_400;  // نشانگر پیشنهاد خرید عملاً دائمی است (قدیمی‌ها هم یک‌بار می‌گیرند، نه هر سال)
const BUY_PER_RUN = 5;          // حداکثر کاربر در هر اجرای ساعتی (هر کاربر تا ۷ زیردرخواست: ربات ۲ + اعلان وب ۴ + ایمیل ۱)
const BUY_PER_DAY = 60;         // سقف روزانه؛ بک‌لاگ قدیمی‌ها در چند روز خالی می‌شود نه یک‌جا
const DONE_TTL = 30 * 86_400;   // ثانیه
const INV_TTL = 400 * 86_400;
const RETRY_TTL = 2 * 3600;
const CAP_TTL = 20 * 3600;

// ---------- بودجه و زمینه ----------
interface Ctx { env: Env; now: number; nowSec: number; left: number; mailOn: boolean; botNames: Map<string, string> }
const take = (c: Ctx, n: number) => { if (c.left < n) return false; c.left -= n; return true; };

interface Contact { uid: string; name: string; email: string; tgId: number | null; /** پیام‌رسان‌های وصل‌شده‌ی دیگرِ روشن (غیر از هویت اصلی tgId) */ extra: number[]; push: boolean; /** توکن‌های FCM اپ اندروید (تازه‌ترین اول) */ fcm: string[] }
/** ستون‌های مشترک همه‌ی کارها: شناسه‌ی حساب وب در ستون u */
interface Base { k: string; uid: string; usr: string | null; tg: string | null; banned: number | null; blk: number | null; push: number | null; fcm: string | null; /** w2ids: همه‌ی پیام‌رسان‌های وصل‌شده (JSON) */ ids?: string | null; /** nto: پیام‌رسان‌هایی که اعلانشان خاموش است (JSON) */ nto?: string | null }
type Mail = Parameters<typeof render>[2];
interface Note {
  /** برچسب ایمیل در Resend */ tag: string;
  tg: string;
  /** کیبورد پیام ربات (فقط وقتی کانال ربات انتخاب شد ساخته می‌شود) */
  kb?: (c: Contact) => Promise<Record<string, unknown>>;
  /** ایمیل؛ undefined = این اعلان ایمیل ندارد */
  mail?: { subject: string; m: Mail };
  /** اعلان وب؛ undefined = ندارد. همین عنوان/متن/برچسب به اپ اندروید هم (FCM) می‌رود */
  push?: WebPushMsg;
  /** آدرس https کامل برای اعلان اپ (باز شدن در مرورگر)؛ بدون آن اعلان اپ را باز می‌کند */
  fcmUrl?: string;
  /** فقط از همین کانال بفرست (مثلاً ایمیل) و سراغ ربات/اعلان وب نرو */
  only?: "email";
  /** پیوست ایمیل (base64) */
  attach?: { filename: string; content: string }[];
}

/** بلوک زیر دکمه‌ی ایمیل هر اعلان: plans = کارت مقایسه‌ی پلن‌ها، features = چهار امکان با لینک، false = هیچ (نوار لینک سایت همیشه هست) */
const PROMO: Record<string, Mail["promo"]> = {
  "payment-recovery": "plans", "plan-credit-low": "plans", "buy-offer-48h": "plans",
  "extras-nudge": "features", "files-ready": "features", "next-deck": "features", "winback": "features",
  "profile-gift": "features", "referral-invitee": "features",
  "invite-ask": false, "coffee": false,
};
/** نکته‌ی برجسته‌ی ایمیل هر اعلان (ایمیل‌هایی که خودشان tip دارند عوض نمی‌شوند) */
const TIP: Record<string, string> = {
  "payment-recovery": "با پلن، ارائه‌ی بلندتر با اسلاید و تصویر بیشتر و مدل‌های ویژه می‌سازی؛ دو پلن را پایین ببین 👇",
  "plan-credit-low": "تمدید زودهنگام ضرری ندارد: ۳۰ روز به مدت فعلی اضافه می‌شود و اعتبار تازه روی اعتبار باقی‌مانده جمع می‌شود.",
  "buy-offer-48h": "با پلن، ارائه‌های بلندتر با تصویر بیشتر، حالت‌های ساخت ویژه و مدل‌های ویژه به دستت می‌رسد.",
  "extras-nudge": "یک ارائه، چهار خروجی: پوستر برای اشتراک‌گذاری، جزوه برای کلاس، اسلاید صوتی و پادکست برای گوش‌دادن در مسیر.",
  "files-ready": "فایل PPTX کاملاً قابل ویرایش است؛ در پاورپوینت باز کن و هر چه خواستی عوض کن.",
  "next-deck": "موضوع ندارم؟ ایده‌ی بالا را کپی کن و بفرست؛ ۱ تا ۲ دقیقه بعد فایل آماده است.",
  "winback": "موضوع ندارم؟ ایده‌ی بالا را کپی کن و بفرست؛ ۱ تا ۲ دقیقه بعد فایل آماده است.",
  "profile-gift": "فقط یک کد یک‌بارمصرف تا اعتبار هدیه‌ات.",
  "referral-invitee": "با ساخت اولین ارائه‌ات، دوستت هم یک قدم به اعتبار هدیه‌اش نزدیک‌تر می‌شود.",
};
/** ایمیل یک اعلان با کمپین، بلوک تبلیغی و نکته‌ی پیش‌فرضش (فیلدهای خودِ اعلان اولویت دارند) */
const mailOf = (n: Note) => render0(n);

const GONE_RE = /bot was blocked by the user|user is deactivated|chat not found|bot can't initiate|Rubika \w+: INVALID_ACCESS|Eitaa sendMessage: not allow write access/i;
const BLK_TTL = 90 * 86_400;

const botReady = (env: Env, id: number): boolean =>
  isSplusId(id) ? !!env.SPLUS_BOT_TOKEN : isBaleId(id) ? !!env.BALE_BOT_TOKEN : isRubikaId(id) ? !!env.RUBIKA_BOT_TOKEN : isEitaaId(id) ? !!env.EITAA_APP_TOKEN : !!env.TELEGRAM_BOT_TOKEN;

function contactOf(c: Ctx, r: Base): Contact {
  let u: WebUser | null = null;
  try { u = r.usr ? (JSON.parse(r.usr) as WebUser) : null; } catch { /* بدون ایمیل */ }
  const n = Number(r.tg);
  const list = (raw: string | null | undefined): unknown[] => { try { const a = JSON.parse(raw ?? "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
  const muted = list(r.nto).filter(isChan);
  const usable = (i: number) => Number.isSafeInteger(i) && i > 0 && botReady(c.env, i) && !muted.includes(chanOf(i));
  const tgId = !r.blk && usable(n) ? n : null;
  const extra = list(r.ids).map(Number).filter((i) => i !== n && usable(i)).slice(0, 4);
  return { uid: r.uid, name: u?.name ?? "", email: c.mailOn && u?.email ? u.email : "", tgId, extra, push: !!r.push && webPushEnabled(c.env), fcm: pushEnabled(c.env) ? parseFcmCol(r.fcm) : [] };
}

function render0(n: Note) { return n.mail ? { subject: n.mail.subject, m: { campaign: n.tag, promo: PROMO[n.tag] ?? "features", ...(TIP[n.tag] ? { tip: TIP[n.tag] } : {}), ...n.mail.m } as Mail } : null; }

/** اعلان به همه‌ی کانال‌های موجود می‌رسد (ربات + اعلان وب + ایمیل)؛ نوت‌های only:"email" فقط ایمیل. null = هیچ‌کدام نرسید یا بودجه تمام شد (skip) */
async function deliver(c: Ctx, k: Contact, n: Note, key: string): Promise<"bot" | "push" | "email" | "fail" | "skip"> {
  if (n.only !== "email") {
    let ok: "bot" | "push" | "email" | null = null, tried = false;
    if (k.tgId && take(c, 2)) {
      tried = true;
      try { await sendMessage(c.env, k.tgId, n.tg, n.kb ? await n.kb(k) : undefined); ok ??= "bot"; }
      catch (e) {
        console.error("lifecycle bot", String(e).slice(0, 160));
        // گیرنده دیگر در دسترس نیست (ربات را بلاک کرده/حسابش حذف شده): از ارسال‌های بعدی حذف شود (مثل broadcast.ts)؛ با /start برمی‌گردد
        if (GONE_RE.test(String(e))) await c.env.KV.put(`blk:${k.tgId}`, "1", { expirationTtl: BLK_TTL }).catch(() => {});
      }
    }
    // پیام‌رسان‌های وصل‌شده‌ی دیگر (مثلاً هم تلگرام و هم بله): همان اعلان با کیبورد مخصوص همان پلتفرم
    for (const id of k.extra) {
      if (!take(c, 3)) break;
      if (await c.env.KV.get(`blk:${id}`).catch(() => null)) continue;
      tried = true;
      try { await sendMessage(c.env, id, n.tg, n.kb ? await n.kb({ ...k, tgId: id }) : undefined); ok ??= "bot"; }
      catch (e) {
        console.error("lifecycle bot extra", String(e).slice(0, 160));
        if (GONE_RE.test(String(e))) await c.env.KV.put(`blk:${id}`, "1", { expirationTtl: BLK_TTL }).catch(() => {});
      }
    }
    if (k.push && n.push && take(c, 4)) {
      tried = true;
      if ((await sendWebPush(c.env, k.uid, n.push)).ok > 0) ok ??= "push";
    }
    // اپ اندروید (FCM): فقط تازه‌ترین دستگاه؛ اپ با برچسب (tag) همتای محلی همین پیام را مهار می‌کند تا دوبار نمایش داده نشود
    if (k.fcm.length && n.push && take(c, 3)) {
      tried = true;
      const r = await sendPushToUser(c.env, k.uid, { title: n.push.title, body: n.push.body, tag: n.push.tag, url: n.fcmUrl }, k.fcm, 1);
      if (r.ok > 0) ok ??= "push";
    }
    if (k.email && n.mail && take(c, 1)) {
      tried = true;
      const mm = mailOf(n)!;
      const m = render(c.env, mm.subject, mm.m);
      if (await sendEmail(c.env, { to: k.email, ...m, tag: n.tag, attachments: n.attach, idempotencyKey: `lc-${key}`.slice(0, 250) })) ok ??= "email";
    }
    return ok ?? (tried ? "fail" : "skip");
  }
  // فقط نوت‌های «فقط ایمیل» (مثل fl با پیوست) به اینجا می‌رسند
  let tried = false;
  if (k.email && n.mail) {
    if (!take(c, 1)) return tried ? "fail" : "skip";
    tried = true;
    const mm = mailOf(n)!;
    const m = render(c.env, mm.subject, mm.m);
    if (await sendEmail(c.env, { to: k.email, ...m, tag: n.tag, attachments: n.attach, idempotencyKey: `lc-${key}`.slice(0, 250) })) return "email";
  }
  return "fail";
}

// ---------- SQL مشترک ----------
/** بازه‌ی پیشوند کلید: k >= 'pay:' AND k < 'pay;' (کاراکتر بعد از «:» «;» است) */
const rng = (col: string, prefix: string) => `${col} >= '${prefix}' AND ${col} < '${prefix.slice(0, -1)};'`;
/** ستون‌های تماس برای حسابی که شناسه‌ی وبش در ستون u است. ?1 = نشانگر زمان بر حسب ثانیه */
const CONTACT = (u: string) => `
  ${u} AS uid,
  (SELECT w.v FROM kv w WHERE w.k = 'wu:' || ${u}) AS usr,
  (SELECT t.v FROM kv t WHERE t.k = 'w2tg:' || ${u}) AS tg,
  (SELECT i.v FROM kv i WHERE i.k = 'w2ids:' || ${u}) AS ids,
  (SELECT m.v FROM kv m WHERE m.k = 'nto:' || ${u}) AS nto,
  (SELECT 1 FROM kv n WHERE n.k = 'ban:' || ${u}) AS banned,
  (SELECT 1 FROM kv b WHERE b.k = 'blk:' || (SELECT t2.v FROM kv t2 WHERE t2.k = 'w2tg:' || ${u})) AS blk,
  (SELECT 1 FROM kv p WHERE p.k = 'wps:' || ${u} AND (p.exp IS NULL OR p.exp > ?1)) AS push,
  (SELECT f.v FROM kv f WHERE f.k = 'ptu:' || ${u} AND (f.exp IS NULL OR f.exp > ?1)) AS fcm`;
const notMarked = (key: string) => `NOT EXISTS (SELECT 1 FROM kv m WHERE m.k = ${key} AND (m.exp IS NULL OR m.exp > ?1))`;
const notCapped = (u: string) => notMarked(`'lcl:' || ${u}`);
/** ?2 = زمان فعلی (ms) */
const noActivePlan = (u: string) =>
  `NOT EXISTS (SELECT 1 FROM kv s WHERE s.k = 'sub:' || ${u} AND (s.exp IS NULL OR s.exp > ?1) AND json_extract(s.v, '$.exp') > ?2 AND json_extract(s.v, '$.credits') > 0)`;

interface Job<R extends Base> {
  name: string;
  /** پرس‌وجو؛ ?1 = ثانیه‌ی فعلی، ?2 = میلی‌ثانیه‌ی فعلی، ?3 = سقف ردیف و بعد از آن مقدارهای extra */
  sql: string;
  extra: (now: number) => unknown[];
  /** کلید نشانگر «فرستاده شد» */
  marker: (r: R) => string;
  doneTtl?: number;
  /** سقف ردیف این کار در هر اجرا (کمتر از MAX_ROWS) برای کارهای پرحجم */
  maxRows?: number;
  /** معاف از سقف «۱ اعلان در ۲۰ ساعت» (فقط تراکنشی‌ها) */
  urgent?: boolean;
  /** بعد از ارسال، نشانگر سقف ۲۰ ساعته (lcl:) را نمی‌نویسد؛ برای پیام‌های تراکنشی مثل fl که نباید پیام‌های بعدی (ex) را حذف کنند */
  noCap?: boolean;
  note: (c: Ctx, r: R, k: Contact) => Note | null | Promise<Note | null>;
}

const put = (c: Ctx, key: string, val: string, ttl: number) =>
  c.env.DB.prepare("INSERT INTO kv (k, v, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp").bind(key, val, c.nowSec + ttl);

async function runJob<R extends Base>(c: Ctx, job: Job<R>): Promise<number> {
  if (c.left < 5) return 0;
  const limit = Math.max(1, Math.min(job.maxRows ?? MAX_ROWS, Math.floor((c.left - 2) / 2)));
  take(c, 1);
  let rows: R[] = [];
  try {
    rows = (await c.env.DB.prepare(job.sql).bind(c.nowSec, c.now, limit, ...job.extra(c.now)).all<R>()).results ?? [];
  } catch (e) { console.error("lifecycle query", job.name, String(e).slice(0, 300)); return 0; }
  const marks: D1PreparedStatement[] = [];
  let sent = 0;
  for (const r of rows) {
    const key = job.marker(r);
    const ttl = job.doneTtl ?? DONE_TTL;
    if (r.banned) { marks.push(put(c, key, "0", ttl)); continue; }
    const k = contactOf(c, r);
    if (!k.tgId && !k.extra.length && !k.push && !k.email && !k.fcm.length) { marks.push(put(c, key, "0", ttl)); continue; }
    let n: Note | null = null;
    try { n = await job.note(c, r, k); } catch (e) { console.error("lifecycle note", job.name, String(e).slice(0, 200)); }
    if (!n) { marks.push(put(c, key, "0", ttl)); continue; }
    const res = await deliver(c, k, n, key);
    if (res === "skip") break; // بودجه تمام شد؛ ردیف بدون نشانگر می‌ماند و ساعت بعد دوباره می‌آید
    if (res === "fail") { marks.push(put(c, key, "r", RETRY_TTL)); continue; }
    sent++;
    marks.push(put(c, key, "1", ttl));
    if (!job.noCap) marks.push(put(c, `lcl:${r.uid}`, "1", CAP_TTL));
  }
  if (marks.length && take(c, 1)) await c.env.DB.batch(marks).catch((e) => console.error("lifecycle marks", job.name, String(e).slice(0, 200)));
  return sent;
}

// ---------- ابزارهای متن ----------
const startKb = (env: Env) => async () => ({ reply_markup: { inline_keyboard: [[{ text: "🚀 ساخت ارائه", web_app: { url: `${miniappUrl(env)}/app` } }]] } });
const utm = (env: Env, kind: string, path = "/") => `${siteOf(env)}${path}${path.includes("?") ? "&" : "?"}utm_source=lifecycle&utm_medium=email&utm_campaign=${kind}`;
const hashOf = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
const planNameOf = (id: unknown) => PLANS.find((p) => p.id === id)?.name ?? String(id ?? "");

/** ماه شمسی (۱ تا ۱۲) به وقت تهران */
export function persianMonth(t: number): number {
  try {
    const p = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", { month: "numeric", timeZone: "Asia/Tehran" }).formatToParts(new Date(t));
    const m = Number(p.find((x) => x.type === "month")?.value);
    return m >= 1 && m <= 12 ? m : 1;
  } catch { return 1; }
}
/** موضوع‌های پیشنهادی هر ماه شمسی (ساده و بدون عدد اسلاید تا ربات/سایت همان‌طور که هست بفهمد) */
export const SEASONAL: string[][] = [
  ["تاریخچه‌ی نوروز و آیین‌های آن", "اهداف و برنامه‌ریزی سال جدید"],                       // فروردین
  ["روش‌های مطالعه‌ی مؤثر برای امتحانات", "گیاهان دارویی ایران"],                           // اردیبهشت
  ["مدیریت استرس امتحان", "کاربردهای هوش مصنوعی در آموزش"],                                 // خرداد
  ["طرح کسب‌وکار کوچک تابستانی", "برنامه‌ریزی تابستان برای دانش‌آموزان"],                   // تیر
  ["گردشگری در ایران؛ جاذبه‌ها و پیشنهادها", "انرژی‌های تجدیدپذیر"],                         // مرداد
  ["آمادگی برای بازگشایی مدارس و دانشگاه‌ها", "ایده‌های پایان‌نامه و سمینار"],               // شهریور
  ["معرفی خود و دوره در اولین جلسه‌ی کلاس", "مدیریت زمان برای دانشجویان"],                  // مهر
  ["روش تحقیق و نگارش مقاله‌ی علمی", "تاریخ هنر ایران"],                                     // آبان
  ["ارائه‌ی یک طرح پژوهشی برای هفته‌ی پژوهش", "اصول دفاع از پایان‌نامه"],                  // آذر
  ["برنامه‌ی مطالعه برای امتحانات پایان‌ترم", "تحلیل SWOT یک کسب‌وکار"],                    // دی
  ["ارائه‌ی ایده‌ی استارتاپی (پیچ‌دک)", "حفاظت از محیط زیست"],                              // بهمن
  ["گزارش عملکرد سالانه‌ی تیم", "برنامه‌ریزی کسب‌وکار برای سال جدید"],                       // اسفند
];
export const seasonalTopic = (uid: string, t: number) => { const l = SEASONAL[persianMonth(t) - 1]; return l[hashOf(uid) % l.length]; };

/** نکته‌های «ارائه‌ی بعدی»؛ همه‌ی امکانات واقعی سرویس‌اند (فهرست امکانات ایمیل خوش‌آمد) */
export const TIPS = [
  "متن یک مقاله یا فایل Word/PDF بدهی تا همان را به اسلاید تبدیل کند",
  "لینک یک صفحه‌ی وب بدهی تا ارائه را از روی آن بسازد",
  "حالت «یادداشت سخنرانی» را روشن کنی تا برای هر اسلاید متنِ گفتنی هم داشته باشی",
  "از ارائه‌ات پوستر، جزوه‌ی Word، اسلاید صوتی یا پادکست هم بسازی",
];

// ---------- کار ۱: پرداخت نیمه‌کاره ----------
interface PayRow extends Base { v: string }
const payJob: Job<PayRow> = {
  name: "pay", urgent: true,
  sql: `
SELECT x.k AS k, x.v AS v, ${CONTACT("x.u")}
FROM (SELECT k, v, json_extract(v,'$.uid') AS u, json_extract(v,'$.t') AS t FROM kv
      WHERE ${rng("k", "pay:")} AND (exp IS NULL OR exp > ?1)
        AND json_extract(v,'$.state') IN ('pending','failed') AND json_extract(v,'$.issue') IS NULL
        AND json_extract(v,'$.plan') IS NOT NULL AND json_extract(v,'$.t') <= ?4 AND json_extract(v,'$.t') > ?5) x
WHERE x.u IS NOT NULL
  AND ${notMarked("'lc:pay:' || substr(x.k, 5)")}
  AND ${notMarked("'lc:payu:' || x.u")}
  AND NOT EXISTS (SELECT 1 FROM kv q WHERE ${rng("q.k", "pay:")} AND q.k <> x.k AND json_extract(q.v,'$.uid') = x.u
                  AND (json_extract(q.v,'$.t') > x.t OR (json_extract(q.v,'$.state') = 'paid' AND json_extract(q.v,'$.t') >= x.t)))
  AND ${noActivePlan("x.u")}
ORDER BY x.k LIMIT ?3`,
  extra: (now) => [now - 30 * MIN, now - 24 * HOUR],
  marker: (r) => `lc:pay:${r.k.slice(4)}`,
  note: (c, r, k) => {
    let plan = "", price = 0, credits = 0, slides = 0;
    try {
      const j = JSON.parse(r.v); const p = PLANS.find((x) => x.id === j.plan);
      if (!p) return null;
      plan = p.name; price = p.price; credits = p.credits; slides = p.maxSlides;
    } catch { return null; }
    const price_fa = toFa(price.toLocaleString("en-US")).replace(/,/g, "٬");
    return {
      tag: "payment-recovery",
      tg: [
        `🛒 <b>پرداخت پلن ${tgEsc(plan)} کامل نشد</b>`,
        "",
        `اگر در درگاه مشکلی پیش آمد یا وقت نشد، می‌توانی همین حالا دوباره امتحان کنی: پلن ${tgEsc(plan)} ${price_fa} هزار تومان، ${toFa(String(credits))} ارائه در ماه و تا ${toFa(String(slides))} اسلاید.`,
        "",
        "اگر پولی از حسابت کم شده ولی پلن فعال نشده، به پشتیبانی پیام بده تا همان لحظه بررسی کنیم.",
      ].join("\n"),
      kb: async (kk) => (await buyKbFor(c.env, kk.uid, kk.tgId ?? undefined)),
      mail: {
        subject: `🛒 یک قدم تا پلن ${plan} مانده؛ پرداختت نیمه‌کاره ماند — ${BRAND}`,
        m: {
          href: utm(c.env, "pay", "/?buy=1"), head: "پرداختت کامل نشد 🛒", sub: `${firstName(k.name)}، پلن ${plan} هنوز فعال نشده است.`,
          paras: ["اگر در درگاه مشکلی پیش آمد یا وقت نشد، می‌توانی همین حالا دوباره امتحان کنی.", "اگر پولی از حسابت کم شده ولی پلن فعال نشده، همین ایمیل را پاسخ بده تا همان لحظه بررسی کنیم."],
          rows: [["پلن", `پلن ${plan}`], ["قیمت", `${price_fa} هزار تومان`], ["اعتبار ماهانه", `${toFa(String(credits))} ارائه`]],
          cta: "ادامه‌ی خرید ←", color: "#2563eb", foot: "این یادآوری فقط یک‌بار برای هر تلاش پرداخت فرستاده می‌شود.", preview: `پرداخت پلن ${plan} کامل نشد؛ همین حالا دوباره امتحان کن.`,
        },
      },
      push: { title: `پرداخت پلن ${plan} کامل نشد`, body: "برای ادامه‌ی خرید همین‌جا بزن. اگر پول کم شده ولی پلن فعال نشد، به پشتیبانی پیام بده.", url: "/?buy=1", tag: "pay" },
    };
  },
};

// ---------- کار ۲: کم‌شدن اعتبار پلن ----------
interface LowRow extends Base { v: string; e: number }
const lowJob: Job<LowRow> = {
  name: "low",
  sql: `
SELECT x.k AS k, x.v AS v, x.e AS e, ${CONTACT("x.u")}
FROM (SELECT k, v, substr(k, 5) AS u, CAST(json_extract(v,'$.exp') AS INTEGER) AS e FROM kv
      WHERE ${rng("k", "sub:")} AND (exp IS NULL OR exp > ?1)
        AND json_extract(v,'$.credits') = 1 AND json_extract(v,'$.exp') > ?4) x
WHERE EXISTS (SELECT 1 FROM kv a WHERE a.k = 'act:' || x.u AND json_extract(a.v,'$.l') >= ?5)
  AND ${notMarked("'lc:low:' || x.u || ':' || x.e")}
  AND ${notCapped("x.u")}
ORDER BY x.k LIMIT ?3`,
  extra: (now) => [now + 2 * DAY, now - 48 * HOUR],
  marker: (r) => `lc:low:${r.uid}:${r.e}`,
  note: (c, r, k) => {
    let plan = "";
    try { plan = planNameOf(JSON.parse(r.v).plan); } catch { return null; }
    const days = Math.max(1, Math.ceil((r.e - c.now) / DAY)), end = faDate(r.e);
    const free = `${toFa(String(DAILY_FREE_CREDITS))} ارائه‌ی رایگان در روز تا ${toFa(String(FREE_MAX_SLIDES))} اسلاید و ${toFa(String(FREE_MAX_IMAGES))} تصویر`;
    return {
      tag: "plan-credit-low",
      tg: [
        `🎟 <b>فقط ۱ اعتبار از پلن ${tgEsc(plan)} مانده</b>`,
        "",
        `پلن ${tgEsc(plan)}ت تا <b>${tgEsc(end)}</b> (${toFa(String(days))} روز دیگر) فعال است. بعد از این اعتبار، ساخت ارائه با اعتبار رایگان ادامه پیدا می‌کند (${free}).`,
        "",
        "اگر پلن را تمدید کنی، ۳۰ روز به مدتش اضافه می‌شود و اعتبار جدید روی اعتبار باقی‌مانده جمع می‌شود.",
      ].join("\n"),
      kb: async (kk) => buyKbFor(c.env, kk.uid, kk.tgId ?? undefined),
      mail: {
        subject: `⚠️ فقط ۱ اعتبار از پلن ${plan} مانده — ${BRAND}`,
        m: {
          href: utm(c.env, "low", "/?buy=1"), head: "فقط ۱ اعتبار مانده 🎟", sub: `${firstName(k.name)}، پلن ${plan} یک اعتبار دارد.`,
          paras: [`بعد از این اعتبار، ساخت ارائه با اعتبار رایگان ادامه پیدا می‌کند (${free}).`, "اگر پلن را تمدید کنی، ۳۰ روز به مدتش اضافه می‌شود و اعتبار جدید روی اعتبار باقی‌مانده جمع می‌شود."],
          rows: [["پلن", `پلن ${plan}`], ["اعتبار باقی‌مانده", "۱ اعتبار"], ["پایان پلن", `${end} (${toFa(String(days))} روز دیگر)`]],
          cta: "تمدید پلن ←", color: "#d97706", foot: "این پیام فقط یک‌بار برای هر دوره‌ی پلن فرستاده می‌شود.", preview: `فقط ۱ اعتبار از پلن ${plan} مانده است.`,
        },
      },
      push: { title: "فقط ۱ اعتبار از پلنت مانده", body: `پلن ${plan} تا ${days} روز دیگر فعال است؛ برای ادامه تمدیدش کن.`, url: "/?buy=1", tag: "low" },
    };
  },
};

// ---------- ردیف‌های مبتنی بر act:<حساب> ----------
interface ActRow extends Base { v: string; d: string | null }
const ACT_COLS = (u = "x.u") => `x.k AS k, x.v AS v, x.d AS d, ${CONTACT(u)}`;
const ACT_FROM = (where: string) =>
  `FROM (SELECT k, v, substr(k, 5) AS u, json_extract(v,'$.d') AS d FROM kv WHERE ${rng("k", "act:")} AND substr(k, 5, 2) = 'w_' AND ${where}) x`;

// کار ۳: ترویج همراه‌ها (پوستر، جزوه، صدا، پادکست) در ۲۴ ساعتِ نگه‌داری ارائه
const exJob: Job<ActRow> = {
  name: "ex",
  sql: `
SELECT ${ACT_COLS()}
${ACT_FROM("json_extract(v,'$.d') IS NOT NULL AND json_extract(v,'$.n') <= 5 AND json_extract(v,'$.l') <= ?4 AND json_extract(v,'$.l') > ?5")}
WHERE ${notMarked("'lc:ex:' || x.u || ':' || x.d")}
  AND NOT EXISTS (SELECT 1 FROM kv m WHERE m.k >= 'ex:' || x.u || ':' || x.d || ':' AND m.k < 'ex:' || x.u || ':' || x.d || ';' AND (m.exp IS NULL OR m.exp > ?1))
  AND (COALESCE((SELECT CAST(b.v AS INTEGER) FROM kv b WHERE b.k = 'bonus:' || x.u AND (b.exp IS NULL OR b.exp > ?1)), 0)
     + COALESCE((SELECT json_extract(s.v,'$.credits') FROM kv s WHERE s.k = 'sub:' || x.u AND (s.exp IS NULL OR s.exp > ?1) AND json_extract(s.v,'$.exp') > ?2), 0)) > 0
  AND ${notCapped("x.u")}
ORDER BY x.k LIMIT ?3`,
  extra: (now) => [now - 3 * HOUR, now - 20 * HOUR],
  marker: (r) => `lc:ex:${r.uid}:${r.d}`,
  note: (c, r, k) => {
    const deck = String(r.d ?? "");
    if (!/^[\w-]{1,48}$/.test(deck)) return null; // callback_data تلگرام حداکثر ۶۴ بایت است
    const rows = extraButtons(c.env, deck, new Set());
    if (!rows.length) return null;
    let left = 20;
    try { left = Math.max(1, Math.round((JSON.parse(r.v).l + 24 * HOUR - c.now) / HOUR)); } catch { /* پیش‌فرض */ }
    const lf = toFa(String(left));
    return {
      tag: "extras-nudge",
      tg: [
        "✨ <b>ارائه‌ات را کامل‌تر کن</b>",
        "",
        `برای ارائه‌ی امروزت هنوز پوستر، جزوه‌ی Word، اسلاید صوتی یا پادکست نساخته‌ای. هرکدام ۱ اعتبار است و تا حدود <b>${lf} ساعت</b> دیگر (۲۴ ساعت بعد از ساخت ارائه) می‌شود ساخت.`,
      ].join("\n"),
      kb: async () => ({ reply_markup: { inline_keyboard: rows } }),
      mail: {
        subject: `🎨 ارائه‌ات را به پوستر، جزوه و پادکست تبدیل کن — ${BRAND}`,
        m: {
          href: utm(c.env, "extras"), head: "ارائه‌ات را کامل‌تر کن ✨", sub: `${firstName(k.name)}، ارائه‌ی امروزت هنوز چند همراه ندارد.`,
          paras: [`پوستر، جزوه‌ی Word، اسلاید صوتی و پادکست از همان ارائه ساخته می‌شود؛ هرکدام ۱ اعتبار. این امکان تا حدود ${lf} ساعت دیگر (۲۴ ساعت بعد از ساخت ارائه) باز است.`],
          rows: [["ارائه", "ارائه‌ی امروز"], ["زمان باقی‌مانده", `حدود ${lf} ساعت`]],
          cta: "دیدن فایل‌ها ←", color: "#7c3aed", foot: "این پیام فقط یک‌بار برای هر ارائه فرستاده می‌شود.", preview: "پوستر، جزوه و پادکست ارائه‌ات را بساز.",
        },
      },
      push: { title: "ارائه‌ات را کامل‌تر کن", body: `پوستر، جزوه، اسلاید صوتی و پادکست تا حدود ${lf} ساعت دیگر باز است.`, url: "/", tag: "extras" },
    };
  },
};

// کار ۳٫۵: «فایل‌هایت آماده است» حدود ۱ ساعت بعد از ساخت ارائه (همه‌ی کانال‌ها؛ ایمیل با پیوست PPTX؛ cron ساعتی ⇒ ۱ تا ۲ ساعت بعد، در ساعت‌های مجاز ارسال؛ سقف ۲۰ ساعته را مصرف نمی‌کند)
const flJob: Job<ActRow> = {
  name: "fl", noCap: true,
  sql: `
SELECT ${ACT_COLS()}
${ACT_FROM("json_extract(v,'$.d') IS NOT NULL AND json_extract(v,'$.l') <= ?4 AND json_extract(v,'$.l') > ?5")}
WHERE ${notMarked("'lc:fl:' || x.u || ':' || x.d")}
ORDER BY x.k LIMIT ?3`,
  // ۲۰ ساعت: بعد از آن فایل‌ها (نگه‌داری ۲۴ ساعته) رو به پاک‌شدن‌اند و پیام بی‌فایده است
  extra: (now) => [now - 1 * HOUR, now - 20 * HOUR],
  marker: (r) => `lc:fl:${r.uid}:${r.d}`,
  note: async (c, r, k) => {
    let left = 23, ago = 1;
    try {
      const l = JSON.parse(r.v).l;
      left = Math.max(1, Math.round((l + 24 * HOUR - c.now) / HOUR));
      ago = Math.max(1, Math.round((c.now - l) / HOUR)); // ایمیل بین ۱ تا ۲۰ ساعت بعد از ساخت می‌رود (ساعت مجاز و سقف ۲۰ ساعته)؛ پس «یک ساعت پیش» ثابت نادرست است
    } catch { /* پیش‌فرض */ }
    const lf = toFa(String(left));
    const agoTxt = ago <= 1 ? "یک ساعت" : `حدود ${toFa(String(ago))} ساعت`;
    // فایل PPTX همان ارائه از KV فایل‌ها (۱ زیردرخواست)؛ اگر نبود/بزرگ بود/بودجه تمام شد، ایمیل بدون پیوست و فقط با لینک می‌رود
    let attach: { filename: string; content: string }[] | undefined;
    if (k.email && r.d && take(c, 1)) { // پیوست فقط برای ایمیل لازم است
      try {
        const f = await loadFileDirect(c.env, r.uid, String(r.d));
        if (f && f.data.byteLength <= FL_MAX_BYTES) attach = [{ filename: f.entry.name, content: toBase64(f.data) }];
      } catch (e) { console.error("lifecycle fl attach", String(e).slice(0, 160)); }
    }
    return {
      tag: "files-ready",
      tg: [
        "📂 <b>فایل‌های ارائه‌ات آماده‌ی دانلود است</b>",
        "",
        `ارائه‌ات ${tgEsc(agoTxt)} پیش ساخته شد. فایل‌ها ۲۴ ساعت نگه‌داری می‌شوند؛ تا حدود <b>${lf} ساعت</b> دیگر می‌توانی دوباره از بخش «فایل‌ها» بگیری‌شان.`,
      ].join("\n"),
      kb: startKb(c.env),
      attach,
      mail: {
        subject: `📂 فایل ارائه‌ات آماده است — ${BRAND}`,
        m: {
          href: utm(c.env, "files"), head: "فایل‌هایت آماده است 📂", sub: `${firstName(k.name)}، ارائه‌ات ${agoTxt} پیش ساخته شد.`,
          paras: [
            attach ? "فایل PPTX ارائه‌ات به همین ایمیل پیوست شده است." : "فایل ارائه‌ات در سایت آماده‌ی دانلود است.",
            `فایل‌های ساخته‌شده ۲۴ ساعت در سایت نگه‌داری می‌شوند؛ تا حدود ${lf} ساعت دیگر می‌توانی دوباره از آنجا بگیری‌شان.`,
          ],
          rows: [["پیوست", attach ? "فایل PPTX" : "ندارد؛ از سایت دانلود کن"], ["زمان باقی‌مانده در سایت", `حدود ${lf} ساعت`]],
          cta: "دیدن و دانلود فایل‌ها ←", color: "#2563eb", foot: "این ایمیل فقط یک‌بار برای هر ارائه فرستاده می‌شود.", preview: "فایل PPTX ارائه‌ات پیوست شده است.",
        },
      },
      push: { title: "فایل‌های ارائه‌ات آماده‌ی دانلود است", body: `تا حدود ${lf} ساعت دیگر می‌توانی دوباره از بخش «فایل‌ها» بگیری‌شان.`, url: "/", tag: "files" },
    };
  },
};

// کار ۳٫۷: پیشنهاد خرید ۴۸ ساعته؛ یک‌بار برای هر حساب (مثل بقیه، در همه‌ی کانال‌ها)
const buyJob: Job<ActRow> = {
  name: "buy", doneTtl: BUY_TTL, maxRows: BUY_PER_RUN,
  sql: `
SELECT ${ACT_COLS()}
${ACT_FROM("json_extract(v,'$.l') <= ?4")}
WHERE ${notMarked("'lc:buy:' || x.u")}
  AND ${noActivePlan("x.u")}
  AND NOT EXISTS (SELECT 1 FROM kv q WHERE ${rng("q.k", "pay:")} AND json_extract(q.v,'$.uid') = x.u AND json_extract(q.v,'$.state') = 'paid')
  AND NOT EXISTS (SELECT 1 FROM kv n WHERE n.k = 'ban:' || x.u)
  -- فقط حساب‌هایی که حداقل یک کانال دارند؛ بقیه ردیف و سهمیه مصرف نکنند
  AND (EXISTS (SELECT 1 FROM kv t WHERE t.k = 'w2tg:' || x.u)
    OR EXISTS (SELECT 1 FROM kv p WHERE p.k = 'wps:' || x.u AND (p.exp IS NULL OR p.exp > ?1))
    OR EXISTS (SELECT 1 FROM kv f WHERE f.k = 'ptu:' || x.u AND (f.exp IS NULL OR f.exp > ?1))
    OR EXISTS (SELECT 1 FROM kv w WHERE w.k = 'wu:' || x.u AND COALESCE(json_extract(w.v,'$.email'), '') <> ''))
  AND ${notCapped("x.u")}
ORDER BY json_extract(x.v,'$.l') DESC
-- سقف روزانه: تعداد پیشنهادهای واقعاً فرستاده‌شده (نشانگر «1») در ۲۴ ساعت گذشته از سقف کم می‌شود
LIMIT MIN(?3, MAX(0, ?6 - (SELECT COUNT(*) FROM kv m WHERE ${rng("m.k", "lc:buy:")} AND m.v = '1' AND m.exp > ?5)))`,
  // ?4 = ۴۸ ساعت پیش (بدون سقف بالا: قدیمی‌ها هم می‌گیرند)؛ تازه‌ترین‌ها اول. ?5 = آستانه‌ی «امروز» روی exp نشانگرها (ثانیه)، ?6 = سقف روزانه
  extra: (now) => [now - 48 * HOUR, Math.floor(now / 1000) + BUY_TTL - 86_400, BUY_PER_DAY],
  marker: (r) => `lc:buy:${r.uid}`,
  note: (c, r, k) => {
    const [plus, pro] = [PLANS.find((p) => p.id === "plus"), PLANS.find((p) => p.id === "pro")];
    if (!plus || !pro) return null;
    const fa = (n: number) => toFa(String(n));
    const line = (p: typeof plus) => `پلن ${p.name}: ${fa(p.credits)} ارائه در ماه، تا ${fa(p.maxSlides)} اسلاید`;
    return {
      tag: "buy-offer-48h",
      tg: [
        "🚀 <b>ارائه‌های بیشتر و بلندتر می‌خواهی؟</b>",
        "",
        `دو روز از آخرین ارائه‌ات گذشته. با پلن ماهانه تعداد ارائه و اسلاید بیشتری داری:`,
        `• ${tgEsc(line(plus))}`,
        `• ${tgEsc(line(pro))}`,
      ].join("\n"),
      kb: async (kk) => buyKbFor(c.env, kk.uid, kk.tgId ?? undefined),
      mail: {
        subject: `🚀 ارائه‌های بیشتر، اسلاید بلندتر: پلن‌های ${BRAND}`,
        m: {
          href: utm(c.env, "buy48", "/?buy=1"), head: "ارائه‌های بیشتر و بلندتر 🚀", sub: `${firstName(k.name)}، دو روز از آخرین ارائه‌ات گذشته.`,
          paras: ["با پلن ماهانه می‌توانی ارائه‌ی بیشتری در ماه، با اسلاید و تصویر بیشتر بسازی. مقایسه‌ی دو پلن را پایین ببین."],
          rows: [],
          cta: "دیدن پلن‌ها ←", color: "#2563eb", foot: "این پیشنهاد فقط یک‌بار فرستاده می‌شود.", preview: "پلن‌های ماهانه برای ساخت ارائه‌ی بیشتر.",
        },
      },
      push: { title: "ارائه‌های بیشتر و بلندتر می‌خواهی؟", body: `${line(plus)}؛ ${line(pro)}.`, url: "/?buy=1", tag: "buy48" },
    };
  },
};

// کار ۴: «ارائه‌ی بعدی» برای کاربر تازه‌کار (۱ تا ۲ ارائه)
const nxJob: Job<ActRow> = {
  name: "nx",
  sql: `
SELECT ${ACT_COLS()}
${ACT_FROM("json_extract(v,'$.n') BETWEEN 1 AND 2 AND json_extract(v,'$.l') <= ?4 AND json_extract(v,'$.l') > ?5")}
WHERE ${notMarked("'lc:nx:' || x.u")}
  AND ${notCapped("x.u")}
ORDER BY x.k LIMIT ?3`,
  extra: (now) => [now - 48 * HOUR, now - 96 * HOUR],
  marker: (r) => `lc:nx:${r.uid}`,
  note: (c, r, k) => {
    const tip = TIPS[hashOf(r.uid) % TIPS.length];
    const topic = seasonalTopic(r.uid, c.now);
    return {
      tag: "next-deck",
      tg: [
        "💡 <b>ارائه‌ی بعدی‌ات چیست؟</b>",
        "",
        `برای ارائه‌ی بعدی می‌توانی ${tgEsc(tip)}.`,
        `یک ایده برای شروع: <code>${tgEsc(topic)}</code>`,
        "",
        `امروز ${toFa(String(DAILY_FREE_CREDITS))} ارائه‌ی رایگان داری؛ موضوع را کپی کن و بفرست.`,
      ].join("\n"),
      kb: startKb(c.env),
      mail: {
        subject: `💡 ایده‌ی ارائه‌ی بعدی‌ات: «${topic}» — ${BRAND}`,
        m: {
          href: utm(c.env, "next"), head: "ارائه‌ی بعدی‌ات چیست؟ 💡", sub: `${firstName(k.name)}، یک نکته برای ارائه‌ی بعدی.`,
          paras: [`برای ارائه‌ی بعدی می‌توانی ${tip}.`, `یک ایده برای شروع: «${topic}».`],
          rows: [["موضوع پیشنهادی", topic]], cta: "ساخت ارائه ←", color: "#2563eb", foot: "این پیام فقط یک‌بار فرستاده می‌شود.", preview: `ارائه‌ی بعدی: «${topic}»`,
        },
      },
      push: { title: "ارائه‌ی بعدی‌ات چیست؟", body: `ایده: «${topic}»؛ امروز یک ارائه‌ی رایگان داری.`, url: "/", tag: "next" },
    };
  },
};

// کار ۵: بازگشت کاربر غیرفعال (۱۴ و ۳۰ روز بعد از آخرین ارائه)
const wbJob = (days: 14 | 30): Job<ActRow> => ({
  name: `wb${days}`,
  sql: `
SELECT ${ACT_COLS()}
${ACT_FROM("json_extract(v,'$.l') <= ?4 AND json_extract(v,'$.l') > ?5")}
WHERE ${notMarked(`'lc:wb${days}:' || x.u`)}
  AND ${noActivePlan("x.u")}
  AND ${notCapped("x.u")}
ORDER BY x.k LIMIT ?3`,
  extra: (now) => [now - days * DAY, now - (days + 7) * DAY],
  marker: (r) => `lc:wb${days}:${r.uid}`,
  note: (c, r, k) => {
    const topic = seasonalTopic(r.uid + days, c.now);
    const lead = days === 14 ? "مدتی است ارائه‌ای نساخته‌ای" : "یک ماه از آخرین ارائه‌ات گذشته";
    return {
      tag: `winback-${days}d`,
      tg: [
        `👋 <b>${lead}</b>`,
        "",
        `امروز ${toFa(String(DAILY_FREE_CREDITS))} ارائه‌ی رایگان داری. یک ایده برای این روزها:`,
        `<code>${tgEsc(topic)}</code>`,
        "",
        "همین را کپی کن و بفرست؛ ۱ تا ۲ دقیقه بعد فایل PPTX فارسی‌ات آماده است. متن، فایل Word/PDF یا لینک هم می‌شود.",
      ].join("\n"),
      kb: startKb(c.env),
      mail: {
        subject: `👋 «${topic}»؛ ایده‌ی این روزهای تو — ${BRAND}`,
        m: {
          href: utm(c.env, `wb${days}`), head: "یک ایده برای ارائه‌ی بعدی‌ات 💡", sub: `${firstName(k.name)}، ${lead}.`,
          paras: [`امروز ${toFa(String(DAILY_FREE_CREDITS))} ارائه‌ی رایگان داری. موضوع پیشنهادی این روزها: «${topic}».`, "متن، فایل Word/PDF یا لینک هم می‌توانی بدهی."],
          rows: [["موضوع پیشنهادی", topic]], cta: "ساخت ارائه ←", color: "#2563eb", foot: "این پیام فقط یک‌بار فرستاده می‌شود و بعد از آن مزاحمت نمی‌شویم.", preview: `«${topic}» را امتحان کن؛ امروز یک ارائه‌ی رایگان داری.`,
        },
      },
      push: { title: "ارائه‌ی بعدی‌ات؟", body: `ایده‌ی این روزها: «${topic}». امروز یک ارائه‌ی رایگان داری.`, url: "/", tag: "winback" },
    };
  },
});

// کار ۶: دعوت دوستان (یک‌بار، بعد از ۲ تا ۶ ارائه)
const invJob: Job<ActRow> = {
  name: "inv", doneTtl: INV_TTL,
  sql: `
SELECT ${ACT_COLS()}
${ACT_FROM("json_extract(v,'$.n') BETWEEN 2 AND 6 AND json_extract(v,'$.l') <= ?4 AND json_extract(v,'$.l') > ?5")}
WHERE ${notMarked("'lc:inv:' || x.u")}
  AND (EXISTS (SELECT 1 FROM kv t WHERE t.k = 'w2tg:' || x.u)
    OR EXISTS (SELECT 1 FROM kv p WHERE p.k = 'wps:' || x.u AND (p.exp IS NULL OR p.exp > ?1))
    OR EXISTS (SELECT 1 FROM kv f WHERE f.k = 'ptu:' || x.u AND (f.exp IS NULL OR f.exp > ?1))
    OR EXISTS (SELECT 1 FROM kv w WHERE w.k = 'wu:' || x.u AND COALESCE(json_extract(w.v,'$.email'), '') <> ''))
  AND NOT EXISTS (SELECT 1 FROM kv r WHERE r.k = 'refc:' || COALESCE((SELECT t3.v FROM kv t3 WHERE t3.k = 'w2tg:' || x.u), x.u))
  AND ${notCapped("x.u")}
ORDER BY x.k LIMIT ?3`,
  extra: (now) => [now - 2 * HOUR, now - 72 * HOUR],
  marker: (r) => `lc:inv:${r.uid}`,
  note: async (c, r, k) => {
    // کاربر پیام‌رسان‌دار: لینک پلتفرم خودش؛ حساب فقط‌وب/اپ (بدون ربات): لینک سایت (?ref=)
    const id: RefId = k.tgId ?? k.uid;
    // لینک اختصاصی پلتفرم خودِ کاربر (تلگرام/بله/روبیکا: ربات، ایتا: برنامک)؛ نام ربات‌ها یک‌بار در هر اجرا گرفته می‌شود
    const plat = invitePlatform(id);
    let name: string | undefined;
    if (plat === "tg" || plat === "bale" || plat === "rubika" || plat === "splus") {
      name = c.botNames.get(plat);
      if (name === undefined) {
        if (!take(c, 1)) return null;
        name = await botUsername(c.env, plat);
        c.botNames.set(plat, name);
      }
      if (!name) return null;
    }
    const link = await inviteLinkFor(c.env, id, name);
    if (!link) return null;
    const siteLink = webInviteLink(c.env, id);
    return {
      tag: "invite-ask",
      tg: `🙌 اگر از ساخت ارائه راضی بودی، به دوستانت هم معرفی کن:\n\n${inviteBody(link, 0)}`,
      kb: async () => inviteMarkup(id, link),
      mail: {
        subject: `دوستانت را دعوت کن و اعتبار هدیه بگیر 🎁 — ${BRAND}`,
        m: {
          href: utm(c.env, "invite", "/"), head: "اگر راضی بودی، به دوستانت هم معرفی کن 🙌", sub: `${firstName(k.name)}، دعوت دوستان اعتبار هدیه دارد`,
          paras: ["به ازای هر چند دوستی که با لینک تو وارد شوند و اولین ارائه‌شان را بسازند، اعتبار هدیه می‌گیری.", "لینک اختصاصی‌ات را برای دوستانت بفرست؛ دعوت وقتی شمرده می‌شود که دوستت اولین ارائه‌اش را بسازد."],
          rows: [["لینک اختصاصی تو", siteLink]], cta: "دعوت دوستان ←", color: "#0f766e", foot: "این پیام فقط یک‌بار فرستاده می‌شود.", preview: "با دعوت دوستانت اعتبار هدیه بگیر.",
        },
      },
      push: { title: "🙌 دوستانت را دعوت کن", body: "با هر دعوت موفق اعتبار هدیه بگیر؛ لینک اختصاصی‌ات در بخش «حساب» است.", url: "/", tag: "invite" },
    };
  },
};

// کار ۷: یادآوری نرم به دعوت‌شده‌ای که هنوز ارائه نساخته
interface RfnRow extends Base { tgid: string }
const rfnJob: Job<RfnRow> = {
  name: "rfn",
  sql: `
SELECT x.k AS k, x.tgid AS tgid, ${CONTACT("x.u")}
FROM (SELECT r.k AS k, substr(r.k, 6) AS tgid, COALESCE((SELECT w.v FROM kv w WHERE w.k = 'tg2w:' || substr(r.k, 6)), CASE WHEN substr(r.k, 6, 2) = 'w_' THEN substr(r.k, 6) END) AS u FROM kv r
      WHERE ${rng("r.k", "refp:")} AND r.exp - 2592000 <= ?4 AND r.exp - 2592000 > ?5) x
WHERE x.u IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM kv a WHERE a.k = 'act:' || x.u)
  AND ${notMarked("'lc:rfn:' || x.tgid")}
  AND ${notCapped("x.u")}
ORDER BY x.k LIMIT ?3`,
  // exp ردیف refp: بر حسب ثانیه است و ۳۰ روز اعتبار دارد؛ پس «ساخته‌شده ۳ تا ۴۸ ساعت پیش» ⇔ exp - ۳۰ روز در این بازه
  extra: (now) => [Math.floor((now - 3 * HOUR) / 1000), Math.floor((now - 48 * HOUR) / 1000)],
  marker: (r) => `lc:rfn:${r.tgid}`,
  note: (c, _r, k) => ({
    tag: "referral-invitee",
    tg: [
      "🎁 <b>اولین ارائه‌ات یک پیام فاصله دارد</b>",
      "",
      "با لینک دعوت یکی از دوستانت وارد شدی. موضوعت را بفرست (یا فایل Word/PDF یا لینک)؛ ۱ تا ۲ دقیقه بعد فایل PPTX فارسی‌ات آماده است.",
      "با ساخت اولین ارائه‌ات، دعوتِ دوستت هم شمرده می‌شود.",
    ].join("\n"),
    kb: startKb(c.env),
    mail: {
      subject: `اولین ارائه‌ات یک پیام فاصله دارد 🎁 — ${BRAND}`,
      m: {
        href: utm(c.env, "invitee", "/"), head: "اولین ارائه‌ات یک قدم فاصله دارد 🎁", sub: `${firstName(k.name)}، با لینک دعوت یکی از دوستانت وارد شدی`,
        paras: ["موضوعت را بنویس (یا فایل Word/PDF یا لینک بده)؛ ۱ تا ۲ دقیقه بعد فایل PPTX فارسی‌ات آماده است.", "با ساخت اولین ارائه‌ات، دعوتِ دوستت هم شمرده می‌شود."],
        rows: [], cta: "ساخت ارائه ←", color: "#0f766e", foot: "این پیام فقط یک‌بار فرستاده می‌شود.", preview: "اولین ارائه‌ات یک پیام فاصله دارد.",
      },
    },
    push: { title: "🎁 اولین ارائه‌ات یک پیام فاصله دارد", body: "موضوعت را بنویس؛ با اولین ارائه‌ات، دعوتِ دوستت هم شمرده می‌شود.", url: "/", tag: "invitee" },
  }),
};

// کار ۸: هدیه‌ی تکمیل پروفایل (یک‌بار برای هر حساب). نه در بدو ورود: بعد از اینکه کاربر طعم ساخت ارائه را چشید (۲۶ ساعت تا ۸ روز بعد از آخرین ارائه؛
// از پنجره‌ی ۳ تا ۲۰ ساعتِ «ex» جداست). فقط حساب‌هایی که موبایل یا ایمیلی ندارند و هدیه‌ی همان مورد (pcr:u:<حساب>:mobile|email) را هنوز نگرفته‌اند.
// متن بر اساس وضعیت واقعی حساب ساخته می‌شود (موبایل / ایمیل / هر دو) و فقط موردی که ثبتش در سرور فعال است (OTP پیامکی/ایمیلی) آورده می‌شود.
const pfJob: Job<ActRow> = {
  name: "pf", doneTtl: INV_TTL,
  sql: `
SELECT ${ACT_COLS()}
${ACT_FROM("json_extract(v,'$.n') >= 1 AND json_extract(v,'$.l') <= ?4 AND json_extract(v,'$.l') > ?5")}
WHERE ${notMarked("'lc:pf:' || x.u")}
  AND (
    (COALESCE((SELECT json_extract(w.v,'$.mobile') FROM kv w WHERE w.k = 'wu:' || x.u), '') = ''
       AND NOT EXISTS (SELECT 1 FROM kv g WHERE g.k = 'pcr:u:' || x.u || ':mobile'))
    OR
    (COALESCE((SELECT json_extract(w.v,'$.email') FROM kv w WHERE w.k = 'wu:' || x.u), '') = ''
       AND NOT EXISTS (SELECT 1 FROM kv g WHERE g.k = 'pcr:u:' || x.u || ':email'))
  )
  AND ${notCapped("x.u")}
ORDER BY x.k LIMIT ?3`,
  extra: (now) => [now - 26 * HOUR, now - 8 * DAY],
  marker: (r) => `lc:pf:${r.uid}`,
  note: (c, r, k) => {
    if (CONTACT_CREDITS <= 0) return null;
    let u: WebUser | null = null;
    try { u = r.usr ? (JSON.parse(r.usr) as WebUser) : null; } catch { /* بدون پروفایل */ }
    if (!u) return null;
    const missing: string[] = [];
    if (!u.mobile && otpEnabled(c.env)) missing.push("mobile");
    if (!u.email && emailOtpEnabled(c.env)) missing.push("email");
    if (!missing.length) return null;
    const both = missing.length > 1;
    const what = both ? "شماره‌ی موبایل و ایمیل" : missing[0] === "mobile" ? "شماره‌ی موبایل" : "ایمیل";
    const n = toFa(String(CONTACT_CREDITS));
    const gift = both ? `${n} اعتبار هدیه برای هر مورد` : `${n} اعتبار هدیه`;
    return {
      tag: "profile-gift",
      tg: [
        `🎁 <b>${gift} برای تکمیل پروفایل</b>`,
        "",
        `با ثبت و تایید ${what} با کد یک‌بارمصرف، ${gift} می‌گیری (برای هر مورد فقط یک‌بار).`,
        tgEsc(CONTACT_REWARD_NOTE),
      ].join("\n"),
      kb: async () => ({ reply_markup: { inline_keyboard: [[{ text: "👤 تکمیل پروفایل", callback_data: "h:pf" }]] } }),
      mail: {
        subject: `${gift} برای تکمیل پروفایل — ${BRAND}`,
        m: {
          href: utm(c.env, "profile", "/?profile=1"), head: "یک هدیه برای تکمیل پروفایلت 🎁", sub: `${firstName(k.name)}، ${gift} منتظر توست.`,
          paras: [`با ثبت و تایید ${what} در پروفایل، ${gift} به حسابت اضافه می‌شود (برای هر مورد فقط یک‌بار).`, CONTACT_REWARD_NOTE],
          rows: [["هدیه", `${n} اعتبار` + (both ? " برای هر مورد" : "")], ["نیاز به", what]], cta: "تکمیل پروفایل ←", color: "#2563eb",
          foot: "این پیام فقط یک‌بار فرستاده می‌شود.", preview: `${gift} با ثبت ${what}`,
        },
      },
      push: { title: "🎁 هدیه‌ی تکمیل پروفایل", body: `با ثبت و تایید ${what}، ${gift} بگیر.`, url: "/?profile=1", tag: "profile-gift" },
    };
  },
};

// کار ۹: «یک قهوه مهمانم کن» (حمایت از سازنده، صفحه‌ی /support). یک‌بار برای هر کسی که حداقل ۲ ارائه ساخته و ۲۴ ساعت یا بیشتر از آخرین ارائه‌اش گذشته
// (بدون سقف بالا: کاربران قدیمی هم می‌گیرند؛ تازه‌ترین‌ها اول). مثل «buy» سقف هر اجرا و سقف روزانه دارد تا بک‌لاگ قدیمی‌ها در چند روز خالی شود نه یک‌جا؛
// فقط حساب‌هایی که حداقل یک کانال دارند ردیف و سهمیه مصرف می‌کنند. سقف «۱ اعلان در ۲۰ ساعت» هم رعایت می‌شود. لحن دوستانه و دعوت است نه درخواست.
const CF_PER_RUN = 5;
const CF_PER_DAY = 60;
const cfJob: Job<ActRow> = {
  name: "cf", doneTtl: INV_TTL, maxRows: CF_PER_RUN,
  sql: `
SELECT ${ACT_COLS()}
${ACT_FROM("json_extract(v,'$.n') >= 2 AND json_extract(v,'$.l') <= ?4")}
WHERE ${notMarked("'lc:cf:' || x.u")}
  AND NOT EXISTS (SELECT 1 FROM kv n WHERE n.k = 'ban:' || x.u)
  AND (EXISTS (SELECT 1 FROM kv t WHERE t.k = 'w2tg:' || x.u)
    OR EXISTS (SELECT 1 FROM kv p WHERE p.k = 'wps:' || x.u AND (p.exp IS NULL OR p.exp > ?1))
    OR EXISTS (SELECT 1 FROM kv f WHERE f.k = 'ptu:' || x.u AND (f.exp IS NULL OR f.exp > ?1))
    OR EXISTS (SELECT 1 FROM kv w WHERE w.k = 'wu:' || x.u AND COALESCE(json_extract(w.v,'$.email'), '') <> ''))
  AND ${notCapped("x.u")}
ORDER BY json_extract(x.v,'$.l') DESC
-- سقف روزانه: تعداد پیام‌های واقعاً فرستاده‌شده (نشانگر «1») در ۲۴ ساعت گذشته از سقف کم می‌شود
LIMIT MIN(?3, MAX(0, ?6 - (SELECT COUNT(*) FROM kv m WHERE ${rng("m.k", "lc:cf:")} AND m.v = '1' AND m.exp > ?5)))`,
  // ?4 = ۲۴ ساعت پیش (بدون سقف بالا). ?5 = آستانه‌ی «امروز» روی exp نشانگرها (ثانیه)، ?6 = سقف روزانه
  extra: (now) => [now - 24 * HOUR, Math.floor(now / 1000) + INV_TTL - 86_400, CF_PER_DAY],
  marker: (r) => `lc:cf:${r.uid}`,
  note: (c, r, k) => {
    const url = utm(c.env, "coffee", "/support"); // ایمیل
    const botUrl = `${siteOf(c.env)}/support?utm_source=lifecycle&utm_medium=bot&utm_campaign=coffee`; // ربات
    return {
      tag: "coffee",
      tg: [
        "☕ <b>یه قهوه مهمونم می‌کنی؟</b>",
        "",
        "دیدم چند تا ارائه با pptساز ساختی؛ امیدوارم کارت رو راه انداخته باشه 😊",
        "اگه ازش خوشت اومده، یه قهوه مهمونم کن تا با انرژی بیشتر بهترش کنم ☕💛",
        "",
        "همین که ازش استفاده می‌کنی برام ارزش داره 🙏",
        "",
        tgEsc(botUrl),
      ].join("\n"),
      kb: async () => ({ reply_markup: { inline_keyboard: [[{ text: "☕ یه قهوه مهمونت می‌کنم", url: botUrl }]] } }),
      mail: {
        subject: `یه قهوه مهمونم می‌کنی؟ ☕ — ${BRAND}`,
        m: {
          href: url, head: "یه قهوه مهمونم می‌کنی؟ ☕", sub: `${firstName(k.name)}، چند تا ارائه با هم ساختیم 😊`,
          paras: ["امیدوارم pptساز کارت رو راه انداخته باشه. اگه ازش خوشت اومده، یه قهوه مهمونم کن تا با انرژی بیشتر بهترش کنم 💛", "همین که ازش استفاده می‌کنی برام ارزش داره 🙏"],
          rows: [], cta: "یه قهوه مهمونم کن ←", color: "#b45309", foot: "این پیام فقط یک‌بار فرستاده می‌شود.", preview: "اگه از pptساز خوشت اومده، یه قهوه مهمونم کن ☕",
        },
      },
      push: { title: "☕ یه قهوه مهمونم می‌کنی؟", body: "اگه از pptساز خوشت اومده، یه قهوه مهمونم کن 💛", url: "/support", tag: "coffee" },
      fcmUrl: `${siteOf(c.env)}/support?utm_source=lifecycle&utm_medium=app&utm_campaign=coffee`,
    };
  },
};

// ---------- اجرا ----------
/** از cron ساعتی صدا زده می‌شود. */
export async function runLifecycle(env: Env): Promise<Record<string, number>> {
  const sent: Record<string, number> = {};
  try {
    const now = Date.now();
    if (!inSendHours(now)) return sent;
    const mailOn = emailEnabled(env);
    if (!mailOn && !env.TELEGRAM_BOT_TOKEN && !env.BALE_BOT_TOKEN && !env.SPLUS_BOT_TOKEN && !env.RUBIKA_BOT_TOKEN && !env.EITAA_APP_TOKEN && !webPushEnabled(env) && !pushEnabled(env)) return sent;
    await env.KV.ready();
    const c: Ctx = { env, now, nowSec: Math.floor(now / 1000), left: SUBREQUEST_BUDGET, mailOn, botNames: new Map() };
    // پرداخت و هشدار اعتبار همیشه اول؛ بقیه هر ساعت با ترتیب چرخشی تا هیچ‌کدام گرسنه نماند
    const rest: Job<any>[] = [flJob, buyJob, exJob, nxJob, wbJob(14), wbJob(30), invJob, pfJob, cfJob, rfnJob];
    const shift = Math.floor(now / HOUR) % rest.length;
    const order: Job<any>[] = [payJob, lowJob, ...rest.slice(shift), ...rest.slice(0, shift)];
    for (const job of order) {
      const n = await runJob(c, job);
      if (n) sent[job.name] = n;
    }
  } catch (e) {
    console.error("runLifecycle", String(e).slice(0, 300));
  }
  return sent;
}
