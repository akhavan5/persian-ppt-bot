import type { Env } from "./env";
import type { DeckParams, Settings } from "./types";
import { FONTS, THEMES, TONES } from "./themes";
import {
  acquireLock, bumpStat, clampSlides, getCredit, getSettings, isAdmin, isAllowed, isBanned, isLocked,
  refundCredit, releaseLock, saveSettings, SLIDE_CHOICES, SUPPORT_CONTACT, spendCredit, touchUser,
} from "./settings";
import { ADMIN_CMDS, handleAdmin } from "./admin";
import { editMessage, esc, sendMessage, tg } from "./telegram";
import { toEn, toFa } from "./util";

const HELP =
  "سلام! 👋\n" +
  "من ربات <b>ساخت پاورپوینت فارسی</b> هستم.\n\n" +
  "📝 فقط <b>موضوع ارائه</b> را بفرست؛ کمی بعد فایل PPTX آماده (راست‌به‌چپ و قابل ویرایش در پاورپوینت) را همین‌جا می‌گیری.\n\n" +
  "مثال:\n<code>هوش مصنوعی در آموزش، ۱۰ اسلاید</code>\n\n" +
  "⚙️ /settings ← تغییر تم، لحن، فونت و تعداد پیش‌فرض اسلاید\n" +
  "💳 /credit ← اعتبار باقی‌مانده‌ی امروز\n" +
  "ℹ️ متن اسلایدها را پیش از ارائه بررسی کن؛ مدل ممکن است اطلاعات نادرست بنویسد.";

type Btn = { text: string; callback_data: string };
const kb = (rows: Btn[][]) => ({ reply_markup: { inline_keyboard: rows } });

// ---------- منوی تنظیمات ----------
function mainMenu(s: Settings) {
  const rows: Btn[][] = [
    [{ text: `🎨 تم: ${THEMES[s.theme].name}`, callback_data: "m:theme" }, { text: `🗣 لحن: ${TONES[s.tone]}`, callback_data: "m:tone" }],
    [{ text: `🔤 فونت: ${s.font}`, callback_data: "m:font" }, { text: `📄 اسلاید: ${toFa(String(s.slides))}`, callback_data: "m:slides" }],
    [{ text: `🖼 تصویر: ${s.images ? "روشن" : "خاموش"}`, callback_data: "t:images" }, { text: `🔢 ارقام: ${s.digits ? "فارسی" : "انگلیسی"}`, callback_data: "t:digits" }],
    [{ text: "✅ بستن", callback_data: "x:close" }],
  ];
  return { text: "⚙️ <b>تنظیمات</b>\nگزینه‌ای را برای تغییر انتخاب کن:", ...kb(rows) };
}

function subMenu(kind: string, s: Settings) {
  const mark = (on: boolean, t: string) => (on ? `✔️ ${t}` : t);
  let title = "", opts: Btn[] = [];
  if (kind === "theme") {
    title = "🎨 تم رنگی";
    opts = Object.entries(THEMES).map(([k, v]) => ({ text: mark(s.theme === k, v.name), callback_data: `v:theme:${k}` }));
  } else if (kind === "tone") {
    title = "🗣 لحن متن";
    opts = Object.entries(TONES).map(([k, v]) => ({ text: mark(s.tone === k, v), callback_data: `v:tone:${k}` }));
  } else if (kind === "font") {
    title = "🔤 فونت\n<i>Vazirmatn باید روی دستگاه نمایش‌دهنده نصب باشد؛ Tahoma و Arial همه‌جا کار می‌کنند.</i>";
    opts = FONTS.map((f) => ({ text: mark(s.font === f, f), callback_data: `v:font:${f}` }));
  } else {
    title = "📄 تعداد اسلاید پیش‌فرض\n<i>در متن پیام هم می‌توانی بنویسی «۱۲ اسلاید».</i>";
    opts = SLIDE_CHOICES.map((n) => ({ text: mark(s.slides === n, toFa(String(n))), callback_data: `v:slides:${n}` }));
  }
  const rows: Btn[][] = [];
  for (let i = 0; i < opts.length; i += 2) rows.push(opts.slice(i, i + 2));
  rows.push([{ text: "◀️ بازگشت", callback_data: "b:main" }]);
  return { text: title, ...kb(rows) };
}

