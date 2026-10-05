import type { Env } from "./env";
import type { Settings } from "./types";
import { FONTS, THEMES, TONES } from "./themes";
import {
  ABS_MAX_IMAGES, WEB_SLIDE_CHOICES, ABS_MAX_SLIDES, clampSlides, getActiveSub, getCredit, getSettings, isAdmin, isAllowed, isBanned,
  maxImagesFor, maxSlidesFor, saveSettings, supportLink, touchUser, REF_MAX, rewardReferral, displayName, noteActive, isWebId,
  type Uid,
} from "./settings";
import { ADMIN_CMDS, handleAdmin, handleAdminFileCallback, handleBroadcastCallback } from "./admin";
import { listFiles, loadFile } from "./files";
import { editMessage, esc, sendDocument, sendMessage, tg } from "./telegram";
import { toEn, toFa } from "./util";
import { modelList } from "./llm";
import { PLANS } from "./payment";
import { BUY_SITE_NOTE, beginDeck, buyKbFor, imagesLimitMsg, launchDeck, siteLoginUrl, siteUrl, slidesLimitMsg } from "./deck-service";
import { ensureUid, resolveUid } from "./link";

const HELP =
  "سلام! 👋\n" +
  "من ربات <b>ساخت پاورپوینت فارسی</b> هستم.\n\n" +
  "📝 فقط <b>موضوع ارائه</b> را بفرست؛ کمی بعد فایل PPTX آماده (راست‌به‌چپ و قابل ویرایش در پاورپوینت) را همین‌جا می‌گیری.\n\n" +
  "مثال:\n<code>هوش مصنوعی در آموزش، ۱۰ اسلاید</code>\n\n" +
  "⚙️ /settings ← تغییر تم، لحن، فونت، حالت دانشجویی، منابع و تعداد اسلاید\n" +
  "💳 /credit ← اعتبار، پلن و سقف‌های حساب\n" +
  "🌐 /site ← ورود خودکار به سایت (پلن‌ها و پرداخت آنلاین)\n" +
  "🎁 /invite ← دعوت دوستان و دریافت ارائه‌ی رایگان\n" +
  "📁 /files ← دریافت دوباره‌ی فایل‌های ۲۴ ساعت اخیر";

type Btn = { text: string; callback_data?: string; url?: string };
const kb = (rows: Btn[][]) => ({ reply_markup: { inline_keyboard: rows } });

// ---------- منوی تنظیمات ----------
/** سقف‌های حساب (بر اساس پلن)؛ همان قوانین نسخه‌ی وب */
interface Caps { maxSlides: number; maxImg: number }
const getCaps = async (env: Env, uid: Uid): Promise<Caps> => {
  const [maxSlides, maxImg] = await Promise.all([maxSlidesFor(env, uid), maxImagesFor(env, uid)]);
  return { maxSlides, maxImg };
};
const imgCountOf = (s: Settings, caps: Caps) => Math.min(caps.maxImg, s.imageCount ?? (s.images ? 1 : 0));

function mainMenu(env: Env, s: Settings, caps: Caps) {
  const models = modelList(env);
  const model = models.find((m) => m.id === s.model) ?? models[0];
  const modeBtn: Btn = { text: `🎓 حالت: ${s.mode === "student" ? "دانشجویی" : "عادی"}`, callback_data: "t:mode" };
  const n = imgCountOf(s, caps);
  const rows: Btn[][] = [
    [{ text: `🎨 تم: ${THEMES[s.theme].name}`, callback_data: "m:theme" }, { text: `🗣 لحن: ${TONES[s.tone]}`, callback_data: "m:tone" }],
    [{ text: `🔤 فونت: ${s.font}`, callback_data: "m:font" }, { text: `📄 اسلاید: ${toFa(String(Math.min(s.slides, caps.maxSlides)))}`, callback_data: "m:slides" }],
    [{ text: `🖼 تصویر: ${n ? toFa(String(n)) : "خاموش"}`, callback_data: "m:imgs" }, { text: `🔢 ارقام: ${s.digits ? "فارسی" : "انگلیسی"}`, callback_data: "t:digits" }],
    models.length > 1 ? [{ text: `🤖 مدل: ${model.name}`, callback_data: "m:model" }, modeBtn] : [modeBtn],
    [{ text: `📚 منابع: ${s.mode === "student" ? "روشن (دانشجویی)" : s.sources ? "روشن" : "خاموش"}`, callback_data: "t:sources" },
      { text: `❓ پرسش پایانی: ${s.questions ? "روشن" : "خاموش"}`, callback_data: "t:questions" }],
    [{ text: "✅ بستن", callback_data: "x:close" }],
  ];
  return { text: "⚙️ <b>تنظیمات</b>\nگزینه‌ای را برای تغییر انتخاب کن:", ...kb(rows) };
}

