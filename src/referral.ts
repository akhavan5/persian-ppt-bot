/** تکمیل دعوت دوستان (همه‌ی پلتفرم‌ها: تلگرام، بله، روبیکا، ایتا، سایت و اپ اندروید): پاداش دعوت‌کننده وقتی شمرده می‌شود که دوستِ دعوت‌شده «اولین ارائه‌اش را بسازد» (نه صرفاً وارد شود).
 *  - ورود با لینک ربات (تلگرام/بله/روبیکا): bot.ts ← holdReferral (settings.ts) فقط refp:<دعوت‌شده> را می‌گذارد.
 *  - ورود با لینک سایت (?ref=)، برنامک ایتا/Mini App (startapp=ref_…) یا کد دعوتِ واردشده در سایت/اپ: claimReferral (همین فایل) همان refp: را می‌گذارد.
 *  - اولین ارائه‌ی موفق: workflow.ts (گام finish) ← completeReferral؛ rewardReferral شمارنده‌ی دعوت‌کننده را بالا می‌برد و پیام او را می‌فرستد.
 *  شناسه‌ی دعوت (RefId): حساب وبِ وصل‌به‌پیام‌رسان با شناسه‌ی پیام‌رسانش (عدد) شمرده می‌شود تا با داده‌ی قبلی یکی بماند؛ حساب فقط‌وب/اپ با شناسه‌ی «w_…» خودش.
 *  idempotent: rewardReferral برای هر دعوت‌شده فقط یک‌بار می‌شمارد (ref:<دعوت‌شده>)؛ پس اجرای دوباره (تکرار گام یا تلاش مجدد) بی‌اثر است.
 *  هرگز خطا پرتاب نمی‌کند (جز claimReferral که پیام خطای قابل‌نمایش برمی‌گرداند)؛ فراخواننده هم `.catch` می‌گذارد. */
import type { Env } from "./env";
import { REF_EVERY, REF_MAX, clearPendingReferral, holdReferral, isBanned, isWebId, parseRefId, pendingInviter, referralMsg, rewardReferral, type RefId, type Uid } from "./settings";
import { hitLimit } from "./auth";
import { toFa } from "./util";
import { getLinkedTg, resolveUid } from "./link";
import { sendMessage } from "./telegram";
import { sendWebPush } from "./webpush";

/** شناسه‌ی دعوتِ یک حساب: پیام‌رسان/مدیر ← همان عدد؛ حساب وب ← پیام‌رسانِ وصل‌شده (اگر هست) وگرنه شناسه‌ی خودِ حساب وب */
export async function refIdOf(env: Env, uid: Uid): Promise<RefId | null> {
  if (isWebId(uid)) return (await getLinkedTg(env, String(uid))) ?? parseRefId(uid);
  return parseRefId(uid);
}

/** تعداد دعوت‌های موفق یک حساب (۰ تا REF_MAX) */
export async function refCount(env: Env, id: RefId): Promise<number> {
  return Math.min(REF_MAX, Math.max(0, Number(await env.KV.get(`refc:${id}`).catch(() => null)) || 0));
}

/** پیام به دعوت‌کننده: پیام‌رسان ← پیام در همان پیام‌رسان؛ حساب فقط‌وب/اپ ← اعلان وب (اگر اجازه داده). خطا نمی‌پرتابد. */
async function notifyInviter(env: Env, inviter: RefId, html: string): Promise<void> {
  try {
    if (typeof inviter === "number") { await sendMessage(env, inviter, html); return; }
    const body = html.replace(/<[^>]+>/g, "").replace(/\s*\n+\s*/g, " ").trim();
    await sendWebPush(env, inviter, { title: "🎁 دعوت دوستان", body, url: "/", tag: "referral" });
  } catch { /* اعلان اختیاری است */ }
}

/** uid = شناسه‌ی اصلی حسابی که ارائه ساخته (حساب وب یا شناسه‌ی عددی مدیر). true = دعوت همین حالا شمرده شد. */
export async function completeReferral(env: Env, uid: Uid): Promise<boolean> {
  const me = await refIdOf(env, uid);
  if (me === null) return false;
  const inviter = await pendingInviter(env, me);
  if (inviter === null) return false;
  const creditTo: Uid = typeof inviter === "number" ? await resolveUid(env, inviter) : inviter; // اعتبار روی حساب اصلی دعوت‌کننده
  const r = await rewardReferral(env, inviter, me, creditTo); // خطا ⇒ دعوت در انتظار می‌ماند و ارائه‌ی بعدی دوباره تلاش می‌کند
  await clearPendingReferral(env, me);
  if (r) await notifyInviter(env, inviter, referralMsg(r));
  return !!r;
}

/** وقتی دوستی با لینک دعوت وارد شد (هنوز شمرده نمی‌شود، چون دعوت با اولین ارائه‌ی او کامل می‌شود): به دعوت‌کننده خبر می‌دهد و پیشرفتش را نشان می‌دهد.
 *  حداکثر ۳ بار در روز برای هر دعوت‌کننده و فقط تا سقف REF_MAX. هرگز خطا پرتاب نمی‌کند. */
