/** اعلان‌های پلن ماهانه:
 *  ۱) یادآوری ۷ روز مانده به پایان پلن (ایمیل + ربات تلگرام؛ هر کدام که برای حساب موجود باشد) — از cron روزانه (remindExpiringPlans)
 *  ۲) اعلام تمام شدن اعتبار پلن (فقط ایمیل) — بعد از ساخت ارائه‌ای که آخرین اعتبار پلن را مصرف کرده (notifyPlanCreditsOut)
 *  هر اعلان برای هر دوره‌ی پلن فقط یک‌بار فرستاده می‌شود (نشانگر در KV با کلید شامل پایان پلن)؛ با تمدید، پایان پلن عوض می‌شود و دوره‌ی بعد دوباره اعلام می‌گیرد.
 *  هرگز خطا پرتاب نمی‌کند و کار اصلی (ساخت ارائه، cron) را خراب نمی‌کند. بدون RESEND_API_KEY ایمیل بی‌اثر است. */
import type { Env } from "./env";
import { getUserById } from "./auth";
import { getLinkedTg } from "./link";
import { getSub, isWebId, type Sub, type Uid } from "./settings";
import { esc as tgEsc, sendMessage } from "./telegram";
import { BRAND, emailEnabled, sendEmail, siteOf } from "./email";
import { PLANS } from "./payment";
import { buyKbFor } from "./deck-service";
import { toFa } from "./util";

const DAY = 86_400_000;
/** چند روز مانده به پایان پلن یادآوری فرستاده شود */
export const REMIND_DAYS = 7;

const FONT = "Vazirmatn,Tahoma,'Segoe UI',Arial,sans-serif";
const BLUE = "#2563eb", AMBER = "#d97706", INK = "#0f1b33", MUTED = "#5b6b86", LINE = "#e3e9f5", SOFT = "#eef4ff";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const faDate = (t: number) => new Date(t).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran", year: "numeric", month: "long", day: "numeric" });
const planName = (s: Sub) => PLANS.find((p) => p.id === s.plan)?.name ?? s.plan;

interface Mail { head: string; sub: string; paras: string[]; rows: [string, string][]; cta: string; color: string; foot: string; preview: string }

