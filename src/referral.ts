/** تکمیل دعوت دوستان (همه‌ی پلتفرم‌ها: تلگرام، بله، روبیکا، ایتا، سایت و اپ اندروید): پاداش دعوت‌کننده وقتی شمرده می‌شود که دوستِ دعوت‌شده «اولین ارائه‌اش را بسازد» (نه صرفاً وارد شود).
 *  - ورود با لینک ربات (تلگرام/بله/روبیکا): bot.ts ← holdReferral (settings.ts) فقط refp:<دعوت‌شده> را می‌گذارد.
 *  - ورود با لینک سایت (?ref=)، برنامک ایتا/Mini App (startapp=ref_…) یا کد دعوتِ واردشده در سایت/اپ: claimReferral (همین فایل) همان refp: را می‌گذارد.
 *  - اولین ارائه‌ی موفق: workflow.ts (گام finish) ← completeReferral؛ rewardReferral شمارنده‌ی دعوت‌کننده را بالا می‌برد و پیام او را می‌فرستد.
 *  شناسه‌ی دعوت (RefId): حساب وبِ وصل‌به‌پیام‌رسان با شناسه‌ی پیام‌رسانش (عدد) شمرده می‌شود تا با داده‌ی قبلی یکی بماند؛ حساب فقط‌وب/اپ با شناسه‌ی «w_…» خودش.
 *  idempotent: rewardReferral برای هر دعوت‌شده فقط یک‌بار می‌شمارد (ref:<دعوت‌شده>)؛ پس اجرای دوباره (تکرار گام یا تلاش مجدد) بی‌اثر است.
 *  هرگز خطا پرتاب نمی‌کند (جز claimReferral که پیام خطای قابل‌نمایش برمی‌گرداند)؛ فراخواننده هم `.catch` می‌گذارد. */
import type { Env } from "./env";
import { REF_CREDITS, REF_EVERY, REF_MAX, clearPendingReferral, holdReferral, isBanned, isWebId, parseRefId, pendingInviter, refPaid, referralMsg, rewardReferral, settleReferralCredits, type RefId, type Uid } from "./settings";
import { hitLimit } from "./auth";
import { toFa } from "./util";
import { getLinkedTg, resolveUid } from "./link";
import { BRAND } from "./email";
import { firstName, render } from "./plan-notify";
import { notifyUser } from "./notify";

/** شناسه‌ی دعوتِ یک حساب: پیام‌رسان/مدیر ← همان عدد؛ حساب وب ← پیام‌رسانِ وصل‌شده (اگر هست) وگرنه شناسه‌ی خودِ حساب وب */
export async function refIdOf(env: Env, uid: Uid): Promise<RefId | null> {
  if (isWebId(uid)) return (await getLinkedTg(env, String(uid))) ?? parseRefId(uid);
  return parseRefId(uid);
}

/** تعداد دعوت‌های موفق یک حساب (۰ تا REF_MAX) */
export async function refCount(env: Env, id: RefId): Promise<number> {
  return Math.min(REF_MAX, Math.max(0, Number(await env.KV.get(`refc:${id}`).catch(() => null)) || 0));
}

/** پیام به دعوت‌کننده در همه‌ی کانال‌هایی که دارد (notify.ts): همه‌ی پیام‌رسان‌های وصل‌شده‌ی حساب + اعلان وب + اپ اندروید
 *  و، فقط برای پاداش نهایی (email=true)، ایمیل. کانال‌ها مستقل‌اند و خطای یکی بقیه را خراب نمی‌کند. خطا نمی‌پرتابد. */
