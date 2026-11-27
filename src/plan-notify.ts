/** اعلان‌های پلن ماهانه:
 *  ۱) یادآوری ۷ روز و یادآوری آخر (کمتر از ۱ روز) مانده به پایان پلن — به همه‌ی کانال‌های کاربر (همه‌ی پیام‌رسان‌های وصل‌شده، اپ اندروید، اعلان مرورگر، ایمیل؛ هر کدام که برای حساب موجود باشد) با notify.ts — از cron روزانه (remindExpiringPlans)
 *  ۲) اعلام تمام شدن اعتبار پلن (به همه‌ی کانال‌ها) — بعد از ساخت ارائه‌ای که آخرین اعتبار پلن را مصرف کرده (notifyPlanCreditsOut)
 *  هر اعلان (هر کدام از دو یادآوری) برای هر دوره‌ی پلن فقط یک‌بار فرستاده می‌شود (نشانگر در KV با کلید شامل پایان پلن)؛ با تمدید، پایان پلن عوض می‌شود و دوره‌ی بعد دوباره اعلام می‌گیرد.
 *  هرگز خطا پرتاب نمی‌کند و کار اصلی (ساخت ارائه، cron) را خراب نمی‌کند. بدون RESEND_API_KEY ایمیل بی‌اثر است. */
import type { Env } from "./env";
import { getSub, type Sub, type Uid } from "./settings";
import { esc as tgEsc } from "./telegram";
import { BRAND, siteOf } from "./email";
import { notifyUser } from "./notify";
import { PLANS } from "./payment";
import { buyKbFor } from "./deck-service";
import { toFa } from "./util";
import { featuresCard, featuresText, ghostButton, linkBar, linksText, mailUrl, plansCard, plansText, tipBox } from "./email-blocks";

const DAY = 86_400_000;
/** چند روز مانده به پایان پلن یادآوری فرستاده شود */
export const REMIND_DAYS = 7;
/** یادآوری آخر: وقتی کمتر از این تعداد روز به پایان پلن مانده (cron روزانه ⇒ هر پلن دقیقاً یک‌بار در این پنجره می‌افتد) */
export const REMIND_LAST_DAYS = 1;

const FONT = "Vazirmatn,Tahoma,'Segoe UI',Arial,sans-serif";
const BLUE = "#2563eb", AMBER = "#d97706", INK = "#0f1b33", MUTED = "#5b6b86", LINE = "#e3e9f5", SOFT = "#eef4ff";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const faDate = (t: number) => new Date(t).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran", year: "numeric", month: "long", day: "numeric" });
const planName = (s: Sub) => PLANS.find((p) => p.id === s.plan)?.name ?? s.plan;

export interface Mail {
  /** لینک دکمه‌ی ایمیل (پیش‌فرض: صفحه‌ی اصلی سایت)؛ مثلاً mailto برای پاسخ‌نامه */ href?: string; head: string; sub: string; paras: string[]; rows: [string, string][]; cta: string; color: string; foot: string; preview: string;
  /** برچسب کمپین برای utm لینک‌های پایین ایمیل و بلوک تبلیغی (پیش‌فرض: mail) */ campaign?: string;
  /** کادر نکته‌ی برجسته بالای دکمه */ tip?: string;
  /** دکمه‌ی دوم (حاشیه‌دار) زیر دکمه‌ی اصلی */ cta2?: { text: string; href: string };
  /** بلوک زیر دکمه: "plans" = کارت مقایسه‌ی پلن‌ها، "features" = چهار امکان با لینک (پیش‌فرض)، false = هیچ (نوار لینک سایت همیشه هست) */ promo?: "plans" | "features" | false;
}

