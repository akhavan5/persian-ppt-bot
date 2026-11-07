/**
 * پروفایل داخل ربات‌ها (تلگرام، بله، روبیکا، ایتا؛ همه از bot.ts عبور می‌کنند، پس یک بار نوشتن کافی است).
 * دستور /profile یا دکمه‌ی «👤 پروفایل»: نمایش وضعیت حساب + ثبت موبایل (OTP پیامکی) و ایمیل (OTP ایمیلی).
 * جریان: دکمه ← کاربر شماره/ایمیل را می‌نویسد ← ربات کد ۶ رقمی می‌فرستد ← کاربر کد را می‌نویسد ← ثبت + ۱ اعتبار هدیه (یک‌بار).
 * حساب، اعتبار و فایل‌ها همان حساب یکپارچه‌ی سایت است؛ پس ثبت از هر پلتفرمی در همه‌ی پلتفرم‌ها دیده می‌شود.
 */
import type { Env } from "./env";
import { emailOtpEnabled, getUserById, otpEnabled } from "./auth";
import { attachContact, contactRewardInfo, normContact, sendContactCode, type ContactKind } from "./profile";
import { CONTACT_CREDITS, CONTACT_REWARD_NOTE, getCredit } from "./settings";
import { resolveUid } from "./link";
import { esc, sendMessage, tg } from "./telegram";
import { toEn, toFa } from "./util";
import { siteLoginUrl } from "./deck-service";

type Btn = { text: string; callback_data?: string; url?: string };
const kb = (rows: Btn[][]) => ({ reply_markup: { inline_keyboard: rows } });

const stKey = (userId: number) => `pf:${userId}`;
const nudgeKey = (uid: string) => `pfn:${uid}`;
const ST_TTL = 600;
type State = { s: "mobile" | "email" | "mcode" | "ecode"; v?: string };

const giftLine = () => `🎁 <b>${toFa(String(CONTACT_CREDITS))} اعتبار هدیه</b> — ${esc(CONTACT_REWARD_NOTE)}`;
const cancelKb = kb([[{ text: "✖️ لغو", callback_data: "pf:x" }]]);

/** نمایش پروفایل. uid عددی (مدیر) پروفایل وب ندارد. */
export async function showProfile(env: Env, chatId: number, userId: number, uid: string | number): Promise<unknown> {
  const user = typeof uid === "string" ? await getUserById(env, uid) : null;
  if (!user) return sendMessage(env, chatId, "👤 برای حساب مدیر پروفایل جدا ساخته نمی‌شود.");
  const [c, info] = await Promise.all([getCredit(env, uid), contactRewardInfo(env, user)]);
  const lines = [
    "👤 <b>پروفایل</b>",
    `نام: ${esc(user.name)}`,
    `📱 موبایل: ${user.mobile ? `<code>${esc(user.mobile)}</code> ✅` : "ثبت نشده"}`,
    `✉️ ایمیل: ${user.email ? `<code>${esc(user.email)}</code>${user.verified ? " ✅" : ""}` : "ثبت نشده"}`,
    c.unlimited ? "💳 اعتبار: نامحدود" : `💳 اعتبار: <b>${toFa(String(c.total))}</b> ارائه`,
  ];
  if (info.available) lines.push("", giftLine(), "به‌ازای هر مورد (موبایل و ایمیل جداگانه) پس از تایید با کد، یک‌بار اضافه می‌شود.");
  const rows: Btn[][] = [];
  const add: Btn[] = [];
  if (info.missing.includes("mobile")) add.push({ text: "📱 ثبت شماره‌ی موبایل", callback_data: "pf:m" });
  if (info.missing.includes("email")) add.push({ text: "✉️ ثبت ایمیل", callback_data: "pf:e" });
  if (add.length) rows.push(add);
  rows.push([{ text: "🌐 ورود به سایت", url: await siteLoginUrl(env, userId, "home") }]);
  return sendMessage(env, chatId, lines.join("\n"), kb(rows));
}

/** یک‌بار بعد از /start برای کاربر جدیدی که موبایل/ایمیل ندارد: یادآور هدیه */
export async function nudgeProfile(env: Env, chatId: number, uid: string | number): Promise<void> {
  if (typeof uid !== "string") return;
  const user = await getUserById(env, uid);
  if (!user) return;
  const info = await contactRewardInfo(env, user);
  if (!info.available) return;
  if ((await env.KV.get(nudgeKey(uid))) !== null) return;
  await env.KV.put(nudgeKey(uid), "1");
  const add: Btn[] = [];
  if (info.missing.includes("mobile")) add.push({ text: "📱 ثبت شماره‌ی موبایل", callback_data: "pf:m" });
  if (info.missing.includes("email")) add.push({ text: "✉️ ثبت ایمیل", callback_data: "pf:e" });
  await sendMessage(env, chatId, `${giftLine()}\nبا ثبت و تایید ${user.mobile ? "ایمیل" : user.email ? "شماره‌ی موبایل" : "شماره‌ی موبایل و ایمیل (هرکدام جداگانه)"} اعتبار هدیه می‌گیری.`, kb([add])).catch(() => {});
}

