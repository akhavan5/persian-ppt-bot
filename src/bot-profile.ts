/**
 * پروفایل داخل ربات‌ها (تلگرام، بله، روبیکا، ایتا؛ همه از bot.ts عبور می‌کنند، پس یک بار نوشتن کافی است).
 * دستور /profile یا دکمه‌ی «👤 پروفایل»: نمایش وضعیت حساب + ثبت موبایل (OTP پیامکی) و ایمیل (OTP ایمیلی).
 * جریان: دکمه ← کاربر شماره/ایمیل را می‌نویسد ← ربات کد ۶ رقمی می‌فرستد ← کاربر کد را می‌نویسد ← ثبت + ۱ اعتبار هدیه (یک‌بار).
 * حساب، اعتبار و فایل‌ها همان حساب یکپارچه‌ی سایت است؛ پس ثبت از هر پلتفرمی در همه‌ی پلتفرم‌ها دیده می‌شود.
 */
import type { Env } from "./env";
import { emailOtpEnabled, getUserById, normMobile, otpEnabled } from "./auth";
import { attachContact, contactRewardInfo, isEitaaAccount, normContact, sendContactCode, type ContactKind } from "./profile";
import { CONTACT_CREDITS, CONTACT_REWARD_NOTE, getCredit, hasContactReward } from "./settings";
import { CHAN_LABEL, channelStatus, chanOf, deviceStatus, isChan, resolveUid, setChannelNotify, unlinkChannel } from "./link";
import { esc, sendMessage, tg } from "./telegram";
import { toEn, toFa } from "./util";
import { siteLoginUrl } from "./deck-service";
import { isBaleId } from "./bale-format";
import { sendWelcomeOnce } from "./safir";

type Btn = { text: string; callback_data?: string; url?: string };
const kb = (rows: Btn[][]) => ({ reply_markup: { inline_keyboard: rows } });

const stKey = (userId: number) => `pf:${userId}`;
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
  if (info.available) lines.push("", giftLine(), (await isEitaaAccount(env, user)) ? "با ثبت و تایید ایمیل (با کد)، یک‌بار اضافه می‌شود." : "به‌ازای هر مورد (موبایل و ایمیل جداگانه) پس از تایید با کد، یک‌بار اضافه می‌شود.");
  lines.push("", ...(await channelLines(env, uid, user, userId)));
  const rows: Btn[][] = [];
  const add: Btn[] = [];
  if (info.missing.includes("mobile")) add.push({ text: "📱 ثبت شماره‌ی موبایل", callback_data: "pf:m" });
  if (info.missing.includes("email")) add.push({ text: "✉️ ثبت ایمیل", callback_data: "pf:e" });
  if (add.length) rows.push(add);
  rows.push([{ text: "🔗 اتصال پلتفرم‌ها", callback_data: "pf:c" }]);
  rows.push([{ text: "🌐 ورود به سایت", url: await siteLoginUrl(env, userId, "home") }]);
  return sendMessage(env, chatId, lines.join("\n"), kb(rows));
}

// ---------- اتصال پلتفرم‌ها (چند پیام‌رسان همزمان؛ link.ts) ----------
/** خط‌های وضعیت اتصال: هر پیام‌رسان + اپ/مرورگر/ایمیل. «اینجا» = پیام‌رسانی که کاربر همین حالا در آن است. */
async function channelLines(env: Env, uid: string, user: { email?: string }, userId: number): Promise<string[]> {
  const [chs, dev] = await Promise.all([channelStatus(env, uid), deviceStatus(env, uid, !!user.email)]);
  const here = chanOf(userId);
  const out = ["🔗 <b>پلتفرم‌های متصل</b>"];
  for (const c of chs) {
    if (!c.connected && !c.available) continue;
    out.push(`${c.connected ? "✅" : "⬜️"} ${c.label}: ${c.connected ? `وصل است${c.key === here ? " (اینجا)" : ""} · اعلان ${c.notify ? "🔔 روشن" : "🔕 خاموش"}` : "وصل نیست"}`);
  }
  out.push(`${dev.app ? "✅" : "⬜️"} اپ اندروید · ${dev.web ? "✅" : "⬜️"} اعلان مرورگر · ${dev.email ? "✅" : "⬜️"} ایمیل`);
  return out;
}

