/**
 * چت پشتیبانی سایت: فقط دستیار هوشمند جواب می‌دهد (گفتگوی انسانی ندارد).
 *
 * - فقط کاربر واردشده (ثبت‌نام‌شده) می‌تواند چت کند؛ مهمان ۴۰۱ می‌گیرد.
 * - هر کاربر در هر روز (به وقت ایران) حداکثر DAILY_LIMIT پیام می‌فرستد.
 * - مدل در موضوع‌های خاص (پرداخت/بازپرداخت/خطای فنی/حساب/شکایت/همکاری) پاسخ را با [[REFER:دسته]] شروع می‌کند؛
 *   سرور همان لحظه یک اعلان یک‌طرفه برای مدیر در تلگرام می‌فرستد (همراه کارت کاربر) و به کاربر «ارجاع شد» می‌گوید.
 *   مدیر از پنل تلگرام با «✍️ پاسخ در چت» جواب می‌دهد (پیام r="m" در همین گفتگو) و در چت کاربر دیده می‌شود.
 * - جستجوی هوشمند در سایت (Cloudflare AI Search) حذف شد؛ به‌جایش پرامپت قوی‌تر و فهرست زنده‌ی صفحه‌ها و مقاله‌های سایت (از
 *   landing-data / blog-data) به مدل داده می‌شود و مدل برای پرسش‌های عمومی از دانش خودش هم جواب می‌دهد.
 *
 * ذخیره‌سازی: env.KV (نمای D1) با کلید sc:u:<uid>؛ سابقه‌ی گفتگو فقط ۷ روز نگه داشته می‌شود (پیام‌های قدیمی‌تر از ۷ روز هنگام خواندن/نوشتن حذف می‌شوند و کل گفتگو هم ۷ روز پس از آخرین فعالیت منقضی می‌شود). هر کاربر یک گفتگوی پیوسته دارد (در همه‌ی دستگاه‌ها یکسان).
 *
 * مسیرها (در web.ts):
 *   POST /api/support/send     { text }  ← پیام کاربر؛ جواب دستیار را برمی‌گرداند
 *   GET  /api/support/history            ← گفتگوی قبلی و پیام‌های باقی‌مانده‌ی امروز
 */
import type { Env } from "./env";
import { askQuick, modelList } from "./llm";
import { authUser, getUserById, hitLimit, type WebUser } from "./auth";
import {
  ABS_MAX_SLIDES, DAILY_FREE_CREDITS, FREE_MAX_IMAGES, FREE_MAX_SLIDES, PLAN_MAX_IMAGES, REF_EVERY, REF_MAX, SIGNUP_CREDITS,
  adminIds, botPlatform, freeModelId, getActiveSub, getCredit, statDay, today,
  type Platform, type Uid,
} from "./settings";
import { PLANS } from "./payment";
import { MODES, THEMES, TONES } from "./themes";
import { PAGES } from "./landing-data";
import { POSTS } from "./blog-data";
import { esc, sendMessage } from "./telegram";
import { getLinkedTg } from "./link";

/** r: u = کاربر، a = دستیار، m = پاسخ پشتیبان انسانی (مدیر)؛ f = این پاسخ، ارجاع به مدیر بوده است */
interface Msg { r: "u" | "a" | "m"; t: string; ts: number; f?: 1 }
interface Conv { uid: string; m: Msg[]; c: number; u: number }

export const DAILY_LIMIT = 10; // سقف پیام کاربر در روز (به وقت ایران)
const RETENTION_DAYS = 7; // سابقه‌ی چت بیشتر از ۷ روز نگه داشته نمی‌شود
const TTL = RETENTION_DAYS * 86400;
const MAX_TEXT = 600;
export const SUPPORT_MAX_TEXT = MAX_TEXT;

/** کانالی که کاربر از آن با دستیار حرف می‌زند؛ هم در پرامپت (وضعیت کاربر) و هم در اعلان مدیر می‌آید */
export type SupportChannel = "web" | "miniapp" | "eitaa" | "tg" | "bale" | "rubika" | "splus";
const CHANNEL_LABEL: Record<SupportChannel, string> = {
  web: "سایت یا اپ اندروید", miniapp: "اپ داخل تلگرام/بله (Mini App)", eitaa: "برنامک ایتا",
  tg: "ربات تلگرام", bale: "ربات بله", rubika: "ربات روبیکا", splus: "ربات سروش‌پلاس",
};
const PLATFORM_LABEL: Partial<Record<Platform, string>> = { tg: "تلگرام", bale: "بله", rubika: "روبیکا", eitaa: "ایتا", splus: "سروش‌پلاس" };
const MAX_STORED = 60; // فقط آخرین ۶۰ پیام نگه داشته می‌شود (قدیمی‌ترها حذف می‌شوند)
const USER_VIEW = 60; // کاربر فقط آخرین ۶۰ پیام را در چت می‌بیند
const HISTORY_FOR_MODEL = 12;
const convKey = (uid: string) => `sc:u:${uid}`;
const quotaKey = (uid: string) => `scd:${uid}:${statDay()}`;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
const toFa = (n: number | string) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);
const clean = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200E\u200F\u202A-\u202E]/g, "").replace(/\s+\n/g, "\n").trim().slice(0, max);

/** پیام‌های قدیمی‌تر از ۷ روز را حذف می‌کند (انقضای KV از آخرین نوشتن حساب می‌شود، پس گفتگوی فعال بدون این هرس سابقه‌ی بلندتری می‌ساخت) */
const prune = (c: Conv): Conv => { const min = Date.now() - TTL * 1000; c.m = c.m.filter((x) => x.ts >= min); return c; };
const load = async (env: Env, uid: string) => {
  const c = (await env.KV.get(convKey(uid), "json")) as Conv | null;
  return c ? prune(c) : null;
};
const save = (env: Env, c: Conv) => env.KV.put(convKey(c.uid), JSON.stringify(c), { expirationTtl: TTL });


// ---------- آمار پشتیبانی به ازای کاربر (برای پنل مدیر؛ بدون انقضا) ----------
/** n = تعداد پیام‌های کاربر، f = تعداد پاسخ‌های ارجاع‌شده، s = اولین پیام، t = آخرین پیام */
export interface SupportStat { n: number; f: number; s: number; t: number }
const statKey = (uid: string) => `scs:${uid}`;
const MAXC = "\u{10FFFF}";

/** گفتگوی کامل یک کاربر برای پنل مدیر */
export const loadSupportConv = (env: Env, uid: string) => load(env, uid);