/** قالب مشترک ایمیل‌ها (هم‌شکل رسید خرید). هر ایمیل: لوگوی لینک‌دار، دکمه‌ی اصلی، (اختیاری) نکته/دکمه‌ی دوم/بلوک پلن‌ها یا امکانات، و نوار لینک‌های سایت. */
export function render(env: Env, subject: string, m: Mail): { subject: string; html: string; text: string } {
  const site = siteOf(env);
  const camp = m.campaign || "mail";
  const href = m.href ?? mailUrl(env, "/", camp, "cta");
  const tr = m.rows.map(([k, v]) => `
        <tr>
          <td dir="rtl" style="padding:11px 0;border-bottom:1px solid ${LINE};font:400 13px/1.8 ${FONT};color:${MUTED};text-align:right;">${esc(k)}</td>
          <td dir="rtl" style="padding:11px 0;border-bottom:1px solid ${LINE};font:700 13.5px/1.8 ${FONT};color:${INK};text-align:left;unicode-bidi:plaintext;">${esc(v)}</td>
        </tr>`).join("");
  const ps = m.paras.map((p) => `<p dir="rtl" style="direction:rtl;margin:0 0 12px;font:400 14px/2 ${FONT};color:${INK};">${esc(p)}</p>`).join("");
  const tip = m.tip ? tipBox(m.tip) : "";
  const btn2 = m.cta2 ? ghostButton(m.cta2.text, m.cta2.href, m.color) : "";
  const promo = m.promo === false ? "" : m.promo === "plans" ? plansCard(env, camp) : featuresCard(env, camp);
  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body dir="rtl" style="margin:0;padding:0;background:#f1f5fb;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${esc(m.preview)}</div>
<table dir="rtl" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5fb" style="background:#f1f5fb;">
<tr><td dir="rtl" align="center" style="padding:28px 12px;">
  <table dir="rtl" role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
    <tr><td dir="rtl" align="center" bgcolor="${m.color}" style="background:${m.color};border-radius:20px 20px 0 0;padding:28px 20px;">
      <a href="${esc(mailUrl(env, "/", camp, "header"))}" target="_blank" style="text-decoration:none;"><img src="${site}/icon-192.png" width="52" height="52" alt="${BRAND}" style="display:block;border:0;border-radius:13px;margin:0 auto 10px;"></a>
      <div dir="rtl" style="direction:rtl;font:700 21px/1.6 ${FONT};color:#ffffff;">${esc(m.head)}</div>
      <div dir="rtl" style="direction:rtl;font:400 13.5px/1.9 ${FONT};color:#ffffff;opacity:.92;">${esc(m.sub)}</div>
    </td></tr>
    <tr><td dir="rtl" bgcolor="#ffffff" style="background:#ffffff;padding:24px 26px 14px;font-family:${FONT};text-align:right;">
      ${ps}
      ${tip}
      <table dir="rtl" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${tr}
      </table>
      <table dir="rtl" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td dir="rtl" align="center" style="padding:24px 0 18px;">
        <table dir="rtl" role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td dir="rtl" align="center" bgcolor="${BLUE}" style="border-radius:13px;background:${BLUE};"><a href="${esc(href)}" target="_blank" style="display:inline-block;padding:13px 34px;font:700 15px/1.4 ${FONT};color:#ffffff;text-decoration:none;border-radius:13px;">${esc(m.cta)}</a></td>
        </tr></table>
        ${btn2}
      </td></tr></table>
      ${promo}
    </td></tr>
    <tr><td dir="rtl" bgcolor="${SOFT}" align="center" style="background:${SOFT};border-radius:0 0 20px 20px;padding:16px 22px 18px;font:400 12px/2 ${FONT};color:${MUTED};">
      ${esc(m.foot)}
      ${linkBar(env, camp)}
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
  const text = [
    `${m.head} — ${BRAND}`, "", ...m.paras,
    ...(m.tip ? ["", `💡 ${m.tip}`] : []),
    "", ...m.rows.map(([k, v]) => `${k}: ${v}`), "",
    `${m.cta}: ${href}`,
    ...(m.cta2 ? [`${m.cta2.text}: ${m.cta2.href}`] : []),
    ...(m.promo === false ? [] : m.promo === "plans" ? plansText(env, camp) : featuresText(env, camp)),
    "", m.foot, "", linksText(env, camp),
  ].join("\n");
  return { subject, html, text };
}

