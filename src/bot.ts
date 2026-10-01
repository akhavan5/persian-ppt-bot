import type { Env } from "./env";
import type { DeckParams, Settings } from "./types";
import { FONTS, THEMES, TONES } from "./themes";
import { bumpDaily, clampSlides, dailyLimit, getSettings, isAllowed, saveSettings, SLIDE_CHOICES } from "./settings";
import { editMessage, esc, sendMessage, tg } from "./telegram";
import { toEn, toFa } from "./util";

const HELP =
  "سلام! 👋\n" +
  "من ربات <b>ساخت پاورپوینت فارسی</b> هستم.\n\n" +
  "📝 فقط <b>موضوع ارائه</b> را بفرست؛ کمی بعد فایل PPTX آماده (راست‌به‌چپ و قابل ویرایش در پاورپوینت) را همین‌جا می‌گیری.\n\n" +
  "مثال:\n<code>هوش مصنوعی در آموزش، ۱۰ اسلاید</code>\n\n" +
  "⚙️ /settings ← تغییر تم، لحن، فونت و تعداد پیش‌فرض اسلاید\n" +
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
  if (!chatId || !mid || !isAllowed(env, userId)) return void tg(env, "answerCallbackQuery", { callback_query_id: cq.id });

  const [act, a, b] = String(cq.data ?? "").split(":");
  const s = await getSettings(env, userId);
  let view = mainMenu(s);

  if (act === "x") {
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
    return void tg(env, "deleteMessage", { chat_id: chatId, message_id: mid }).catch(() => {});
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

// ---------- ورودی اصلی ----------
export async function handleUpdate(env: Env, update: any): Promise<void> {
  if (update.callback_query) return handleCallback(env, update.callback_query);

  const msg = update.message;
  if (!msg || msg.chat?.type !== "private" || !msg.from) return; // فقط گفتگوی خصوصی
  const chatId: number = msg.chat.id;
  const userId: number = msg.from.id;
  const text: string = (msg.text ?? "").trim();

  const cmd = text.startsWith("/") ? text.split(/[\s@]/)[0].toLowerCase() : "";
  if (cmd === "/id") return void sendMessage(env, chatId, `شناسه‌ی عددی شما: <code>${userId}</code>`);

  if (!isAllowed(env, userId)) {
    return void sendMessage(env, chatId, `⛔️ این ربات خصوصی است و شما دسترسی ندارید.\nشناسه‌ی شما: <code>${userId}</code>`);
  }
  if (cmd === "/start" || cmd === "/help") return void sendMessage(env, chatId, HELP);
  if (cmd === "/settings") {
    const { text: t, ...extra } = mainMenu(await getSettings(env, userId));
    return void sendMessage(env, chatId, t, extra);
  }
  if (cmd) return void sendMessage(env, chatId, "دستور ناشناخته است. /start را بزن.");
  if (!text) return void sendMessage(env, chatId, "لطفاً موضوع ارائه را به‌صورت <b>متن</b> بفرست.");

  const { topic, slides } = extractSlideCount(text);
  if (topic.length < 3) return void sendMessage(env, chatId, "موضوع خیلی کوتاه است؛ کمی کامل‌تر بنویس.");
  if (topic.length > 600) return void sendMessage(env, chatId, "موضوع بیش از حد طولانی است (حداکثر ۶۰۰ کاراکتر).");

  const quota = await bumpDaily(env, userId);
  if (!quota.ok) {
    return void sendMessage(env, chatId, `⏳ سقف روزانه (${toFa(String(quota.limit))} ارائه) پر شده است. فردا دوباره امتحان کن.`);
  }

  const settings = await getSettings(env, userId);
  if (slides) settings.slides = slides;

  const status = await sendMessage(env, chatId,
    `⏳ در حال آماده‌سازی ارائه‌ی «${esc(topic)}» (${toFa(String(settings.slides))} اسلاید)…\nمعمولاً ۱ تا ۲ دقیقه طول می‌کشد.`);

  const params: DeckParams = { chatId, statusMessageId: status.message_id, userId, topic, settings };
  try {
    await env.DECK_WORKFLOW.create({ id: `d-${update.update_id}`, params });
  } catch (e) {
    console.error("workflow create failed", e);
    await editMessage(env, chatId, status.message_id, "❌ شروع ساخت ارائه ممکن نشد. چند دقیقه بعد دوباره امتحان کن.");
  }
}
