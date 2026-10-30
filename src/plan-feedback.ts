/** نظرسنجی پایان پلن: کاربری که پلنش (پلاس/پرو) تمام شده و تمدید نکرده، یک‌بار نظرسنجی می‌گیرد (ایمیل + ربات تلگرام).
 *
 *  - «پلن تمام شد» = لحظه‌ای که حساب به رایگان برمی‌گردد (مثل getActiveSub در settings.ts): یا مدت پلن تمام شده (exp گذشته)،
 *    یا اعتبار پلن صفر شده (credits ≤ ۰؛ مدت هنوز مانده). ردیف sub:<حساب> تا ۲۴ ساعت بعد از exp در D1 می‌ماند (putSub).
 *    تمدید exp را عوض می‌کند و اعتبار می‌افزاید؛ پس تمدیدکننده‌ها نظرسنجی نمی‌گیرند.
 *  - حدود ۱ ساعت بعد از پایان پلن (برای تمام‌شدن اعتبار: ۱ ساعت بعد از آخرین ارائه‌ی کاربر، act:<حساب>.l) و فقط ساعت ۹ تا ۲۱ تهران؛
 *    هر دوره‌ی پلن فقط یک‌بار، با هر کدام از دو دلیل (نشانگر fbs:<حساب>:<exp> در KV).
 *  - تلگرام: دکمه‌ی «ارسال نظر» (fb:p) ← پاسخ کاربر مثل نظر بعد از ارائه برای مدیرها می‌رود (handleFeedback در bot.ts) و اعتبار هدیه‌ی نظر (یک‌بار برای هر حساب) را هم می‌گیرد.
 *    ایمیل: دکمه‌ی «پاسخ به این ایمیل» (mailto به EMAIL_REPLY_TO یا فرستنده)؛ بدون RESEND_API_KEY بی‌اثر است.
 *  - cron جدا از cron یادآوری فعال‌سازی (هر اجرا سقف ۵۰ زیردرخواست): هر ساعت حداکثر MAX_PER_RUN حساب، یک پرس‌وجوی واحد و یک batch.
 *  هرگز خطا پرتاب نمی‌کند. env باید با withStore ساخته شده باشد. */
import type { Env } from "./env";
import type { WebUser } from "./auth";
import { FEEDBACK_CREDITS } from "./settings";
import { esc as tgEsc, sendMessage } from "./telegram";
import { BRAND, emailEnabled, sendEmail, siteOf } from "./email";
import { inSendHours } from "./activation-reminder";
import { faDate, firstName, render } from "./plan-notify";
import { toFa } from "./util";
import { PLANS } from "./payment";

/** cron ساعتی (دقیقه‌ی ۲۷)؛ باید با triggers.crons در wrangler.jsonc یکی باشد */
export const FEEDBACK_CRON = "27 * * * *";

const HOUR = 3_600_000;
/** چند وقت بعد از پایان پلن نظرسنجی برود */
const DELAY = 1 * HOUR;
const MAX_PER_RUN = 20;
const DONE_TTL = 10 * 86_400; // ثانیه
const RETRY_TTL = 2 * 3600;   // ثانیه؛ فقط وقتی ایمیل شکست خورد
const MAXC = "\u{10FFFF}";

const addrOf = (s?: string) => s?.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? (s && /^[^<>\s@]+@[^<>\s@]+$/.test(s.trim()) ? s.trim() : "");
const replyAddr = (env: Env) => addrOf(env.EMAIL_REPLY_TO) || addrOf(env.EMAIL_FROM) || `hello@${new URL(siteOf(env)).hostname}`;

/** time = مدت پلن تمام شد؛ credits = اعتبار پلن تمام شد (مدت هنوز مانده) */
export type EndReason = "time" | "credits";

