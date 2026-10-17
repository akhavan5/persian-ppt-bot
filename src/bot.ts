import type { Env } from "./env";
import type { Mode, Settings } from "./types";
import { FONTS, FONT_URL, MODES, THEMES, TONES, nextMode } from "./themes";
import { DEFAULT_TEMPLATE, TEMPLATES, isTemplate, type TemplateKey } from "./template";
import {
  EXTRA_MODEL_MSG, canUseModel, hasPlanAccess, ABS_MAX_IMAGES, WEB_SLIDE_CHOICES, ABS_MAX_SLIDES, clampSlides, getActiveSub, getCredit, getSettings, isAdmin, isAllowed, isBanned,
  maxImagesFor, maxSlidesFor, saveSettings, supportLink, touchUser, REF_MAX, rewardReferral, displayName, noteActive, isWebId,
  type Uid,
} from "./settings";
import { ADMIN_CMDS, handleAdmin, handleAdminFileCallback, handleAdminInput, handleBroadcastCallback, handlePanelCallback } from "./admin";
import { listFiles, loadFile } from "./files";
import { buildDeckPdf, cachedPdf } from "./pdf";
import { hitLimit } from "./auth";
import { editMessage, esc, sendDocument, sendMessage, tg } from "./telegram";
import { toEn, toFa } from "./util";
import { modelList } from "./llm";
import { PLANS } from "./payment";
import { BUY_SITE_NOTE, beginDeck, buyKbFor, imagesLimitMsg, launchDeck, posterEnabled, runningJob, siteLoginUrl, siteUrl, slidesLimitMsg } from "./deck-service";
import { ensureUid, resolveUid } from "./link";
import { parseRequest } from "./parse";
import { SUPPORTED_NOTE, extractTelegramFile, fileRefOf, type Extracted, type TgFileRef } from "./tg-file";
import { fetchLinkSource, findLinkInText, linkCapNote, linkEnabled, linkLimitHit } from "./link-source";

const HELP =
  "سلام! 👋\n" +
  "من ربات <b>ساخت پاورپوینت فارسی</b> هستم.\n\n" +
  "📝 فقط <b>موضوع ارائه</b> را بفرست؛ بعد مرحله‌به‌مرحله <b>مدل، تعداد اسلاید و تعداد تصویر</b> را انتخاب می‌کنی و ساخت شروع می‌شود. فایل PPTX آماده (راست‌به‌چپ و قابل ویرایش در پاورپوینت) را همین‌جا می‌گیری.\n\n" +
  "مثال:\n<code>هوش مصنوعی در آموزش</code>\n\n" +
  "🖼 در مرحله‌های آخر می‌توانی یک <b>پوستر (اینفوگرافیک)</b> و یک <b>جزوه‌ی Word</b> هم همراه ارائه بگیری.\n\n" +
  "📎 یا یک <b>فایل</b> بفرست (Word، PDF، PowerPoint، Excel، متن یا عکس) تا ارائه از روی محتوای آن ساخته شود. موضوع را می‌توانی در کپشن فایل بنویسی.\n\n" +
  "🔗 یا <b>لینک یک صفحه‌ی وب</b> را بفرست تا ارائه از روی محتوای همان صفحه ساخته شود.\nمثال:\n<code>https://example.com/article</code>\n\n" +
  "⚙️ /settings ← تغییر تم، لحن، فونت، حالت (عادی، دانشجویی، کسب‌وکار، معلم، دفاع پایان‌نامه)، منابع و تعداد اسلاید\n" +
  "💳 /credit ← اعتبار، پلن و سقف‌های حساب (هر کاربر جدید ۳ ارائه‌ی رایگان هدیه می‌گیرد)\n" +
  "🌐 /site ← ورود خودکار به سایت pptsaz.ir (پلن‌ها و پرداخت آنلاین)\n" +
  "🎁 /invite ← دعوت دوستان و دریافت ارائه‌ی رایگان\n" +
  "📁 /files ← دریافت دوباره‌ی فایل‌ها (PPTX، PDF، پوستر و جزوه) تا ۲۴ ساعت\n\n" +
  "💻 نسخه‌ی وب با امکانات بیشتر: pptsaz.ir"; // زیر هر ارائه‌ی ساخته‌شده هم دکمه‌ی «نسخه‌ی PDF» هست

type Btn = { text: string; callback_data?: string; url?: string };
const kb = (rows: Btn[][]) => ({ reply_markup: { inline_keyboard: rows } });

// ---------- منوی تنظیمات ----------
/** سقف‌های حساب (بر اساس پلن)؛ همان قوانین نسخه‌ی وب */
interface Caps { maxSlides: number; maxImg: number; /** مدیر یا پلن فعال: دسترسی به مدل‌های ویژه */ premium: boolean }
const getCaps = async (env: Env, uid: Uid): Promise<Caps> => {
  const [maxSlides, maxImg, premium] = await Promise.all([maxSlidesFor(env, uid), maxImagesFor(env, uid), hasPlanAccess(env, uid)]);
  return { maxSlides, maxImg, premium };
};
const imgCountOf = (s: Settings, caps: Caps) => Math.min(caps.maxImg, s.imageCount ?? (s.images ? 1 : 0));