/** پنل اتصال پلتفرم‌ها: وضعیت + روشن/خاموش‌کردن اعلان هر پیام‌رسان + جدا کردن + کد اتصال */
export async function showChannels(env: Env, chatId: number, userId: number, uid: string | number): Promise<unknown> {
  const user = typeof uid === "string" ? await getUserById(env, uid) : null;
  if (!user || typeof uid !== "string") return sendMessage(env, chatId, "🔗 برای حساب مدیر اتصال چند پلتفرم فعال نیست.");
  const chs = await channelStatus(env, uid);
  const lines = [
    ...(await channelLines(env, uid, user, userId)),
    "",
    "هر پیام‌رسانی که وصل کنی اعتبار، پلن و فایل‌هایت همان‌جا هم یکی است و اعلان‌ها (رسید، پایان پلن، یادآوری‌ها) به <b>همه‌ی پیام‌رسان‌های روشن</b> می‌رسد.",
    "",
    user.mobile
      ? `➕ <b>اتصال پلتفرم دیگر:</b> در ربات/برنامک همان پلتفرم، همین شماره (<code>${esc(user.mobile)}</code>) را تایید کن؛ همان لحظه به این حساب وصل می‌شود.`
      : "➕ <b>اتصال پلتفرم دیگر:</b> اول شماره‌ی موبایلت را ثبت و تایید کن (/profile)؛ بعد در هر پلتفرم دیگر همان شماره را تایید کن تا به همین حساب وصل شود.",
  ];
  const rows: Btn[][] = [];
  for (const c of chs.filter((x) => x.connected)) {
    const r: Btn[] = [{ text: `${c.notify ? "🔔" : "🔕"} ${c.label}: اعلان ${c.notify ? "روشن" : "خاموش"}`, callback_data: `pf:n:${c.key}` }];
    if (c.canUnlink) r.push({ text: "❌ جدا کردن", callback_data: `pf:u:${c.key}` });
    rows.push(r);
  }
  if (!user.mobile && otpEnabled(env)) rows.push([{ text: "📱 ثبت شماره‌ی موبایل", callback_data: "pf:m" }]);
  return sendMessage(env, chatId, lines.join("\n"), kb(rows));
}