async function notifyInviter(env: Env, inviter: RefId, html: string, email = false): Promise<void> {
  try {
    const body = html.replace(/<[^>]+>/g, "").replace(/\s*\n+\s*/g, " ").trim();
    await notifyUser(env, inviter, {
      title: "🎁 دعوت دوستان", body, url: "/", tag: "referral", html,
      except: email ? [] : ["email"],
      email: ({ name }) => render(env, `پاداش دعوت دوستانت رسید 🎁 — ${BRAND}`, {
        head: "پاداش دعوت دوستانت رسید 🎁", sub: `${firstName(name)}، دوستت اولین ارائه‌اش را ساخت`,
        paras: body.split(/(?<=[.!؟])\s+/).filter(Boolean).slice(0, 4), rows: [], cta: "دیدن حساب ←", color: "#0f766e", campaign: "referral-reward", promo: "features",
        tip: "اعتبار هدیه را می‌توانی برای ساخت ارائه، پوستر، جزوه یا پادکست خرج کنی؛ و با دعوت دوستان بیشترش کنی.",
        foot: "این پیام فقط وقتی فرستاده می‌شود که دعوت یکی از دوستانت کامل شود.", preview: "دعوت دوستت شمرده شد.",
      } as Parameters<typeof render>[2]),
      emailTag: "referral-reward",
      key: `ref-${inviter}-${Date.now().toString(36)}`,
    });
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
  if (r) await notifyInviter(env, inviter, referralMsg(r), true);
  return !!r;
}

/** وقتی دوستی با لینک دعوت وارد شد (هنوز شمرده نمی‌شود، چون دعوت با اولین ارائه‌ی او کامل می‌شود): به دعوت‌کننده خبر می‌دهد و پیشرفتش را نشان می‌دهد.
 *  حداکثر ۳ بار در روز برای هر دعوت‌کننده و فقط تا سقف REF_MAX. هرگز خطا پرتاب نمی‌کند. */
export async function notifyInviterJoined(env: Env, inviterId: RefId): Promise<void> {
  try {
    const done = await refCount(env, inviterId);
    if (done >= REF_MAX) return;
    if (await hitLimit(env, `refjn:${inviterId}`, 3, 86_400)) return;
    const left = REF_EVERY - ((done - await refPaid(env, inviterId, done)) % REF_EVERY); // بر پایه‌ی دعوت‌های تسویه‌نشده (نه صرفاً باقی‌مانده‌ی شمارنده)
    await notifyInviter(env, inviterId, [
      "👋 <b>یکی از دوستانت با لینک تو وارد پاورپوینت‌ساز شد</b>",
      "",
      "وقتی <b>اولین ارائه‌اش</b> را بسازد، دعوتت شمرده می‌شود.",
      `📊 دعوت‌های موفق تو تا الان: <b>${toFa(String(done))}</b> از ${toFa(String(REF_MAX))}`,
      `🎁 ${toFa(String(left))} دعوت موفق دیگر تا ${toFa(String(REF_CREDITS))} اعتبار`,
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

/** تسویه‌ی یک‌باره‌ی دعوت‌های قبلی بعد از تغییر قانون (هر ۵ دعوت = ۱ پلاس ← هر ۲ دعوت = ۱ اعتبار معمولی).
 *  برای هر دعوت‌کننده: پلاس‌های قبلاً داده‌شده (floor(دعوت/۵)) دست‌نخورده می‌مانند و فقط دعوت‌های «تسویه‌نشده» (دعوت − مضرب ۵) دسته‌دسته (دوتایی) اعتبار معمولی می‌شوند.
 *  idempotent است (refpaid: پیش می‌رود)، پس اجرای دوباره چیزی اضافه نمی‌دهد. به هر دعوت‌کننده‌ای که اعتبار گرفت پیام می‌رود.
 *  cursor/limit: برای جلوگیری از سقف درخواست‌های یک اجرا، هر بار حداکثر limit دعوت‌کننده پردازش می‌شود؛ done=false یعنی دوباره اجرا کن. */
export interface SettleReport { inviters: number; granted: number; credits: number; errors: number; done: boolean; cursor: string }
export async function settleLegacyReferrals(env: Env, cursor = "", limit = 60): Promise<SettleReport> {
  const rep: SettleReport = { inviters: 0, granted: 0, credits: 0, errors: 0, done: true, cursor };
  await env.KV.ready();
  const rows = (await env.DB.prepare("SELECT k, v FROM kv WHERE k > ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND CAST(v AS INTEGER) > 0 ORDER BY k LIMIT ?4")
    .bind(cursor || "refc:", "refc:\uffff", Math.floor(Date.now() / 1000), limit).all<{ k: string; v: string }>()).results ?? [];
  for (const r of rows) {
    rep.cursor = r.k;
    const id = parseRefId(r.k.slice(5));
    if (id === null) continue;
    rep.inviters++;
    try {
      const count = Math.min(REF_MAX, Number(r.v) || 0);
      const creditTo: Uid = typeof id === "number" ? await resolveUid(env, id) : id;
      const n = await settleReferralCredits(env, id, count, creditTo, count);
      if (n > 0) {
        rep.granted++; rep.credits += n;
        await notifyInviter(env, id, [
          "🎁 <b>قانون دعوت دوستان به‌روز شد!</b>",
          "",
          `از حالا به ازای هر <b>${toFa(String(REF_EVERY))} دعوت موفق</b> ${toFa(String(REF_CREDITS))} اعتبار (یک ارائه‌ی رایگان) می‌گیری.`,
          `دعوت‌هایی که قبلاً پاداشی نگرفته بودند حساب شد و <b>${toFa(String(n))} اعتبار</b> به حسابت اضافه شد. برای دیدن اعتبار: /credit`,
        ].join("\n"));
      }
    } catch (e) { rep.errors++; console.error("settleLegacyReferrals", r.k, String(e).slice(0, 200)); }
  }
  rep.done = rows.length < limit;
  return rep;
}