export async function notifyInviterJoined(env: Env, inviterId: RefId): Promise<void> {
  try {
    const done = await refCount(env, inviterId);
    if (done >= REF_MAX) return;
    if (await hitLimit(env, `refjn:${inviterId}`, 3, 86_400)) return;
    const left = REF_EVERY - (done % REF_EVERY);
    await notifyInviter(env, inviterId, [
      "👋 <b>یکی از دوستانت با لینک تو وارد پاورپوینت‌ساز شد</b>",
      "",
      "وقتی <b>اولین ارائه‌اش</b> را بسازد، دعوتت شمرده می‌شود.",
      `📊 دعوت‌های موفق تو تا الان: <b>${toFa(String(done))}</b> از ${toFa(String(REF_MAX))}`,
      `🎁 ${toFa(String(left))} دعوت موفق دیگر تا ۱ اعتبار پلن پلاس`,
    ].join("\n"));
  } catch (e) {
    console.error("notifyInviterJoined", String(e).slice(0, 200));
  }
}

export type ClaimResult = { ok: true } | { error: string; status: number };

/** ثبت «دعوت در انتظار» برای حسابی که از سایت، اپ اندروید، برنامک ایتا یا Mini App با کد/لینک دعوت آمده (مسیر ربات‌ها همان holdReferral در bot.ts است).
 *  در هر زمان پذیرفته می‌شود (هر حساب فقط یک دعوت): اگر حساب هنوز ارائه نساخته، دعوت تا اولین ارائه در انتظار می‌ماند؛ اگر قبلاً ساخته، همین حالا شمرده می‌شود.
 *  تکراری‌بودن (همان دعوت‌کننده) موفق حساب می‌شود تا کلاینت دوباره تلاش نکند. */
export async function claimReferral(env: Env, uid: Uid, rawCode: unknown, ip: string): Promise<ClaimResult> {
  let s = String(rawCode ?? "").trim();
  // کاربر ممکن است کل لینک دعوت را بچسباند (سایت ?ref=…، ربات ?start=ref_…، برنامک ?startapp=ref_…) یا فقط کد/ref_<کد>
  const fromUrl = /[?&]ref=([^&#\s]+)/i.exec(s)?.[1] ?? /[?&]start(?:app)?=ref_([^&#\s]+)/i.exec(s)?.[1];
  if (fromUrl) s = fromUrl;
  else if (/^ref_/i.test(s)) s = s.slice(4);
  const inviter = parseRefId(s);
  if (inviter === null) return { error: "کد دعوت معتبر نیست؛ کد یا لینک را دوباره بررسی کن.", status: 400 };
  if (await hitLimit(env, `refcl:u:${uid}`, 8, 3600) || await hitLimit(env, `refcl:ip:${ip}`, 40, 3600)) return { error: "تعداد تلاش زیاد بود؛ کمی بعد دوباره امتحان کن.", status: 429 };
  const me = await refIdOf(env, uid);
  if (me === null) return { error: "حساب شما پیدا نشد.", status: 403 };
  if (String(inviter) === String(me)) return { error: "نمی‌توانی با کد دعوت خودت وارد شوی.", status: 400 };
  if ((await env.KV.get(`ref:${me}`)) !== null) return { error: "دعوتِ این حساب قبلاً ثبت شده است.", status: 409 };
  const pend = await pendingInviter(env, me);
  if (pend !== null) return String(pend) === String(inviter) ? { ok: true } : { error: "برای این حساب قبلاً کد دعوت دیگری ثبت شده است.", status: 409 };
  const alreadyMadeDeck = (await env.KV.get(`act:${uid}`)) !== null;
  if (!(await holdReferral(env, inviter, me))) return { error: "این کد دعوت معتبر نیست یا دعوت‌کننده‌اش فعال نیست.", status: 400 };
  // حساب قبلاً ارائه ساخته: «اولین ارائه»ی دیگری در راه نیست، پس دعوت همین حالا شمرده می‌شود (پیام پاداش را completeReferral به دعوت‌کننده می‌فرستد)
  if (alreadyMadeDeck) await completeReferral(env, uid).catch((e) => console.error("referral complete", String(e).slice(0, 200)));
  else await notifyInviterJoined(env, inviter);
  return { ok: true };
}

/** برای پنل دعوت (سایت/اپ/Mini App): شمارنده‌ی دعوت‌های موفق، وضعیت «کد دعوت واردشده» و شناسه‌ی دعوت این حساب */
export async function referralState(env: Env, uid: Uid): Promise<{ id: RefId | null; count: number; canClaim: boolean; banned: boolean }> {
  const id = await refIdOf(env, uid);
  if (id === null) return { id: null, count: 0, canClaim: false, banned: false };
  const [count, counted, pend, banned] = await Promise.all([
    refCount(env, id),
    env.KV.get(`ref:${id}`).catch(() => null),
    pendingInviter(env, id),
    isBanned(env, id),
  ]);
  return { id, count, canClaim: counted === null && pend === null, banned };
}
