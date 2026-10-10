import type { Env } from "./env";
import { editMessage, esc, sendDocument, sendMessage, tg } from "./telegram";
import { getBonus, getCredit, getRecentUsers, getStats, getUserSeen, isAdmin, isBanned, setBanned, setBonus, type Uid } from "./settings";
import { getUserById } from "./auth";
import { resolveUid } from "./link";
import { getDeckLog, loadFile } from "./files";
import { toEn, toFa } from "./util";

export const ADMIN_CMDS = new Set(["/admin", "/stats", "/broadcast", "/grant", "/user", "/users", "/decks", "/ban", "/unban"]);

/** لینک پروفایل: با نام کاربری → t.me/نام_کاربری، وگرنه لینک tg://user (برای کاربرانی که با ربات گفتگو داشته‌اند کار می‌کند) */
const userLink = (id: Uid, name?: string | null, username?: string | null) => {
  if (typeof id === "string") return `<b>${esc(name || id)}</b> 🌐`; // کاربر وب: پروفایل تلگرام ندارد
  const uname = username && /^[A-Za-z0-9_]{3,64}$/.test(username) ? username : null;
  const label = esc(name || (uname ? "@" + uname : String(id)));
  return `<a href="${uname ? `https://t.me/${uname}` : `tg://user?id=${id}`}">${label}</a>`;
};

/** زمان به وقت ایران، مثلاً ۲۰۲۶-۱۰-۰۲ ۱۵:۳۰ */
const fmtTime = (t: number | string) =>
  toFa(new Date(t).toLocaleString("sv-SE", { timeZone: "Asia/Tehran" }).slice(0, 16));

/** شناسه‌ی تلگرام (عدد) یا شناسه‌ی کاربر وب (w_ + ۱۶ نویسه‌ی هگز) */
const parseId = (s?: string): Uid | null => {
  const v = toEn(s ?? "").trim();
  if (/^w_[0-9a-f]{16}$/.test(v)) return v;
  return /^\d{1,15}$/.test(v) ? Number(v) : null;
};

const ADMIN_HELP =
  "🛠 <b>دستورهای مدیر</b>\n\n" +
  "/stats ← آمار امروز و ۷ روز اخیر\n" +
  "/broadcast <code>متن</code> ← پیام همگانی به همه‌ی کاربران (با تایید)\n" +
  "/users ← ۱۰ کاربر اخیر (نام + لینک پروفایل)\n" +
  "/decks ← ۱۰ ارائه‌ی اخیر ساخته‌شده (با دکمه‌ی دریافت فایل)\n" +
  "/user <code>شناسه</code> ← وضعیت و اعتبار یک کاربر\n" +
  "/grant <code>شناسه تعداد</code> ← افزودن اعتبار (عدد منفی = کم کردن)\n" +
  "<i>برای کاربر وب، شناسه‌ی w_… که در پیام خرید می‌آید را بنویس.</i>\n" +
  "/ban <code>شناسه</code> ← مسدود کردن کاربر\n" +
  "/unban <code>شناسه</code> ← رفع انسداد\n\n" +
  "<i>شناسه‌ی عددی کاربر را خودش با /id می‌تواند ببیند.</i>";