/** دکمه‌های pf:m (ثبت موبایل) | pf:e (ثبت ایمیل) | pf:x (لغو) */
export async function handleProfileCallback(env: Env, cq: any, userId: number, chatId: number, action: string): Promise<void> {
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
  if (action === "x") {
    await env.KV.delete(stKey(userId)).catch(() => {});
    await sendMessage(env, chatId, "لغو شد. هر وقت خواستی: /profile");
    return;
  }
  const kind: ContactKind = action === "e" ? "email" : "mobile";
  if (kind === "mobile" ? !otpEnabled(env) : !emailOtpEnabled(env)) {
    await sendMessage(env, chatId, kind === "mobile" ? "ثبت موبایل با پیامک فعلاً فعال نیست." : "ثبت ایمیل فعلاً فعال نیست.");
    return;
  }
  const uid = await resolveUid(env, userId);
  const user = typeof uid === "string" ? await getUserById(env, uid) : null;
  if (!user) return void (await sendMessage(env, chatId, "پروفایل پیدا نشد؛ یک بار /start بزن."));
  if (user[kind]) return void (await sendMessage(env, chatId, "این مورد قبلاً برای حسابت ثبت شده است. /profile"));
  await env.KV.delete(`fb:${userId}`).catch(() => {}); // حالت «ارسال نظر» با این ورودی قاطی نشود
  await env.KV.put(stKey(userId), JSON.stringify({ s: kind } satisfies State), { expirationTtl: ST_TTL });
  await sendMessage(env, chatId, kind === "mobile"
    ? "📱 شماره‌ی موبایلت را بفرست (مثل <code>09123456789</code>). یک کد ۶ رقمی پیامک می‌شود."
    : "✉️ نشانی ایمیلت را بفرست (مثل <code>name@example.com</code>). یک کد ۶ رقمی به ایمیلت فرستاده می‌شود.", cancelKb);
}

/** پیام متنیِ کاربر وقتی در جریان ثبت است. true = پیام مصرف شد. دستور یا پیام غیرمتنی جریان را لغو می‌کند و false برمی‌گرداند. */
export async function handleProfileInput(env: Env, userId: number, chatId: number, text: string, isCmd: boolean): Promise<boolean> {
  const st = (await env.KV.get(stKey(userId), "json")) as State | null;
  if (!st) return false;
  if (isCmd || !text) { await env.KV.delete(stKey(userId)).catch(() => {}); return false; }

  const uid = await resolveUid(env, userId);
  const user = typeof uid === "string" ? await getUserById(env, uid) : null;
  if (!user) { await env.KV.delete(stKey(userId)).catch(() => {}); return false; }

  if (st.s === "mobile" || st.s === "email") {
    const kind: ContactKind = st.s;
    const value = normContact(kind, text);
    if (!value) {
      await sendMessage(env, chatId, kind === "mobile" ? "شماره‌ی موبایل معتبر نیست؛ مثل <code>09123456789</code> بفرست." : "ایمیل معتبر نیست؛ مثل <code>name@example.com</code> بفرست.", cancelKb);
      return true;
    }
    if (user[kind]) { await env.KV.delete(stKey(userId)).catch(() => {}); await sendMessage(env, chatId, "این مورد قبلاً ثبت شده است. /profile"); return true; }
    const e = await sendContactCode(env, `bot:${userId}`, kind, value); // محدودیت نرخ OTP (۶۰ ثانیه، ۵ در ساعت برای هر شماره/ایمیل) همان وب است
    if (e) { await sendMessage(env, chatId, `⚠️ ${esc(e.error)}`, cancelKb); return true; }
    await env.KV.put(stKey(userId), JSON.stringify({ s: kind === "mobile" ? "mcode" : "ecode", v: value } satisfies State), { expirationTtl: ST_TTL });
    await sendMessage(env, chatId, `✅ کد ${kind === "mobile" ? "پیامک" : "به ایمیل فرستاده"} شد: <code>${esc(value)}</code>\nکد ۶ رقمی را همین‌جا بفرست (۵ دقیقه اعتبار دارد).`,
      kb([[{ text: "🔄 ارسال دوباره", callback_data: kind === "mobile" ? "pf:m" : "pf:e" }, { text: "✖️ لغو", callback_data: "pf:x" }]]));
    return true;
  }

  // مرحله‌ی کد
  const kind: ContactKind = st.s === "mcode" ? "mobile" : "email";
  const code = toEn(text).replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) { await sendMessage(env, chatId, "کد باید ۶ رقم باشد.", cancelKb); return true; }
  const r = await attachContact(env, user, kind, st.v ?? "", code, userId);
  if ("error" in r) {
    if (r.status !== 401 || /منقضی|زیاد/.test(r.error)) await env.KV.delete(stKey(userId)).catch(() => {}); // کد اشتباه: فرصت دوباره؛ بقیه‌ی خطاها: پایان جریان
    await sendMessage(env, chatId, `⚠️ ${esc(r.error)}`, r.status === 401 ? cancelKb : undefined);
    return true;
  }
  await env.KV.delete(stKey(userId)).catch(() => {});
  const what = kind === "mobile" ? "شماره‌ی موبایل" : "ایمیل";
  if (r.merged) {
    await sendMessage(env, chatId, `✅ ${what} تایید شد و این حساب به حساب سایتِ دارنده‌ی آن وصل شد؛ اعتبار و فایل‌هایت در همه‌ی پلتفرم‌ها یکی است. /credit`);
  } else {
    await sendMessage(env, chatId, `✅ ${what} ثبت شد.` + (r.reward > 0 ? `\n\n🎁 <b>${toFa(String(r.reward))} اعتبار هدیه</b> به حسابت اضافه شد — ${esc(CONTACT_REWARD_NOTE)}\nموجودی: /credit` : ""));
  }
  return true;
}
