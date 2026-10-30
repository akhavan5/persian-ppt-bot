/** یادآوری فعال‌سازی: کاربری که ثبت‌نام کرده ولی ظرف ۲۴ ساعت اولین ارائه‌اش را نساخته، یک‌بار یادآوری می‌گیرد
 *  و در آن اعتبار رایگان باقی‌مانده‌اش اعلام می‌شود (ایمیل برای حساب‌های دارای ایمیل + ربات تلگرام برای حساب‌های وصل‌به‌تلگرام).
 *
 *  - «ارائه نساخته» = ردیف act:<حساب> وجود ندارد (noteDeckDone در settings.ts آن را با اولین ارائه‌ی موفق می‌نویسد).
 *  - مخاطب: حساب‌هایی که بین ۲۴ تا ۷۲ ساعت از ساختشان گذشته (بازه‌ی ۷۲ساعته یعنی اگر یک اجرای cron از دست رفت، بعدی جبران می‌کند).
 *  - هر حساب فقط یک‌بار: نشانگر act24:<حساب> در KV (برای همه‌ی نتیجه‌ها ثبت می‌شود تا ردیف‌های ردشده صف را پر نکنند).
 *  - cron ساعتی (نه روزانه): هر اجرای Worker سقف ۵۰ زیردرخواست دارد؛ پس هر ساعت حداکثر MAX_PER_RUN حساب و هر بار یک پرس‌وجوی واحد
 *    (اعتبار، پلن، مسدودی و تلگرام در همان JOIN خوانده می‌شود) و یک batch برای نشانگرها.
 *  - فقط ساعت ۹ تا ۲۱ به وقت تهران ارسال می‌شود (نیمه‌شب پیام نمی‌رسد).
 *  هرگز خطا پرتاب نمی‌کند. بدون RESEND_API_KEY ایمیل بی‌اثر است. env باید با withStore ساخته شده باشد. */
import type { Env } from "./env";
import type { WebUser } from "./auth";
import { FREE_MAX_SLIDES } from "./settings";
import { sendMessage } from "./telegram";
import { BRAND, emailEnabled, sendEmail } from "./email";
import { miniappUrl } from "./deck-service";
import { firstName, render } from "./plan-notify";
import { toFa } from "./util";

/** cron ساعتی (دقیقه‌ی ۴۷ تا با cron روزانه‌ی ۰۳:۱۷ هم‌زمان نشود)؛ باید با triggers.crons در wrangler.jsonc یکی باشد */
export const ACTIVATION_CRON = "47 * * * *";

const HOUR = 3_600_000;
const MIN_AGE = 24 * HOUR;
const MAX_AGE = 72 * HOUR;
/** هر اجرا حداکثر این تعداد حساب (هر کدام تا ۲ ارسال) ← زیر سقف ۵۰ زیردرخواست */
const MAX_PER_RUN = 20;
const DONE_TTL = 10 * 86_400; // ثانیه
const RETRY_TTL = 2 * 3600;   // ثانیه؛ فقط وقتی ایمیل شکست خورد
const MAXC = "\u{10FFFF}";

/** ساعت فعلی تهران (UTC+3:30؛ ایران ساعت تابستانی ندارد) */
const tehranHour = (t: number) => new Date(t + 3.5 * HOUR).getUTCHours();
const inSendHours = (t: number) => { const h = tehranHour(t); return h >= 9 && h < 21; };

export function activationEmail(env: Env, name: string, credits: number) {
  const n = toFa(String(credits));
  return render(env, `${n} ارائه‌ی رایگان هنوز منتظر توست — ${BRAND}`, {
    head: "اولین ارائه‌ات منتظر توست 🎁",
    sub: `${firstName(name)}، ${n} اعتبار رایگان هنوز دست‌نخورده در حسابت مانده است.`,
    paras: [
      "ثبت‌نام کردی ولی هنوز ارائه‌ای نساخته‌ای. فقط یک موضوع بنویس (یا متن، فایل Word/PDF یا لینک بده)؛ ۱ تا ۲ دقیقه بعد فایل PPTX فارسی و راست‌چینت آماده است.",
      "ساخت ارائه با همین اعتبار رایگان است و نیازی به پرداخت ندارد.",
    ],
    rows: [["اعتبار رایگان باقی‌مانده", `${n} اعتبار`], ["حداکثر اسلاید رایگان", `${toFa(String(FREE_MAX_SLIDES))} اسلاید`]],
    cta: "ساخت اولین ارائه ←", color: "#2563eb",
    foot: "این یادآوری فقط یک‌بار فرستاده می‌شود. سؤالی داشتی؟ همین ایمیل را پاسخ بده.",
    preview: `${n} اعتبار رایگان در حسابت مانده؛ اولین ارائه‌ات را همین حالا بساز.`,
  });
}