/** نام کوچک برای سلام در ایمیل/پیام. اگر نام لاتین باشد، یک RLM (U+200F) بعدش می‌آید تا «،» و عددِ فارسیِ بعد از آن در جمله‌ی راست‌به‌چپ جابه‌جا نشوند (مثلاً «Akhava ،۱» به‌جای «Akhava، ۱») */
export const firstName = (n: string) => {
  const f = n.trim().split(/\s+/)[0]?.slice(0, 24) || "دوست عزیز";
  return /[A-Za-z]/.test(f) ? f + "\u200f" : f;
};

// ---------- ۱) یادآوری ۷ روز و ۱ روز مانده به پایان پلن ----------
/** last = یادآوری آخر (کمتر از ۱ روز مانده)؛ وگرنه یادآوری ۷ روز مانده */
export function expiryEmail(env: Env, name: string, s: Sub, now = Date.now(), last = false) {
  const days = Math.max(1, Math.ceil((s.exp - now) / DAY));
  const pn = planName(s);
  const cr = toFa(String(s.credits));
  if (last) {
    return render(env, `⏰ آخرین ساعت‌های پلن ${pn}؛ ${cr} اعتبارت در خطر است — ${BRAND}`, {
      campaign: "plan-expiry-1d", promo: false,
      tip: "ساعت‌شمار روشن است: بعد از پایان پلن، اعتبارهای استفاده‌نشده از بین می‌روند. همین امروز یک ارائه، پوستر یا پادکست بساز یا پلن را تمدید کن.",
      cta2: { text: "ساخت ارائه با اعتبار باقی‌مانده", href: mailUrl(env, "/", "plan-expiry-1d", "cta") },
      head: "آخرین روز پلنت است ⏰",
      sub: `${firstName(name)}، پلن ${pn} تا کمتر از ۲۴ ساعت دیگر تمام می‌شود.`,
      paras: [
        `${cr} اعتبار استفاده‌نشده‌ی پلنت با پایان آن از بین می‌رود؛ همین امروز می‌توانی از آن‌ها برای ساخت ارائه، پوستر و جزوه استفاده کنی.`,
        "اگر پیش از پایان پلن، همان پلن را تمدید کنی، ۳۰ روز به مدت پلن فعلی اضافه می‌شود و اعتبار جدید روی اعتبار باقی‌مانده‌ات جمع می‌شود.",
      ],
      rows: [["پلن", `پلن ${pn}`], ["پایان پلن", faDate(s.exp)], ["زمان باقی‌مانده", "کمتر از ۲۴ ساعت"], ["اعتبار باقی‌مانده", `${cr} اعتبار`]],
      cta: "تمدید پلن ←", color: AMBER,
      foot: "این آخرین یادآوری برای این دوره‌ی پلن است. سؤالی داشتی؟ همین ایمیل را پاسخ بده.",
      preview: `پلن ${pn} کمتر از ۲۴ ساعت دیگر تمام می‌شود و ${cr} اعتبار استفاده‌نشده دارد.`,
    });
  }
  return render(env, `⏳ ${toFa(String(days))} روز تا پایان پلن ${pn}؛ ${cr} اعتبارت را خرج کن — ${BRAND}`, {
    campaign: "plan-expiry", promo: "features",
    tip: "هنوز از ارائه‌هایت پوستر، جزوه‌ی Word یا پادکست نساخته‌ای؟ هرکدام ۱ اعتبار است و با اعتبار باقی‌مانده‌ات می‌شود.",
    cta2: { text: "ساخت ارائه با اعتبار باقی‌مانده", href: mailUrl(env, "/", "plan-expiry", "cta") },
    head: "پلنت رو به پایان است ⏳",
    sub: `${firstName(name)}، پلن ${pn} تا ${toFa(String(days))} روز دیگر تمام می‌شود.`,
    paras: [
      `${cr} اعتبار استفاده‌نشده‌ی پلنت با پایان آن از بین می‌رود؛ تا آن موقع می‌توانی از آن‌ها برای ساخت ارائه، پوستر و جزوه استفاده کنی.`,
      "اگر پیش از پایان پلن، همان پلن را تمدید کنی، ۳۰ روز به مدت پلن فعلی اضافه می‌شود و اعتبار جدید روی اعتبار باقی‌مانده‌ات جمع می‌شود.",
    ],
    rows: [["پلن", `پلن ${pn}`], ["پایان پلن", faDate(s.exp)], ["اعتبار باقی‌مانده", `${cr} اعتبار`]],
    cta: "تمدید پلن ←", color: AMBER,
    foot: "یک یادآوری دیگر هم یک روز مانده به پایان پلن می‌فرستیم. سؤالی داشتی؟ همین ایمیل را پاسخ بده.",
    preview: `پلن ${pn} تا ${toFa(String(days))} روز دیگر تمام می‌شود و ${cr} اعتبار استفاده‌نشده دارد.`,
  });
}