/** دکمه‌های pf:m (ثبت موبایل) | pf:e (ثبت ایمیل) | pf:x (لغو) */
export async function handleProfileCallback(env: Env, cq: any, userId: number, chatId: number, action: string, arg?: string): Promise<void> {
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
  if (action === "c" || action === "n" || action === "u" || action === "U") {
    const uid0 = await resolveUid(env, userId);
    if (typeof uid0 !== "string") return void (await sendMessage(env, chatId, "🔗 برای حساب مدیر اتصال چند پلتفرم فعال نیست."));
    if (action === "c") { await showChannels(env, chatId, userId, uid0); return; }
    if (!isChan(arg)) return;
    if (action === "n") {
      const cur = (await channelStatus(env, uid0)).find((c) => c.key === arg);
      if (!cur?.connected) return;
      await setChannelNotify(env, uid0, arg, !cur.notify);
      await showChannels(env, chatId, userId, uid0);
      return;
    }
    if (action === "u") { // تایید قبل از جدا کردن
      await sendMessage(env, chatId, `❌ ${CHAN_LABEL[arg]} از حساب جدا شود؟ دیگر اعلان نمی‌گیرد و با آن وارد این حساب نمی‌شوی (هر وقت خواستی دوباره وصل کن).`,
        kb([[{ text: "✅ بله، جدا کن", callback_data: `pf:U:${arg}` }, { text: "✖️ انصراف", callback_data: "pf:c" }]]));
      return;
    }
    const r = await unlinkChannel(env, uid0, arg);
    await sendMessage(env, chatId, "error" in r ? `⚠️ ${esc(r.error)}` : `✅ ${CHAN_LABEL[arg]} از حساب جدا شد.`);
    return;
  }
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


// ---------- درخواست اختیاری شماره بعد از دکمه‌ی «ساخت» (ربات تلگرام و بله) ----------
// مثل مینی‌اپ: تا وقتی شماره ثبت نشده، بعد از هر شروع ساخت پرسیده می‌شود؛ ساخت ارائه هیچ‌وقت منتظر جواب نمی‌ماند.
// دکمه‌ی request_contact در کیبورد پاسخ (تلگرام و بله هر دو پشتیبانی می‌کنند) شماره را به‌صورت پیام «مخاطب» می‌فرستد
// و handleSharedContact بدون OTP ثبتش می‌کند (فقط اگر contact.user_id == from.id).
export const SKIP_CONTACT_TEXT = "⏭ فعلاً نه";
const REMOVE_KB = { reply_markup: { remove_keyboard: true } };
const isTgOrBale = (env: Env, chatId: number): boolean => isBaleId(chatId) || (env.PLATFORM !== "bale" && env.PLATFORM !== "rubika" && env.PLATFORM !== "splus" && chatId > 0 && chatId < 100_000_000_000_000);

export async function askShareContact(env: Env, chatId: number, uid: string | number): Promise<void> {
  try {
    if (!isTgOrBale(env, chatId) || typeof uid !== "string") return; // ایتا/روبیکا/سروش پلاس و حساب مدیر: نه
    const user = await getUserById(env, uid);
    if (!user || user.mobile) return;
    // هدیه فقط وقتی ذکر می‌شود که هدیه‌ی «موبایل» این حساب هنوز گرفته نشده باشد (هر مورد یک‌بار هدیه دارد)
    const gift = CONTACT_CREDITS > 0 && !(await hasContactReward(env, user.id, "mobile").catch(() => true));
    await sendMessage(env, chatId,
      "📱 <b>ثبت شماره (اختیاری)</b>\nاگر دوست داری شماره‌ات روی حسابت ثبت شود، دکمه‌ی زیر را بزن. ساخت ارائه‌ات به این بستگی ندارد و همین حالا ادامه دارد." + (gift ? `\n\n${giftLine()}` : ""),
      { reply_markup: { keyboard: [[{ text: "📱 اشتراک‌گذاری شماره‌ام", request_contact: true }], [{ text: SKIP_CONTACT_TEXT }]], resize_keyboard: true, one_time_keyboard: true } });
  } catch (e) { console.error("askShareContact", e instanceof Error ? e.message.slice(0, 200) : e); }
}

/** دکمه‌ی «فعلاً نه»: فقط کیبورد را برمی‌دارد. true = پیام همین بود و تمام شد. */
export async function handleContactSkip(env: Env, chatId: number, text: string): Promise<boolean> {
  if (text !== SKIP_CONTACT_TEXT) return false;
  await sendMessage(env, chatId, "باشه 👍 هر وقت خواستی از /profile ثبتش کن.", REMOVE_KB).catch(() => {});
  return true;
}

/** پیام «مخاطب» که کاربر از Mini App (دکمه‌ی ساخت ← requestContact تلگرام/بله) به ربات فرستاده؛ شماره‌ی خود کاربر بدون کد پیامکی ثبت می‌شود.
 *  فقط وقتی user_id مخاطب با فرستنده یکی باشد (یعنی شماره‌ی خود فرستنده است، نه مخاطبِ فوروارد/دلخواه) و کاربر شماره‌ای نداشته باشد.
 *  true = پیام مخاطب بود و همین‌جا تمام شد. هر خطا فقط لاگ می‌شود و ساخت ارائه به آن وابسته نیست. */
export async function handleSharedContact(env: Env, msg: any, userId: number, chatId: number): Promise<boolean> {
  const c = msg?.contact;
  if (!c) return false;
  if (Number(c.user_id) !== userId) return true; // شماره‌ی شخص دیگر: نادیده گرفته می‌شود
  const mobile = normMobile(String(c.phone_number ?? "").replace(/[\s()-]/g, ""));
  if (!mobile) return true;
  const uid = await resolveUid(env, userId);
  const user = typeof uid === "string" ? await getUserById(env, uid) : null;
  if (!user || user.mobile) return true;
  const r = await attachContact(env, user, "mobile", mobile, "", userId, true);
  if ("error" in r) { console.error("shared contact", r.status, r.error.slice(0, 120)); return true; }
  // پیام خوش‌آمد بله (سفیر؛ یک‌بار برای هر شماره، مثل ثبت با OTP و ایتا). اگر شماره بله ندارد یا خطا بخورد بی‌صدا رد می‌شود و جلوی ثبت را نمی‌گیرد.
  if (!r.merged) await sendWelcomeOnce(env, mobile).catch(() => {});
  await sendMessage(env, chatId, r.merged
    ? "✅ شماره‌ات ثبت شد و این حساب به حساب سایتِ دارنده‌ی آن وصل شد؛ اعتبار و فایل‌هایت در همه‌ی پلتفرم‌ها یکی است."
    : "✅ شماره‌ات ثبت شد." + (r.reward > 0 ? `\n\n🎁 <b>${toFa(String(r.reward))} اعتبار هدیه</b> به حسابت اضافه شد.` : ""), REMOVE_KB).catch(() => {});
  return true;
}
