/** یادآوری فعال‌سازی: کاربری که ثبت‌نام کرده ولی هنوز اولین ارائه‌اش را نساخته، حداکثر دو یادآوری می‌گیرد و در آن اعتبار رایگان باقی‌مانده‌اش اعلام می‌شود
 *  (ایمیل برای حساب‌های دارای ایمیل + همه‌ی پیام‌رسان‌های وصل‌شده + اعلان مرورگر + اپ اندروید):
 *    ۱) ۲۴ تا ۷۲ ساعت بعد از ساخت حساب (مرحله‌ی act24)
 *    ۲) ۵ تا ۷ روز بعد از ساخت حساب (مرحله‌ی act5d) — با یک موضوع آماده‌ی نمونه که کاربر فقط کپی و ارسال کند («موضوع ننوشتن» بزرگ‌ترین مانع شروع است)
 *
 *  - «ارائه نساخته» = ردیف act:<حساب> وجود ندارد (noteDeckDone در settings.ts آن را با اولین ارائه‌ی موفق می‌نویسد)؛ پس کسی که بین دو مرحله ارائه ساخته باشد مرحله‌ی دوم را نمی‌گیرد.
 *  - بازه‌ی هر مرحله چند روزه است تا اگر یک اجرای cron از دست رفت، اجرای بعدی جبران کند.
 *  - هر حساب در هر مرحله فقط یک‌بار: نشانگر act24:<حساب> / act5d:<حساب> در KV (برای همه‌ی نتیجه‌ها ثبت می‌شود تا ردیف‌های ردشده صف را پر نکنند).
 *  - cron ساعتی (نه روزانه): هر اجرای Worker سقف ۵۰ زیردرخواست دارد؛ پس هر ساعت در مجموع دو مرحله حداکثر MAX_PER_RUN حساب (مرحله‌ی ۱ اولویت دارد)،
 *    برای هر مرحله یک پرس‌وجوی واحد (اعتبار، پلن، مسدودی و تلگرام در همان JOIN خوانده می‌شود) و یک batch برای نشانگرها.
 *  - فقط ساعت ۹ تا ۲۱ به وقت تهران ارسال می‌شود (نیمه‌شب پیام نمی‌رسد).
 *  هرگز خطا پرتاب نمی‌کند. بدون RESEND_API_KEY ایمیل بی‌اثر است. env باید با withStore ساخته شده باشد. */
import type { Env } from "./env";
import type { WebUser } from "./auth";
import { FREE_MAX_SLIDES } from "./settings";
import { esc as tgEsc, sendMessage } from "./telegram";
import { BRAND, emailEnabled, sendEmail } from "./email";
import { miniappUrl } from "./deck-service";
import { firstName, render } from "./plan-notify";
import { mailUrl } from "./email-blocks";
import { toFa } from "./util";
import { parseDevices, sendWebPushDevices, webPushEnabled, type WebPushMsg } from "./webpush";
import { parseFcmCol, pushEnabled, sendPushToUser } from "./push";
import { CHANS, chanOf, chanReady, sendToChannels } from "./link";

/** cron ساعتی (دقیقه‌ی ۴۷ تا با cron روزانه‌ی ۰۳:۱۷ هم‌زمان نشود)؛ باید با triggers.crons در wrangler.jsonc یکی باشد */
export const ACTIVATION_CRON = "47 * * * *";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** هر اجرا در مجموع دو مرحله حداکثر این تعداد حساب (هر کدام تا ۲ ارسال) ← با ۲ پرس‌وجو و ۲ batch زیر سقف ۵۰ زیردرخواست */
const MAX_PER_RUN = 20;
const DONE_TTL = 10 * 86_400; // ثانیه
const RETRY_TTL = 2 * 3600;   // ثانیه؛ فقط وقتی ایمیل شکست خورد
const MAXC = "\u{10FFFF}";

/** ساعت فعلی تهران (UTC+3:30؛ ایران ساعت تابستانی ندارد) */
const tehranHour = (t: number) => new Date(t + 3.5 * HOUR).getUTCHours();
export const inSendHours = (t: number) => { const h = tehranHour(t); return h >= 9 && h < 21; };

