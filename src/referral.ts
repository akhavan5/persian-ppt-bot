/** تکمیل دعوت دوستان: پاداش دعوت‌کننده وقتی شمرده می‌شود که دوستِ دعوت‌شده «اولین ارائه‌اش را بسازد» (نه صرفاً وارد ربات شود).
 *  - ورود با لینک: bot.ts ← holdReferral (settings.ts) فقط refp:<دعوت‌شده> را می‌گذارد.
 *  - اولین ارائه‌ی موفق: workflow.ts (گام finish) ← completeReferral؛ rewardReferral شمارنده‌ی دعوت‌کننده را بالا می‌برد و پیام او را می‌فرستد.
 *  idempotent: rewardReferral برای هر دعوت‌شده فقط یک‌بار می‌شمارد (ref:<دعوت‌شده>)؛ پس اجرای دوباره (تکرار گام یا تلاش مجدد) بی‌اثر است.
 *  هرگز خطا پرتاب نمی‌کند؛ فراخواننده هم `.catch` می‌گذارد. */
import type { Env } from "./env";
import { REF_EVERY, REF_MAX, clearPendingReferral, isWebId, pendingInviter, referralMsg, rewardReferral, type Uid } from "./settings";
import { hitLimit } from "./auth";
import { toFa } from "./util";
import { getLinkedTg, resolveUid } from "./link";
import { sendMessage } from "./telegram";

/** uid = شناسه‌ی اصلی حسابی که ارائه ساخته (حساب وب یا شناسه‌ی عددی مدیر). true = دعوت همین حالا شمرده شد. */
export async function completeReferral(env: Env, uid: Uid): Promise<boolean> {
  // دعوت‌شده با شناسه‌ی پیام‌رسانش (تلگرام/بله/روبیکا) ثبت شده؛ از حساب وب برمی‌گردیم به آن
  const tgId = isWebId(uid) ? await getLinkedTg(env, String(uid)) : (Number.isSafeInteger(Number(uid)) && Number(uid) > 0 ? Number(uid) : null);
  if (!tgId) return false;
  const inviter = await pendingInviter(env, tgId);
  if (!inviter) return false;
  const r = await rewardReferral(env, inviter, tgId, await resolveUid(env, inviter)); // خطا ⇒ دعوت در انتظار می‌ماند و ارائه‌ی بعدی دوباره تلاش می‌کند
  await clearPendingReferral(env, tgId);
  if (r) await sendMessage(env, inviter, referralMsg(r)).catch(() => {});
  return !!r;
}

/** وقتی دوستی با لینک دعوت وارد شد (هنوز شمرده نمی‌شود، چون دعوت با اولین ارائه‌ی او کامل می‌شود): به دعوت‌کننده خبر می‌دهد و پیشرفتش را نشان می‌دهد.
 *  حداکثر ۳ بار در روز برای هر دعوت‌کننده و فقط تا سقف REF_MAX. هرگز خطا پرتاب نمی‌کند. */
export async function notifyInviterJoined(env: Env, inviterId: number): Promise<void> {
  try {
    const done = Math.min(REF_MAX, Math.max(0, Number(await env.KV.get(`refc:${inviterId}`)) || 0));
    if (done >= REF_MAX) return;
    if (await hitLimit(env, `refjn:${inviterId}`, 3, 86_400)) return;
    const left = REF_EVERY - (done % REF_EVERY);
    await sendMessage(env, inviterId, [
      "👋 <b>یکی از دوستانت با لینک تو وارد ربات شد</b>",
      "",
      "وقتی <b>اولین ارائه‌اش</b> را بسازد، دعوتت شمرده می‌شود.",
      `📊 دعوت‌های موفق تو تا الان: <b>${toFa(String(done))}</b> از ${toFa(String(REF_MAX))}`,
      `🎁 ${toFa(String(left))} دعوت موفق دیگر تا ۱ اعتبار پلن پلاس`,
    ].join("\n"));
  } catch (e) {
    console.error("notifyInviterJoined", String(e).slice(0, 200));
  }
}