async function handleCallback(env: Env, cq: any) {
  const userId: number = cq.from.id;
  const chatId: number = cq.message?.chat?.id;
  const mid: number = cq.message?.message_id;
  const blocked = !chatId || !mid || !isAllowed(env, userId) || (!isAdmin(env, userId) && (await isBanned(env, userId)));
  if (blocked) return await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });

  const [act, a, b] = String(cq.data ?? "").split(":");
  const s = await getSettings(env, userId);
  let view = mainMenu(s);

  if (act === "x") {
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
    return await tg(env, "deleteMessage", { chat_id: chatId, message_id: mid }).catch(() => {});
  }
  if (act === "m") view = subMenu(a, s);
  else if (act === "t") {
    if (a === "images") s.images = !s.images;
    if (a === "digits") s.digits = !s.digits;
    await saveSettings(env, userId, s);
    view = mainMenu(s);
  } else if (act === "v") {
    if (a === "theme" && b in THEMES) s.theme = b;
    if (a === "tone" && b in TONES) s.tone = b;
    if (a === "font" && (FONTS as readonly string[]).includes(b)) s.font = b;
    if (a === "slides" && Number(b) >= 3) s.slides = clampSlides(Number(b));
    await saveSettings(env, userId, s);
    view = mainMenu(s);
  }
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  const { text, ...extra } = view;
  await editMessage(env, chatId, mid, text, extra);
}

// ---------- استخراج تعداد اسلاید از متن (مثلاً «… ، ۱۰ اسلاید») ----------
function extractSlideCount(text: string): { topic: string; slides?: number } {
  const norm = toEn(text);
  const m = norm.match(/(\d{1,2})\s*(?:اسلایدی|اسلاید|صفحه‌ای|صفحه|slides?)/i);
  if (!m) return { topic: text.trim() };
  const topic = (norm.slice(0, m.index) + " " + norm.slice((m.index ?? 0) + m[0].length))
    .replace(/\s+/g, " ").replace(/^[\s،,.:;\-–—]+|[\s،,.:;\-–—]+$/g, "");
  return { topic, slides: clampSlides(Number(m[1])) };
}

// ---------- پیام‌های اعتبار ----------
const RESET_NOTE = "<i>سهمیه‌ی روزانه هر روز ساعت ۰۳:۳۰ بامداد (به وقت ایران) دوباره پر می‌شود.</i>";
const CONTACT_NOTE = `برای افزایش اعتبار به ${SUPPORT_CONTACT} پیام بده.`;

