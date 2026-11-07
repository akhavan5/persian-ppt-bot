/**
 * ثبت و تایید موبایل/ایمیل پروفایل؛ منطق مشترک «وب، اپ اندروید و ربات‌ها» (تلگرام، بله، روبیکا، ایتا).
 * همه‌ی پلتفرم‌ها از همین توابع استفاده می‌کنند تا قانون‌ها و هدیه‌ی تکمیل پروفایل در همه‌جا یکسان بماند:
 *  - کد یک‌بارمصرف (OTP) پیامکی برای موبایل و ایمیلی برای ایمیل؛ مالکیت فقط با کد ثابت می‌شود
 *  - ۱ اعتبار هدیه برای حسابی که موبایل یا ایمیل نداشت (یک‌بار برای هر حساب و هر شماره/ایمیل؛ settings.ts ← claimContactReward)
 *  - اگر شماره/ایمیل مال حساب دیگری بود و درخواست از ربات آمده بود، هویت ربات به همان حساب وصل می‌شود (اعتبار منتقل می‌شود)
 */
import type { Env } from "./env";
import {
  checkOtp, emailOtpEnabled, getUserByEmail, getUserByMobile, normEmail, normMobile, otpEnabled, saveWebUser, sendEmailOtp, sendOtp, validEmail, type WebUser,
} from "./auth";
import { CONTACT_CREDITS, claimContactReward, hasContactReward, type ContactKind } from "./settings";
import { getLinkedTg, linkBotToAccount } from "./link";

export type { ContactKind };
type Err = { error: string; status: number };

/** اطلاعات هدیه برای نمایش در کلاینت‌ها (GET /api/me) */
export async function contactRewardInfo(env: Env, user: WebUser): Promise<{ credits: number; available: boolean; missing: ContactKind[] }> {
  const missing: ContactKind[] = [];
  if (!user.mobile && otpEnabled(env)) missing.push("mobile");
  if (!user.email && emailOtpEnabled(env)) missing.push("email");
  // هر مورد جداگانه هدیه دارد؛ «available» یعنی حداقل یکی از موردهای نبوده هنوز هدیه‌اش گرفته نشده
  const rewarded = await Promise.all(missing.map((k) => hasContactReward(env, user.id, k)));
  const available = CONTACT_CREDITS > 0 && rewarded.some((r) => !r);
  return { credits: CONTACT_CREDITS, available, missing };
}

/** مقدار را بر اساس نوع تمیز می‌کند؛ نامعتبر → null */
export function normContact(kind: ContactKind, raw: unknown): string | null {
  if (kind === "mobile") return normMobile(raw);
  const e = normEmail(raw);
  return validEmail(e) ? e : null;
}

/** ارسال کد یک‌بارمصرف. who: شناسه‌ی درخواست‌دهنده برای محدودیت نرخ (وب: IP؛ ربات: «bot:<شناسه>»). null = موفق */
export async function sendContactCode(env: Env, who: string, kind: ContactKind, value: string): Promise<Err | null> {
  return kind === "mobile" ? sendOtp(env, who, value) : sendEmailOtp(env, who, value);
}

/** بررسی کد و ثبت موبایل/ایمیل روی حساب. botId: فقط وقتی درخواست از ربات آمده (برای یکی‌کردن با حساب سایت). */
export async function attachContact(env: Env, user: WebUser, kind: ContactKind, value: string, code: string, botId?: number): Promise<{ user: WebUser; reward: number; merged?: string } | Err> {
  if (user[kind]) return { error: kind === "mobile" ? "برای حساب شما شماره‌ی موبایل ثبت شده است." : "برای حساب شما ایمیل ثبت شده است.", status: 409 };
  // اول کد: تا مالکیت ثابت نشده، وجود یا نبودِ حساب دیگر با این شماره/ایمیل فاش نمی‌شود
  const bad = await checkOtp(env, value, code);
  if (bad) return { error: bad, status: 401 };

  const other = kind === "mobile" ? await getUserByMobile(env, value) : await getUserByEmail(env, value);
  if (other && other.id !== user.id) {
    const what = kind === "mobile" ? "این شماره" : "این ایمیل";
    if (!botId) return { error: `${what} برای حساب دیگری ثبت شده است.`, status: 409 };
    // ربات: حسابِ دارنده‌ی این شماره/ایمیل را «حساب اصلی» می‌کنیم و هویت ربات را به آن وصل می‌کنیم (اعتبار منتقل می‌شود)
    if (await getLinkedTg(env, other.id)) return { error: `${what} به حساب دیگری وصل است که یک پیام‌رسان دیگر هم دارد؛ با همان پیام‌رسان یا از سایت وارد شو.`, status: 409 };
    const r = await linkBotToAccount(env, other.id, botId);
    if ("error" in r) return r;
    return { user: other, reward: 0, merged: other.id };
  }

  user[kind] = value;
  if (kind === "email") user.verified = true;
  await saveWebUser(env, user);
  await env.KV.put(kind === "mobile" ? `wm:${value}` : `we:${value}`, user.id);
  const got = await claimContactReward(env, user.id, `${kind}:${value}`).catch((e) => { console.error("contactReward", e); return false; });
  return { user, reward: got ? CONTACT_CREDITS : 0 };
}