function mainMenu(env: Env, s: Settings, caps: Caps) {
  const models = modelList(env);
  const model = models.find((m) => m.id === s.model) ?? models[0];
  const modeBtn: Btn = { text: `${MODES[s.mode].emoji} حالت: ${MODES[s.mode].name}`, callback_data: "t:mode" };
  const n = imgCountOf(s, caps);
  const tpl = TEMPLATES[(isTemplate(s.template) ? s.template : DEFAULT_TEMPLATE) as TemplateKey];
  const rows: Btn[][] = [
    [{ text: `${tpl.emoji} قالب: ${tpl.name}`, callback_data: "m:tpl" }],
    [{ text: `🎨 تم: ${THEMES[s.theme].name}`, callback_data: "m:theme" }, { text: `🗣 لحن: ${TONES[s.tone]}`, callback_data: "m:tone" }],
    [{ text: `🔤 فونت: ${s.font}`, callback_data: "m:font" }, { text: `📄 اسلاید: ${toFa(String(Math.min(s.slides, caps.maxSlides)))}`, callback_data: "m:slides" }],
    [{ text: `🖼 تصویر: ${n ? toFa(String(n)) : "خاموش"}`, callback_data: "m:imgs" }, { text: `🔢 ارقام: ${s.digits ? "فارسی" : "انگلیسی"}`, callback_data: "t:digits" }],
    models.length > 1 ? [{ text: `🤖 مدل: ${model.name}`, callback_data: "m:model" }, modeBtn] : [modeBtn],
    [{ text: `📚 منابع: ${s.mode === "student" || s.mode === "thesis" ? "روشن (" + MODES[s.mode].name + ")" : s.sources ? "روشن" : "خاموش"}`, callback_data: "t:sources" },
      { text: `❓ پرسش پایانی: ${s.mode === "teacher" ? "روشن (معلم)" : s.questions ? "روشن" : "خاموش"}`, callback_data: "t:questions" }],
    [{ text: "✅ بستن", callback_data: "x:close" }],
  ];
  return { text: "⚙️ <b>تنظیمات</b>\nگزینه‌ای را برای تغییر انتخاب کن:", ...kb(rows) };
}

function subMenu(env: Env, kind: string, s: Settings, caps: Caps) {
  const mark = (on: boolean, t: string) => (on ? `✔️ ${t}` : t);
  const lock = (locked: boolean, t: string) => (locked ? `🔒 ${t}` : t);
  let title = "", opts: Btn[] = [];
  if (kind === "tpl") {
    title = "🖼 قالب اسلاید\n<i>قالب، چیدمان و تزئین اسلایدها را تعیین می‌کند و جدا از «تم رنگی» است. برای بهترین نتیجه‌ی «آکادمیک مدرن»، تم «بنفش و نارنجی» را هم انتخاب کن.</i>\n\n" +
      Object.values(TEMPLATES).map((v) => `${v.emoji} <b>${v.name}</b>: ${v.hint}`).join("\n");
    opts = Object.entries(TEMPLATES).map(([k, v]) => ({ text: mark((isTemplate(s.template) ? s.template : DEFAULT_TEMPLATE) === k, `${v.emoji} ${v.name}`), callback_data: `v:tpl:${k}` }));
  } else if (kind === "theme") {
    title = "🎨 تم رنگی";
    opts = Object.entries(THEMES).map(([k, v]) => ({ text: mark(s.theme === k, v.name), callback_data: `v:theme:${k}` }));
  } else if (kind === "tone") {
    title = "🗣 لحن متن";
    opts = Object.entries(TONES).map(([k, v]) => ({ text: mark(s.tone === k, v), callback_data: `v:tone:${k}` }));
  } else if (kind === "font") {
    title = `🔤 فونت\n<i>Vazirmatn (<a href="${FONT_URL}">دانلود</a>) و فونت‌های B Nazanin و B Titr باید روی دستگاه نمایش‌دهنده نصب باشند؛ Tahoma و Arial همه‌جا کار می‌کنند.</i>`;
    opts = FONTS.map((f) => ({ text: mark(s.font === f, f), callback_data: `v:font:${f}` }));
  } else if (kind === "imgs") {
    const cur = imgCountOf(s, caps);
    title = `🖼 تعداد تصویر در هر ارائه\n<i>سقف حساب تو: ${toFa(String(caps.maxImg))} تصویر. گزینه‌های 🔒 با پلن پلاس/پرو باز می‌شوند.</i>`;
    opts = Array.from({ length: ABS_MAX_IMAGES + 1 }, (_, n) => ({
      text: lock(n > caps.maxImg, mark(cur === n, n === 0 ? "بدون تصویر" : toFa(String(n)))), callback_data: `v:imgs:${n}`,
    }));
  } else if (kind === "model") {
    title = "🤖 مدل هوش مصنوعی";
    opts = modelList(env).map((m, i) => ({ text: lock(!!m.extra && !caps.premium, mark(s.model === m.id, m.name)), callback_data: `v:model:${i}` }));
  } else {
    title = `📄 تعداد اسلاید پیش‌فرض\n<i>سقف حساب تو: ${toFa(String(caps.maxSlides))} اسلاید. گزینه‌های 🔒 با پلن پلاس/پرو باز می‌شوند. در متن پیام هم می‌توانی بنویسی «۱۲ اسلاید».</i>`;
    opts = WEB_SLIDE_CHOICES.map((n) => ({ text: lock(n > caps.maxSlides, mark(s.slides === n, toFa(String(n)))), callback_data: `v:slides:${n}` }));
  }
  const rows: Btn[][] = [];
  for (let i = 0; i < opts.length; i += 2) rows.push(opts.slice(i, i + 2));
  rows.push([{ text: "◀️ بازگشت", callback_data: "b:main" }]);
  return { text: title, ...kb(rows) };
}