// ---------- ورودی اصلی ----------
export async function handleUpdate(env: Env, update: any): Promise<unknown> {
  if (update.callback_query) return handleCallback(env, update.callback_query);

  const msg = update.message;
  if (!msg || msg.chat?.type !== "private" || !msg.from) return; // فقط گفتگوی خصوصی
  const chatId: number = msg.chat.id;
  const userId: number = msg.from.id;
  // نویسه‌های نامرئی جهت‌نما (RLM/LRM و …) که کیبوردهای فارسی گاهی قبل از «/» می‌گذارند حذف می‌شوند؛ ZWNJ (نیم‌فاصله) دست‌نخورده می‌ماند
  const text: string = String(msg.text ?? "").replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim();

  const cmd = text.startsWith("/") ? text.split(/[\s@]/)[0].toLowerCase() : "";
  const args = text.split(/\s+/).slice(1);
  if (cmd === "/id") return await sendMessage(env, chatId, `شناسه‌ی عددی شما: <code>${userId}</code>`);

  const admin = isAdmin(env, userId);
  if (!admin && (await isBanned(env, userId))) {
    return await sendMessage(env, chatId, "⛔️ دسترسی شما به این ربات مسدود شده است.");
  }
  if (!isAllowed(env, userId)) {
    return await sendMessage(env, chatId,
      `⛔️ این ربات خصوصی است و شما دسترسی ندارید.\nبرای دریافت دسترسی به ${SUPPORT_CONTACT} پیام بده و این شناسه را بفرست:\n<code>${userId}</code>`);
  }
  await touchUser(env, userId, msg.from.username).catch((e) => console.error("touchUser", e));

  if (admin && ADMIN_CMDS.has(cmd)) return await handleAdmin(env, chatId, cmd, args);

  if (cmd === "/credit" || cmd === "/balance") {
    const c = await getCredit(env, userId);
    let out: string;
    if (c.unlimited) out = "💳 اعتبار شما <b>نامحدود</b> است.";
    else {
      out = `💳 اعتبار باقی‌مانده: <b>${toFa(String(c.total))}</b> ارائه\n` +
        `• سهمیه‌ی امروز: ${toFa(String(c.dailyLeft))} از ${toFa(String(c.limit))}\n` +
        (c.bonus > 0 ? `• اعتبار اضافه: ${toFa(String(c.bonus))}\n` : "") +
        `\n${RESET_NOTE}` + (c.total === 0 ? `\n${CONTACT_NOTE}` : "");
    }
    return await sendMessage(env, chatId, out);
  }
  if (cmd === "/start" || cmd === "/help") return await sendMessage(env, chatId, HELP);
  if (cmd === "/settings") {
    const { text: t, ...extra } = mainMenu(await getSettings(env, userId));
    return await sendMessage(env, chatId, t, extra);
  }
  if (cmd) return await sendMessage(env, chatId, "دستور ناشناخته است. /start را بزن.");
  if (!text) return await sendMessage(env, chatId, "لطفاً موضوع ارائه را به‌صورت <b>متن</b> بفرست.");

  const { topic, slides } = extractSlideCount(text);
  if (topic.length < 3) return await sendMessage(env, chatId, "موضوع خیلی کوتاه است؛ کمی کامل‌تر بنویس.");
  if (topic.length > 600) return await sendMessage(env, chatId, "موضوع بیش از حد طولانی است (حداکثر ۶۰۰ کاراکتر).");

  // هر کاربر در هر لحظه فقط یک ارائه (قبل از کم کردن اعتبار چک می‌شود)
  if (await isLocked(env, userId)) {
    return await sendMessage(env, chatId, "⏳ ارائه‌ی قبلی شما هنوز در حال ساخته شدن است. وقتی فایلش رسید، موضوع بعدی را بفرست.");
  }

  const quota = await spendCredit(env, userId);
  if (!quota.ok) {
    return await sendMessage(env, chatId, `⏳ اعتبار شما تمام شده است.\n${CONTACT_NOTE}\n\n${RESET_NOTE}`);
  }
  await acquireLock(env, userId);

  const settings = await getSettings(env, userId);
  if (slides) settings.slides = slides;

  const undo = async () => { // اگر قبل از شروع Workflow چیزی خراب شد: اعتبار برگردد و قفل آزاد شود
    await refundCredit(env, userId, quota.source, quota.day).catch((e) => console.error("refund", e));
    await releaseLock(env, userId).catch((e) => console.error("unlock", e));
  };

  try {
    const creditLine = quota.unlimited ? "" : `\n💳 اعتبار باقی‌مانده: ${toFa(String(quota.left))}`;
    const status = await sendMessage(env, chatId,
      `⏳ در حال آماده‌سازی ارائه‌ی «${esc(topic)}» (${toFa(String(settings.slides))} اسلاید)…\nمعمولاً ۱ تا ۲ دقیقه طول می‌کشد.${creditLine}`);

    const params: DeckParams = { chatId, statusMessageId: status.message_id, userId, topic, settings, credit: quota.source, day: quota.day };
    try {
      await env.DECK_WORKFLOW.create({ id: `d-${update.update_id}`, params });
    } catch (e) {
      console.error("workflow create failed", e);
      await undo();
      return await editMessage(env, chatId, status.message_id, "❌ شروع ساخت ارائه ممکن نشد. اعتبارت برگردانده شد؛ چند دقیقه بعد دوباره امتحان کن.");
    }
    await bumpStat(env, "started").catch(() => {});
  } catch (e) {
    await undo(); // مثلاً ارسال پیام وضعیت شکست خورد
    throw e;
  }
}