function subMenu(env: Env, kind: string, s: Settings, caps: Caps) {
  const mark = (on: boolean, t: string) => (on ? `✔️ ${t}` : t);
  const lock = (locked: boolean, t: string) => (locked ? `🔒 ${t}` : t);
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
  } else if (kind === "imgs") {
    const cur = imgCountOf(s, caps);
    title = `🖼 تعداد تصویر در هر ارائه\n<i>سقف حساب تو: ${toFa(String(caps.maxImg))} تصویر. گزینه‌های 🔒 با پلن پلاس/پرو باز می‌شوند.</i>`;
    opts = Array.from({ length: ABS_MAX_IMAGES + 1 }, (_, n) => ({
      text: lock(n > caps.maxImg, mark(cur === n, n === 0 ? "بدون تصویر" : toFa(String(n)))), callback_data: `v:imgs:${n}`,
    }));
  } else if (kind === "model") {
    title = "🤖 مدل هوش مصنوعی";
    opts = modelList(env).map((m, i) => ({ text: mark(s.model === m.id, m.name), callback_data: `v:model:${i}` }));
  } else {
    title = `📄 تعداد اسلاید پیش‌فرض\n<i>سقف حساب تو: ${toFa(String(caps.maxSlides))} اسلاید. گزینه‌های 🔒 با پلن پلاس/پرو باز می‌شوند. در متن پیام هم می‌توانی بنویسی «۱۲ اسلاید».</i>`;
    opts = WEB_SLIDE_CHOICES.map((n) => ({ text: lock(n > caps.maxSlides, mark(s.slides === n, toFa(String(n)))), callback_data: `v:slides:${n}` }));
  }
  const rows: Btn[][] = [];
  for (let i = 0; i < opts.length; i += 2) rows.push(opts.slice(i, i + 2));
  rows.push([{ text: "◀️ بازگشت", callback_data: "b:main" }]);
  return { text: title, ...kb(rows) };
}

async function banned(env: Env, tgId: number, uid: Uid): Promise<boolean> {
  if (isAdmin(env, tgId)) return false;
  return (await isBanned(env, tgId)) || (uid !== tgId && (await isBanned(env, uid)));
}

async function handleCallback(env: Env, cq: any) {
  const userId: number = cq.from.id;
  const chatId: number = cq.message?.chat?.id;
  const mid: number = cq.message?.message_id;
  const uid = await resolveUid(env, userId);
  const blocked = !chatId || !mid || !isAllowed(env, userId) || (await banned(env, userId, uid));
  if (blocked) return await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });

  const [act, a, b] = String(cq.data ?? "").split(":");
  if (act === "bc") return await handleBroadcastCallback(env, cq);
  if (act === "af") return await handleAdminFileCallback(env, cq);
  if (act === "f") {
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
    const f = await loadFile(env, uid, a);
    if (!f) return await sendMessage(env, chatId, "⌛️ این فایل منقضی شده است (فایل‌ها ۲۴ ساعت نگه داشته می‌شوند).");
    return await sendDocument(env, chatId, new Uint8Array(f.data), f.entry.name, `✅ <b>${esc(f.entry.title)}</b>`);
  }
  const [s, caps] = await Promise.all([getSettings(env, uid), getCaps(env, uid)]);
  let view = mainMenu(env, s, caps);
  /** گزینه‌ی قفل: پیام توضیح به‌صورت هشدار نشان داده می‌شود و تنظیمات تغییر نمی‌کند */
  const alertLimit = (text: string) => tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: text.slice(0, 200), show_alert: true });

  if (act === "x") {
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
    return await tg(env, "deleteMessage", { chat_id: chatId, message_id: mid }).catch(() => {});
  }
  if (act === "m") view = subMenu(env, a, s, caps);
  else if (act === "t") {
    if (a === "images") { s.images = !s.images; s.imageCount = s.images ? Math.min(1, caps.maxImg) : 0; } // دکمه‌های قدیمی
    if (a === "digits") s.digits = !s.digits;
    if (a === "mode") s.mode = s.mode === "student" ? "normal" : "student";
    if (a === "sources") s.sources = !s.sources;
    if (a === "questions") s.questions = !s.questions;
    await saveSettings(env, uid, s);
    view = mainMenu(env, s, caps);
  } else if (act === "v") {
    if (a === "theme" && b in THEMES) s.theme = b;
    if (a === "tone" && b in TONES) s.tone = b;
    if (a === "font" && (FONTS as readonly string[]).includes(b)) s.font = b;
    if (a === "slides" && Number(b) >= 3) {
      if (Number(b) > caps.maxSlides) return await alertLimit(slidesLimitMsg(caps.maxSlides));
      s.slides = clampSlides(Number(b), caps.maxSlides);
    }
    if (a === "imgs" && Number.isInteger(Number(b)) && Number(b) >= 0 && Number(b) <= ABS_MAX_IMAGES) {
      if (Number(b) > caps.maxImg) return await alertLimit(imagesLimitMsg(caps.maxImg));
      s.imageCount = Number(b);
      s.images = s.imageCount > 0;
    }
    if (a === "model") { const m = modelList(env)[Number(b)]; if (m) s.model = m.id; }
    await saveSettings(env, uid, s);
    view = mainMenu(env, s, caps);
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
  return { topic, slides: clampSlides(Number(m[1]), ABS_MAX_SLIDES) }; // سقف پلن در beginDeck بررسی می‌شود
}