// ---------- انتخاب مرحله‌ای قبل از ساخت (مدل ← تعداد اسلاید ← تعداد تصویر) ----------
type Step = "model" | "slides" | "imgs" | "poster" | "handout";
/** پوستر (اینفوگرافیک) همراه ارائه: none = نه، wide = افقی، tall = عمودی */
type PosterChoice = "none" | "wide" | "tall";
/** وضعیت ویزارد: موضوع + انتخاب‌های فعلی + مرحله‌ی جاری. هر کاربر یک ویزارد فعال دارد؛ فقط پیام همان ویزارد معتبر است. */
interface Pending { /** جزوه‌ی Word همراه ارائه (آخرین مرحله؛ ۱ اعتبار جدا) */ handout?: boolean; /** پوستر همراه ارائه (آخرین مرحله؛ فقط وقتی فعال است) */ poster?: PosterChoice; /** متن اصلی ارسالی کاربر (برای گزارش مدیر) */ orig?: string; topic: string; mid: number; slides: number; imgs: number; model: string; step: Step; fixed?: boolean; note?: string; /** حالتِ نوشته‌شده در متن کاربر («حالت دانشجویی»)؛ فقط برای همین ارائه و بدون تغییر تنظیمات ذخیره‌شده */ mode?: Mode; /** متن فایل آپلودی (منبع اصلی محتوا) */ source?: string; /** نام فایل آپلودی (فقط برای نمایش) */ file?: string; /** منبع از روی لینک وب است (file = نام سایت) */ link?: boolean }
const pendKey = (uid: Uid) => `pend:${uid}`;
const getPending = async (env: Env, uid: Uid) => (await env.KV.get(pendKey(uid), "json")) as Pending | null;
const putPending = (env: Env, uid: Uid, p: Pending) => env.KV.put(pendKey(uid), JSON.stringify(p), { expirationTtl: 3600 });

/** مرحله‌ها به ترتیب: مدل (فقط اگر بیش از یکی باشد)، اسلاید (اگر کاربر در متن موضوع تعداد را نوشته باشد پرسیده نمی‌شود)، تصویر،
 *  پوستر (اینفوگرافیک) همراه ارائه — فقط وقتی Browser Rendering وصل است. ارائه همیشه ساخته می‌شود؛ پوستر اختیاری است و هزینه‌ی اضافه ندارد */
const stepsOf = (env: Env, p: Pending): Step[] => [
  ...(modelList(env).length > 1 ? (["model"] as Step[]) : []),
  ...(p.fixed ? [] : (["slides"] as Step[])),
  "imgs",
  ...(posterEnabled(env) ? (["poster"] as Step[]) : []),
  "handout",
];

