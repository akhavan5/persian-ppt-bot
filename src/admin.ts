import type { Env } from "./env";
import { sendMessage } from "./telegram";
import { getBonus, getCredit, getStats, getUserSeen, isAdmin, isBanned, setBanned, setBonus } from "./settings";
import { toEn, toFa } from "./util";

export const ADMIN_CMDS = new Set(["/admin", "/stats", "/grant", "/user", "/ban", "/unban"]);

const parseId = (s?: string) => {
  const v = toEn(s ?? "").trim();
  return /^\d{1,15}$/.test(v) ? Number(v) : null;
};

const ADMIN_HELP =
  "🛠 <b>دستورهای مدیر</b>\n\n" +
  "/stats ← آمار کاربران و ارائه‌های امروز\n" +
  "/user <code>شناسه</code> ← وضعیت و اعتبار یک کاربر\n" +
  "/grant <code>شناسه تعداد</code> ← افزودن اعتبار (عدد منفی = کم کردن)\n" +
  "/ban <code>شناسه</code> ← مسدود کردن کاربر\n" +
  "/unban <code>شناسه</code> ← رفع انسداد\n\n" +
  "<i>شناسه‌ی عددی کاربر را خودش با /id می‌تواند ببیند.</i>";

export async function handleAdmin(env: Env, chatId: number, cmd: string, args: string[]) {
  const reply = (t: string) => sendMessage(env, chatId, t);

  if (cmd === "/admin") return reply(ADMIN_HELP);

  if (cmd === "/stats") {
    const s = await getStats(env);
    return reply(
      "📊 <b>آمار</b>\n" +
      `👥 کاربران ثبت‌شده: ${toFa(String(s.users))}\n\n` +
      "<b>امروز (UTC)</b>\n" +
      `▶️ شروع‌شده: ${toFa(String(s.started))}\n` +
      `✅ موفق: ${toFa(String(s.ok))}\n` +
      `❌ ناموفق: ${toFa(String(s.fail))}`);
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