export function feedbackEmail(env: Env, name: string, plan: string, exp: number, why: EndReason) {
  const pn = plan;
  const body = ["۱) از چه چیزی راضی بودم:", "", "۲) چه چیزی کم بود یا اذیتم کرد:", "", "۳) پلن را تمدید می‌کنم؟ چرا (یا چرا نه):", ""].join("\n");
  const href = `mailto:${replyAddr(env)}?subject=${encodeURIComponent(`نظر من درباره‌ی پلن ${pn}`)}&body=${encodeURIComponent(body)}`;
  return render(env, `پلن ${pn} تمام شد؛ نظرت را بگو — ${BRAND}`, {
    href,
    head: "نظرت برای ما مهم است 💬",
    sub: `${firstName(name)}، ممنون که با پلن ${pn} همراه ما بودی.`,
    paras: [
      `${why === "time" ? `مدت پلن ${pn} در ${faDate(exp)} تمام شد` : `اعتبار پلن ${pn} تمام شد`} و حسابت به پلن رایگان برگشت. چند دقیقه وقت بگذار و بگو تجربه‌ات چطور بود؛ تک‌تک پاسخ‌ها را خودمان می‌خوانیم و همین‌ها ربات و سایت را بهتر می‌کند.`,
      "کافی است به همین ایمیل پاسخ بدهی، یا دکمه‌ی پایین را بزنی تا پاسخ‌نامه‌ی آماده باز شود. فقط این سه سؤال: از چه چیزی راضی بودی؟ چه چیزی کم بود یا اذیتت کرد؟ و چرا (یا چرا نه) پلن را تمدید می‌کنی؟",
    ],
    rows: [["پلن", `پلن ${pn}`], [why === "time" ? "پایان پلن" : "وضعیت", why === "time" ? faDate(exp) : "اعتبار پلن تمام شد"]],
    cta: "پاسخ به این ایمیل ←", color: "#7c3aed",
    foot: "این نظرسنجی فقط یک‌بار برای هر دوره‌ی پلن فرستاده می‌شود.",
    preview: `پلن ${pn} تمام شد؛ دو دقیقه نظرت را درباره‌اش بگو.`,
  });
}

export function feedbackTelegram(plan: string, exp: number, why: EndReason, canReward: boolean): string {
  return [
    `💬 <b>نظرت درباره‌ی پلن ${tgEsc(plan)} چیست؟</b>`,
    "",
    `${why === "time" ? `مدت پلن ${tgEsc(plan)}ت در ${tgEsc(faDate(exp))} تمام شد` : `اعتبار پلن ${tgEsc(plan)}ت تمام شد`} و حسابت به پلن رایگان برگشت؛ ممنون که همراه ما بودی! 🙏`,
    "از چه چیزی راضی بودی؟ چه چیزی کم بود یا اذیتت کرد؟ و چرا (یا چرا نه) تمدید می‌کنی؟ دکمه‌ی زیر را بزن و در یک پیام بنویس.",
    ...(canReward ? ["", `🎁 با ثبت نظرت <b>${toFa(String(FEEDBACK_CREDITS))} اعتبار رایگان</b> هدیه می‌گیری.`] : []),
  ].join("\n");
}

interface Row { k: string; v: string; usr: string | null; tg: string | null; banned: number | null; rewarded: number | null }

const SQL = `
SELECT s.k AS k, s.v AS v,
  (SELECT w.v FROM kv w WHERE w.k = 'wu:' || substr(s.k, 5)) AS usr,
  (SELECT t.v FROM kv t WHERE t.k = 'w2tg:' || substr(s.k, 5)) AS tg,
  (SELECT 1 FROM kv n WHERE n.k = 'ban:' || substr(s.k, 5)) AS banned,
  (SELECT 1 FROM kv r WHERE r.k = 'fbr:' || substr(s.k, 5)) AS rewarded
FROM kv s
WHERE s.k >= ?1 AND s.k < ?2 AND (s.exp IS NULL OR s.exp > ?3)
  AND (json_extract(s.v, '$.exp') <= ?4
    OR (COALESCE(json_extract(s.v, '$.credits'), 0) <= 0
        AND COALESCE((SELECT json_extract(a.v, '$.l') FROM kv a WHERE a.k = 'act:' || substr(s.k, 5)), 0) <= ?4))
  AND NOT EXISTS (SELECT 1 FROM kv m WHERE m.k = 'fbs:' || substr(s.k, 5) || ':' || CAST(json_extract(s.v, '$.exp') AS INTEGER) AND (m.exp IS NULL OR m.exp > ?3))
ORDER BY s.k LIMIT ?5`;