function pendingView(env: Env, p: Pending, s: Settings, caps: Caps) {
  const models = modelList(env);
  const model = models.find((m) => m.id === p.model) ?? models[0];
  const steps = stepsOf(env, p);
  const idx = Math.max(0, steps.indexOf(p.step));
  const mark = (on: boolean, t: string) => (on ? `✔️ ${t}` : t);
  const lock = (locked: boolean, t: string) => (locked ? `🔒 ${t}` : t);
  const chunk = (arr: Btn[], n: number) => { const r: Btn[][] = []; for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n)); return r; };

  let ask = "", opts: Btn[][] = [];
  if (p.step === "model") {
    ask = "🤖 <b>مدل هوش مصنوعی</b> را انتخاب کن:";
    opts = chunk(models.map((m, i) => ({ text: lock(!!m.extra && !caps.premium, mark(p.model === m.id, m.name)), callback_data: `p:model:${i}` })), 2);
  } else if (p.step === "slides") {
    ask = "📄 <b>تعداد اسلاید</b> را انتخاب کن:" + (MODES[p.mode ?? s.mode].minSlides ? `\n<i>${MODES[p.mode ?? s.mode].emoji} حالت ${MODES[p.mode ?? s.mode].name} حداقل ${toFa(String(MODES[p.mode ?? s.mode].minSlides))} اسلاید می‌سازد.</i>` : "");
    opts = chunk(WEB_SLIDE_CHOICES.map((n) => ({ text: lock(n > caps.maxSlides, mark(p.slides === n, toFa(String(n)))), callback_data: `p:slides:${n}` })), 5);
  } else if (p.step === "poster") {
    ask = "🖼 <b>پوستر (اینفوگرافیک)</b> هم ساخته شود؟ (۱ اعتبار)\n<i>پوستر آموزشی آماده‌ی اشتراک‌گذاری و چاپ، با تیتر، بخش‌های رنگی، جدول و نکته‌ی پایانی. افقی برای نمایش روی صفحه و عمودی برای پیام‌رسان است.</i>";
    opts = [
      [{ text: mark(p.poster === "wide", "🖥 پوستر افقی (پیش‌فرض) — ۱ اعتبار"), callback_data: "p:poster:wide" }],
      [{ text: mark(p.poster === "tall", "📱 پوستر عمودی — ۱ اعتبار"), callback_data: "p:poster:tall" }],
      [{ text: mark((p.poster ?? "none") === "none", "بدون پوستر"), callback_data: "p:poster:none" }],
    ];
  } else if (p.step === "handout") {
    ask = "📝 <b>جزوه‌ی Word</b> هم ساخته شود؟ (۱ اعتبار)\n<i>جزوه‌ی مطالعه‌ی حدود سه صفحه‌ای به‌صورت فایل Word قابل‌ویرایش، شامل مقدمه، چند بخش توضیحی و نکات کلیدی. با انتخاب این گزینه ساخت شروع می‌شود.</i>";
    opts = [
      [{ text: mark(p.handout !== false, "📝 با جزوه — ۱ اعتبار"), callback_data: "p:handout:1" }],
      [{ text: mark(p.handout === false, "بدون جزوه"), callback_data: "p:handout:0" }],
    ];
  } else {
    ask = "🖼 <b>تعداد تصویر</b> را انتخاب کن:" + (steps[steps.length - 1] === "imgs" ? "\n<i>با انتخاب این گزینه ساخت ارائه شروع می‌شود.</i>" : "");
    opts = chunk(Array.from({ length: ABS_MAX_IMAGES + 1 }, (_, n) => ({
      text: lock(n > caps.maxImg, mark(p.imgs === n, n === 0 ? "بدون تصویر" : toFa(String(n)))), callback_data: `p:imgs:${n}`,
    })), 4);
  }

  const topicShown = p.topic.length > 200 ? p.topic.slice(0, 200) + "…" : p.topic;
  // انتخاب‌های مرحله‌های قبل (جلوی چشم کاربر)
  const done: string[] = [];
  if (steps.indexOf("model") >= 0 && steps.indexOf("model") < idx) done.push(`🤖 مدل: <b>${esc(model.name)}</b>`);
  if (p.fixed) done.push(`📄 اسلاید: <b>${toFa(String(p.slides))}</b>`);
  else if (steps.indexOf("slides") >= 0 && steps.indexOf("slides") < idx) done.push(`📄 اسلاید: <b>${toFa(String(p.slides))}</b>`);
  const text = [
    `📝 <b>موضوع:</b> ${esc(topicShown)}`,
    ...(p.source ? [p.link ? `🔗 <b>لینک:</b> ${esc((p.file ?? "صفحه‌ی وب").slice(0, 80))} <i>(ارائه از روی محتوای صفحه ساخته می‌شود)</i>`
      : `📎 <b>فایل:</b> ${esc((p.file ?? "فایل").slice(0, 80))} <i>(ارائه از روی محتوای فایل ساخته می‌شود)</i>`] : []),
    ...(done.length ? ["", ...done] : []),
    "",
    `<i>مرحله‌ی ${toFa(String(idx + 1))} از ${toFa(String(steps.length))}</i>`,
    ask,
    ...(p.note ? [`\n⚠️ <i>${esc(p.note)}</i>`] : []),
  ].join("\n");
  return { text, ...kb(opts) };
}

/** شروع ساخت پس از آخرین مرحله: اعتبار کم می‌شود و همین پیام به پیام وضعیت تبدیل می‌شود */
async function launchFromPending(env: Env, cq: any, uid: Uid, tgId: number, chatId: number, mid: number, p: Pending, answer: (t?: string, alert?: boolean) => Promise<unknown>) {
  const wantPoster = p.poster === "wide" || p.poster === "tall";
  const begin = await beginDeck(env, uid, p.topic, { poster: wantPoster && posterEnabled(env), handout: p.handout !== false, slides: p.slides, imageCount: p.imgs, ...(p.mode ? { mode: p.mode } : {}), ...(p.source ? { source: p.source } : {}) });
  if (!begin.ok) {
    const d = begin.denied;
    if (d.busy) return await answer("ارائه‌ی قبلی شما هنوز در حال ساخته شدن است. وقتی فایلش رسید، دوباره امتحان کن.", true);
    if (d.noCredit) {
      await answer();
      return await sendMessage(env, chatId, `⏳ ${d.extras ? esc(d.error) : "اعتبار شما تمام شده است."}\n\n${BUY_SITE_NOTE}`, await buyKbFor(env, uid, tgId));
    }
    if (d.needPlan) {
      await answer();
      return await sendMessage(env, chatId, `🔒 ${esc(d.error)}`, await buyKbFor(env, uid, tgId));
    }
    return await answer(d.error, true);
  }
  if (await canUseModel(env, uid, p.model)) begin.settings.model = p.model; // انتخاب مدل در ویزارد (بدون وابستگی به خواندن KV)؛ مدل ویژه بدون پلن نادیده گرفته می‌شود
  try {
    await env.KV.delete(pendKey(uid)).catch(() => {});
    await answer();
    const creditLine = begin.quota.unlimited ? "" : `\n💳 اعتبار باقی‌مانده: ${toFa(String(begin.quota.left))}`;
    await editMessage(env, chatId, mid,
      `⏳ در حال آماده‌سازی ارائه‌ی «${esc(begin.topic)}» (${toFa(String(begin.settings.slides))} اسلاید${wantPoster ? " + پوستر" : ""}${p.handout !== false ? " + جزوه" : ""})…\nمعمولاً ۱ تا ۲ دقیقه طول می‌کشد.${creditLine}`,
      { reply_markup: { inline_keyboard: [] } });
    const ok = await launchDeck(env, begin, uid, `d-${cq.id}`, { chatId, statusMessageId: mid, channel: "telegram", tgId, orig: p.orig },
      wantPoster && posterEnabled(env) ? { layout: p.poster as "wide" | "tall" } : undefined);
    if (!ok) {
      return await editMessage(env, chatId, mid, "❌ شروع ساخت ارائه ممکن نشد. اعتبارت برگردانده شد؛ چند دقیقه بعد دوباره امتحان کن.").catch(() => {});
    }
  } catch (e) {
    await begin.undo();
    throw e;
  }
}