export function expiryTelegram(s: Sub, now = Date.now(), last = false): string {
  const days = Math.max(1, Math.ceil((s.exp - now) / DAY));
  if (last) {
    return [
      `⏰ <b>پلن ${tgEsc(planName(s))} تا کمتر از ۲۴ ساعت دیگر تمام می‌شود</b>`,
      "",
      `📅 پایان پلن: <b>${tgEsc(faDate(s.exp))}</b>`,
      `🎟 اعتبار استفاده‌نشده: <b>${toFa(String(s.credits))}</b> که با پایان پلن از بین می‌رود.`,
      "",
      "همین امروز می‌توانی از اعتبارها استفاده کنی یا پلن را تمدید کنی؛ با تمدید، ۳۰ روز به مدت پلن فعلی اضافه می‌شود و اعتبار جدید روی اعتبار باقی‌مانده جمع می‌شود.",
    ].join("\n");
  }
  return [
    `⏳ <b>پلن ${tgEsc(planName(s))} رو به پایان است</b>`,
    "",
    `📅 پایان پلن: <b>${tgEsc(faDate(s.exp))}</b> (${toFa(String(days))} روز دیگر)`,
    `🎟 اعتبار استفاده‌نشده: <b>${toFa(String(s.credits))}</b> که با پایان پلن از بین می‌رود.`,
    "",
    "اگر پیش از پایان پلن، همان پلن را تمدید کنی، ۳۰ روز به مدت پلن فعلی اضافه می‌شود و اعتبار جدید روی اعتبار باقی‌مانده جمع می‌شود.",
  ].join("\n");
}

/** نشانگر «فرستاده شد» برای هر دوره‌ی پلن: rem7 = یادآوری ۷ روز (کلید قدیمی، دست‌نخورده)، rem1 = یادآوری آخر */
const remKey = (uid: string, exp: number, last: boolean) => `${last ? "rem1" : "rem7"}:${uid}:${exp}`;

/** یک پلن: اعلان یکسان به همه‌ی کانال‌های کاربر (همه‌ی پیام‌رسان‌ها، اپ، مرورگر، ایمیل) — notify.ts.
 *  true = یادآوری رسید. اگر کاربر هیچ کانال قابل‌رسیدنی ندارد دیگر تلاش نمی‌شود؛ اگر مقصد بود ولی نرسید فردا دوباره تلاش می‌شود. */