/** از cron ساعتی صدا زده می‌شود. */
export async function sendPlanFeedbackSurveys(env: Env): Promise<{ scanned: number; sent: number }> {
  let scanned = 0, sent = 0;
  try {
    const now = Date.now();
    if (!inSendHours(now)) return { scanned, sent };
    const mailOn = emailEnabled(env), tgOn = !!env.TELEGRAM_BOT_TOKEN;
    if (!mailOn && !tgOn) return { scanned, sent };
    await env.KV.ready();
    const nowSec = Math.floor(now / 1000);
    const rows = (await env.DB.prepare(SQL).bind("sub:", "sub:" + MAXC, nowSec, now - DELAY, MAX_PER_RUN).all<Row>()).results ?? [];
    const marks: D1PreparedStatement[] = [];
    const mark = (uid: string, exp: number, val: string, ttl: number) => marks.push(env.DB
      .prepare("INSERT INTO kv (k, v, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp")
      .bind(`fbs:${uid}:${exp}`, val, nowSec + ttl));

    for (const r of rows) {
      const uid = r.k.slice(4);
      scanned++;
      let plan = "", exp = 0, why: EndReason = "time";
      try { const s = JSON.parse(r.v); exp = Number(s.exp); why = exp <= now ? "time" : "credits"; plan = String(PLANS.find((p) => p.id === s.plan)?.name ?? s.plan); } catch { continue; }
      if (!Number.isFinite(exp)) continue;
      exp = Math.floor(exp); // همان مقداری که SQL با CAST AS INTEGER در کلید نشانگر می‌گذارد
      let u: WebUser | null = null;
      try { u = r.usr ? JSON.parse(r.usr) : null; } catch { /* بدون ایمیل */ }
      const tgN = uid.startsWith("w_") ? Number(r.tg) : Number(uid); // مدیرها (شناسه‌ی عددی) خودِ تلگرامشان هستند
      const tgId = Number.isSafeInteger(tgN) && tgN > 0 ? tgN : null;
      const to = mailOn && u?.email ? u.email : "";
      if (r.banned || (!to && !(tgOn && tgId))) { mark(uid, exp, "0", DONE_TTL); continue; }

      const [mailOk, tgOk] = await Promise.all([
        to ? sendEmail(env, { to, ...feedbackEmail(env, u!.name, plan, exp, why), tag: "plan-feedback", idempotencyKey: `plan-fb-${uid}-${exp}`.slice(0, 256) }) : Promise.resolve(false),
        tgOn && tgId
          ? sendMessage(env, tgId, feedbackTelegram(plan, exp, why, FEEDBACK_CREDITS > 0 && !r.rewarded), { reply_markup: { inline_keyboard: [[{ text: "💬 ارسال نظر", callback_data: "fb:p" }]] } })
              .then(() => true).catch((e) => { console.error("plan feedback telegram", String(e).slice(0, 200)); return false; })
          : Promise.resolve(false),
      ]);
      if (mailOk || tgOk) { sent++; mark(uid, exp, "1", DONE_TTL); }
      else if (to) mark(uid, exp, "r", RETRY_TTL); // ایمیل شکست خورد: دو ساعت بعد دوباره
      else mark(uid, exp, "0", DONE_TTL);          // فقط تلگرام بود و نرسید (معمولاً ربات را بلاک کرده)
    }
    if (marks.length) await env.DB.batch(marks);
  } catch (e) {
    console.error("sendPlanFeedbackSurveys", String(e).slice(0, 300));
  }
  return { scanned, sent };
}