/** دکمه‌های ویزارد (p:…) */
async function handlePending(env: Env, cq: any, uid: Uid, tgId: number, chatId: number, mid: number, a: string, b: string) {
  const answer = (text?: string, alert = false) =>
    tg(env, "answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text: text.slice(0, 200), show_alert: alert } : {}) }).catch(() => {});
  const p = await getPending(env, uid);
  if (!p || p.mid !== mid) {
    await answer("این درخواست منقضی شده است؛ موضوع را دوباره بفرست.", true);
    return await tg(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: mid, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  }

  if (a === "cancel") {
    await env.KV.delete(pendKey(uid)).catch(() => {});
    await answer();
    return await editMessage(env, chatId, mid, "✖️ لغو شد. هر وقت خواستی، موضوع جدید را بفرست.", { reply_markup: { inline_keyboard: [] } });
  }

  const [s, caps] = await Promise.all([getSettings(env, uid), getCaps(env, uid)]);
  const steps = stepsOf(env, p);
  const render = async () => {
    await putPending(env, uid, p);
    await answer();
    const { text, ...extra } = pendingView(env, p, s, caps);
    await editMessage(env, chatId, mid, text, extra);
  };

  if (a === "back") {
    p.step = steps[Math.max(0, steps.indexOf(p.step) - 1)];
    return await render();
  }

  // انتخاب در مرحله‌ی جاری؛ هم روی ویزارد و هم روی تنظیمات ذخیره‌شده‌ی کاربر (پیش‌فرض دفعه‌ی بعد)
  if (a !== p.step) return await answer(); // دکمه‌ی مرحله‌ی قبلی (بعد از پیشرفت) بی‌اثر است
  if (a === "model") {
    const m = modelList(env)[Number(b)];
    if (!m) return await answer();
    if (m.extra && !caps.premium) return await answer(EXTRA_MODEL_MSG, true);
    p.model = m.id; s.model = m.id;
  } else if (a === "slides") {
    if (!(Number(b) >= 3)) return await answer();
    if (Number(b) > caps.maxSlides) return await answer(slidesLimitMsg(caps.maxSlides), true);
    p.slides = clampSlides(Number(b), caps.maxSlides); s.slides = p.slides; p.note = undefined;
  } else if (a === "handout") {
    if (b !== "0" && b !== "1") return await answer();
    p.handout = b === "1";
  } else if (a === "poster") {
    if (b !== "none" && b !== "wide" && b !== "tall") return await answer();
    p.poster = b;
  } else if (a === "imgs") {
    if (!(Number.isInteger(Number(b)) && Number(b) >= 0 && Number(b) <= ABS_MAX_IMAGES)) return await answer();
    if (Number(b) > caps.maxImg) return await answer(imagesLimitMsg(caps.maxImg), true);
    p.imgs = Number(b); s.imageCount = p.imgs; s.images = p.imgs > 0;
  } else return await answer();
  await saveSettings(env, uid, s).catch((e) => console.error("saveSettings", e));

  const next = steps[steps.indexOf(p.step) + 1];
  if (next) { p.step = next; return await render(); }
  return await launchFromPending(env, cq, uid, tgId, chatId, mid, p, answer); // آخرین مرحله ⇒ شروع ساخت
}

async function banned(env: Env, tgId: number, uid: Uid): Promise<boolean> {
  if (isAdmin(env, tgId)) return false;
  return (await isBanned(env, tgId)) || (uid !== tgId && (await isBanned(env, uid)));
}

/** سقف روزانه‌ی ساخت PDF برای هر کاربر (پلن رایگان کلودفلر ۱۰ دقیقه مرورگر در روز دارد؛ PDF ذخیره‌شده این سقف را مصرف نمی‌کند) */
const PDF_DAILY_LIMIT = 8;

/** دکمه‌ی «دریافت نسخه‌ی PDF» (g:<شناسه‌ی ارائه>) */
async function sendDeckPdf(env: Env, cq: any, uid: Uid, chatId: number, id: string) {
  const answer = (text?: string, alert = false) =>
    tg(env, "answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text: text.slice(0, 200), show_alert: alert } : {}) }).catch(() => {});
  if (!/^[\w-]{1,100}$/.test(id)) return await answer();
  const cap = (title: string) => `📄 <b>${esc(title)}</b>\nنسخه‌ی PDF`;
  const name = (title: string) => `${title.replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 80) || "presentation"}.pdf`;

  // قبلاً ساخته شده؟ بدون مصرف مرورگر و بدون شمارش در سقف روزانه
  const hit = await cachedPdf(env, uid, id).catch(() => null);
  if (hit) {
    await answer();
    const f = (await listFiles(env, uid).catch(() => [])).find((x) => x.id === id);
    return await sendDocument(env, chatId, hit, name(f?.title ?? "presentation"), cap(f?.title ?? "ارائه"), { mime: "application/pdf" });
  }
  const day = new Date().toISOString().slice(0, 10);
  if (await hitLimit(env, `pdf:${uid}:${day}`, PDF_DAILY_LIMIT, 172_800)) {
    return await answer("سقف روزانه‌ی ساخت PDF تمام شد؛ فردا دوباره امتحان کن (فایل PPTX همیشه در دسترس است).", true);
  }
  await answer("⏳ در حال ساخت PDF… چند ثانیه صبر کن.");
  const wait = await sendMessage(env, chatId, "⏳ در حال ساخت PDF…").catch(() => null);
  const done = () => (wait ? tg(env, "deleteMessage", { chat_id: chatId, message_id: wait.message_id }).catch(() => {}) : Promise.resolve());
  try {
    const r = await buildDeckPdf(env, uid, id);
    await done();
    if (!r.ok) return await sendMessage(env, chatId, r.error);
    return await sendDocument(env, chatId, r.data, name(r.title), cap(r.title), { mime: "application/pdf" });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    console.error("deck pdf", msg.slice(0, 400), e); // پیام کامل در ابتدای لاگ بیاید
    await done();
    // ۴۲۹ معمولاً یعنی شلوغی لحظه‌ای (تعداد مرورگر در دقیقه)، نه تمام‌شدن سهمیه‌ی روز؛ فقط خطای صریح «time limit» سقف روزانه است
    return await sendMessage(env, chatId, /time limit/i.test(msg)
      ? "⚠️ سقف ساخت PDF برای امروز تمام شده است؛ فردا دوباره امتحان کن. فایل PPTX همیشه در دسترس است."
      : /429|rate|too many|concurrent/i.test(msg)
        ? "⏳ الان سرویس ساخت PDF شلوغ است؛ حدود یک دقیقه دیگر دوباره دکمه‌ی PDF را بزن. فایل PPTX همیشه در دسترس است."
        : "⚠️ ساخت PDF ناموفق بود؛ کمی بعد دوباره امتحان کن.");
  }
}

async function handleCallback(env: Env, cq: any) {
  const userId: number = cq.from.id;
  const chatId: number = cq.message?.chat?.id;
  const mid: number = cq.message?.message_id;
  const uid = await resolveUid(env, userId);
  const blocked = !chatId || !mid || !isAllowed(env, userId) || (await banned(env, userId, uid));
  if (blocked) return await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });

  const [act, a, b] = String(cq.data ?? "").split(":");
  if (act === "ad") return await handlePanelCallback(env, cq);
  if (act === "bc") return await handleBroadcastCallback(env, cq);
  if (act === "af") return await handleAdminFileCallback(env, cq);
  if (act === "n") return await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {}); // عنوان بخش (بی‌اثر)
  if (act === "p") return await handlePending(env, cq, uid, userId, chatId, mid, a, b);
  if (act === "g") return await sendDeckPdf(env, cq, uid, chatId, a);
  if (act === "f") {
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
    const f = await loadFile(env, uid, a);
    if (!f) return await sendMessage(env, chatId, "⌛️ این فایل منقضی شده است (فایل‌ها ۲۴ ساعت نگه داشته می‌شوند).");
    return await sendDocument(env, chatId, new Uint8Array(f.data), f.entry.name, `✅ <b>${esc(f.entry.title)}</b>`,
      /\.(png|jpe?g)$/i.test(f.entry.name) ? { mime: /\.png$/i.test(f.entry.name) ? "image/png" : "image/jpeg" }
        : /\.docx$/i.test(f.entry.name) ? { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } : undefined);
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
    if (a === "mode") s.mode = nextMode(s.mode);
    if (a === "sources") s.sources = !s.sources;
    if (a === "questions") s.questions = !s.questions;
    await saveSettings(env, uid, s);
    view = mainMenu(env, s, caps);
  } else if (act === "v") {
    if (a === "theme" && b in THEMES) s.theme = b;
    if (a === "tpl" && isTemplate(b)) s.template = b;
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
    if (a === "model") {
      const m = modelList(env)[Number(b)];
      if (m?.extra && !caps.premium) return await alertLimit(EXTRA_MODEL_MSG);
      if (m) s.model = m.id;
    }
    await saveSettings(env, uid, s);
    view = mainMenu(env, s, caps);
  }
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
  const { text, ...extra } = view;
  await editMessage(env, chatId, mid, text, extra);
}