/** قالب مشترک ایمیل‌ها (هم‌شکل رسید خرید) */
function render(env: Env, subject: string, m: Mail): { subject: string; html: string; text: string } {
  const site = siteOf(env);
  const tr = m.rows.map(([k, v]) => `
        <tr>
          <td style="padding:11px 0;border-bottom:1px solid ${LINE};font:400 13px/1.8 ${FONT};color:${MUTED};text-align:right;">${esc(k)}</td>
          <td style="padding:11px 0;border-bottom:1px solid ${LINE};font:700 13.5px/1.8 ${FONT};color:${INK};text-align:left;unicode-bidi:plaintext;">${esc(v)}</td>
        </tr>`).join("");
  const ps = m.paras.map((p) => `<p style="margin:0 0 12px;font:400 14px/2 ${FONT};color:${INK};">${esc(p)}</p>`).join("");
  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5fb;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${esc(m.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5fb" style="background:#f1f5fb;">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
    <tr><td align="center" bgcolor="${m.color}" style="background:${m.color};border-radius:20px 20px 0 0;padding:28px 20px;">
      <img src="${site}/icon-192.png" width="52" height="52" alt="${BRAND}" style="display:block;border:0;border-radius:13px;margin:0 auto 10px;">
      <div style="font:700 21px/1.6 ${FONT};color:#ffffff;">${esc(m.head)}</div>
      <div style="font:400 13.5px/1.9 ${FONT};color:#ffffff;opacity:.92;">${esc(m.sub)}</div>
    </td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:24px 26px 8px;font-family:${FONT};text-align:right;">
      ${ps}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${tr}
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 0 10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="${BLUE}" style="border-radius:13px;background:${BLUE};"><a href="${site}/" target="_blank" style="display:inline-block;padding:13px 34px;font:700 15px/1.4 ${FONT};color:#ffffff;text-decoration:none;border-radius:13px;">${esc(m.cta)}</a></td>
        </tr></table>
      </td></tr></table>
    </td></tr>
    <tr><td bgcolor="${SOFT}" align="center" style="background:${SOFT};border-radius:0 0 20px 20px;padding:16px 22px;font:400 12px/2 ${FONT};color:${MUTED};">
      ${esc(m.foot)}
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
  const text = [`${m.head} — ${BRAND}`, "", ...m.paras, "", ...m.rows.map(([k, v]) => `${k}: ${v}`), "", `${m.cta}: ${site}/`, m.foot].join("\n");
  return { subject, html, text };
}

/** آیا کاربر ایمیل قابل‌ارسال دارد؟ (فقط حساب‌های وب) */
async function emailOf(env: Env, uid: Uid): Promise<{ to: string; name: string } | null> {
  if (!emailEnabled(env) || !isWebId(uid)) return null;
  const u = await getUserById(env, String(uid)).catch(() => null);
  return u?.email ? { to: u.email, name: u.name } : null;
}
const firstName = (n: string) => n.trim().split(/\s+/)[0]?.slice(0, 24) || "دوست عزیز";

// ---------- ۱) یادآوری ۷ روز مانده به پایان پلن ----------
export function expiryEmail(env: Env, name: string, s: Sub, now = Date.now()) {
  const days = Math.max(1, Math.ceil((s.exp - now) / DAY));
  const pn = planName(s);
  return render(env, `${toFa(String(days))} روز تا پایان پلن ${pn} — ${BRAND}`, {
    head: "پلنت رو به پایان است ⏳",
    sub: `${firstName(name)}، پلن ${pn} تا ${toFa(String(days))} روز دیگر تمام می‌شود.`,
    paras: [
      `${toFa(String(s.credits))} اعتبار استفاده‌نشده‌ی پلنت با پایان آن از بین می‌رود؛ تا آن موقع می‌توانی از آن‌ها برای ساخت ارائه، پوستر و جزوه استفاده کنی.`,
      "اگر پیش از پایان پلن، همان پلن را تمدید کنی، ۳۰ روز به مدت پلن فعلی اضافه می‌شود و اعتبار جدید روی اعتبار باقی‌مانده‌ات جمع می‌شود.",
    ],
    rows: [["پلن", `پلن ${pn}`], ["پایان پلن", faDate(s.exp)], ["اعتبار باقی‌مانده", `${toFa(String(s.credits))} اعتبار`]],
    cta: "تمدید پلن ←", color: AMBER,
    foot: "این یادآوری فقط یک‌بار برای هر دوره‌ی پلن فرستاده می‌شود. سؤالی داشتی؟ همین ایمیل را پاسخ بده.",
    preview: `پلن ${pn} تا ${toFa(String(days))} روز دیگر تمام می‌شود و ${toFa(String(s.credits))} اعتبار استفاده‌نشده دارد.`,
  });
}

export function expiryTelegram(s: Sub, now = Date.now()): string {
  const days = Math.max(1, Math.ceil((s.exp - now) / DAY));
  return [
    `⏳ <b>پلن ${tgEsc(planName(s))} رو به پایان است</b>`,
    "",
    `📅 پایان پلن: <b>${tgEsc(faDate(s.exp))}</b> (${toFa(String(days))} روز دیگر)`,
    `🎟 اعتبار استفاده‌نشده: <b>${toFa(String(s.credits))}</b> که با پایان پلن از بین می‌رود.`,
    "",
    "اگر پیش از پایان پلن، همان پلن را تمدید کنی، ۳۰ روز به مدت پلن فعلی اضافه می‌شود و اعتبار جدید روی اعتبار باقی‌مانده جمع می‌شود.",
  ].join("\n");
}

const remKey = (uid: string, exp: number) => `rem7:${uid}:${exp}`;

/** یک پلن: ایمیل + تلگرام. true = یادآوری رسید (یا کانالی برای رساندن وجود ندارد و نیازی به تلاش مجدد نیست) */
async function remindOne(env: Env, uid: string, s: Sub): Promise<boolean> {
  if (await env.KV.get(remKey(uid, s.exp))) return false; // قبلاً فرستاده شده
  const mail = await emailOf(env, uid);
  const tgId = isWebId(uid) ? await getLinkedTg(env, uid) : (Number.isSafeInteger(Number(uid)) && Number(uid) > 0 ? Number(uid) : null);
  if (!mail && !tgId) { await env.KV.put(remKey(uid, s.exp), "0", { expirationTtl: 10 * 86_400 }); return false; }
  const jobs: Promise<boolean>[] = [];
  if (mail) {
    const m = expiryEmail(env, mail.name, s);
    jobs.push(sendEmail(env, { to: mail.to, ...m, tag: "plan-expiry", idempotencyKey: `plan-exp7-${uid}-${s.exp}`.slice(0, 256) }));
  }
  if (tgId) {
    jobs.push((async () => {
      await sendMessage(env, tgId, expiryTelegram(s), await buyKbFor(env, uid, tgId));
      return true;
    })().catch((e) => { console.error("expiry telegram", String(e).slice(0, 200)); return false; }));
  }
  const ok = (await Promise.all(jobs)).some(Boolean);
  if (ok) await env.KV.put(remKey(uid, s.exp), "1", { expirationTtl: 10 * 86_400 }); // اگر هیچ کانالی نرسید، فردا دوباره تلاش می‌شود
  return ok;
}

/** cron روزانه: پلن‌های فعالی که حداکثر REMIND_DAYS روز تا پایان‌شان مانده و هنوز اعتبار دارند. env باید با withStore ساخته شده باشد. */
export async function remindExpiringPlans(env: Env): Promise<{ scanned: number; sent: number }> {
  let scanned = 0, sent = 0;
  try {
    await env.KV.ready();
    const now = Date.now(), nowSec = Math.floor(now / 1000);
    let after = "sub:";
    for (let page = 0; page < 50; page++) {
      const rows = (await env.DB.prepare(
        "SELECT k, v FROM kv WHERE k > ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND json_extract(v,'$.exp') > ?4 AND json_extract(v,'$.exp') <= ?5 AND json_extract(v,'$.credits') > 0 ORDER BY k LIMIT 100")
        .bind(after, "sub:\u{10FFFF}", nowSec, now, now + REMIND_DAYS * DAY).all<{ k: string; v: string }>()).results ?? [];
      for (const r of rows) {
        after = r.k;
        let s: Sub;
        try { const j = JSON.parse(r.v); s = { plan: String(j.plan), exp: Number(j.exp), credits: Math.floor(Number(j.credits) || 0) }; } catch { continue; }
        if (!Number.isFinite(s.exp) || s.credits <= 0) continue;
        scanned++;
        try { if (await remindOne(env, r.k.slice(4), s)) sent++; } catch (e) { console.error("remind plan", String(e).slice(0, 200)); }
      }
      if (rows.length < 100) break;
    }
  } catch (e) {
    console.error("remindExpiringPlans", String(e).slice(0, 300));
  }
  return { scanned, sent };
}

// ---------- ۲) اعلام تمام شدن اعتبار پلن (فقط ایمیل) ----------
export function creditsOutEmail(env: Env, name: string, s: Sub, now = Date.now()) {
  const pn = planName(s);
  const left = Math.max(1, Math.ceil((s.exp - now) / DAY));
  return render(env, `اعتبار پلن ${pn} تمام شد — ${BRAND}`, {
    head: "اعتبار پلنت تمام شد",
    sub: `${firstName(name)}، آخرین اعتبار پلن ${pn} مصرف شد.`,
    paras: [
      "تا وقتی اعتبار جدیدی نداشته باشی، حسابت مثل پلن رایگان کار می‌کند: تا ۸ اسلاید و ۱ تصویر در هر ارائه و فقط مدل‌های رایگان؛ اعتبار رایگان روزانه هم برقرار است.",
      "برای ادامه، همان پلن را تمدید کن؛ ۳۰ روز به مدت پلن فعلی اضافه می‌شود و امکانات پلن (اسلاید بیشتر، تصویر بیشتر، مدل‌های ویژه و بدون واترمارک) با اعتبار جدید دوباره فعال می‌شود.",
    ],
    rows: [["پلن", `پلن ${pn}`], ["اعتبار باقی‌مانده", "۰ اعتبار"], ["پایان پلن", `${faDate(s.exp)} (${toFa(String(left))} روز دیگر)`]],
    cta: "تمدید پلن ←", color: BLUE,
    foot: "این ایمیل فقط یک‌بار برای هر دوره‌ی پلن فرستاده می‌شود. سؤالی داشتی؟ همین ایمیل را پاسخ بده.",
    preview: `آخرین اعتبار پلن ${pn} مصرف شد؛ برای ادامه پلن را تمدید کن.`,
  });
}

/** بعد از ساخت ارائه صدا زده می‌شود (فقط وقتی اعتبارِ این ارائه از پلن کم شده): اگر اعتبار پلن اکنون صفر است و پلن هنوز تمام نشده، ایمیل می‌رود. */
export async function notifyPlanCreditsOut(env: Env, uid: Uid): Promise<void> {
  try {
    const s = await getSub(env, uid); // فقط پلن منقضی‌نشده
    if (!s || s.credits > 0) return; // اعتبار برگشته یا تمدید شده
    const key = `planout:${uid}:${s.exp}`;
    if (await env.KV.get(key)) return;
    const mail = await emailOf(env, uid);
    if (!mail) return;
    const m = creditsOutEmail(env, mail.name, s);
    const ok = await sendEmail(env, { to: mail.to, ...m, tag: "plan-credits-out", idempotencyKey: `plan-out-${uid}-${s.exp}`.slice(0, 256) });
    if (ok) await env.KV.put(key, "1", { expiration: Math.floor(s.exp / 1000) + 86_400 });
  } catch (e) {
    console.error("notifyPlanCreditsOut", String(e).slice(0, 300));
  }
}