async function remindOne(env: Env, uid: string, s: Sub, last: boolean): Promise<boolean> {
  const key = remKey(uid, s.exp, last);
  if (await env.KV.get(key)) return false; // قبلاً فرستاده شده
  const days = Math.max(1, Math.ceil((s.exp - Date.now()) / DAY));
  const r = await notifyUser(env, uid, {
    title: last ? `پلن ${planName(s)} فردا تمام می‌شود` : `${toFa(String(days))} روز تا پایان پلن ${planName(s)}`,
    body: last ? "برای اینکه اعتبار و امکانات پلن قطع نشود، همین حالا تمدیدش کن." : "اگر پیش از پایان تمدید کنی، ۳۰ روز به مدت پلن اضافه می‌شود.",
    url: "/?buy=1", tag: "plan-expiry", emailTag: last ? "plan-expiry-1d" : "plan-expiry",
    html: expiryTelegram(s, Date.now(), last),
    extra: (id) => buyKbFor(env, uid, id),
    email: ({ name }) => expiryEmail(env, name, s, Date.now(), last),
    key: `plan-exp${last ? 1 : 7}-${uid}-${s.exp}`,
  });
  if (r.ok) await env.KV.put(key, "1", { expirationTtl: 10 * 86_400 }); // اگر هیچ کانالی نرسید، فردا دوباره تلاش می‌شود
  else if (r.reachable === 0) await env.KV.put(key, "0", { expirationTtl: 10 * 86_400 }); // کانالی برای رساندن وجود ندارد: تلاش مجدد ندارد
  return r.ok;
}

/** پلن‌های فعالی که حداکثر `days` روز تا پایان‌شان مانده و هنوز اعتبار دارند. handled: پلن‌هایی (uid:exp) که پنجره‌ی «آخر» همین اجرا پوشش داده و دیگر یادآوری ۷ روزه نمی‌گیرند. */
async function scanExpiring(env: Env, days: number, last: boolean, handled: Set<string>): Promise<{ scanned: number; sent: number }> {
  let scanned = 0, sent = 0;
  const now = Date.now(), nowSec = Math.floor(now / 1000);
  let after = "sub:";
  for (let page = 0; page < 50; page++) {
    const rows = (await env.DB.prepare(
      "SELECT k, v FROM kv WHERE k > ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND json_extract(v,'$.exp') > ?4 AND json_extract(v,'$.exp') <= ?5 AND json_extract(v,'$.credits') > 0 ORDER BY k LIMIT 100")
      .bind(after, "sub:\u{10FFFF}", nowSec, now, now + days * DAY).all<{ k: string; v: string }>()).results ?? [];
    for (const r of rows) {
      after = r.k;
      let s: Sub;
      try { const j = JSON.parse(r.v); s = { plan: String(j.plan), exp: Number(j.exp), credits: Math.floor(Number(j.credits) || 0) }; } catch { continue; }
      if (!Number.isFinite(s.exp) || s.credits <= 0) continue;
      const hk = `${r.k.slice(4)}:${s.exp}`;
      if (!last && handled.has(hk)) continue; // کمتر از ۱ روز مانده: فقط یادآوری آخر
      if (last) handled.add(hk);
      scanned++;
      try { if (await remindOne(env, r.k.slice(4), s, last)) sent++; } catch (e) { console.error("remind plan", String(e).slice(0, 200)); }
    }
    if (rows.length < 100) break;
  }
  return { scanned, sent };
}

/** cron روزانه: اول یادآوری آخر (کمتر از ۱ روز مانده)، بعد یادآوری ۷ روز مانده. env باید با withStore ساخته شده باشد. */
export async function remindExpiringPlans(env: Env): Promise<{ scanned: number; sent: number }> {
  let scanned = 0, sent = 0;
  try {
    await env.KV.ready();
    const handled = new Set<string>();
    for (const [days, last] of [[REMIND_LAST_DAYS, true], [REMIND_DAYS, false]] as const) {
      const r = await scanExpiring(env, days, last, handled);
      scanned += r.scanned; sent += r.sent;
    }
  } catch (e) {
    console.error("remindExpiringPlans", String(e).slice(0, 300));
  }
  return { scanned, sent };
}