export function activationEmail(env: Env, name: string, credits: number) {
  const n = toFa(String(credits));
  return render(env, `🎁 ${n} ارائه‌ی رایگانت هنوز دست‌نخورده مانده — ${BRAND}`, {
    campaign: "activation-24h", promo: "features",
    tip: "موضوع به ذهنت نمی‌رسد؟ فقط بنویس «معرفی هوش مصنوعی» و ببین ۲ دقیقه بعد چه تحویل می‌گیری.",
    cta2: { text: "راهنما و نمونه‌ها", href: mailUrl(env, "/blog", "activation-24h", "cta") },
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

/** موضوع‌های نمونه برای یادآوری دوم؛ ساده و بدون عدد اسلاید تا ربات/سایت همان‌طور که هست بفهمد */
export const SAMPLE_TOPICS = [
  "مدیریت زمان برای دانشجویان",
  "معرفی هوش مصنوعی و کاربردهای روزمره‌ی آن",
  "انرژی خورشیدی؛ مزایا و چالش‌ها",
  "طرح کسب‌وکار یک کافه‌ی کوچک",
  "تاریخ و فرهنگ ایران باستان",
  "اصول سخنرانی و ارائه‌ی مؤثر",
];
/** انتخاب ثابت (بدون تصادف) از روی شناسه‌ی حساب: هر کاربر همیشه همان موضوع را می‌بیند */
export const pickTopic = (uid: string) => SAMPLE_TOPICS[[...uid].reduce((a, c) => a + c.charCodeAt(0), 0) % SAMPLE_TOPICS.length];

export function activationEmail2(env: Env, name: string, credits: number, topic: string) {
  const n = toFa(String(credits));
  return render(env, `💡 «${topic}»؛ موضوع آماده‌ی اولین ارائه‌ات — ${BRAND}`, {
    campaign: "activation-5d", promo: "features",
    tip: "موضوع را کپی کن، در سایت یا ربات بفرست و ۱ تا ۲ دقیقه بعد فایل PPTX فارسی‌ات را تحویل بگیر.",
    cta2: { text: "راهنما و نمونه‌ها", href: mailUrl(env, "/blog", "activation-5d", "cta") },
    head: "نمی‌دانی چه موضوعی بنویسی؟ 💡",
    sub: `${firstName(name)}، ${n} اعتبار رایگان هنوز در حسابت مانده است.`,
    paras: [
      `برای شروع همین موضوع را امتحان کن: «${topic}». آن را در کادر سایت یا ربات بنویس و ۱ تا ۲ دقیقه بعد فایل PPTX فارسی و راست‌چینت آماده است.`,
      "موضوع دیگری داری؟ متن، فایل Word/PDF یا لینک هم می‌توانی بدهی. ساخت ارائه با همین اعتبار رایگان است و نیازی به پرداخت ندارد.",
    ],
    rows: [["موضوع پیشنهادی", topic], ["اعتبار رایگان باقی‌مانده", `${n} اعتبار`], ["حداکثر اسلاید رایگان", `${toFa(String(FREE_MAX_SLIDES))} اسلاید`]],
    cta: "ساخت اولین ارائه ←", color: "#2563eb",
    foot: "این آخرین یادآوری ماست و بعد از آن مزاحمت نمی‌شویم. سؤالی داشتی؟ همین ایمیل را پاسخ بده.",
    preview: `«${topic}» را امتحان کن؛ ${n} اعتبار رایگان در حسابت مانده است.`,
  });
}

export function activationTelegram2(credits: number, topic: string): string {
  return [
    "💡 <b>هنوز اولین ارائه‌ات را نساخته‌ای!</b>",
    "",
    `<b>${toFa(String(credits))}</b> اعتبار رایگان هنوز در حسابت مانده است. نمی‌دانی چه موضوعی بفرستی؟ همین را کپی کن و برای ربات بفرست:`,
    "",
    `<code>${tgEsc(topic)}</code>`,
    "",
    "۱ تا ۲ دقیقه بعد فایل PPTX فارسی‌ات آماده است. موضوع دیگری داشتی، همان را بفرست (متن، فایل Word/PDF یا لینک هم می‌شود).",
    "",
    "موجودی: /credit",
  ].join("\n");
}

interface Row { k: string; v: string; bonus: string | null; sub: string | null; banned: number | null; tg: string | null; ids: string | null; wps: string | null; fcm: string | null }

/** marker: پیشوند نشانگر «فرستاده شد» (act24 / act5d) — ثابتِ کد است، نه ورودی کاربر */
const sqlFor = (marker: string) => `
SELECT u.k AS k, u.v AS v,
  (SELECT b.v FROM kv b WHERE b.k = 'bonus:' || substr(u.k, 4)) AS bonus,
  (SELECT s.v FROM kv s WHERE s.k = 'sub:' || substr(u.k, 4) AND (s.exp IS NULL OR s.exp > ?3)) AS sub,
  (SELECT 1 FROM kv n WHERE n.k = 'ban:' || substr(u.k, 4)) AS banned,
  (SELECT t.v FROM kv t WHERE t.k = 'w2tg:' || substr(u.k, 4)) AS tg,
  (SELECT i.v FROM kv i WHERE i.k = 'w2ids:' || substr(u.k, 4)) AS ids,
  (SELECT p.v FROM kv p WHERE p.k = 'wps:' || substr(u.k, 4) AND (p.exp IS NULL OR p.exp > ?3)) AS wps,
  (SELECT f.v FROM kv f WHERE f.k = 'ptu:' || substr(u.k, 4) AND (f.exp IS NULL OR f.exp > ?3)) AS fcm
FROM kv u
WHERE u.k >= ?1 AND u.k < ?2 AND (u.exp IS NULL OR u.exp > ?3)
  AND json_extract(u.v, '$.created') >= ?4 AND json_extract(u.v, '$.created') < ?5
  AND NOT EXISTS (SELECT 1 FROM kv a WHERE a.k = 'act:' || substr(u.k, 4))
  AND NOT EXISTS (SELECT 1 FROM kv m WHERE m.k = '${marker}:' || substr(u.k, 4) AND (m.exp IS NULL OR m.exp > ?3))
ORDER BY u.k LIMIT ?6`;

interface Stage {
  marker: string; minAge: number; maxAge: number; tag: string; idem: string;
  email: (env: Env, name: string, credits: number, uid: string) => { subject: string; html: string; text: string };
  telegram: (credits: number, uid: string) => string;
  push: (credits: number, uid: string) => WebPushMsg;
}
const STAGES: Stage[] = [
  { marker: "act24", minAge: 24 * HOUR, maxAge: 72 * HOUR, tag: "activation-24h", idem: "activation",
    email: (env, name, c) => activationEmail(env, name, c), telegram: (c) => activationTelegram(c),
    push: (c) => ({ title: "🎁 اولین ارائه‌ات منتظر توست", body: `${toFa(String(c))} اعتبار رایگان در حسابت مانده؛ فقط یک موضوع بنویس.`, url: "/", tag: "activation" }) },
  { marker: "act5d", minAge: 5 * DAY, maxAge: 7 * DAY, tag: "activation-5d", idem: "activation5d",
    email: (env, name, c, uid) => activationEmail2(env, name, c, pickTopic(uid)), telegram: (c, uid) => activationTelegram2(c, pickTopic(uid)),
    push: (c, uid) => ({ title: "یک ایده برای اولین ارائه‌ات", body: `«${pickTopic(uid)}»؛ ${toFa(String(c))} اعتبار رایگان منتظر توست.`, url: "/", tag: "activation" }) },
];

/** از cron ساعتی صدا زده می‌شود. */
export async function remindInactiveSignups(env: Env): Promise<{ scanned: number; sent: number }> {
  let scanned = 0, sent = 0;
  try {
    const now = Date.now();
    if (!inSendHours(now)) return { scanned, sent };
    const mailOn = emailEnabled(env), msgOn = CHANS.some((c) => chanReady(env, c)), pushOn = webPushEnabled(env), fcmOn = pushEnabled(env);
    if (!mailOn && !msgOn && !pushOn && !fcmOn) return { scanned, sent };
    await env.KV.ready();
    const nowSec = Math.floor(now / 1000);
    let sub = 36; // سقف زیردرخواست باقی‌مانده برای ارسال‌ها (۵۰ − پرس‌وجوها و batchها − حاشیه)؛ اعلان وب فقط وقتی جا باشد
    let budget = MAX_PER_RUN; // بین دو مرحله مشترک است؛ مرحله‌ی ۱ اولویت دارد
    for (const st of STAGES) {
      if (budget <= 0) break;
      const rows = (await env.DB.prepare(sqlFor(st.marker))
        .bind("wu:", "wu:" + MAXC, nowSec, now - st.maxAge, now - st.minAge, budget).all<Row>()).results ?? [];
      budget -= rows.length;
      const marks: D1PreparedStatement[] = [];
      const mark = (uid: string, val: string, ttl: number) => marks.push(env.DB
        .prepare("INSERT INTO kv (k, v, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp")
        .bind(`${st.marker}:${uid}`, val, nowSec + ttl));

      for (const r of rows) {
        const uid = r.k.slice(3);
        scanned++;
        let u: WebUser, credits = 0;
        try {
          u = JSON.parse(r.v);
          credits = Math.max(0, Math.floor(Number(r.bonus) || 0));
          if (r.sub) { const s = JSON.parse(r.sub); if (Number(s.exp) > now) credits += Math.max(0, Math.floor(Number(s.credits) || 0)); }
        } catch { mark(uid, "0", DONE_TTL); continue; }
        // همه‌ی پیام‌رسان‌های وصل‌شده‌ی حساب (هویت اصلی اول) که ربات‌شان روی سرور فعال است؛ نه فقط یک «تلگرام اصلی»
        const tgN = Number(r.tg);
        let linked: number[] = [];
        try { const a = JSON.parse(r.ids ?? "[]"); if (Array.isArray(a)) linked = a.map(Number); } catch { /* فقط هویت اصلی */ }
        const msgIds = msgOn ? [...new Set([tgN, ...linked])].filter((i) => Number.isSafeInteger(i) && i > 0 && chanReady(env, chanOf(i))).slice(0, CHANS.length) : [];
        const to = mailOn && u.email ? u.email : "";
        // مسدود، بدون اعتبار یا بدون هیچ کانالی: ردش می‌کنیم و نشانگر می‌گذاریم تا صف را پر نکند
        const devices = pushOn ? parseDevices(r.wps) : [];
        const fcmTokens = fcmOn ? parseFcmCol(r.fcm) : [];
        if (r.banned || credits <= 0 || (!to && !msgIds.length && !devices.length && !fcmTokens.length)) { mark(uid, "0", DONE_TTL); continue; }

        sub -= (to ? 1 : 0) + msgIds.length;
        const usePush = devices.length > 0 && sub >= Math.min(3, devices.length);
        if (usePush) sub -= Math.min(3, devices.length);
        const useFcm = fcmTokens.length > 0 && sub >= 3;
        if (useFcm) sub -= 3;
        const [mailOk, tgOk, pushOk, fcmOk] = await Promise.all([
          to ? sendEmail(env, { to, ...st.email(env, u.name, credits, uid), tag: st.tag, idempotencyKey: `${st.idem}-${uid}` }) : Promise.resolve(false),
          msgIds.length
            ? sendToChannels(env, uid, (id) => sendMessage(env, id, st.telegram(credits, uid), { reply_markup: { inline_keyboard: [[{ text: "🚀 ساخت ارائه", web_app: { url: `${miniappUrl(env)}/app` } }]] } }), msgIds)
                .then((x) => x.ok > 0).catch((e) => { console.error("activation messenger", String(e).slice(0, 200)); return false; })
            : Promise.resolve(false),
          usePush ? sendWebPushDevices(env, uid, devices, st.push(credits, uid)).then((x) => x.ok > 0).catch(() => false) : Promise.resolve(false),
          // اپ اندروید: برچسب activation / activation5d همتای محلی (act1 / act2) را در اپ مهار می‌کند
          useFcm ? (() => { const p = st.push(credits, uid); return sendPushToUser(env, uid, { title: p.title, body: p.body, tag: st.marker === "act24" ? "activation" : "activation5d" }, fcmTokens, 1).then((x) => x.ok > 0).catch(() => false); })() : Promise.resolve(false),
        ]);
        if (mailOk || tgOk || pushOk || fcmOk) { sent++; mark(uid, "1", DONE_TTL); }
        else if (to) mark(uid, "r", RETRY_TTL);   // ایمیل شکست خورد (قطعی موقت Resend): دو ساعت بعد دوباره
        else mark(uid, "0", DONE_TTL);            // فقط تلگرام بود و نرسید (معمولاً ربات را بلاک کرده): تلاش مجدد ندارد
      }
      if (marks.length) await env.DB.batch(marks);
    }
  } catch (e) {
    console.error("remindInactiveSignups", String(e).slice(0, 300));
  }
  return { scanned, sent };
}