// ---------- استخراج تعداد اسلاید و حالت از متن (منطق در parse.ts؛ این‌جا فقط سقف مطلق اعمال می‌شود) ----------
const extractSlideCount = (text: string) => parseRequest(text, (n) => clampSlides(n, ABS_MAX_SLIDES));

// ---------- پیام‌های اعتبار ----------
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

  if (admin && ADMIN_CMDS.has(cmd)) return await handleAdmin(env, chatId, cmd, args, text, userId);
  // ورودی در انتظار پنل مدیر (جستجو، مقدار اعتبار، متن پیام…): پیام متنی بعدی مدیر همان است
  if (admin && !cmd && text && !msg.document && !msg.photo && (await handleAdminInput(env, chatId, userId, text).catch((e) => { console.error("admin input", e); return false; }))) return;

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
      kb(list.map((f) => /\.(png|jpe?g)$/i.test(f.name)
        ? [{ text: `🖼 ${f.title.slice(0, 32)} (پوستر)`, callback_data: `f:${f.id}` }]
        : /\.docx$/i.test(f.name)
        ? [{ text: `📝 ${f.title.slice(0, 32)} (جزوه)`, callback_data: `f:${f.id}` }]
        : [
          { text: `📥 ${f.title.slice(0, 32)} (${toFa(String(f.slides))} اسلاید)`, callback_data: `f:${f.id}` },
          ...(env.BROWSER ? [{ text: "📄 PDF", callback_data: `g:${f.id}` }] : []),
        ])));
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
        (sub ? `• اعتبار پلن: ${toFa(String(sub.credits))}\n` : "") +
        (c.bonus > 0 ? `• اعتبار هدیه و شارژ: ${toFa(String(c.bonus))}\n` : "");
    const out = head +
      `👑 ${sub ? `پلن ${planName} تا ${fmtDate(sub.exp)}` : "پلن رایگان"}\n` +
      `📄 حداکثر ${toFa(String(caps.maxSlides))} اسلاید و 🖼 ${toFa(String(caps.maxImg))} تصویر در هر ارائه\n` +
      (c.unlimited ? "" : `\n${BUY_SITE_NOTE}`);
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

  // آپلود فایل (سند یا عکس): متن فایل منبع ارائه می‌شود؛ کپشن (اگر باشد) موضوع است، وگرنه نام فایل
  const ref = fileRefOf(msg);
  if (ref) {
    const caption = String(msg.caption ?? "").replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim();
    const { topic: capTopic } = extractSlideCount(caption);
    if (capTopic.length > 600) return await sendMessage(env, chatId, "موضوع بیش از حد طولانی است (حداکثر ۶۰۰ کاراکتر).");
    const gate = await wizardGate(env, chatId, uid, userId);
    if (!gate) return;
    const wait = await sendMessage(env, chatId, "⏳ در حال خواندن فایل…");
    // PDF و عکس ممکن است OCR شوند (چند ده ثانیه)؛ waitUntil فقط ~۳۰ ثانیه فرصت دارد، پس در Workflow اجرا می‌شود
    const heavy = ref.isPhoto || ref.mime === "application/pdf" || ref.mime.startsWith("image/") || /\.(pdf|png|jpe?g)$/i.test(ref.name);
    if (heavy && env.OCR_WORKFLOW) {
      try {
        await env.OCR_WORKFLOW.create({ id: `ocr-${chatId}-${Date.now()}`, params: { chatId, userId, uid, ref, caption, waitId: wait.message_id } });
        return;
      } catch (e) {
        console.error("ocr workflow create", e instanceof Error ? e.message : e); // ناموفق ⇒ مسیر درون‌خطی
      }
    }
    return await finishFileUpload(env, chatId, uid, userId, ref, caption, await extractTelegramFile(env, ref, uid), wait.message_id);
  }

  if (!text) return await sendMessage(env, chatId, `لطفاً موضوع ارائه را به‌صورت <b>متن</b> بفرست؛ یا یک فایل (${SUPPORTED_NOTE}) تا ارائه از روی محتوایش ساخته شود.`);

  // لینک صفحه‌ی وب (فقط وقتی Tavily فعال است): متن صفحه خوانده و منبع ارائه می‌شود
  if (linkEnabled(env)) {
    const found = findLinkInText(text);
    if (found) return await startFromLink(env, chatId, uid, userId, found.url, found.rest, text);
  }

  // به‌جای ساخت فوری، کارت انتخاب (مدل / اسلاید / تصویر) نشان داده می‌شود؛ اعتبار فقط با «🚀 ساخت ارائه» کم می‌شود
  const { topic, slides, mode } = extractSlideCount(text);
  if (topic.length < 3) return await sendMessage(env, chatId, "موضوع خیلی کوتاه است؛ کمی کامل‌تر بنویس.");
  if (topic.length > 600) return await sendMessage(env, chatId, "موضوع بیش از حد طولانی است (حداکثر ۶۰۰ کاراکتر).");
  const gate = await wizardGate(env, chatId, uid, userId);
  if (!gate) return;
  return await showWizard(env, chatId, uid, gate, { topic, slides, mode, orig: text });
}