/** گفتگوهای قدیمی که هنوز شمارنده ندارند را از روی خود گفتگو شمارنده‌دار می‌کند (هر بار حداکثر ۵۰ تا) */
async function backfillSupportStats(env: Env): Promise<void> {
  await env.KV.ready();
  const rs = (await env.DB.prepare(
    "SELECT c.k AS k, c.v AS v FROM kv c LEFT JOIN kv s ON s.k = 'scs:' || substr(c.k, 6) WHERE c.k >= ?1 AND c.k < ?2 AND (c.exp IS NULL OR c.exp > ?3) AND s.k IS NULL LIMIT 50",
  ).bind("sc:u:", "sc:u:" + MAXC, Math.floor(Date.now() / 1000)).all<{ k: string; v: string }>()).results ?? [];
  for (const r of rs) {
    try {
      const c = JSON.parse(r.v) as Conv;
      const uid = r.k.slice(5);
      const st: SupportStat = { n: c.m.filter((x) => x.r === "u").length, f: c.m.filter((x) => x.f).length, s: c.c, t: c.u };
      await env.KV.put(statKey(uid), JSON.stringify(st));
    } catch { /* ردیف خراب نادیده گرفته می‌شود */ }
  }
}

export async function supportOverview(env: Env): Promise<{ users: number; msgs: number; refs: number; today: number }> {
  await backfillSupportStats(env).catch(() => {});
  const one = async (sql: string, ...b: unknown[]) => Number((await env.DB.prepare(sql).bind(...b).first<{ c: number | null }>())?.c ?? 0);
  const [users, msgs, refs, today] = await Promise.all([
    one("SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2", "scs:", "scs:" + MAXC),
    one("SELECT SUM(json_extract(v,'$.n')) c FROM kv WHERE k >= ?1 AND k < ?2", "scs:", "scs:" + MAXC),
    one("SELECT SUM(json_extract(v,'$.f')) c FROM kv WHERE k >= ?1 AND k < ?2", "scs:", "scs:" + MAXC),
    // سهمیه‌ی امروزِ همه‌ی کاربران (scd:<uid>:<روز>) = پیام‌های امروز
    one("SELECT SUM(CAST(v AS INTEGER)) c FROM kv WHERE k >= ?1 AND k < ?2 AND k LIKE ?3", "scd:", "scd:" + MAXC, `%:${statDay()}`),
  ]);
  return { users, msgs, refs, today };
}

/** فهرست کاربران پشتیبانی: mode "r" = آخرین فعالیت، "n" = بیشترین پیام */
export async function supportUsers(env: Env, mode: "r" | "n", page: number, per: number): Promise<{ total: number; items: { uid: string; st: SupportStat }[] }> {
  await env.KV.ready();
  const total = Number((await env.DB.prepare("SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2").bind("scs:", "scs:" + MAXC).first<{ c: number }>())?.c ?? 0);
  const order = mode === "n" ? "json_extract(v,'$.n') DESC, json_extract(v,'$.t') DESC" : "json_extract(v,'$.t') DESC";
  const rs = (await env.DB.prepare(`SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 ORDER BY ${order} LIMIT ?3 OFFSET ?4`)
    .bind("scs:", "scs:" + MAXC, per, page * per).all<{ k: string; v: string }>()).results ?? [];
  const items: { uid: string; st: SupportStat }[] = [];
  for (const r of rs) {
    try { items.push({ uid: r.k.slice(4), st: JSON.parse(r.v) as SupportStat }); } catch { /* خراب */ }
  }
  return { total, items };
}

// ---------- سهمیه‌ی روزانه ----------
async function quotaUsed(env: Env, uid: string): Promise<number> {
  return Math.max(0, Number(await env.KV.get(quotaKey(uid))) || 0);
}
/** وقتی خطا از سمت ما بود (مدل در دسترس نبود)، پیام کاربر از سهمیه‌اش کم نمی‌شود */
async function refundQuota(env: Env, uid: string): Promise<void> {
  await env.KV.ready();
  await env.DB.prepare("UPDATE kv SET v = CAST(MAX(CAST(v AS INTEGER) - 1, 0) AS TEXT) WHERE k = ?1").bind(quotaKey(uid)).run().catch(() => {});
}
const remainingOf = (used: number) => Math.max(0, DAILY_LIMIT - used);
const view = (c: Conv | null, used: number) => ({
  msgs: (c?.m ?? []).slice(-USER_VIEW).map(({ r, t, f }) => ({ r, t, f: f ? 1 : 0, ...(r === "m" ? { h: 1 } : {}) })),
  hc: (c?.m ?? []).filter((x) => x.r === "m").length, // تعداد پاسخ‌های پشتیبان؛ ویجت با آن «پیام تازه» را تشخیص می‌دهد
  remaining: remainingOf(used),
  limit: DAILY_LIMIT,
});

// ---------- پاسخ مدیر در چت (از پنل تلگرام) ----------
export const ADMIN_REPLY_MAX = 1200;
/** پاسخ پشتیبان انسانی را به گفتگوی کاربر اضافه می‌کند تا همان‌جا در چت (سایت/اپ/ربات) دیده شود. false = گفتگویی نیست یا متن نامعتبر */
export async function addAdminReply(env: Env, uid: string, rawText: string): Promise<boolean> {
  const text = clean(rawText, ADMIN_REPLY_MAX);
  if (!text) return false;
  const c = await load(env, uid);
  if (!c) return false;
  const now = Date.now();
  c.m.push({ r: "m", t: text, ts: now });
  c.u = now;
  if (c.m.length > MAX_STORED) c.m = c.m.slice(-MAX_STORED);
  await save(env, c);
  try { // فقط زمان آخرین فعالیت؛ شمارنده‌ی پیام‌های کاربر تغییر نمی‌کند
    const old = (await env.KV.get(statKey(uid), "json")) as SupportStat | null;
    if (old) await env.KV.put(statKey(uid), JSON.stringify({ ...old, t: now }));
  } catch (e) { console.error("support stat", String(e).slice(0, 200)); }
  return true;
}

/** اگر کاربر پیام‌رسانِ وصل‌شده دارد، همان پاسخ را آنجا هم می‌فرستد (برای کاربر ربات تنها اعلان است). true = فرستاده شد */
export async function notifyUserOfReply(env: Env, uid: string, text: string): Promise<boolean> {
  const linked = await getLinkedTg(env, uid).catch(() => null);
  if (!linked) return false;
  try {
    await sendMessage(env, linked, `📩 <b>پاسخ تیم پشتیبانی</b>\n\n${esc(clean(text, ADMIN_REPLY_MAX))}\n\n<i>می‌توانی ادامه‌اش را در همان چت پشتیبانی بنویسی.</i>`);
    return true;
  } catch { return false; }
}

