import type { Env } from "./env";
import { editMessage, esc, sendMessage, tg } from "./telegram";
import { getBonus, getCredit, getStats, getUserSeen, isAdmin, isBanned, setBanned, setBonus } from "./settings";
import { toEn, toFa } from "./util";

export const ADMIN_CMDS = new Set(["/admin", "/stats", "/broadcast", "/grant", "/user", "/ban", "/unban"]);

const parseId = (s?: string) => {
  const v = toEn(s ?? "").trim();
  return /^\d{1,15}$/.test(v) ? Number(v) : null;
};

const ADMIN_HELP =
  "🛠 <b>دستورهای مدیر</b>\n\n" +
  "/stats ← آمار امروز و ۷ روز اخیر\n" +
  "/broadcast <code>متن</code> ← پیام همگانی به همه‌ی کاربران (با تایید)\n" +
  "/user <code>شناسه</code> ← وضعیت و اعتبار یک کاربر\n" +
  "/grant <code>شناسه تعداد</code> ← افزودن اعتبار (عدد منفی = کم کردن)\n" +
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
    const before = await getBonus(env, id);
    const after = Math.max(0, before + n);
    await setBonus(env, id, after);
    let note = "";
    if (n > 0) {
      try {
        await sendMessage(env, id, `🎁 ${toFa(String(n))} ارائه به اعتبار شما اضافه شد. برای دیدن اعتبار: /credit`);
      } catch {
        note = "\n⚠️ پیام اطلاع‌رسانی به کاربر نرسید (احتمالاً هنوز ربات را شروع نکرده).";
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
    const [seen, banned, c] = await Promise.all([getUserSeen(env, id), isBanned(env, id), getCredit(env, id)]);
    const credit = c.unlimited
      ? "نامحدود"
      : `${toFa(String(c.dailyLeft))} از ${toFa(String(c.limit))} (امروز) + ${toFa(String(c.bonus))} اضافه`;
    return reply(
      `👤 <b>کاربر</b> <code>${id}</code>\n` +
      `نام کاربری: ${seen?.u ? "@" + seen.u : "—"}\n` +
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