/** ساخت از روی لینک: اول پیش‌شرط‌ها (اعتبار/ارائه‌ی در حال ساخت) و سقف روزانه، بعد خواندن صفحه با Tavily و نمایش کارت انتخاب.
 *  rest: باقی پیام بدون لینک (موضوع و تعداد اسلاید)؛ اگر خالی بود، عنوان صفحه موضوع می‌شود. */
async function startFromLink(env: Env, chatId: number, uid: Uid, userId: number, url: string, rest: string, orig: string): Promise<null> {
  const { topic: capTopic, slides, mode } = extractSlideCount(rest);
  if (capTopic.length > 600) { await sendMessage(env, chatId, "موضوع بیش از حد طولانی است (حداکثر ۶۰۰ کاراکتر)."); return null; }
  const gate = await wizardGate(env, chatId, uid, userId);
  if (!gate) return null;
  if (await linkLimitHit(env, uid)) {
    await sendMessage(env, chatId, `⏳ سقف امروزت برای خواندن لینک تمام شد؛ فردا دوباره امتحان کن. ${esc(linkCapNote(env))}`);
    return null;
  }
  const wait = await sendMessage(env, chatId, "🔗 در حال خواندن لینک…");
  const r = await fetchLinkSource(env, url);
  if (!r.ok) { await editMessage(env, chatId, wait.message_id, `⚠️ ${esc(r.error)}`); return null; }
  const topic = capTopic.length >= 3 ? capTopic : r.title.length >= 3 ? r.title.slice(0, 200) : "ارائه از روی لینک ارسالی";
  await showWizard(env, chatId, uid, gate, { topic, slides, mode, source: r.text, file: r.host, link: true, cardId: wait.message_id, orig });
  return null;
}

