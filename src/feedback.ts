/** نظر کاربر کنار ارائه در سایت، مینی‌اپ تلگرام و برنامک ایتا (همان صفحه‌ی app.html)؛ مکمل دکمه‌ی «ارسال نظر» ربات (handleFeedback در bot.ts).
 *
 *  - POST /api/feedback { text?, rating? (۱ تا ۵), title?, via? } ← نظر برای مدیرها در تلگرام فرستاده می‌شود (ذخیره نمی‌شود).
 *  - اعتبار هدیه‌ی نظر (FEEDBACK_CREDITS) برای هر حساب فقط یک‌بار است و با همان نشانگر fbr:<حساب> در تلگرام/بله/روبیکا مشترک است؛
 *    پس کاربری که در ربات نظر داده، در سایت دوباره هدیه نمی‌گیرد و برعکس.
 *  - feedbackInfo در /api/me برمی‌گردد تا رابط فقط وقتی هدیه هنوز گرفته نشده، جمله‌ی «🎁 اعتبار هدیه» را نشان دهد.
 *  هرگز خطای گرفتن هدیه را به کاربر نمی‌رساند (نظرش ثبت می‌شود). */
import type { Env } from "./env";
import type { WebUser } from "./auth";
import { hitLimit } from "./auth";
import { FEEDBACK_CREDITS, FEEDBACK_MIN_CHARS, adminIds, claimFeedbackReward, hasFeedbackReward, isAdmin } from "./settings";
import { esc, sendMessage } from "./telegram";
import { toFa } from "./util";

const MAX_TEXT = 1500;
const VIA: Record<string, string> = { web: "سایت", telegram: "مینی‌اپ تلگرام", eitaa: "برنامک ایتا", app: "اپ اندروید" };

/** وضعیت هدیه‌ی نظر برای رابط: available = هنوز می‌شود با ثبت نظر اعتبار گرفت */
export async function feedbackInfo(env: Env, user: WebUser): Promise<{ available: boolean; credits: number }> {
  try {
    const available = FEEDBACK_CREDITS > 0 && !isAdmin(env, user.id) && !(await hasFeedbackReward(env, user.id));
    return { available, credits: FEEDBACK_CREDITS };
  } catch {
    return { available: false, credits: FEEDBACK_CREDITS };
  }
}

export async function submitFeedback(env: Env, user: WebUser, b: Record<string, unknown> | null): Promise<Response> {
  const out = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  if (!b) return out({ error: "درخواست نامعتبر" }, 400);
  const text = typeof b.text === "string" ? b.text.trim().slice(0, MAX_TEXT) : "";
  const r = Number(b.rating);
  const rating = Number.isInteger(r) && r >= 1 && r <= 5 ? r : 0;
  if (!text && !rating) return out({ error: "لطفاً امتیاز بده یا نظرت را بنویس." }, 400);
  if (text && text.length < FEEDBACK_MIN_CHARS) return out({ error: "نظرت خیلی کوتاه است؛ کمی کامل‌تر بنویس." }, 400);
  if (await hitLimit(env, `fbk:${user.id}`, 5, 3600)) return out({ error: "چند نظر پشت‌سر‌هم فرستادی؛ کمی بعد دوباره امتحان کن." }, 429);

  const canReward = FEEDBACK_CREDITS > 0 && !isAdmin(env, user.id);
  const rewarded = canReward && (await claimFeedbackReward(env, user.id).catch((e) => { console.error("feedbackReward", e); return false; }));

  const via = VIA[String(b.via)] ?? VIA.web;
  const title = typeof b.title === "string" ? b.title.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const who = `${esc(user.name || "کاربر")}${user.email ? ` (${esc(user.email)})` : ""}${user.mobile ? ` · ${esc(user.mobile)}` : ""}`;
  const msg = [
    `💬 <b>نظر کاربر</b> <i>(${via})</i>`,
    `👤 ${who}`,
    `🆔 <code>${esc(user.id)}</code>`,
    ...(title ? [`📄 ارائه: ${esc(title)}`] : []),
    ...(rating ? [`⭐ امتیاز: ${toFa(String(rating))} از ${toFa("5")}`] : []),
    ...(rewarded ? [`🎁 ${toFa(String(FEEDBACK_CREDITS))} اعتبار هدیه داده شد`] : []),
    ...(text ? ["", esc(text)] : []),
  ].join("\n");
  await Promise.allSettled(adminIds(env).map((id) => sendMessage(env, Number(id), msg)));

  return out({ ok: true, rewarded, credits: rewarded ? FEEDBACK_CREDITS : 0 });
}
