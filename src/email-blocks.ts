/** بلوک‌های مشترک قالب ایمیل‌ها: نوار لینک‌های سایت، کارت پلن‌ها، کارت امکانات، کادر نکته و دکمه‌ی دوم.
 *  render (plan-notify.ts)، ایمیل خوش‌آمد، رسید و کد ورود همه از همین‌جا لینک سایت می‌گیرند تا هیچ ایمیلی بدون راه برگشت به سایت نباشد
 *  و هر ایمیل فرصتی برای معرفی امکانات یا پلن‌ها باشد.
 *  همه‌ی خروجی‌ها HTML درون‌خطیِ سازگار با کلاینت‌های ایمیل‌اند (جدول، استایل inline، راست‌به‌چپ، بدون SVG و فونت وب). */
import type { Env } from "./env";
import { siteOf } from "./email";
import { PLANS } from "./payment";
import { toFa } from "./util";

const FONT = "Vazirmatn,Tahoma,'Segoe UI',Arial,sans-serif";
const BLUE = "#2563eb", INK = "#0f1b33", MUTED = "#5b6b86", LINE = "#e3e9f5", SOFT = "#eef4ff";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** آدرس کامل سایت + مسیر + پارامترهای utm (medium: footer / promo / cta) */
export function mailUrl(env: Env, path: string, campaign: string, medium = "footer"): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${siteOf(env)}${path}${sep}utm_source=email&utm_medium=${encodeURIComponent(medium)}&utm_campaign=${encodeURIComponent(campaign)}`;
}

/** لینک‌های ثابت پایین هر ایمیل */
const FOOTER_LINKS: [string, string][] = [["ساخت ارائه", "/"], ["پلن‌ها", "/?buy=1"], ["راهنما و وبلاگ", "/blog"], ["حریم خصوصی", "/privacy.html"]];

/** نوار لینک‌های پایین ایمیل + آدرس سایت */
export function linkBar(env: Env, campaign: string): string {
  const host = siteOf(env).replace(/^https?:\/\//, "");
  const items = FOOTER_LINKS
    .map(([t, p]) => `<a href="${esc(mailUrl(env, p, campaign))}" target="_blank" style="color:${BLUE};text-decoration:none;font-weight:700;">${t}</a>`)
    .join(`<span style="color:#b6c2d6;">&nbsp; · &nbsp;</span>`);
  return `<div dir="rtl" style="padding-top:12px;font:400 12.5px/2.2 ${FONT};color:${MUTED};text-align:center;">${items}</div>` +
    `<div dir="ltr" style="font:400 12px/2 ${FONT};text-align:center;"><a href="${esc(mailUrl(env, "/", campaign))}" target="_blank" style="color:#8a97ad;text-decoration:none;">${esc(host)}</a></div>`;
}
export function linksText(env: Env, campaign: string): string {
  return FOOTER_LINKS.map(([t, p]) => `${t}: ${mailUrl(env, p, campaign)}`).join("\n");
}

/** کادر نکته‌ی برجسته (زرد ملایم) */
export function tipBox(text: string): string {
  return `<table dir="rtl" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td dir="rtl" style="padding:2px 0 14px;">
    <table dir="rtl" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td dir="rtl" bgcolor="#fffbeb" style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:12px 16px;font:400 13px/2 ${FONT};color:#7c4a03;text-align:right;">💡 ${esc(text)}</td>
    </tr></table></td></tr></table>`;
}

/** دکمه‌ی دوم (حاشیه‌دار) زیر دکمه‌ی اصلی */
export function ghostButton(text: string, href: string, color: string): string {
  return `<table dir="rtl" role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:12px;"><tr>
    <td dir="rtl" align="center" style="border:2px solid ${color};border-radius:13px;"><a href="${esc(href)}" target="_blank" style="display:inline-block;padding:10px 26px;font:700 13.5px/1.4 ${FONT};color:${color};text-decoration:none;border-radius:13px;">${esc(text)}</a></td>
  </tr></table>`;
}

const faPrice = (n: number) => toFa(n.toLocaleString("en-US")).replace(/,/g, "٬");
const perDeck = (p: { price: number; credits: number }) => Math.round(p.price / p.credits);

/** کارت مقایسه‌ی پلن‌ها (قیمت، تعداد ارائه، اسلاید، هزینه‌ی هر ارائه) با دکمه‌ی دیدن پلن‌ها؛ همه‌ی عددها از PLANS خوانده می‌شود */
export function plansCard(env: Env, campaign: string, title = "پلن‌هایی که ارائه‌هایت را حرفه‌ای‌تر می‌کنند"): string {
  if (!PLANS.length) return "";
  const best = Math.min(...PLANS.map((p) => p.price / p.credits));
  const cell = (p: (typeof PLANS)[number]) => {
    const isBest = PLANS.length > 1 && p.price / p.credits === best;
    const badge = isBest
      ? `<div style="display:inline-block;background:${BLUE};color:#ffffff;border-radius:20px;padding:1px 12px;font:700 11px/1.9 ${FONT};margin-bottom:6px;">به‌صرفه‌ترین</div>`
      : `<div style="height:25px;line-height:25px;font-size:1px;">&nbsp;</div>`;
    return `<td dir="rtl" width="${Math.floor(100 / PLANS.length)}%" valign="top" style="padding:0 5px;">
      <table dir="rtl" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td dir="rtl" align="center" bgcolor="#ffffff" style="background:#ffffff;border:2px solid ${isBest ? BLUE : LINE};border-radius:16px;padding:14px 8px 16px;font-family:${FONT};">
          ${badge}
          <div style="font:700 15px/1.8 ${FONT};color:${INK};">پلن ${esc(p.name)}</div>
          <div style="font:800 24px/1.5 ${FONT};color:${BLUE};">${faPrice(p.price)}</div>
          <div style="font:400 12px/1.8 ${FONT};color:${MUTED};padding-bottom:6px;">هزار تومان برای ${toFa(String(p.days))} روز</div>
          <div style="font:700 13px/2 ${FONT};color:${INK};">${toFa(String(p.credits))} ارائه، تا ${toFa(String(p.maxSlides))} اسلاید</div>
          <div style="font:400 12px/2 ${FONT};color:${MUTED};">تا ${toFa(String(p.maxImages))} تصویر در هر ارائه</div>
          <div style="font:400 12px/2 ${FONT};color:${MUTED};">حدود ${faPrice(perDeck(p))} هزار تومان برای هر ارائه</div>
        </td>
      </tr></table></td>`;
  };
  return `<table dir="rtl" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td dir="rtl" style="padding:18px 0 4px;border-top:1px solid ${LINE};">
    <div style="font:700 15px/1.8 ${FONT};color:${INK};text-align:center;padding-bottom:12px;">✨ ${esc(title)}</div>
    <table dir="rtl" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${PLANS.map(cell).join("")}</tr></table>
    <div style="text-align:center;padding:14px 0 6px;"><a href="${esc(mailUrl(env, "/?buy=1", campaign, "promo"))}" target="_blank" style="display:inline-block;padding:11px 30px;border-radius:13px;background:${BLUE};font:700 14px/1.4 ${FONT};color:#ffffff;text-decoration:none;">دیدن و خرید پلن ←</a></div>
  </td></tr></table>`;
}
export function plansText(env: Env, campaign: string): string[] {
  return ["", "پلن‌ها:", ...PLANS.map((p) => `• پلن ${p.name}: ${faPrice(p.price)} هزار تومان، ${toFa(String(p.credits))} ارائه در ماه، تا ${toFa(String(p.maxSlides))} اسلاید`), `دیدن پلن‌ها: ${mailUrl(env, "/?buy=1", campaign, "promo")}`];
}

/** امکانات سرویس که هر کدام به صفحه‌ی راهنمای خودش لینک دارد (مسیرها در wrangler.jsonc و landing-data هستند) */
const FEATURES: [string, string, string][] = [
  ["📄 Word و PDF ← ارائه", "فایلت را بده تا اسلاید شود", "/word-to-pptx"],
  ["🔗 ساخت از لینک", "آدرس یک مقاله یا صفحه کافی است", "/link-to-pptx"],
  ["🖼 پوستر و اینفوگرافیک", "خلاصه‌ی ارائه، آماده‌ی اشتراک", "/infographic-maker"],
  ["🎙 اسلاید صوتی و پادکست", "ارائه‌ات را بشنو", "/audio-slide-podcast"],
];

/** چهار کاشی امکانات (۲×۲) با لینک؛ title: تیتر بلوک */
export function featuresCard(env: Env, campaign: string, title = "ندیده‌ای؟ این‌ها را هم امتحان کن"): string {
  const tile = ([t, d, p]: [string, string, string]) => `<td dir="rtl" width="50%" valign="top" style="padding:0 5px 10px;">
      <a href="${esc(mailUrl(env, p, campaign, "promo"))}" target="_blank" style="text-decoration:none;display:block;">
        <table dir="rtl" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td dir="rtl" bgcolor="#f8faff" style="background:#f8faff;border:1px solid ${LINE};border-radius:14px;padding:12px 12px;font-family:${FONT};text-align:right;">
            <div style="font:700 13px/1.8 ${FONT};color:${INK};">${t}</div>
            <div style="font:400 12px/1.8 ${FONT};color:${MUTED};">${d}</div>
          </td>
        </tr></table></a></td>`;
  return `<table dir="rtl" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td dir="rtl" style="padding:18px 0 4px;border-top:1px solid ${LINE};">
    <div style="font:700 15px/1.8 ${FONT};color:${INK};text-align:center;padding-bottom:12px;">${esc(title)}</div>
    <table dir="rtl" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>${tile(FEATURES[0])}${tile(FEATURES[1])}</tr>
      <tr>${tile(FEATURES[2])}${tile(FEATURES[3])}</tr>
    </table>
  </td></tr></table>`;
}
export function featuresText(env: Env, campaign: string): string[] {
  return ["", "امکانات:", ...FEATURES.map(([t, , p]) => `• ${t}: ${mailUrl(env, p, campaign, "promo")}`)];
}