// ---------- پیام‌های اعتبار ----------
const RESET_NOTE = "<i>سهمیه‌ی روزانه هر روز ساعت ۰۳:۳۰ بامداد (به وقت ایران) دوباره پر می‌شود.</i>";
const supportKb = (userId: number) => kb([[{ text: "💬 پیام به پشتیبانی", url: supportLink(userId) }]]);

const fmtDate = (ms: number) => {
  try { return new Date(ms).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tehran" }); }
  catch { return new Date(ms).toISOString().slice(0, 10); }
};

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
  // شناسه‌ی اصلی: اگر تلگرام به حساب سایت وصل باشد شناسه‌ی حساب سایت (اعتبار/پلن/تنظیمات/فایل مشترک)؛ وگرنه خود شناسه‌ی تلگرام
  let uid = await resolveUid(env, userId);
  if (await banned(env, userId, uid)) {
    return await sendMessage(env, chatId, "⛔️ دسترسی شما به این ربات مسدود شده است.");
  }
  if (!isAllowed(env, userId)) {
    return await sendMessage(env, chatId,
      `⛔️ این ربات خصوصی است و شما دسترسی ندارید.\nبرای دریافت دسترسی، دکمه‌ی زیر را بزن.`,
      supportKb(userId));
  }
  const name = displayName(msg.from);
  uid = await ensureUid(env, userId, name); // هر کاربر ربات از اولین پیام یک پروفایل وب (خودکار) دارد
  const isNew = await touchUser(env, userId, msg.from.username, name).catch((e) => { console.error("touchUser", e); return false; });
  if (!admin) await noteActive(env, userId, msg.from.username, name).catch((e) => console.error("noteActive", e)); // فهرست «کاربران اخیر» مدیر؛ خود مدیرها در آن نمی‌آیند

  if (admin && ADMIN_CMDS.has(cmd)) return await handleAdmin(env, chatId, cmd, args, text);

  if (cmd === "/site") {
    return await sendMessage(env, chatId, "🌐 با دکمه‌ی زیر بدون ثبت‌نام و رمز، با همین حساب تلگرامت وارد سایت می‌شوی (پلن‌ها، پرداخت آنلاین، پروفایل).",
      kb([[{ text: "🌐 ورود به سایت", url: await siteLoginUrl(env, userId, "home") }]]));
  }
  // دعوت دوستان: کاربر جدیدی که با لینک اختصاصی آمده، به دعوت‌کننده ۱ ارائه‌ی رایگان می‌دهد
  if (cmd === "/start" && isNew && args[0]?.startsWith("ref_")) {
    const inviter = Number(args[0].slice(4));
    if (await rewardReferral(env, inviter, userId, await resolveUid(env, inviter)).catch(() => false)) {
      await sendMessage(env, inviter, "🎉 یکی از دوستانت با لینک تو وارد ربات شد؛ <b>۱ ارائه‌ی رایگان</b> به اعتبارت اضافه شد. برای دیدن اعتبار: /credit").catch(() => {});
    }
  }
  if (cmd === "/files") {
    const list = await listFiles(env, uid);
    if (!list.length) return await sendMessage(env, chatId, "📁 فایلی برای ۲۴ ساعت اخیر نداری. فایل هر ارائه بعد از ساخته شدن تا ۲۴ ساعت اینجا می‌ماند.");
    return await sendMessage(env, chatId, "📁 <b>فایل‌های ۲۴ ساعت اخیر</b>\nبرای دریافت دوباره، یکی را بزن:",
      kb(list.map((f) => [{ text: `📥 ${f.title.slice(0, 40)} (${toFa(String(f.slides))} اسلاید)`, callback_data: `f:${f.id}` }])));
  }
  if (cmd === "/invite") {
    const me = await tg<{ username?: string }>(env, "getMe");
    const link = `https://t.me/${me.username}?start=ref_${userId}`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("ساخت پاورپوینت فارسی با هوش مصنوعی، مستقیم توی تلگرام 👇")}`;
    return await sendMessage(env, chatId,
      `🎁 <b>دعوت دوستان</b>\nبه ازای هر دوستی که با لینک تو وارد ربات شود، <b>۱ ارائه‌ی رایگان</b> می‌گیری (حداکثر ${toFa(String(REF_MAX))} دعوت).\n\n🔗 لینک اختصاصی تو:\n${link}`,
      kb([[{ text: "📤 ارسال به دوستان", url: share }]]));
  }

  if (cmd === "/credit" || cmd === "/balance") {
    const [c, sub, caps] = await Promise.all([getCredit(env, uid), getActiveSub(env, uid), getCaps(env, uid)]);
    const planName = sub ? (PLANS.find((p) => p.id === sub.plan)?.name ?? sub.plan) : "";
    const head = c.unlimited ? "💳 اعتبار شما <b>نامحدود</b> است.\n"
      : `💳 اعتبار باقی‌مانده: <b>${toFa(String(c.total))}</b> ارائه\n` +
        (sub ? `• اعتبار پلن: ${toFa(String(sub.credits))}\n` : `• سهمیه‌ی امروز: ${toFa(String(c.dailyLeft))} از ${toFa(String(c.limit))}\n`) +
        (c.bonus > 0 ? `• اعتبار اضافه: ${toFa(String(c.bonus))}\n` : "");
    const out = head +
      `👑 ${sub ? `پلن ${planName} تا ${fmtDate(sub.exp)}` : "پلن رایگان"}\n` +
      `📄 حداکثر ${toFa(String(caps.maxSlides))} اسلاید و 🖼 ${toFa(String(caps.maxImg))} تصویر در هر ارائه\n` +
      (c.unlimited ? "" : `\n${sub ? "" : RESET_NOTE + "\n\n"}${BUY_SITE_NOTE}`);
    return await sendMessage(env, chatId, out, c.unlimited ? undefined : await buyKbFor(env, uid, userId));
  }
  if (cmd === "/start" || cmd === "/help") {
    return await sendMessage(env, chatId, admin ? HELP + "\n\n🛠 شما مدیر هستید؛ دستورهای مدیریتی: /admin" : HELP);
  }
  if (cmd === "/settings") {
    const [s, caps] = await Promise.all([getSettings(env, uid), getCaps(env, uid)]);
    const { text: t, ...extra } = mainMenu(env, s, caps);
    return await sendMessage(env, chatId, t, extra);
  }
  if (cmd) return await sendMessage(env, chatId, "دستور ناشناخته است. /start را بزن.");
  if (!text) return await sendMessage(env, chatId, "لطفاً موضوع ارائه را به‌صورت <b>متن</b> بفرست.");

  // فرایند ساخت: همان سرویس مشترک نسخه‌ی وب (سقف پلن، اعتبار، قفل، برگشت اعتبار)
  const { topic, slides } = extractSlideCount(text);
  const begin = await beginDeck(env, uid, topic, { slides });
  if (!begin.ok) {
    const d = begin.denied;
    if (d.noCredit) return await sendMessage(env, chatId, `⏳ اعتبار شما تمام شده است.\n\n${BUY_SITE_NOTE}\n\n${RESET_NOTE}`, await buyKbFor(env, uid, userId));
    if (d.needPlan) return await sendMessage(env, chatId, `🔒 ${esc(d.error)}`, await buyKbFor(env, uid, userId));
    return await sendMessage(env, chatId, d.busy ? "⏳ ارائه‌ی قبلی شما هنوز در حال ساخته شدن است. وقتی فایلش رسید، موضوع بعدی را بفرست." : esc(d.error));
  }

  try {
    const creditLine = begin.quota.unlimited ? "" : `\n💳 اعتبار باقی‌مانده: ${toFa(String(begin.quota.left))}`;
    const status = await sendMessage(env, chatId,
      `⏳ در حال آماده‌سازی ارائه‌ی «${esc(begin.topic)}» (${toFa(String(begin.settings.slides))} اسلاید)…\nمعمولاً ۱ تا ۲ دقیقه طول می‌کشد.${creditLine}`);
    const ok = await launchDeck(env, begin, uid, `d-${update.update_id}`, { chatId, statusMessageId: status.message_id, channel: "telegram", tgId: userId });
    if (!ok) { // اعتبار و قفل را launchDeck برگردانده است
      return await editMessage(env, chatId, status.message_id, "❌ شروع ساخت ارائه ممکن نشد. اعتبارت برگردانده شد؛ چند دقیقه بعد دوباره امتحان کن.").catch(() => {});
    }
  } catch (e) {
    await begin.undo(); // مثلاً ارسال پیام وضعیت شکست خورد
    throw e;
  }
}