export async function handleAdmin(env: Env, chatId: number, cmd: string, args: string[], raw = "") {
  const reply = (t: string) => sendMessage(env, chatId, t);

  if (cmd === "/admin") return reply(ADMIN_HELP);

  if (cmd === "/stats") {
    const s = await getStats(env);
    const fa = (n: number) => toFa(String(n));
    const rate = s.week.ok + s.week.fail > 0 ? Math.round((s.week.ok / (s.week.ok + s.week.fail)) * 100) : null;
    return reply(
      "📊 <b>آمار</b>\n" +
      `👥 کاربران ثبت‌شده: ${fa(s.users)}\n\n` +
      "<b>امروز (UTC)</b>\n" +
      `🆕 کاربر جدید: ${fa(s.today.newusers)}\n` +
      `▶️ شروع‌شده: ${fa(s.today.started)}\n` +
      `✅ موفق: ${fa(s.today.ok)}\n` +
      `❌ ناموفق: ${fa(s.today.fail)}\n\n` +
      "<b>۷ روز اخیر</b>\n" +
      `🆕 کاربر جدید: ${fa(s.week.newusers)}\n` +
      `▶️ شروع‌شده: ${fa(s.week.started)}\n` +
      `✅ موفق: ${fa(s.week.ok)}\n` +
      `❌ ناموفق: ${fa(s.week.fail)}` +
      (rate === null ? "" : `\n📈 نرخ موفقیت: ${fa(rate)}٪`) +
      "\n\n<i>«کاربر جدید» از زمان فعال شدن این قابلیت شمرده می‌شود.</i>");
  }

  if (cmd === "/users") {
    const list = await getRecentUsers(env);
    if (!list.length) return reply("هنوز کاربری ثبت نشده است؛ از این به بعد با پیام هر کاربر در این فهرست ثبت می‌شود.");
    const lines = list.map((x, i) =>
      `${toFa(String(i + 1))}. ${userLink(x.id, x.n, x.u)}${x.u ? ` (@${esc(x.u)})` : ""}\n` +
      `    🆔 <code>${x.id}</code> · 🕒 ${fmtTime(x.t)}`);
    return reply(`👥 <b>${toFa(String(list.length))} کاربر اخیر</b> (بر اساس آخرین پیام، به وقت ایران)\n\n${lines.join("\n")}\n\n<i>برای دیدن اعتبار و وضعیت: /user شناسه</i>`);
  }

  if (cmd === "/decks") {
    const list = await getDeckLog(env);
    if (!list.length) return reply("هنوز ارائه‌ای ثبت نشده است؛ از این به بعد هر ارائه‌ی ساخته‌شده در این فهرست ثبت می‌شود.");
    const lines = list.map((x, i) =>
      `${toFa(String(i + 1))}. <b>${esc(x.title.slice(0, 60))}</b> (${toFa(String(x.slides))} اسلاید)\n` +
      `    👤 ${userLink(x.userId, x.n, x.u)} · <code>${x.userId}</code> · 🕒 ${fmtTime(x.t)}` +
      (x.o ? `\n    ✍️ <i>${esc(x.o.slice(0, 200))}</i>` : ""));
    // فایل‌ها فقط ۲۴ ساعت (و ۳ فایل آخر هر کاربر) نگه داشته می‌شوند؛ برای قدیمی‌تر دکمه نمی‌گذاریم
    const fresh = Date.now() - 24 * 3600 * 1000;
    const buttons = list
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => x.t > fresh)
      .map(({ x, i }) => [{ text: `📥 ${toFa(String(i + 1))}. ${x.title.slice(0, 30)}`, callback_data: `af:${x.userId}:${x.id}` }]);
    return await sendMessage(env, chatId,
      `🗂 <b>${toFa(String(list.length))} ارائه‌ی اخیر</b> (به وقت ایران)\n\n${lines.join("\n")}` +
      (buttons.length ? "\n\n<i>دکمه‌ها فقط برای فایل‌های ۲۴ ساعت اخیر هستند.</i>" : ""),
      buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {});
  }

  if (cmd === "/broadcast") {
    const body = raw.replace(/^\S+\s*/, "").trim(); // متن خام با خط‌های جدید
    if (!body) return reply("متن پیام را بعد از دستور بنویس؛ مثلاً:\n<code>/broadcast سلام! قابلیت جدید اضافه شد.</code>");
    if (body.length > 3500) return reply("متن بیش از حد طولانی است (حداکثر ۳۵۰۰ کاراکتر).");
    await env.KV.put(`bc:${chatId}`, body, { expirationTtl: 600 });
    const { users } = await getStats(env, 1);
    return await sendMessage(env, chatId,
      `📣 <b>پیش‌نمایش پیام همگانی</b>\n\n${esc(body)}\n\n— — —\nبه حدود ${toFa(String(users))} کاربر ارسال می‌شود.`,
      { reply_markup: { inline_keyboard: [[{ text: "✅ ارسال برای همه", callback_data: "bc:y" }, { text: "❌ لغو", callback_data: "bc:n" }]] } });
  }

  const id = parseId(args[0]);
  if (id === null) return reply("شناسه‌ی عددی کاربر را بعد از دستور بنویس؛ مثلاً: <code>" + cmd + " 123456789</code>");

  if (cmd === "/grant") {
    const n = Math.trunc(Number(toEn(args[1] ?? "")));
    if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1000) return reply("تعداد باید یک عدد صحیح غیر صفر و حداکثر ۱۰۰۰ باشد؛ مثلاً: <code>/grant " + id + " 10</code>");
    // اعتبار هر کاربر ربات روی شناسه‌ی پروفایل وبش نگه‌داری می‌شود (نه شناسه‌ی عددی تلگرام)؛ مدیرها شناسه‌ی عددی می‌مانند
    const acct = typeof id === "number" ? await resolveUid(env, id) : id;
    const before = await getBonus(env, acct);
    const after = Math.max(0, before + n);
    await setBonus(env, acct, after);
    let note = typeof id === "number" && isAdmin(env, id) ? "\nℹ️ این کاربر مدیر است و اعتبارش نامحدود؛ اعتبار اضافه برایش مصرف نمی‌شود." : "";
    if (n > 0 && typeof id === "number") { // کاربر وب پیام تلگرام نمی‌گیرد؛ اعتبارش را در صفحه می‌بیند
      try {
        await sendMessage(env, id, `🎁 ${toFa(String(n))} ارائه به اعتبار شما اضافه شد. برای دیدن اعتبار: /credit`);
      } catch {
        note += "\n⚠️ پیام اطلاع‌رسانی به کاربر نرسید (احتمالاً هنوز ربات را شروع نکرده).";
      }
    }
    return reply(`✅ اعتبار اضافه‌ی <code>${id}</code>: ${toFa(String(before))} ← ${toFa(String(after))}${note}`);
  }

  if (cmd === "/ban") {
    if (isAdmin(env, id)) return reply("مدیر را نمی‌شود مسدود کرد.");
    await setBanned(env, id, true);
    return reply(`⛔️ کاربر <code>${id}</code> مسدود شد.`);
  }
  if (cmd === "/unban") {
    await setBanned(env, id, false);
    return reply(`✅ انسداد کاربر <code>${id}</code> برداشته شد.`);
  }

  if (cmd === "/user") {
    const web = typeof id === "string" ? await getUserById(env, id) : null;
    const acct = typeof id === "number" ? await resolveUid(env, id) : id; // اعتبار روی شناسه‌ی پروفایل وب است
    const [seen, banned, c] = await Promise.all([typeof id === "number" ? getUserSeen(env, id) : Promise.resolve(null), isBanned(env, id), getCredit(env, acct)]);
    const credit = c.unlimited
      ? "نامحدود"
      : `${toFa(String(c.dailyLeft))} از ${toFa(String(c.limit))} (امروز) + ${toFa(String(c.plan))} پلن + ${toFa(String(c.bonus))} اضافه`;
    if (typeof id === "string") {
      return reply(
        `🌐 <b>کاربر وب</b> <code>${id}</code>\n` +
        `نام: ${web?.name ? esc(web.name) : "—"}\n` +
        `ایمیل: ${web?.email ? esc(web.email) : "—"}\n` +
        `موبایل: ${web?.mobile ? esc(web.mobile) : "—"}\n` +
        `ثبت‌نام: ${web ? new Date(web.created).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "ناموجود"}\n` +
        `اعتبار: ${credit}\n` +
        `وضعیت: ${banned ? "⛔️ مسدود" : "فعال"}`);
    }
    return reply(
      `👤 <b>کاربر</b> <code>${id}</code>\n` +
      `نام: ${seen?.n ? esc(seen.n) : "—"}\n` +
      `نام کاربری: ${seen?.u ? "@" + esc(seen.u) : "—"}\n` +
      `پروفایل: ${userLink(id, seen?.n || "باز کردن پروفایل", seen?.u)}\n` +
      `اولین پیام: ${seen ? seen.t.slice(0, 16).replace("T", " ") + " UTC" : "هرگز"}\n` +
      `اعتبار: ${credit}\n` +
      `وضعیت: ${banned ? "⛔️ مسدود" : "فعال"}`);
  }
  return reply("دستور ناشناخته است.");
}