// ---------- ۲) اعلام تمام شدن اعتبار پلن (ایمیل + ربات) ----------
export function creditsOutEmail(env: Env, name: string, s: Sub, now = Date.now()) {
  const pn = planName(s);
  const left = Math.max(1, Math.ceil((s.exp - now) / DAY));
  return render(env, `🎟 اعتبار پلن ${pn} تمام شد؛ با یک تمدید برمی‌گردد — ${BRAND}`, {
    campaign: "plan-credits-out", promo: "plans",
    tip: "مدت پلن هنوز باقی است. با تمدید، ۳۰ روز به همین مدت اضافه می‌شود و اعتبار تازه روی حسابت می‌نشیند؛ یعنی از روزهای باقی‌مانده چیزی از دست نمی‌دهی.",
    head: "اعتبار پلنت تمام شد",
    sub: `${firstName(name)}، آخرین اعتبار پلن ${pn} مصرف شد.`,
    paras: [
      "تا وقتی اعتبار جدیدی نداشته باشی، حسابت مثل پلن رایگان کار می‌کند: تا ۶ اسلاید و ۱ تصویر در هر ارائه، فقط حالت «عادی» و فقط مدل‌های رایگان؛ اعتبار رایگان روزانه هم برقرار است.",
      "برای ادامه، همان پلن را تمدید کن؛ ۳۰ روز به مدت پلن فعلی اضافه می‌شود و امکانات پلن (اسلاید بیشتر، تصویر بیشتر، حالت‌های ساخت ویژه، مدل‌های ویژه و بدون واترمارک) با اعتبار جدید دوباره فعال می‌شود.",
    ],
    rows: [["پلن", `پلن ${pn}`], ["اعتبار باقی‌مانده", "۰ اعتبار"], ["پایان پلن", `${faDate(s.exp)} (${toFa(String(left))} روز دیگر)`]],
    cta: "تمدید پلن ←", color: BLUE,
    foot: "این ایمیل فقط یک‌بار برای هر دوره‌ی پلن فرستاده می‌شود. سؤالی داشتی؟ همین ایمیل را پاسخ بده.",
    preview: `آخرین اعتبار پلن ${pn} مصرف شد؛ برای ادامه پلن را تمدید کن.`,
  });
}

export function creditsOutTelegram(s: Sub, now = Date.now()): string {
  const left = Math.max(1, Math.ceil((s.exp - now) / DAY));
  return [
    `🎟 <b>اعتبار پلن ${tgEsc(planName(s))} تمام شد</b>`,
    "",
    `آخرین اعتبار پلن مصرف شد؛ مدت پلن تا <b>${tgEsc(faDate(s.exp))}</b> (${toFa(String(left))} روز دیگر) باقی است ولی تا اعتبار جدیدی نداشته باشی، حسابت مثل پلن رایگان کار می‌کند.`,
    "",
    "با تمدید پلن، ۳۰ روز به مدت پلن فعلی اضافه می‌شود و امکانات پلن (اسلاید و تصویر بیشتر، حالت‌های ساخت و مدل‌های ویژه) برمی‌گردد.",
  ].join("\n");
}

/** بعد از ساخت ارائه صدا زده می‌شود (فقط وقتی اعتبارِ این ارائه از پلن کم شده): اگر اعتبار پلن اکنون صفر است و پلن هنوز تمام نشده، به همه‌ی کانال‌های کاربر اعلام می‌شود. */
export async function notifyPlanCreditsOut(env: Env, uid: Uid): Promise<void> {
  try {
    const s = await getSub(env, uid); // فقط پلن منقضی‌نشده
    if (!s || s.credits > 0) return; // اعتبار برگشته یا تمدید شده
    const key = `planout:${uid}:${s.exp}`;
    if (await env.KV.get(key)) return;
    const r = await notifyUser(env, uid, {
      title: `اعتبار پلن ${planName(s)} تمام شد`,
      body: "مدت پلن هنوز باقی است؛ با تمدید، اعتبار و امکانات پلن برمی‌گردد.",
      url: "/?buy=1", tag: "plan-out", emailTag: "plan-credits-out",
      html: creditsOutTelegram(s),
      extra: (id) => buyKbFor(env, uid, id),
      email: ({ name }) => creditsOutEmail(env, name, s),
      key: `plan-out-${uid}-${s.exp}`,
    });
    if (r.ok) await env.KV.put(key, "1", { expiration: Math.floor(s.exp / 1000) + 86_400 });
  } catch (e) {
    console.error("notifyPlanCreditsOut", String(e).slice(0, 300));
  }
}