/** بعد از خواندن فایل: پیام خطا یا کارت انتخاب ارائه. هم از مسیر درون‌خطی و هم از OcrWorkflow صدا زده می‌شود */
export async function finishFileUpload(env: Env, chatId: number, uid: Uid, userId: number, ref: TgFileRef, caption: string, ex: Extracted, waitId: number): Promise<null> {
  if (!ex.ok) { await editMessage(env, chatId, waitId, `⚠️ ${esc(ex.error)}`); return null; }
  const { topic: capTopic, slides: capSlides, mode: capMode } = extractSlideCount(caption);
  const gate = await wizardGate(env, chatId, uid, userId);
  if (!gate) { await editMessage(env, chatId, waitId, "✅ فایل خوانده شد."); return null; }
  const fromName = ref.name.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  const topic = capTopic.length >= 3 ? capTopic : fromName.length >= 3 && !ref.isPhoto ? fromName.slice(0, 200) : "ارائه از روی فایل ارسالی";
  await showWizard(env, chatId, uid, gate, { topic, slides: capSlides, mode: capMode, source: ex.text, file: ref.name, cardId: waitId, orig: caption });
  return null;
}

/** پیش‌شرط‌های شروع ویزارد (ارائه‌ی در حال ساخت / اتمام اعتبار)؛ اگر مانعی باشد پیام می‌دهد و null برمی‌گرداند */
async function wizardGate(env: Env, chatId: number, uid: Uid, userId: number): Promise<{ s: Settings; caps: Caps } | null> {
  if ((await runningJob(env, uid)).busy) {
    await sendMessage(env, chatId, "⏳ ارائه‌ی قبلی شما هنوز در حال ساخته شدن است. وقتی فایلش رسید، موضوع بعدی را بفرست.");
    return null;
  }
  const [s, caps, credit] = await Promise.all([getSettings(env, uid), getCaps(env, uid), getCredit(env, uid)]);
  if (!credit.unlimited && credit.total <= 0) {
    await sendMessage(env, chatId, `⏳ اعتبار شما تمام شده است.\n\n${BUY_SITE_NOTE}`, await buyKbFor(env, uid, userId));
    return null;
  }
  return { s, caps };
}

/** نمایش کارت انتخاب (مدل / اسلاید / تصویر). cardId: پیامی که باید به کارت تبدیل شود (مثلاً «در حال خواندن فایل…»)؛ خالی = پیام تازه */
async function showWizard(env: Env, chatId: number, uid: Uid, g: { s: Settings; caps: Caps }, o: { topic: string; slides?: number; mode?: Mode; source?: string; file?: string; link?: boolean; cardId?: number; orig?: string }) {
  const { s, caps } = g;
  const models = modelList(env);
  const pend: Pending = {
    topic: o.topic, mid: 0,
    ...(o.orig?.trim() ? { orig: o.orig.replace(/\s+/g, " ").trim().slice(0, 300) } : {}),
    slides: Math.min(o.slides ?? s.slides, caps.maxSlides),
    imgs: imgCountOf(s, caps),
    model: models.some((m) => m.id === s.model) ? (s.model as string) : models[0].id,
    poster: "wide", // پیش‌فرض: با پوستر افقی
    handout: true, // جزوه‌ی Word: پیش‌فرض روشن
    step: "model",
    fixed: o.slides !== undefined, // تعداد اسلاید در متن موضوع آمده؛ دوباره پرسیده نمی‌شود
    ...(o.mode ? { mode: o.mode } : {}),
    note: o.slides !== undefined && o.slides > caps.maxSlides ? slidesLimitMsg(caps.maxSlides)
      : o.mode && o.slides !== undefined && o.slides < MODES[o.mode].minSlides ? `حالت ${MODES[o.mode].name} حداقل ${toFa(String(MODES[o.mode].minSlides))} اسلاید می‌سازد؛ تعداد اسلاید به همین مقدار می‌رسد.` : undefined,
    ...(o.source ? { source: o.source, file: o.file, ...(o.link ? { link: true } : {}) } : {}),
  };
  pend.step = stepsOf(env, pend)[0];
  const { text: cardText, ...cardExtra } = pendingView(env, pend, s, caps);
  if (o.cardId) {
    await editMessage(env, chatId, o.cardId, cardText, cardExtra);
    pend.mid = o.cardId;
  } else {
    pend.mid = (await sendMessage(env, chatId, cardText, cardExtra)).message_id;
  }
  await putPending(env, uid, pend);
}