/** دکمه‌های تایید/لغو پیام همگانی (فقط مدیر) */
export async function handleBroadcastCallback(env: Env, cq: any) {
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
  const chatId: number = cq.message.chat.id, mid: number = cq.message.message_id;
  if (!isAdmin(env, cq.from.id)) return;
  const key = `bc:${chatId}`;
  const act = String(cq.data ?? "").split(":")[1];
  const text = await env.KV.get(key);
  if (act === "n") {
    await env.KV.delete(key);
    return await editMessage(env, chatId, mid, "❌ ارسال همگانی لغو شد.");
  }
  if (text === null) return await editMessage(env, chatId, mid, "⌛️ این پیش‌نویس منقضی شده است؛ دوباره /broadcast بزن.");
  await env.KV.delete(key); // جلوگیری از ارسال دوباره با دو بار زدن دکمه
  try {
    await env.BROADCAST_WORKFLOW.create({ id: `bc-${Date.now()}`, params: { adminChatId: chatId, text } });
  } catch (e) {
    console.error("broadcast create failed", e);
    return await editMessage(env, chatId, mid, "❌ شروع ارسال ممکن نشد. دوباره امتحان کن.");
  }
  await editMessage(env, chatId, mid, "⏳ ارسال همگانی شروع شد. وقتی تمام شد، گزارش را همین‌جا می‌فرستم.");
}

/** دکمه‌ی «📥» در /decks: فایل ارائه‌ی هر کاربر را (اگر هنوز نگه داشته شده باشد) برای مدیر می‌فرستد */
export async function handleAdminFileCallback(env: Env, cq: any) {
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
  if (!isAdmin(env, cq.from.id)) return;
  const chatId: number = cq.message.chat.id;
  const [, uid, fid] = String(cq.data ?? "").split(":");
  const userId: Uid = /^w_[0-9a-f]{16}$/.test(uid ?? "") ? uid : Number(uid);
  const f = (typeof userId === "string" || Number.isSafeInteger(userId)) && fid ? await loadFile(env, userId, fid) : null;
  if (!f) return await sendMessage(env, chatId, "⌛️ این فایل دیگر در دسترس نیست (فایل‌ها ۲۴ ساعت و حداکثر ۳ فایل آخر هر کاربر نگه داشته می‌شوند).");
  await sendDocument(env, chatId, new Uint8Array(f.data), f.entry.name, `✅ <b>${esc(f.entry.title)}</b>\n👤 <code>${userId}</code>`);
}