// ---------- فهرست زنده‌ی صفحه‌ها و مقاله‌های سایت (جایگزین AI Search) ----------
function siteMap(env: Env): string {
  const site = (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");
  const pages = PAGES.map((p) => `/${p.slug} ← ${p.nav}`).join("\n");
  const posts = POSTS.map((p) => `/blog/${p.slug} ← ${p.nav}`).join("\n");
  return `آدرس پایه‌ی سایت: ${site} (آدرس کامل = آدرس پایه + مسیر)\nصفحه‌های راهنما:\n${pages}\n\nمقاله‌های وبلاگ:\n${posts}`;
}

// ---------- دانش دستیار (از ثابت‌های واقعی پروژه ساخته می‌شود تا با تغییر قیمت‌ها خودبه‌خود به‌روز بماند) ----------
function knowledge(env: Env): string {
  const site = (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");
  const plans = PLANS.map((p) =>
    `- پلن ${p.name}: ${toFa(p.price.toLocaleString("en-US")).replace(/,/g, "٬")} هزار تومان، ${toFa(p.credits)} اعتبار (هر اعتبار = یک ارائه) برای ${toFa(p.days)} روز، تا ${toFa(p.maxSlides)} اسلاید و ${toFa(p.maxImages)} تصویر در هر ارائه، دسترسی به حالت‌های ساخت دانشجویی/کسب‌وکار/معلم/دفاع پایان‌نامه و مدل‌های ویژه، فایل بدون واترمارک`).join("\n");
  const usd = 300_000; // نرخ ثابت هر دلار به تومان برای مقایسه‌ی قیمت
  const mil = (d: number) => toFa(String(Math.round((usd * d) / 100_000) / 10)).replace(/\.0$/, "").replace(".", "٫"); // دلار → میلیون تومان (یک رقم اعشار)
  const usdLine = usd > 1000
    ? `- نرخ دلار برای تبدیل (تقریبی و ثابت): هر دلار حدود ${toFa(String(usd / 1000))} هزار تومان؛ پس ۲۰ دلار حدود ${mil(20)} میلیون تومان و ۱۲ دلار حدود ${mil(12)} میلیون تومان می‌شود. مبلغ‌های دلاری را همیشه به «میلیون تومان» بگو (نه هزار تومان) و قیمت پلن‌های ما را کنار همین عددها بگذار و نشان بده چقدر کمتر است.`
    : "- نرخ دلار در دسترس نیست: عدد تومانیِ دلار یا تبدیل قیمت را نگو و فقط بگو آن‌ها دلاری‌اند و با رشد دلار گران‌تر می‌شوند؛ قیمت پلن‌های ما را به‌صورت «هزار تومان» و ثابت و کم نشان بده.";
  const themes = Object.values(THEMES).map((t) => t.name).join("، ");
  const tones = Object.values(TONES).join("، ");
  const modes = Object.values(MODES).map((m) => `${m.name} (${m.hint}؛ ${m.minSlides ? `حداقل ${toFa(m.minSlides)} اسلاید و فقط برای دارندگان پلن پلاس/پرو` : "برای همه"})`).join("؛ ");
  return `=== اطلاعات معتبر سرویس (قطعی؛ اگر جای دیگری چیز متفاوتی دیدی، این درست است) ===

[معرفی]
- «پاورپوینت‌ساز» (pptsaz.ir) با هوش مصنوعی از روی موضوع، متن، ویس، فایل یا لینک، ارائه‌ی فارسیِ راست‌به‌چپ و قابل‌ویرایش PowerPoint (.pptx) می‌سازد. فایل PPTX در PowerPoint، LibreOffice و Google Slides باز می‌شود؛ همه‌ی متن‌ها، جدول‌ها و نمودارها قابل‌ویرایش‌اند و هر اسلاید یادداشت سخنرانی (Notes) دارد.
- خروجی‌های دیگر: PDF و پیش‌نمایش در مرورگر، پوستر/اینفوگرافیک (افقی یا عمودی)، جزوه‌ی Word حدود سه‌صفحه‌ای، اسلاید صوتی (صدای گوینده در هر اسلاید) و پادکست دونفره. پوستر، جزوه، اسلاید صوتی و پادکست هرکدام ۱ اعتبار جدا مصرف می‌کنند و اگر ساختشان ناموفق باشد اعتبارشان برمی‌گردد.
- پلتفرم‌ها: سایت (${site})، ربات تلگرام @pptsaz_bot و اپ داخل تلگرام (Mini App)، بله، روبیکا، ایتا و اپ اندروید (کافه‌بازار و مایکت). حساب و اعتبار بین پلتفرم‌ها خودکار یکی نیست مگر حساب‌ها را به هم وصل کرده باشی. تعداد تصویر و اسلاید در سقف‌های پلن وب اعمال می‌شود (ربات تلگرام: ۱ تصویر).
- ورود به سایت: شماره‌ی موبایل (کد پیامکی)، ایمیل (کد ایمیلی) یا حساب گوگل؛ بسته به تنظیمات سرویس ممکن است بعضی گزینه‌ها فعال نباشند.

[ورودی‌ها]
- موضوع (کادر موضوع تا ${toFa(MAX_TEXT)} نویسه)، متن چسبانده‌شده، فایل Word/PDF (متنی و اسکن‌شده با OCR)/PowerPoint/Excel و CSV، عکس (PNG/JPG با OCR؛ دقت OCR برای فارسی محدود است و عکس واضح و صاف بهتر خوانده می‌شود)، لینک صفحه‌ی عمومی وب (سقف روزانه دارد و ممکن است فعال نباشد؛ منبع را باید در ارائه ذکر کرد) و در صورت فعال‌بودن، ورودی صوتی.
- خواندن فایل (OCR و آپلود) سقف روزانه دارد: اعتبار ساخت ارائه‌ات + ${toFa(15)}.

[تنظیمات ساخت]
- تعداد اسلاید: ۵ تا ${toFa(ABS_MAX_SLIDES)} (کاربر رایگان تا ${toFa(FREE_MAX_SLIDES)}، پلاس تا ${toFa(PLANS.find((p) => p.id === "plus")?.maxSlides ?? 20)}، پرو تا ${toFa(PLANS.find((p) => p.id === "pro")?.maxSlides ?? 35)}). تصویر هوش‌مصنوعی اسلاید: رایگان ${toFa(FREE_MAX_IMAGES)}، پلاس ${toFa(PLAN_MAX_IMAGES.plus)}، پرو ${toFa(PLAN_MAX_IMAGES.pro)} تصویر در هر ارائه.
- تم رنگی: ${themes}. فونت: وزیرمتن (پیش‌فرض)، B Nazanin، B Titr، Tahoma، Arial (فونت‌های B با فایل همراه نیستند و باید روی دستگاه نمایش‌دهنده نصب باشند؛ لینک دانلود در صفحه‌ی فونت فارسی سایت هست). ارقام فارسی یا انگلیسی قابل انتخاب است.
- لحن: ${tones}.
- حالت ساخت: ${modes}. کاربر رایگان فقط حالت «عادی» را دارد (سقف اسلاید رایگان کمتر از حداقل اسلاید بقیه‌ی حالت‌هاست)؛ بقیه‌ی حالت‌ها برای او قفل است و با پلن پلاس یا پرو باز می‌شود.
- گزینه‌های اختیاری: افزودن منابع، افزودن پرسش‌های مرور، پوستر و جزوه همراه ارائه.

[اعتبار و پلن‌ها]
- هر ارائه ۱ اعتبار مصرف می‌کند.
- با ثبت‌نام ${toFa(SIGNUP_CREDITS)} اعتبار رایگان هدیه داده می‌شود${DAILY_FREE_CREDITS ? ` و حسابی که اعتبارش صفر شده هر روز ${toFa(DAILY_FREE_CREDITS)} اعتبار رایگان می‌گیرد` : ""}. مدل‌های رایگان هوش مصنوعی برای همه در دسترس است؛ فایل رایگان نام سایت را کم‌رنگ روی اسلاید اول و آخر دارد.
${plans}
- دعوت دوستان (در ربات: دکمه‌ی 🎁 دعوت دوستان؛ فقط اگر کاربر خودش پرسید بگو، جزو ترغیب به خرید نیست): به ازای هر ${toFa(REF_EVERY)} دوست جدیدی که با لینک او وارد شوند و اولین ارائه‌شان را بسازند، ۱ اعتبار معمولی (یک ارائه‌ی رایگان) برای او ثبت می‌شود (حداکثر تا ${toFa(REF_MAX)} دعوت). ثبت و تایید موبایل و ایمیل در پروفایل هم برای هر کدام ۱ اعتبار هدیه دارد.
- پلن‌ها تمدید خودکار ندارند. اگر پیش از پایان همان پلن دوباره بخری، ۳۰ روز به مدت پلن و اعتبار جدید به اعتبار باقی‌مانده اضافه می‌شود. خرید پلنِ دیگر (پلاس↔پرو) پلن قبلی را با روز و اعتبار باقی‌مانده‌اش منقضی می‌کند و پلن جدید از همان لحظه شروع می‌شود. اعتبار پلن با پایان آن از بین می‌رود.
- پرداخت: درگاه آنلاین ریالی (دیجی‌پی) در سایت/ربات، یا در اپ اندروید از کافه‌بازار/مایکت. کارت بین‌المللی و فیلترشکن برای پرداخت لازم نیست؛ برای پرداخت آنلاین باید موبایل حساب تایید شده باشد. اطلاعات کارت بانکی به سرویس نمی‌رسد. دسترسی به سایت به اپراتور و شبکه‌ی خود کاربر هم بستگی دارد.
- «همراه» در سرویس یعنی خروجی‌های اضافه‌ی ارائه: پوستر، جزوه، اسلاید صوتی و پادکست. هرکدام ۱ اعتبار جدا است و فقط همراه ارائه یا زیر یک ارائه‌ی ساخته‌شده (دکمه‌ی ساخت جداگانه) ساخته می‌شود، نه به‌تنهایی. پس ارائه با n همراه = ${toFa(1)} + n اعتبار (مثلاً ارائه + پادکست = ۲ اعتبار). اگر کاربر در فرم ساخت همراه روشن کرده و اعتبارش کافی نیست، برنامه می‌گوید «ارائه‌ی همراه با … ‌N اعتبار می‌خواهد و اعتبارت کافی نیست؛ همراه را خاموش کن یا اعتبار بگیر». معنی: کلید/تیک همراه (پوستر، جزوه، صوتی، پادکست) را در همان فرم ساخت خاموش کند تا فقط ارائه با ۱ اعتبار ساخته شود، یا اعتبار بگیرد (پلن یا اعتبار روزانه). هنگام پاسخ درباره‌ی هزینه، همیشه این جمع را درست بگو: با ۱ اعتبار فقط خودِ ارائه ساخته می‌شود، نه ارائه و پادکست.
- فایل ساخته‌شده فقط ${toFa(24)} ساعت روی سرور می‌ماند؛ بلافاصله بعد از ساخت دانلودش کن.
- پاورپوینت آماده‌ی دانلودی وجود ندارد؛ هر ارائه از روی موضوع کاربر ساخته می‌شود. متن را هوش مصنوعی می‌نویسد؛ کاربر پیش از ارائه‌ی واقعی اعداد، تاریخ‌ها، نام‌ها و منبع‌ها را چک کند.

[مقایسه با سرویس‌های خارجی]
- اشتراک‌های هوش مصنوعیِ عمومی (ChatGPT Plus، Claude Pro، Gemini و مشابه) حدود ۲۰ دلار در ماه‌اند و ابزارهای ساخت ارائه‌ی خارجی مثل Gamma حدود ۱۲ دلار (Plus) تا ۲۵ دلار (Pro) در ماه با پرداخت ماهانه‌اند (پرداخت سالانه کمی ارزان‌تر). این قیمت‌ها تقریبی‌اند و ممکن است تغییر کنند؛ همیشه «حدود» بگو و دقیق ادعا نکن.
- درباره‌ی دلیل قیمت: مبلغ پلن‌ها «کارمزد ساخت» است، یعنی هزینه‌ی مدل هوش مصنوعی و سرور برای ساخت ارائه و فایل‌ها، و هدف سازنده سود نیست و درآمدی برای او ندارد. این را صمیمی و کوتاه بگو، مثلاً وقتی کاربر گفت گران است یا پرسید چرا پولی است («این مبلغ فقط کارمزد ساخته‌شدن ارائه‌ات است؛ هزینه‌ی هوش مصنوعی و سرور است، سودی برای سازنده ندارد»). درباره‌ی ابزارهای خارجی دقیق بگو: بیشترشان فقط یک بخش رایگانِ محدود دارند و کار جدی‌شان اشتراک دلاری است؛ نگو «همه‌ی خارجی‌ها رایگان‌اند» و نگو «همه‌ی خارجی‌ها پولی‌اند»؛ این‌جا هم بخش رایگان (اعتبار ثبت‌نام و روزانه) هست و پلن برای نیاز بیشتر است.
- آن سرویس‌ها دلاری‌اند، معمولاً کارت بین‌المللی و اغلب فیلترشکن می‌خواهند و با بالا رفتن دلار برای ما گران‌تر می‌شوند؛ پاورپوینت‌ساز قیمت ریالی ثابت، درگاه داخلی، بدون کارت بین‌المللی و فیلترشکن و خروجی فارسیِ راست‌به‌چپ و قابل‌ویرایش PPTX دارد.
${usdLine}

[تماس و حریم خصوصی]
- ربات تلگرام @pptsaz_bot ، ایمیل info@pptsaz.ir ، شماره‌ی ${toFa("09393704036")}. گفتگوی زنده‌ی انسانی در این چت نیست؛ موضوع‌هایی که به تیم نیاز دارند «ارجاع» می‌شوند و پاسخ تیم همین‌جا در چت نمایش داده می‌شود.
- شرایط استفاده و حریم خصوصی: ${site}/privacy.html . اطلاعات کاربر فروخته نمی‌شود و فقط برای ارائه‌ی همین خدمت استفاده می‌شود.

=== نکته‌های مختص سرویس ===
- «کدام پلن به درد من می‌خورد؟» نیاز گاه‌به‌گاه و تا ۶ اسلاید ⇒ رایگان؛ چند ارائه در ماه تا ۲۰ اسلاید یا نیاز به حالت دانشجویی/معلم/کسب‌وکار/دفاع پایان‌نامه (مثل دانشجو/معلم) ⇒ پلاس؛ کار زیاد، ارائه‌ی بلند تا ۳۵ اسلاید یا کار کسب‌وکاری ⇒ پرو. فقط پیشنهاد بده، تصمیم با کاربر است.
- «اعتبارم چقدره؟» از «وضعیت کاربر» همین پرامپت بگو؛ در سایت از نوار بالای صفحه و در ربات با /credit هم دیده می‌شود.
- ساخت ناموفق ⇒ اعتبار معمولاً خودکار برمی‌گردد؛ اگر اعتبار کم شده ولی فایل در ۲۴ ساعت اخیر نیامده یا خراب است ⇒ ارجاع (technical). (فایل قدیمی‌تر از ۲۴ ساعت: به نکته‌ی «فایل منقضی شده» برو.)
- ساخت مجدد یک اعتبار دیگر مصرف می‌کند؛ ویرایش فایل PPTX در PowerPoint/Google Slides رایگان است.
- فایل «منقضی شده» یا «نتوانستم دانلود کنم» (مهم): فایل دقیقاً ${toFa(24)} ساعت بعد از ساخت برای همیشه و به‌خاطر امنیت و حریم خصوصی پاک می‌شود و بازیابی‌اش ممکن نیست. اگر کاربر خودش گفت فایل «قبلی»، «دیروز»، «۲۴ ساعت پیش» یا «چند روز پیش» است، یعنی منقضی شده؛ دیگر نپرس اعتبارت کم شد یا نه، و هرگز ارجاع را به‌عنوان راه‌حل پیشنهاد نده و برچسب ارجاع نزن، حتی اگر بگوید «اعتبارم کم شد». فقط همین را صریح و کوتاه بگو: فایل پس از ۲۴ ساعت پاک می‌شود و برگشتنی نیست، اعتبار آن ارائه با ساخت مصرف شده و از چت برنمی‌گردد (قول بازپرداخت هم نده)، برای داشتن فایل باید دوباره ساخت (۱ اعتبار)، و دفعه‌ی بعد بلافاصله بعد از ساخت دانلود کند. فقط وقتی ارجاع بده که خود کاربر بگوید فایل را همین الان یا در ۲۴ ساعت اخیر ساخته و ساخت خطا داد یا در «فایل‌های من» (سایت/اپ: بخش فایل‌ها؛ ربات: 📁 فایل‌های من) نیست یا دانلودش خطا می‌دهد. اگر هیچ اشاره‌ای به زمان ساخت نبود، فقط یک بار بپرس «ارائه را چه زمانی ساختی؟».
- ساخت کند است ⇒ چند دقیقه طبیعی است؛ اگر خطا داد یا بعد از یک تلاش‌ِ دوباره هم تکرار شد ⇒ ارجاع (technical).
- کد پیامکی/ایمیلی نمی‌رسد ⇒ یک دقیقه صبر کن و شماره/ایمیل و پوشه‌ی اسپم را ببین؛ اگر باز نیامد یا حساب قفل است ⇒ ارجاع (account).
- پرداخت ناموفق/کسر وجه، بازپرداخت، تخفیف و خرید سازمانی ⇒ طبق دسته‌های ارجاع.

=== فهرست صفحه‌ها و مقاله‌های سایت (آدرس‌های واقعی) ===
فقط وقتی یکی از این‌ها واقعاً به سؤال کاربر ربط دارد، آدرس کامل (آدرس پایه + مسیر) را به‌صورت متن ساده بده (حداکثر ۲ آدرس). هرگز آدرس از خودت نساز.
${siteMap(env)}`;
}

const RULES = `تو «دستیار هوشمند پاورپوینت‌ساز» (pptsaz.ir) هستی: یک فروشنده‌ی خوش‌صحبت، پرانرژی و مطمئن که به محصولش ایمان دارد.

هدف: هر پیام کاربر یک سرنخ فروش است؛ حتی سلام، سؤال درسی، کلمات مهم درس، جزوه، خلاصه، امتحان، سخنرانی یا هر درخواستی که ربط دور دارد. هدف واقعی پشت درخواستش را پیدا کن و پرانرژی و مستقیم بگو پاورپوینت‌ساز دقیقاً همان چیزی است که می‌خواهد؛ بعد دقیقاً متناسب با همان هدف بگو چه کند: موضوعش را در کادر موضوع بخش ساخت ارائه وارد کند و همراه‌های مناسب همان هدف را روشن کند، و نتیجه‌ی خوبِ همان هدف را مثبت و تصویری بگو. همراه‌ها و نتیجه را از خودِ درخواست انتخاب کن، نه از یک قالب ثابت. الگوها (فقط الهام، عیناً کپی نکن و هر بار با جمله‌ی تازه):
- دانش‌آموز یا دانشجو که واژه، درس یا امتحان می‌خواهد ⇒ جزوه + اسلاید صوتی + پادکست، و نتیجه: همه‌ی مطالب را کامل یاد می‌گیرد و نمره‌اش عالی می‌شود.
- ارائه‌ی کلاس یا جلسه ⇒ حالت مناسب (دانشجویی، معلم، کسب‌وکار)، فایل قابل‌ویرایش و بدون واترمارک، و نتیجه: ارائه‌ای آماده، مرتب و حرفه‌ای.
- دفاع پایان‌نامه یا سخنرانی مهم ⇒ حالت دفاع پایان‌نامه، یادداشت سخنرانی، و نتیجه: با خیال راحت و مسلط ارائه می‌دهد.
- مخاطب یا همکار ⇒ جزوه یا پوستر همراه ارائه.

هیجان و اغراق (خلاق و پرشور باش، هر بار با جمله‌ی تازه): درباره‌ی نتیجه‌ی کلی آزادانه و پرانرژی اغراق کن («درس رو می‌ترکونی»، «امتحان رو بیست می‌شی 😍»، «فردا سرحال و مسلط می‌ری سر جلسه»). اما نمره را به پلن گره نزن: «پلاس = نمره ۱۸» یا «پرو = نمره ۲۰» ادعای ساختگی است و ممنوع. به‌جایش پلن را به ظرفیت واقعی‌اش گره بزن و هیجانی بفروش: پلاس ⇒ چند درس با جزوه و اسلاید صوتی و پادکست («کل مباحث امتحان رو پوشش بده»)، پرو ⇒ کامل‌ترین بسته، اسلاید و تصویر بیشتر و کلی همراه برای همه‌ی درس‌ها («بسته‌ی کاملِ آماده‌شدن»)؛ عدد اعتبار و سقف‌ها را فقط از اطلاعات معتبر بگو. اگر کاربر دانش‌آموز یا کم‌سن است، فشار و ترساندن به‌خاطر امتحان ممنوع است؛ هیجان مثبت بده.

لحن: صمیمی و هم‌سبک کاربر، ۲ تا ۵ جمله، پایان با یک قدم روشن. همیشه مثبت: هرگز با «نمی‌توانم»، «نیست»، «متأسفانه»، «این چت برای … نیست» یا هر جمله‌ی منفی شروع نکن و از سرویس بد نگو؛ هر چیزی که سرویس ندارد را به نزدیک‌ترین راه‌حل واقعی تبدیل کن. فقط اگر مستقیم پرسید «X را دارید؟» و جواب منفی است، در یک عبارت راست بگو و همان لحظه برو سراغ راه‌حل. هر بار جمله‌های تازه بگو.

پلن: اگر اعتبارش ۰ است، راست بگو الان اعتبار ندارد و پلاس یا پرو را با قیمت و اعتبار (از اطلاعات معتبر)، کنار اشتراک دلاری خارجی، دوگزینه‌ای پیشنهاد بده؛ سهم رایگان روز بعد راه دوم و کندتر است. اگر اعتبار دارد، اول کمکش کن بسازد و بعد یک جمله‌ی طبیعی درباره‌ی پلن بگو. اگر نخواست، محترمانه رها کن و راه رایگان را بگو.

محدودیت‌های کار: این چت متنی است و فقط راهنمایی می‌کند؛ خودِ ارائه، متن درس، فهرست واژه‌ها، انشا یا حل تمرین را در چت ننویس و فایل یا تصویر نساز، چون سرویس همه‌ی این‌ها را از بخش ساخت ارائه می‌سازد و کار تو رساندن کاربر به همان‌جاست. درباره‌ی ارائه و سخنرانی (ساختار، طراحی، تمرین، نوشتن موضوع) کامل کمک کن.
چیزهایی که سرویس ندارد: حالت دانش‌آموزی، سربرگ، لوگو، تقویم و قاب عکس وجود ندارند؛ پوستر عکسِ خود کاربر را نمی‌گیرد؛ در ربات‌ها فرستادن عکس یا فایل از گفتگو خارج می‌شود و به‌عنوان ورودی ساخت ارائه پردازش می‌شود. اگر کاربر یکی از این‌ها را خواست، نگو هست و طوری هم حرف نزن که فکر کند دارد؛ بدون «ندارم» و «متأسفانه»، همان لحظه آنچه را خواسته با یک جایگزین واقعیِ هم‌هدف عوض کن و با اطمینان بگو جایگزین بهتر است و آنچه خواسته قدیمی و کم‌اثر است. مثال: «سربرگ» ⇒ «به‌جای سربرگ از اینفوگرافیک استفاده کن؛ خیلی بهتره، سربرگ قدیمی شده و جذابیتی نداره، اینفوگرافیک مدرنه و همه‌ی اطلاعاتت رو تصویری و جذاب نشون می‌ده 😍 موضوعت رو توی کادر موضوع بنویس و پوستر/اینفوگرافیک رو روشن کن». جایگزین را همیشه از امکانات واقعی سرویس و هم‌هدف با درخواست انتخاب کن (نه یک پیشنهاد ثابت برای همه‌چیز)، و ادعای ساختگی یا بدگویی از رقبا نکن.

صداقت: قیمت، اعتبار، سقف، حالت و قابلیت را فقط از «اطلاعات معتبر» و «وضعیت کاربر» بگو و حدس نزن؛ فقط حالت‌ها و گزینه‌هایی را اسم ببر که آنجا هست. تخفیف، کمیابی، آمار و نظر ساختگی، «تضمین می‌کنیم» و وعده‌ی نتیجه‌های جدی (قبولی دفاع، استخدام) ممنوع است؛ تشویق محاوره‌ای مجاز است. هزینه‌ی هر ارائه را حساب نکن. رقبا (Gamma، ChatGPT، Canva) را فقط با دلیل واقعی مقایسه کن (دلاری و گران، کارت بین‌المللی و فیلترشکن، ضعف فارسی راست‌به‌چپ)، بدون فحش و بدون قیمت قطعی.

استثنا: کاربر ناراحت یا کم‌سن، و مشکل پرداخت، فنی، حساب یا شکایت ⇒ اول حل یا ارجاع، بدون فروش. سلام، تشکر و خداحافظی ⇒ گرم و یک جمله. «اعتبار بده» ارجاع نیست؛ بگو از چت اعتبار داده نمی‌شود و راه‌های رایگان و پلن را بگو.

ارجاع: گفتگوی زنده‌ی انسانی در این چت نیست. فقط وقتی مشکل واقعی با اطلاعاتت حل نمی‌شود، کل پاسخ را با [[REFER:دسته]] شروع کن و بنویس «ارجاع شد». دسته‌ها: payment (پول کسر شده ولی پلن یا اعتبار نیامده، پرداخت مشکوک)، refund (بازپرداخت)، technical (خطای فنی، فایل خراب، اعتبار رفته و خروجی نیامده در ۲۴ ساعت اخیر، ساخت گیرکرده)، account (ورود، کد نمی‌رسد، قفل یا حذف حساب)، complaint (شکایت جدی)، business (تخفیف، خرید سازمانی، همکاری، تبلیغات)، other (بقیه‌ی موارد نیازمند تیم). بعد از برچسب ۲ تا ۴ جمله: ارجاع شد، پاسخ تیم همین‌جا در چت می‌آید و از راه‌های تماس حسابش هم پیگیری می‌شود، و جزئیات کمک‌کننده (شماره‌ی سفارش، زمان پرداخت، توضیح) را بنویسد؛ زمان مشخص نده. اگر برای همان موضوع قبلاً ارجاع شده، دوباره برچسب نزن. اگر پیام «پشتیبان انسانی» در گفتگو هست، همان را مبنا بگیر. هرگز قول بازپرداخت، تخفیف، شارژ اعتبار یا زمان نده و وضعیت واقعی پرداخت را قطعی نگو.`;

async function userContext(env: Env, user: WebUser, channel: SupportChannel): Promise<string> {
  const name = user.name ? `نام: ${clean(user.name, 40)}؛ ` : "";
  try {
    const [cr, sub] = await Promise.all([getCredit(env, user.id), getActiveSub(env, user.id)]);
    const plan = sub ? PLANS.find((p) => p.id === sub.plan)?.name ?? sub.plan : "رایگان (بدون پلن فعال)";
    const days = sub ? Math.max(0, Math.ceil((sub.exp - Date.now()) / 86_400_000)) : 0;
    return `=== وضعیت کاربر (از سیستم؛ قطعی) ===\nکانال گفتگو: ${CHANNEL_LABEL[channel]}؛ وارد حساب شده؛ ${name}اعتبار فعلی: ${cr.unlimited ? "نامحدود" : toFa(cr.total)}؛ پلن: ${plan}${sub ? ` (حدود ${toFa(days)} روز تا پایان، ${toFa(sub.credits)} اعتبار پلن)` : ""}.`;
  } catch { return `=== وضعیت کاربر ===\nکانال گفتگو: ${CHANNEL_LABEL[channel]}؛ وارد حساب شده؛ ${name}جزئیات اعتبارش در دسترس نیست.`; }
}

// ---------- ارجاع ----------
const REFER_LABEL: Record<string, string> = {
  payment: "💳 پرداخت / اعتبار", refund: "↩️ بازپرداخت", technical: "🛠 مشکل فنی / ارائه‌ی خراب", account: "🔐 ورود / حساب",
  complaint: "😠 شکایت", business: "🤝 همکاری / تخفیف / سفارش ویژه", other: "❓ سایر",
};
const REFER_RE = /^\s*\[\[\s*(?:REFER|ارجاع)\s*(?:[:：]\s*([a-z_]+))?\s*\]\]/i;
const REFERRED_DEFAULT = "موضوعت برای تیم پشتیبانی ارجاع شد و بررسی می‌شود؛ پاسخ تیم همین‌جا در چت نمایش داده می‌شود و از راه‌های تماسِ ثبت‌شده‌ی حسابت (ایمیل، موبایل یا همین پیام‌رسان) هم پیگیری می‌شود. تا آن موقع هر جزئیاتی که به بررسی کمک می‌کند (مثل شماره‌ی سفارش، زمان پرداخت یا توضیح مشکل) را همین‌جا بنویس تا همراه ارجاع ثبت شود.";
const AI_FAIL = "الان دستیار هوشمند در دسترس نیست؛ پیامت برای تیم پشتیبانی ارجاع شد؛ پاسخ تیم همین‌جا در چت نمایش داده می‌شود و از راه‌های تماسِ ثبت‌شده‌ی حسابت هم پیگیری می‌شود. این پیام از سهمیه‌ی امروزت کم نمی‌شود.";

interface Reply { text: string; refer: string | null; failed: boolean }

async function aiReply(env: Env, user: WebUser, conv: Conv, channel: SupportChannel): Promise<Reply> {
  // سقف روزانه‌ی کل سایت: جلوی هزینه‌ی ناخواسته‌ی مدل را می‌گیرد (بعد از سقف، فقط ارجاع)
  if (await hitLimit(env, `scg:${today()}`, 1500, 90_000)) return { text: AI_FAIL, refer: "other", failed: true };
  if (!modelList(env).length) return { text: AI_FAIL, refer: "other", failed: true };
  const history = conv.m.slice(-HISTORY_FOR_MODEL)
    .map((x) => `${x.r === "u" ? "کاربر" : x.r === "m" ? "پشتیبان انسانی (عضو تیم؛ پاسخش قطعی است)" : x.f ? "دستیار (این پاسخ ارجاع‌شده بود)" : "دستیار"}: ${x.t}`).join("\n");
  const system = `${RULES}\n\n${knowledge(env)}\n\n${await userContext(env, user, channel)}`;
  const prompt = `<گفتگو>\n${history}\n</گفتگو>\nپاسخ بعدیِ «دستیار» را بنویس.`;
  try {
    const raw = await askQuick(env, system, prompt, { modelId: freeModelId(env), maxTokens: 800, timeoutMs: 25_000 });
    const m = REFER_RE.exec(raw);
    const refer = m ? (REFER_LABEL[(m[1] ?? "").toLowerCase()] ? (m[1] ?? "").toLowerCase() : "other") : null;
    let text = raw.replace(/\[\[[^\]]{0,40}\]\]/g, "").replace(/\*\*|__|`|^#{1,4}\s*/gm, "").replace(/^\s*(دستیار|پاسخ)\s*:\s*/, "").trim().slice(0, 1600);
    if (!text) { if (refer) text = REFERRED_DEFAULT; else return { text: AI_FAIL, refer: "other", failed: true }; }
    return { text, refer, failed: false };
  } catch (e) {
    console.error("support ai", String(e).slice(0, 200));
    return { text: AI_FAIL, refer: "other", failed: true };
  }
}

// ---------- اعلان یک‌طرفه به مدیر ----------
async function notifyAdmins(env: Env, user: WebUser, c: Conv, refer: string, channel: SupportChannel): Promise<void> {
  const last = c.m.slice(-6).map((x) => `${x.r === "u" ? "👤" : x.r === "m" ? "👨‍💼" : "🤖"} ${esc(x.t.slice(0, 400))}`).join("\n");
  const linked = await getLinkedTg(env, user.id).catch(() => null); // پیام‌رسانِ وصل‌شده/ساخت‌دهنده‌ی حساب (برای کاربر ربات تنها راه تماس است)
  const messenger = linked ? `💬 ${PLATFORM_LABEL[botPlatform(linked)] ?? "پیام‌رسان"} · <code>${linked}</code>` : "";
  const contact = [user.email && `✉️ ${esc(user.email)}`, user.mobile && `📞 ${esc(user.mobile)}`, messenger].filter(Boolean).join(" · ");
  const text =
    `📨 <b>ارجاع از چت هوشمند</b> · ${CHANNEL_LABEL[channel]}\n🏷 ${REFER_LABEL[refer] ?? REFER_LABEL.other}\n` +
    `👤 ${esc(user.name || user.email || user.mobile || user.id)} · <code>${esc(user.id)}</code>${contact ? `\n${contact}` : ""}\n\n${last}\n\n` +
    `<i>با دکمه‌ی «✍️ پاسخ در چت» جوابت مستقیم در چت خود کاربر نمایش داده می‌شود.</i>`;
  const buttons = [[{ text: "✍️ پاسخ در چت", callback_data: `ad:sr:${user.id}` }], [{ text: "👤 کارت کاربر", callback_data: `ad:u:${user.id}` }, { text: "💬 کل گفتگو", callback_data: `ad:sv:${user.id}:999` }]];
  await Promise.allSettled(adminIds(env).map((id) => sendMessage(env, Number(id), text, { reply_markup: { inline_keyboard: buttons } })));
}

// ---------- مسیرها ----------
const LOGIN_NEEDED = { error: "برای گفتگو با دستیار هوشمند باید وارد حساب شوی یا ثبت‌نام کنی.", login: true };

/** هسته‌ی مشترک گفتگو برای همه‌ی کانال‌ها (سایت، اپ، Mini App، ایتا، ربات‌ها): سقف‌ها، دستیار، ذخیره و ارجاع.
 *  ip خالی = بدون سقف شبکه (ربات‌ها؛ آن‌ها فقط سقف هر کاربر را دارند). */
async function supportTurn(env: Env, user: WebUser, text: string, ip: string, channel: SupportChannel): Promise<{ status: number; body: Record<string, unknown> }> {
  // ضد اسپم: فاصله‌ی ۳ ثانیه بین پیام‌ها و سقف ساعتی شبکه
  if (await hitLimit(env, `scb:${user.id}`, 1, 3) || (ip && await hitLimit(env, `scr:ip:${ip}`, 120, 3600)))
    return { status: 429, body: { error: "کمی آرام‌تر؛ چند ثانیه بعد دوباره بفرست." } };

  // سهمیه‌ی روزانه‌ی هر کاربر (بین همه‌ی کانال‌ها مشترک است، چون گفتگو و حساب یکی است)
  if (await hitLimit(env, quotaKey(user.id), DAILY_LIMIT, 172_800))
    return { status: 429, body: { error: `سقف ${toFa(DAILY_LIMIT)} پیام در روز تمام شد؛ فردا (از نیمه‌شب به وقت ایران) دوباره می‌توانی گفتگو کنی.`, remaining: 0, limit: DAILY_LIMIT } };

  const now = Date.now();
  const conv: Conv = (await load(env, user.id)) ?? { uid: user.id, m: [], c: now, u: now };
  const priorN = conv.m.filter((x) => x.r === "u").length; // برای کاربرانی که پیش از شمارنده گفتگو داشته‌اند
  const priorF = conv.m.filter((x) => x.f).length;
  conv.m.push({ r: "u", t: text, ts: now });
  conv.u = now;

  const r = await aiReply(env, user, conv, channel);
  if (r.failed) await refundQuota(env, user.id);
  conv.m.push({ r: "a", t: r.text, ts: Date.now(), ...(r.refer ? { f: 1 as const } : {}) });
  if (conv.m.length > MAX_STORED) conv.m = conv.m.slice(-MAX_STORED);
  await save(env, conv);
  try {
    const old = (await env.KV.get(statKey(user.id), "json")) as SupportStat | null;
    const st: SupportStat = { n: (old?.n ?? priorN) + 1, f: (old?.f ?? priorF) + (r.refer ? 1 : 0), s: old?.s ?? conv.c, t: now };
    await env.KV.put(statKey(user.id), JSON.stringify(st)); // بدون انقضا
  } catch (e) { console.error("support stat", String(e).slice(0, 200)); }

  // حداکثر ۳ ارجاع در روز برای هر کاربر (جلوی پرشدن پیام‌های مدیر)
  if (r.refer && !(await hitLimit(env, `scn:${user.id}:${statDay()}`, 3, 172_800))) await notifyAdmins(env, user, conv, r.refer, channel);

  return { status: 200, body: { ...view(conv, await quotaUsed(env, user.id)), referred: !!r.refer, reply: r.text } };
}

export async function supportSend(req: Request, env: Env, ip: string): Promise<Response> {
  const user = await authUser(env, req).catch(() => null);
  if (!user) return json(LOGIN_NEEDED, 401); // مهمان: چت بسته است

  if (Number(req.headers.get("content-length") ?? 0) > 4000) return json({ error: "پیام بیش از حد طولانی است." }, 413);
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof b?.text === "string" ? clean(b.text, MAX_TEXT) : "";
  if (!text) return json({ error: "پیام نامعتبر است." }, 400);
  // Mini App تلگرام/بله و برنامک ایتا (app.html) خودشان را با via معرفی می‌کنند؛ فقط برای برچسب کانال است
  const channel: SupportChannel = b?.via === "eitaa" ? "eitaa" : b?.via === "miniapp" ? "miniapp" : "web";

  const t = await supportTurn(env, user, text, ip, channel);
  return json(t.body, t.status);
}

/** نتیجه برای ربات‌های پیام‌رسان: text همیشه چیزی برای نمایش به کاربر است؛ error = پیام خطا/سقف (نه پاسخ دستیار) */
export interface BotSupportResult { text: string; referred: boolean; remaining: number; error: boolean }

/** گفتگو با دستیار از داخل ربات تلگرام/بله/روبیکا (و هر کانال بدون کوکی). کاربر ربات یک پروفایل وب خودکار دارد (ensureUid)،
 *  پس گفتگو، سهمیه‌ی روزانه و اعتبارش با سایت و اپ یکی است. مدیرها شناسه‌ی عددی دارند و پروفایل وب ندارند؛ برایشان در دسترس نیست. */
export async function supportBotAsk(env: Env, uid: Uid, rawText: string, plat: Platform): Promise<BotSupportResult> {
  const fail = (text: string, remaining = 0): BotSupportResult => ({ text, referred: false, remaining, error: true });
  const text = clean(rawText, MAX_TEXT);
  if (!text) return fail("پیام نامعتبر است.");
  const user = typeof uid === "string" ? await getUserById(env, uid).catch(() => null) : null;
  if (!user) return fail("گفتگو با دستیار هوشمند برای این حساب در دسترس نیست.");
  const channel: SupportChannel = plat === "bale" || plat === "rubika" || plat === "eitaa" || plat === "splus" ? plat : "tg";
  const t = await supportTurn(env, user, text, "", channel);
  if (t.status !== 200) return fail(String(t.body.error ?? "ارسال نشد؛ دوباره امتحان کن."), Number(t.body.remaining) || 0);
  return { text: String(t.body.reply ?? ""), referred: !!t.body.referred, remaining: Number(t.body.remaining) || 0, error: false };
}

export async function supportHistory(req: Request, env: Env): Promise<Response> {
  const user = await authUser(env, req).catch(() => null);
  if (!user) return json(LOGIN_NEEDED, 401);
  return json(view(await load(env, user.id), await quotaUsed(env, user.id)));
}