export function activationTelegram(credits: number): string {
  return [
    "🎁 <b>اولین ارائه‌ات منتظر توست!</b>",
    "",
    `ثبت‌نام کردی ولی هنوز ارائه‌ای نساخته‌ای؛ <b>${toFa(String(credits))}</b> اعتبار رایگان در حسابت مانده است.`,
    "فقط موضوعت را بفرست (یا فایل Word/PDF یا لینک)؛ ۱ تا ۲ دقیقه بعد فایل PPTX فارسی‌ات آماده است.",
    "",
    "موجودی: /credit",
  ].join("\n");
}

interface Row { k: string; v: string; bonus: string | null; sub: string | null; banned: number | null; tg: string | null }

const SQL = `
SELECT u.k AS k, u.v AS v,
  (SELECT b.v FROM kv b WHERE b.k = 'bonus:' || substr(u.k, 4)) AS bonus,
  (SELECT s.v FROM kv s WHERE s.k = 'sub:' || substr(u.k, 4) AND (s.exp IS NULL OR s.exp > ?3)) AS sub,
  (SELECT 1 FROM kv n WHERE n.k = 'ban:' || substr(u.k, 4)) AS banned,
  (SELECT t.v FROM kv t WHERE t.k = 'w2tg:' || substr(u.k, 4)) AS tg
FROM kv u
WHERE u.k >= ?1 AND u.k < ?2 AND (u.exp IS NULL OR u.exp > ?3)
  AND json_extract(u.v, '$.created') >= ?4 AND json_extract(u.v, '$.created') < ?5
  AND NOT EXISTS (SELECT 1 FROM kv a WHERE a.k = 'act:' || substr(u.k, 4))
  AND NOT EXISTS (SELECT 1 FROM kv m WHERE m.k = 'act24:' || substr(u.k, 4) AND (m.exp IS NULL OR m.exp > ?3))
ORDER BY u.k LIMIT ?6`;

/** از cron ساعتی صدا زده می‌شود. */
export async function remindInactiveSignups(env: Env): Promise<{ scanned: number; sent: number }> {
  let scanned = 0, sent = 0;
  try {
    const now = Date.now();
    if (!inSendHours(now)) return { scanned, sent };
    const mailOn = emailEnabled(env), tgOn = !!env.TELEGRAM_BOT_TOKEN;
    if (!mailOn && !tgOn) return { scanned, sent };
    await env.KV.ready();
    const nowSec = Math.floor(now / 1000);
    const rows = (await env.DB.prepare(SQL)
      .bind("wu:", "wu:" + MAXC, nowSec, now - MAX_AGE, now - MIN_AGE, MAX_PER_RUN).all<Row>()).results ?? [];
    const marks: D1PreparedStatement[] = [];
    const mark = (uid: string, val: string, ttl: number) => marks.push(env.DB
      .prepare("INSERT INTO kv (k, v, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp")
      .bind(`act24:${uid}`, val, nowSec + ttl));

    for (const r of rows) {
      const uid = r.k.slice(3);
      scanned++;
      let u: WebUser, credits = 0;
      try {
        u = JSON.parse(r.v);
        credits = Math.max(0, Math.floor(Number(r.bonus) || 0));
        if (r.sub) { const s = JSON.parse(r.sub); if (Number(s.exp) > now) credits += Math.max(0, Math.floor(Number(s.credits) || 0)); }
      } catch { mark(uid, "0", DONE_TTL); continue; }
      const tgN = Number(r.tg);
      const tgId = Number.isSafeInteger(tgN) && tgN > 0 ? tgN : null;
      const to = mailOn && u.email ? u.email : "";
      // مسدود، بدون اعتبار یا بدون هیچ کانالی: ردش می‌کنیم و نشانگر می‌گذاریم تا صف را پر نکند
      if (r.banned || credits <= 0 || (!to && !(tgOn && tgId))) { mark(uid, "0", DONE_TTL); continue; }

      const [mailOk, tgOk] = await Promise.all([
        to ? sendEmail(env, { to, ...activationEmail(env, u.name, credits), tag: "activation-24h", idempotencyKey: `activation-${uid}` }) : Promise.resolve(false),
        tgOn && tgId
          ? sendMessage(env, tgId, activationTelegram(credits), { reply_markup: { inline_keyboard: [[{ text: "🚀 ساخت ارائه", web_app: { url: `${miniappUrl(env)}/app` } }]] } })
              .then(() => true).catch((e) => { console.error("activation telegram", String(e).slice(0, 200)); return false; })
          : Promise.resolve(false),
      ]);
      if (mailOk || tgOk) { sent++; mark(uid, "1", DONE_TTL); }
      else if (to) mark(uid, "r", RETRY_TTL);   // ایمیل شکست خورد (قطعی موقت Resend): دو ساعت بعد دوباره
      else mark(uid, "0", DONE_TTL);            // فقط تلگرام بود و نرسید (معمولاً ربات را بلاک کرده): تلاش مجدد ندارد
    }
    if (marks.length) await env.DB.batch(marks);
  } catch (e) {
    console.error("remindInactiveSignups", String(e).slice(0, 300));
  }
  return { scanned, sent };
}
