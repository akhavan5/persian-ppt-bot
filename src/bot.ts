import type { Env } from "./env";
import type { Mode, Settings } from "./types";
import { B_FONTS_URL, FONTS, FONT_URL, MODES, THEMES, TONES, nextMode } from "./themes";
import { DEFAULT_TEMPLATE, TEMPLATES, isTemplate, type TemplateKey } from "./template";
import {
  EXTRA_IMAGES_MSG, EXTRA_MODE_MSG, EXTRA_MODEL_MSG, canUseModel, hasPlanAccess, adminIds, WEB_SLIDE_CHOICES, ABS_MAX_SLIDES, clampSlides, DAILY_FREE_MSG, getActiveSub, getCredit, grantDailyFree, getSettings, isAdmin, isAllowed, isBanned,
  DAILY_FREE_CREDITS, FEEDBACK_CREDITS, FEEDBACK_MIN_CHARS, claimFeedbackReward, hasFeedbackReward, FREE_MAX_IMAGES, FREE_MAX_SLIDES, maxImagesFor, maxSlidesFor, saveSettings, supportLink, touchUser, botPlatform, REF_EVERY, REF_MAX, holdReferral, parseRefId, displayName, noteActive, isWebId,
  type Uid,
} from "./settings";
import { ADMIN_CMDS, handleAdmin, handleAdminFileCallback, handleAdminSampleCallback, handleAdminInput, handleBroadcastCallback, handlePanelCallback } from "./admin";
import { listFiles, loadFile } from "./files";
import { SAMPLE_BADGE, isSampleId, listSamples, sampleById, sampleCaption, sampleLabel, sampleMime } from "./samples";
import { ALL_EXTRA_KINDS, GAMMA_HEADER, extraButtons, extraOfCode, extrasHint, isButtonOf, isGammaAdmin, isMainDeck, madeExtras, startExtra, type ExtraKind } from "./extras";
import { buildDeckPdf, cachedPdf } from "./pdf";
import { hitLimit } from "./auth";
import { appPushCommand } from "./push";
import { appVerCommand } from "./app-version";
import { editMessage, esc, sendAudio, sendDocument, sendMessage, tg } from "./telegram";
import { audioSeconds, isAudioName } from "./wav";
import { siteHost } from "./deck-service";
import { isBaleId } from "./bale-format";
import { isSplusId } from "./splus-format";
import { isRubikaId } from "./rubika-format";
import { toEn, toFa } from "./util";
import { modelList } from "./llm";
import { PLANS } from "./payment";
import { inviteBody, inviteLinkFor, inviteMarkup } from "./invite-msg";
import { BUY_SITE_NOTE, audioEnabled, beginDeck, buyKbFor, fileNameWithSite, launchDeck, miniappUrl, posterEnabled, runningJob, siteLoginUrl, slidesLimitMsg } from "./deck-service";
import { ensureUid, resolveUid } from "./link";
import { askShareContact, handleContactSkip, handleProfileCallback, handleProfileInput, handleSharedContact, showChannels, showProfile } from "./bot-profile";
import { notifyInviterJoined } from "./referral";
import { SUPPORT_MAX_TEXT, supportBotAsk } from "./support-chat";
import { hasBrowser } from "./browser-api";
import { parseRequest } from "./parse";
import { deepgramEnabled } from "./deepgram";
import { SUPPORTED_NOTE, extractTelegramFile, fileRefOf, type Extracted, type TgFileRef } from "./tg-file";
import { fetchLinkSource, findLinkInText, linkCapNote, linkEnabled, linkLimitHit } from "./link-source";

/** مربع رنگی کنار نام تم در دکمه‌های تلگرام (دکمه‌ی اینلاین تصویر نمی‌گیرد) */
const THEME_DOT: Record<string, string> = { ocean: "🟦", forest: "🟩", sunset: "🟧", royal: "🟪", violet: "🟣", midnight: "⬛" };
const HELP =
  "سلام! 👋\n" +
  "من ربات <b>ساخت پاورپوینت فارسی</b> هستم.\n\n" +
  "📝 فقط <b>موضوع ارائه</b> را بفرست؛ بعد مرحله‌به‌مرحله <b>مدل، تعداد اسلاید و داشتن تصویر</b> را انتخاب می‌کنی و ساخت شروع می‌شود. فایل PPTX آماده (راست‌به‌چپ و قابل ویرایش در پاورپوینت) را همین‌جا می‌گیری.\n\n" +
  "مثال:\n<code>هوش مصنوعی در آموزش</code>\n\n" +
  "🖼 در مرحله‌های آخر می‌توانی یک <b>پوستر (اینفوگرافیک)</b>، یک <b>جزوه‌ی Word</b>، یک <b>اسلاید صوتی</b> (صدای گوینده داخل خود اسلایدها) و یک <b>پادکست</b> دو‌نفره هم همراه ارائه بگیری؛ هرکدام ۱ اعتبار جدا.\n\n" +
  "📎 یا یک <b>فایل</b> بفرست (Word، PDF، PowerPoint، Excel، متن یا عکس) تا ارائه از روی محتوای آن ساخته شود. موضوع را می‌توانی در کپشن فایل بنویسی.\n\n" +
  "🖼 چند عکس (مثلاً صفحه‌های یک جزوه) را <b>یک‌جا و به‌صورت آلبوم</b> انتخاب و بفرست (حداکثر ۱۰ عدد)؛ همه با هم خوانده می‌شوند و فقط <b>یک ارائه</b> ساخته می‌شود. عکس‌هایی که جدا از هم بفرستی هر کدام ارائه‌ی جداگانه حساب می‌شوند.\n\n" +
  "🔗 یا <b>لینک یک صفحه‌ی وب</b> را بفرست تا ارائه از روی محتوای همان صفحه ساخته شود.\nمثال:\n<code>https://example.com/article</code>\n\n" +
  "👇 با دکمه‌های زیر به همه‌ی بخش‌ها می‌رسی: اعتبار و پلن (هر کاربر جدید ۱ ارائه‌ی رایگان هدیه می‌گیرد و هر روز ۱ اعتبار رایگان دیگر؛ با ثبت و تایید موبایل و ایمیل در /profile هم برای هر کدام ۱ اعتبار هدیه می‌گیری)، تنظیمات (تم، لحن، فونت، حالت، منابع، تعداد اسلاید)، فایل‌های ۲۴ ساعت اخیر، دعوت دوستان (هر ۳ دوستی که با لینک تو بیایند و اولین ارائه‌شان را بسازند = ۱ اعتبار) و ورود خودکار به سایت.\n\n" +
  "🤖 سؤال یا مشکلی داری؟ با /support از <b>دستیار هوشمند پشتیبانی</b> بپرس.\n\n" +
  "💻 نسخه‌ی وب با امکانات بیشتر: pptsaz.ir"; // زیر هر ارائه‌ی ساخته‌شده هم دکمه‌ی «نسخه‌ی PDF» هست

/** خط ورودی صوتی فقط وقتی DEEPGRAM_API_KEY تنظیم است در راهنما می‌آید */
const VOICE_HELP = "🎙 یا یک <b>ویس</b> (یا فایل صوتی) بفرست؛ به متن تبدیل می‌شود. ویس کوتاه همان <b>موضوع</b> ارائه است (مثلاً «ده اسلاید درباره‌ی هوش مصنوعی در آموزش») و ویس یا فایل صوتی بلندتر (مثل یک سخنرانی) <b>منبع</b> ارائه می‌شود.\n\n";
const helpText = (env: Env) => (deepgramEnabled(env) ? HELP.replace("🔗 یا <b>لینک", VOICE_HELP + "🔗 یا <b>لینک") : HELP);

type Btn = { text: string; callback_data?: string; url?: string };
const kb = (rows: Btn[][]) => ({ reply_markup: { inline_keyboard: rows } });

// ---------- منوی تنظیمات ----------
/** سقف‌های حساب (بر اساس پلن)؛ همان قوانین نسخه‌ی وب */
interface Caps { maxSlides: number; maxImg: number; /** مدیر یا پلن فعال: دسترسی به مدل‌های ویژه */ premium: boolean }
const getCaps = async (env: Env, uid: Uid): Promise<Caps> => {
  const [maxSlides, maxImg, premium] = await Promise.all([maxSlidesFor(env, uid), maxImagesFor(env, uid), hasPlanAccess(env, uid)]);
  return { maxSlides, maxImg, premium };
};
/** اسلایدها تصویر داشته باشند؟ (تعداد تصویر ضمنی و از روی تعداد اسلاید محاسبه می‌شود) */
const wantsImgs = (s: Settings) => s.images !== false;
/** تصویر «زیاد» (نرمال + ۱) فقط برای پلن‌دارها */
const wantsMany = (s: Settings, caps: Caps) => wantsImgs(s) && s.imagesMany === true && caps.premium;
const imgLabel = (s: Settings, caps: Caps) => (!wantsImgs(s) ? "خیر" : wantsMany(s, caps) ? "زیاد" : "نرمال");

function mainMenu(env: Env, s: Settings, caps: Caps) {
  const models = modelList(env);
  const model = models.find((m) => m.id === s.model) ?? models[0];
  const modeBtn: Btn = { text: `${MODES[s.mode].emoji} حالت: ${MODES[s.mode].name}${caps.premium ? "" : " 🔒"}`, callback_data: "t:mode" }; // 🔒 = حالت‌های دیگر فقط برای پلن‌دارها
  const tpl = TEMPLATES[(isTemplate(s.template) ? s.template : DEFAULT_TEMPLATE) as TemplateKey];
  const rows: Btn[][] = [
    [{ text: `${tpl.emoji} قالب: ${tpl.name}`, callback_data: "m:tpl" }],
    [{ text: `🎨 تم: ${THEMES[s.theme].name}`, callback_data: "m:theme" }, { text: `🗣 لحن: ${TONES[s.tone]}`, callback_data: "m:tone" }],
    [{ text: `🔤 فونت: ${s.font}`, callback_data: "m:font" }, { text: `📄 اسلاید: ${toFa(String(Math.min(s.slides, caps.maxSlides)))}`, callback_data: "m:slides" }],
    [{ text: `🖼 تصویر در اسلاید: ${imgLabel(s, caps)}`, callback_data: "t:images" }, { text: `🔢 ارقام: ${s.digits ? "فارسی" : "انگلیسی"}`, callback_data: "t:digits" }],
    models.length > 1 ? [{ text: `🤖 مدل: ${model.name}`, callback_data: "m:model" }, modeBtn] : [modeBtn],
    [{ text: `📚 منابع: ${s.mode === "student" || s.mode === "thesis" ? "روشن (" + MODES[s.mode].name + ")" : s.sources ? "روشن" : "خاموش"}`, callback_data: "t:sources" },
      { text: `❓ پرسش پایانی: ${s.mode === "teacher" ? "روشن (معلم)" : s.questions ? "روشن" : "خاموش"}`, callback_data: "t:questions" }],
    [{ text: `📝 یادداشت سخنرانی: ${s.notes === false ? "خاموش" : "روشن"}`, callback_data: "t:notes" }],
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
    opts = Object.entries(THEMES).map(([k, v]) => ({ text: mark(s.theme === k, `${THEME_DOT[k] ?? "🎨"} ${v.name}`), callback_data: `v:theme:${k}` }));
  } else if (kind === "tone") {
    title = "🗣 لحن متن";
    opts = Object.entries(TONES).map(([k, v]) => ({ text: mark(s.tone === k, v), callback_data: `v:tone:${k}` }));
  } else if (kind === "font") {
    title = `🔤 فونت\n<i>Vazirmatn (<a href="${FONT_URL}">دانلود</a>) و فونت‌های B Nazanin و B Titr (<a href="${B_FONTS_URL}">دانلود</a>) باید روی دستگاه نمایش‌دهنده نصب باشند؛ Tahoma و Arial همه‌جا کار می‌کنند.</i>`;
    opts = FONTS.map((f) => ({ text: mark(s.font === f, f), callback_data: `v:font:${f}` }));
  } else if (kind === "model") {
    title = "🤖 مدل هوش مصنوعی";
    opts = modelList(env).map((m, i) => ({ text: lock(!m.free && !caps.premium, mark(s.model === m.id, m.name)), callback_data: `v:model:${i}` }));
  } else {
    title = `📄 تعداد اسلاید پیش‌فرض\n<i>سقف حساب تو: ${toFa(String(caps.maxSlides))} اسلاید. گزینه‌های 🔒 با پلن پلاس/پرو باز می‌شوند. در متن پیام هم می‌توانی بنویسی «۱۲ اسلاید».</i>`;
    opts = WEB_SLIDE_CHOICES.map((n) => ({ text: lock(n > caps.maxSlides, mark(s.slides === n, toFa(String(n)))), callback_data: `v:slides:${n}` }));
  }
  const rows: Btn[][] = [];
  for (let i = 0; i < opts.length; i += 2) rows.push(opts.slice(i, i + 2));
  rows.push([{ text: "◀️ بازگشت", callback_data: "b:main" }]);
  return { text: title, ...kb(rows) };
}

// ---------- انتخاب مرحله‌ای قبل از ساخت (مدل ← تعداد اسلاید ← اسلاید حاوی تصویر؟) ----------
type Step = "model" | "slides" | "imgs" | "extras";
/** پوستر (اینفوگرافیک) همراه ارائه: none = نه، wide = افقی، tall = عمودی */
type PosterChoice = "none" | "wide" | "tall";
/** وضعیت ویزارد: موضوع + انتخاب‌های فعلی + مرحله‌ی جاری. هر کاربر یک ویزارد فعال دارد؛ فقط پیام همان ویزارد معتبر است. */
interface Pending { /** اسلاید صوتی همراه ارائه (۱ اعتبار جدا؛ پیش‌فرض خاموش، فقط وقتی TTS فعال است) */ audio?: boolean; /** پادکست همراه ارائه (آخرین مرحله؛ ۱ اعتبار جدا؛ پیش‌فرض خاموش) */ podcast?: boolean; /** جزوه‌ی Word همراه ارائه (۱ اعتبار جدا) */ handout?: boolean; /** پوستر همراه ارائه (آخرین مرحله؛ فقط وقتی فعال است) */ poster?: PosterChoice; /** متن اصلی ارسالی کاربر (برای گزارش مدیر) */ orig?: string; topic: string; mid: number; slides: number; /** اسلاید حاوی تصویر باشد؟ (پیش‌فرض نرمال) */ imgs: boolean; /** تصویر «زیاد» (فقط پلن‌دارها): تعداد نرمال + ۱ */ many?: boolean; model: string; step: Step; fixed?: boolean; note?: string; /** حالتِ نوشته‌شده در متن کاربر («حالت دانشجویی»)؛ فقط برای همین ارائه و بدون تغییر تنظیمات ذخیره‌شده */ mode?: Mode; /** متن فایل آپلودی (منبع اصلی محتوا) */ source?: string; /** نام فایل آپلودی (فقط برای نمایش) */ file?: string; /** منبع از روی لینک وب است (file = نام سایت) */ link?: boolean }
const pendKey = (uid: Uid) => `pend:${uid}`;
const getPending = async (env: Env, uid: Uid) => (await env.KV.get(pendKey(uid), "json")) as Pending | null;
const putPending = (env: Env, uid: Uid, p: Pending) => env.KV.put(pendKey(uid), JSON.stringify(p), { expirationTtl: 3600 });

/** مرحله‌ها به ترتیب: مدل (فقط اگر بیش از یکی باشد)، اسلاید (اگر کاربر در متن موضوع تعداد را نوشته باشد پرسیده نمی‌شود)، تصویر،
 *  پوستر (اینفوگرافیک)، جزوه، اسلاید صوتی و پادکست همراه ارائه (هرکدام اختیاری و ۱ اعتبار جدا؛ پوستر فقط با Browser Rendering، صدا فقط با TTS). ارائه همیشه ساخته می‌شود */
const stepsOf = (env: Env, p: Pending): Step[] => [
  ...(modelList(env).length > 1 ? (["model"] as Step[]) : []),
  ...(p.fixed ? [] : (["slides"] as Step[])),
  "imgs",
  "extras", // پوستر، جزوه، اسلاید صوتی و پادکست در یک مرحله (آخرین مرحله؛ دکمه‌ی «شروع ساخت»)
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
    opts = chunk(models.map((m, i) => ({ text: lock(!m.free && !caps.premium, mark(p.model === m.id, m.name)), callback_data: `p:model:${i}` })), 2);
  } else if (p.step === "slides") {
    ask = "📄 <b>تعداد اسلاید</b> را انتخاب کن:" + (MODES[p.mode ?? s.mode].minSlides ? `\n<i>${MODES[p.mode ?? s.mode].emoji} حالت ${MODES[p.mode ?? s.mode].name} حداقل ${toFa(String(MODES[p.mode ?? s.mode].minSlides))} اسلاید می‌سازد.</i>` : "");
    opts = chunk(WEB_SLIDE_CHOICES.map((n) => ({ text: lock(n > caps.maxSlides, mark(p.slides === n, toFa(String(n)))), callback_data: `p:slides:${n}` })), 5);
  } else if (p.step === "extras") {
    const poster = p.poster ?? "none", hasPoster = posterEnabled(env), hasAudio = audioEnabled(env);
    const n = (hasPoster && poster !== "none" ? 1 : 0) + (p.handout === true ? 1 : 0) + (hasAudio && p.audio === true ? 1 : 0) + (hasAudio && p.podcast === true ? 1 : 0);
    ask = "➕ <b>همراه ارائه چه چیزی ساخته شود؟</b> (اختیاری؛ هرکدام ۱ اعتبار جدا)\n"
      + (hasPoster ? "🖼 <b>پوستر:</b> اینفوگرافیک آماده‌ی اشتراک‌گذاری و چاپ (افقی برای نمایش روی صفحه، عمودی برای پیام‌رسان)\n" : "")
      + "📝 <b>جزوه:</b> جزوه‌ی Word حدود سه صفحه‌ای و قابل‌ویرایش\n"
      + (hasAudio ? "🔊 <b>اسلاید صوتی:</b> PPTX با صدای گوینده در هر اسلاید (جدا می‌رسد)\n🎙 <b>پادکست:</b> گفت‌وگوی دو‌نفره درباره‌ی موضوع، به‌صورت فایل صوتی (جدا می‌رسد)\n" : "")
      + `\n<i>${n ? `اعتبار اضافه‌ی انتخاب‌های فعلی: ${toFa(String(n))}` : "فعلاً فقط خود ارائه ساخته می‌شود."}</i>`;
    opts = [
      ...(hasPoster ? [[
        { text: mark(poster === "none", "بدون پوستر"), callback_data: "p:extras:poster-none" },
        { text: mark(poster === "wide", "🖥 پوستر افقی"), callback_data: "p:extras:poster-wide" },
        { text: mark(poster === "tall", "📱 پوستر عمودی"), callback_data: "p:extras:poster-tall" },
      ]] : []),
      [{ text: p.handout === true ? "✔️ 📝 جزوه‌ی Word — ۱ اعتبار" : "📝 جزوه‌ی Word", callback_data: "p:extras:handout" }],
      ...(hasAudio ? [
        [{ text: p.audio === true ? "✔️ 🔊 اسلاید صوتی — ۱ اعتبار" : "🔊 اسلاید صوتی", callback_data: "p:extras:audio" }],
        [{ text: p.podcast === true ? "✔️ 🎙 پادکست — ۱ اعتبار" : "🎙 پادکست", callback_data: "p:extras:podcast" }],
      ] : []),
      [{ text: "🚀 شروع ساخت", callback_data: "p:extras:go" }],
    ];
  } else {
    ask = "🖼 <b>اسلایدها حاوی تصویر باشند؟</b>" + (steps[steps.length - 1] === "imgs" ? "\n<i>با انتخاب این گزینه ساخت ارائه شروع می‌شود.</i>" : "");
    opts = [[
      { text: mark(p.imgs && !p.many, "✅ نرمال"), callback_data: "p:imgs:1" },
      { text: lock(!caps.premium, mark(p.imgs && p.many === true, "➕ زیاد")), callback_data: "p:imgs:2" },
      { text: mark(!p.imgs, "❌ خیر"), callback_data: "p:imgs:0" },
    ]];
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

/** فهرست پلن‌ها برای /credit: رایگان + پلاس/پرو با قیمت (هزار تومان)، اعتبار، سقف اسلاید و تصویر؛ پلن فعلی با ✅ */
function plansText(curId?: string): string {
  const free = `${!curId ? "✅ " : "▫️ "}<b>رایگان</b> — روزی ${toFa(String(DAILY_FREE_CREDITS))} ارائه • تا ${toFa(String(FREE_MAX_SLIDES))} اسلاید • ${toFa(String(FREE_MAX_IMAGES))} تصویر • حالت «عادی» • با واترمارک`;
  const rows = PLANS.map((p) => `${curId === p.id ? "✅ " : "▫️ "}<b>${p.name}</b> — ${toFa(p.price.toLocaleString("en-US")).replace(/,/g, "٬")} هزار تومان • ${toFa(String(p.credits))} ارائه • تا ${toFa(String(p.maxSlides))} اسلاید • تا ${toFa(String(p.maxImages))} تصویر • همه‌ی حالت‌ها • بدون واترمارک`);
  return [free, ...rows].join("\n");
}

/** شروع ساخت پس از آخرین مرحله: اعتبار کم می‌شود و همین پیام به پیام وضعیت تبدیل می‌شود */
async function launchFromPending(env: Env, cq: any, uid: Uid, tgId: number, chatId: number, mid: number, p: Pending, answer: (t?: string, alert?: boolean) => Promise<unknown>) {
  const wantPoster = p.poster === "wide" || p.poster === "tall";
  const wantAudio = p.audio === true && audioEnabled(env), wantPodcast = p.podcast === true && audioEnabled(env); // پیش‌فرض خاموش؛ فقط با انتخاب کاربر و فعال‌بودن TTS
  const begin = await beginDeck(env, uid, p.topic, { poster: wantPoster && posterEnabled(env), handout: p.handout === true, audio: wantAudio, podcast: wantPodcast, slides: p.slides, images: p.imgs, imagesMany: p.many === true, ...(p.mode ? { mode: p.mode } : {}), ...(p.source ? { source: p.source } : {}) });
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
      `⏳ در حال آماده‌سازی ارائه‌ی «${esc(begin.topic)}» (${toFa(String(begin.settings.slides))} اسلاید${wantPoster ? " + پوستر" : ""}${p.handout === true ? " + جزوه" : ""}${wantAudio ? " + اسلاید صوتی" : ""}${wantPodcast ? " + پادکست" : ""})…\nمعمولاً ۱ تا ۲ دقیقه طول می‌کشد.${wantAudio || wantPodcast ? "\n🔊 صدا (اسلاید صوتی/پادکست) جدا و چند دقیقه بعد از ارائه می‌رسد." : ""}${creditLine}`,
      { reply_markup: { inline_keyboard: [] } });
    const deckId = String(cq.id ?? "").length <= 24 && /^[\w-]+$/.test(String(cq.id ?? "")) ? `d-${cq.id}` : `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; // شناسه‌ی ارائه در callback_data دکمه‌ها می‌آید (سقف ۶۴ بایت)؛ شناسه‌ی callback بله ممکن است بلند باشد
    const ok = await launchDeck(env, begin, uid, deckId, { chatId, statusMessageId: mid, channel: "telegram", tgId, orig: p.orig },
      wantPoster && posterEnabled(env) ? { layout: p.poster as "wide" | "tall" } : undefined);
    if (!ok) {
      return await editMessage(env, chatId, mid, "❌ شروع ساخت ارائه ممکن نشد. اعتبارت برگردانده شد؛ چند دقیقه بعد دوباره امتحان کن.").catch(() => {});
    }
    await askShareContact(env, chatId, uid); // شماره‌ی اختیاری (تلگرام/بله)؛ بعد از شروع ساخت و بدون هیچ انتظاری
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

  if ((["poster", "handout", "audio", "podcast"] as string[]).includes(p.step)) p.step = "extras"; // ویزارد نیمه‌کاره‌ی قبل از ادغام مرحله‌ها
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
    if (!m.free && !caps.premium) return await answer(EXTRA_MODEL_MSG, true);
    p.model = m.id; s.model = m.id;
  } else if (a === "slides") {
    if (!(Number(b) >= 3)) return await answer();
    if (Number(b) > caps.maxSlides) return await answer(slidesLimitMsg(caps.maxSlides), true);
    p.slides = clampSlides(Number(b), caps.maxSlides); s.slides = p.slides; p.note = undefined;
  } else if (a === "extras") {
    // همه‌ی همراه‌ها در یک مرحله: دکمه‌ها فقط انتخاب را عوض می‌کنند و ساخت با «شروع ساخت» شروع می‌شود
    if (b === "go") return await launchFromPending(env, cq, uid, tgId, chatId, mid, p, answer);
    if (b === "handout") p.handout = p.handout !== true;
    else if (b === "audio" && audioEnabled(env)) p.audio = p.audio !== true;
    else if (b === "podcast" && audioEnabled(env)) p.podcast = p.podcast !== true;
    else if (posterEnabled(env) && (b === "poster-none" || b === "poster-wide" || b === "poster-tall")) p.poster = b.slice(7) as PosterChoice;
    else return await answer();
    return await render();
  } else if (a === "imgs") {
    if (!(Number.isInteger(Number(b)) && Number(b) >= 0)) return await answer();
    if (Number(b) === 2 && !caps.premium) return await answer(EXTRA_IMAGES_MSG, true);
    p.imgs = Number(b) > 0; p.many = Number(b) === 2; s.images = p.imgs; s.imagesMany = p.many;
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
  if (!isMainDeck(id, "x.pptx")) return await answer("PDF فقط برای خودِ ارائه ساخته می‌شود.", true); // نه برای اسلاید صوتی/پادکست/جزوه/پوستر
  const cap = (title: string) => `📄 <b>${esc(title)}</b>\nنسخه‌ی PDF`;
  const name = (title: string) => fileNameWithSite(env, title, "pdf", "", 80);

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

/** دکمه‌های زیر ارائه: ex:<کد>:<شناسه‌ی ارائه> (🔊 اسلاید صوتی، 🎙 پادکست، 📝 جزوه، 🖼 پوستر افقی/عمودی) و دکمه‌های قدیمی au:/pc:.
 *  هر کدام ۱ اعتبار جدا می‌خواهد و فقط یک بار برای هر ارائه ساخته می‌شود؛ کار سنگین در Workflow انجام می‌شود (extras.ts) */
async function startExtraButton(env: Env, cq: any, uid: Uid, tgId: number, chatId: number, kind: ExtraKind, id: string, layout?: "wide" | "tall") {
  const answer = (text?: string, alert = false) =>
    tg(env, "answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text: text.slice(0, 200), show_alert: alert } : {}) }).catch(() => {});
  if (!/^[\w-]{1,100}$/.test(id)) return await answer();
  if (!isMainDeck(id, "x.pptx")) return await answer("همراه‌ها فقط از روی خودِ ارائه ساخته می‌شوند.", true);
  const r = await startExtra(env, uid, id, kind, { channel: "telegram", chatId, layout, admin: isGammaAdmin(env, tgId) }); // خروجی‌های Gamma فقط برای مدیر در تلگرام
  if (!r.ok) {
    await answer(r.error, true);
    // اعتبار تمام: دکمه‌های خرید پلن هم نشان داده می‌شود
    if (r.noCredit) await sendMessage(env, chatId, `💳 ${r.error}\nبا دکمه‌ی زیر در سایت پلن بگیر؛ با همین حساب تلگرامت خودکار وارد می‌شوی.`, await buyKbFor(env, uid, tgId).catch(() => undefined)).catch(() => {});
    return;
  }
  await answer("⏳ شروع شد؛ ۱ اعتبار کم شد. فایل در همین چت می‌آید.");
  // دکمه‌ی همین همراه (و برای پوستر هر دو چیدمان) از زیر پیام برداشته می‌شود؛ وقتی دکمه‌ای نماند جمله‌ی راهنمای کپشن هم برداشته می‌شود
  let rows = ((cq.message?.reply_markup?.inline_keyboard ?? []) as { text: string; callback_data?: string }[][])
    .map((row) => row.filter((x) => !isButtonOf(x.callback_data, kind))).filter((row) => row.length);
  // وقتی همه‌ی دکمه‌های Gamma ساخته شدند، عنوان «خروجی‌های Gamma» هم برداشته می‌شود
  if (!rows.some((row) => row.some((x) => /^ex:g[a-z]:/.test(x.callback_data ?? "")))) rows = rows.filter((row) => !row.some((x) => x.callback_data === GAMMA_HEADER));
  const left = rows.some((row) => row.some((x) => /^(ex:(?!g[a-z]:)|au:|pc:)/.test(x.callback_data ?? ""))); // فقط دکمه‌های همراه‌های عمومی؛ Gamma جمله‌ی راهنمای کپشن را نگه نمی‌دارد
  const caption: string | undefined = cq.message?.caption;
  const hint = extrasHint([[{ text: "", callback_data: "" }]]).trim();
  if (!left && caption && caption.endsWith(hint)) {
    await tg(env, "editMessageCaption", {
      chat_id: chatId, message_id: cq.message.message_id, caption: caption.slice(0, caption.length - hint.length).replace(/\s+$/, ""), caption_entities: cq.message.caption_entities ?? [], reply_markup: { inline_keyboard: rows },
    }).catch(() => {});
  } else {
    await tg(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: rows } }).catch(() => {});
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
  if (act === "h") { // دکمه‌های منوی اصلی (homeKb)
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
    if (a === "credit") return await showCredit(env, chatId, uid, userId);
    if (a === "set") return await showSettings(env, chatId, uid);
    if (a === "files") return await showFiles(env, chatId, uid);
    if (a === "inv") return await showInvite(env, chatId, userId);
    if (a === "pf") return await showProfile(env, chatId, userId, uid);
    if (a === "site") return await showSite(env, chatId, userId);
    if (a === "sup") return await showSupport(env, chatId, userId, uid);
    if (a === "menu") return await sendMessage(env, chatId, HOME_TEXT, homeKb(env, userId, isAdmin(env, userId)));
    if (a === "admin" && isAdmin(env, userId)) return await handleAdmin(env, chatId, "/admin", [], "/admin", userId);
    return;
  }
  if (act === "sup") { // «❌ پایان گفتگو» در پشتیبانی هوشمند
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
    await env.KV.delete(supKey(userId)).catch(() => {});
    return await sendMessage(env, chatId, "✅ گفتگو با دستیار تمام شد. هر وقت خواستی موضوع ارائه‌ات را بفرست.", kb([[{ text: "🏠 منوی اصلی", callback_data: "h:menu" }]]));
  }
  if (act === "pf") return await handleProfileCallback(env, cq, userId, chatId, a, b); // ثبت موبایل/ایمیل با OTP (bot-profile.ts)
  if (act === "bc") return await handleBroadcastCallback(env, cq);
  if (act === "af") return await handleAdminFileCallback(env, cq);
  if (act === "as" || act === "ap" || act === "ar") return await handleAdminSampleCallback(env, cq);
  if (act === "n") return await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {}); // عنوان بخش (بی‌اثر)
  if (act === "p") return await handlePending(env, cq, uid, userId, chatId, mid, a, b);
  if (act === "g") return await sendDeckPdf(env, cq, uid, chatId, a);
  if (act === "au" || act === "pc") return await startExtraButton(env, cq, uid, userId, chatId, act === "pc" ? "podcast" : "audio", a);
  if (act === "ex") {
    const x = extraOfCode(a);
    if (!x) return await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
    return await startExtraButton(env, cq, uid, userId, chatId, x.kind, b, x.layout);
  }
  if (act === "fb") { // دکمه‌ی «ارسال نظر» زیر ارائه: پیام متنی بعدی کاربر برای مدیر فرستاده می‌شود
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
    const survey = a === "p"; // fb:p = دکمه‌ی نظرسنجی پایان پلن (plan-feedback.ts)؛ پیامش کپشن ارائه ندارد
    const title = survey ? "نظرسنجی پایان پلن" : String(cq.message?.caption ?? "").split("\n")[0].replace(/^✅\s*/, "").slice(0, 120);
    await env.KV.put(fbKey(userId), title || "-", { expirationTtl: 600 });
    // دکمه‌ی نظر فقط یک بار: بعد از زدن حذف می‌شود (دکمه‌ی PDF، اگر هست، می‌ماند)
    const rows = ((cq.message?.reply_markup?.inline_keyboard ?? []) as { callback_data?: string }[][]).filter((r) => !r.some((x) => x.callback_data?.startsWith("fb:")));
    await tg(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: mid, reply_markup: { inline_keyboard: rows } }).catch(() => {});
    if (survey) return await sendMessage(env, chatId,
      "💬 ممنون که پلنت را امتحان کردی! 😊\n\n" +
      "از چه چیزی راضی بودی؟ چه چیزی کم بود یا اذیتت کرد؟ و چرا (یا چرا نه) پلن را تمدید می‌کنی؟ راحت و خودمونی همین‌جا در <b>یک پیام</b> بنویس و بفرست.\n\n" +
      "نظرت مستقیم به دست خود ما می‌رسه و تک‌تکشون را می‌خونیم. 🙏\n\n" +
      "<i>اگر پشیمون شدی، کافیه یک دستور (مثل /start) بفرستی تا لغو بشه.</i>");
    return await sendMessage(env, chatId,
      "💬 خیلی خوشحال می‌شیم نظرت را بشنویم! 😊\n\n" +
      "ارائه چطور شد؟ از چه چیزش راضی بودی و چه چیزی می‌تونست بهتر باشه؟ اگر مشکلی دیدی، ایده‌ای برای بهتر شدن ربات داری یا هر حرف دیگه‌ای هست، راحت و خودمونی همین‌جا در <b>یک پیام</b> بنویس و بفرست.\n\n" +
      "نظرت مستقیم به دست خود ما می‌رسه و تک‌تکشون را می‌خونیم؛ همین نظرها کمک می‌کنه ربات هر روز بهتر بشه. 🙏\n\n" +
      "<i>اگر پشیمون شدی، کافیه یک دستور (مثل /start) بفرستی تا لغو بشه.</i>");
  }
  if (act === "f") {
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
    const f = await loadFile(env, uid, a);
    if (!f) return await sendMessage(env, chatId, "⌛️ این فایل منقضی شده است (فایل‌ها ۲۴ ساعت نگه داشته می‌شوند).");
    // ارائه‌ی دوباره‌فرستاده‌شده: دکمه‌ی همراه‌هایی که هنوز ساخته نشده‌اند (پوستر، جزوه، اسلاید صوتی، پادکست) زیرش هم می‌آید
    const sm = isSampleId(a) ? await sampleById(env, a) : undefined;
    if (sm) { // نمونه‌ی دائمی: بایت‌های اصلی با کپشن آماده‌ی خودش؛ بدون دکمه‌ی ساخت همراه
      const cap = `${sampleCaption(sm)}\n<i>(${SAMPLE_BADGE})</i>`;
      if (sm.kind === "podcast") { // پخش‌کننده‌ی صوتی تلگرام (کنترل سرعت و جلو/عقب)؛ همان روش ارسال پادکست واقعی
        const wav = new Uint8Array(f.data);
        return await sendAudio(env, chatId, wav, f.entry.name, cap, { title: sm.title, performer: siteHost(env), duration: audioSeconds(wav) });
      }
      return await sendDocument(env, chatId, new Uint8Array(f.data), f.entry.name, cap, { mime: sampleMime(sm) });
    }
    if (isAudioName(f.entry.name)) {
      const wav = new Uint8Array(f.data);
      return await sendAudio(env, chatId, wav, f.entry.name, `${/-podcast(-\d+)?$/.test(a) ? "🎙" : "🔊"} <b>${esc(f.entry.title)}</b>`, { title: f.entry.title, ...(/-podcast(-\d+)?$/.test(a) ? { performer: siteHost(env) } : {}), duration: audioSeconds(wav) });
    }
    const isDeck = isMainDeck(a, f.entry.name); // اسلاید صوتی هم .pptx است ولی ارائه‌ی اصلی نیست: دکمه‌ی همراه نمی‌گیرد
    const gAdmin = isGammaAdmin(env, userId); // مدیر در تلگرام: دکمه‌های Gamma (ساخته‌نشده‌ها) هم می‌آید
    const xrows = isDeck ? extraButtons(env, a, await madeExtras(env, uid, a, undefined, gAdmin ? ALL_EXTRA_KINDS : undefined).catch(() => new Set<ExtraKind>(ALL_EXTRA_KINDS)), gAdmin) : [];
    return await sendDocument(env, chatId, new Uint8Array(f.data), f.entry.name, `✅ <b>${esc(f.entry.title)}</b>${extrasHint(xrows)}`,
      /\.(png|jpe?g)$/i.test(f.entry.name) ? { mime: /\.png$/i.test(f.entry.name) ? "image/png" : "image/jpeg" }
        : /\.docx$/i.test(f.entry.name) ? { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
        : xrows.length ? { reply_markup: { inline_keyboard: xrows } } : undefined);
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
    if (a === "images") { // خیر ← نرمال ← زیاد (فقط پلن‌دارها) ← خیر
      if (!wantsImgs(s)) { s.images = true; s.imagesMany = false; }
      else if (!s.imagesMany && caps.premium) s.imagesMany = true;
      else { s.images = false; s.imagesMany = false; }
    }
    if (a === "digits") s.digits = !s.digits;
    if (a === "mode") {
      if (!caps.premium) return await alertLimit(EXTRA_MODE_MSG); // حالت‌های دارای حداقل اسلاید فقط برای پلن‌دارها
      s.mode = nextMode(s.mode);
    }
    if (a === "sources") s.sources = !s.sources;
    if (a === "questions") s.questions = !s.questions;
    if (a === "notes") s.notes = s.notes === false;
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
    if (a === "imgs" && Number.isInteger(Number(b)) && Number(b) >= 0) s.images = Number(b) > 0; // دکمه‌های قدیمی
    if (a === "model") {
      const m = modelList(env)[Number(b)];
      if (m && !m.free && !caps.premium) return await alertLimit(EXTRA_MODEL_MSG);
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

// ---------- نظر کاربر (دکمه‌ی «ارسال نظر» بعد از ساخت ارائه) ----------
const fbKey = (tgId: number) => `fb:${tgId}`;
/** پیام بعدیِ کاربری که دکمه‌ی نظر را زده؛ فقط برای مدیرها فرستاده می‌شود و ذخیره نمی‌شود. true = پیام مصرف شد */
async function handleFeedback(env: Env, msg: any, userId: number, uid: Uid, chatId: number, text: string, isCmd: boolean): Promise<boolean> {
  const title = await env.KV.get(fbKey(userId));
  if (title === null) return false;
  if (isCmd || !text) { // دستور یا پیام غیرمتنی: حالت نظر لغو می‌شود و پیام عادی پردازش می‌شود
    await env.KV.delete(fbKey(userId)).catch(() => {});
    return false;
  }
  const canReward = !isAdmin(env, userId) && FEEDBACK_CREDITS > 0 && !(await hasFeedbackReward(env, uid));
  if (canReward && text.length < FEEDBACK_MIN_CHARS) { // نظر خیلی کوتاه: حالت نظر می‌ماند تا کاربر کامل‌تر بنویسد
    await env.KV.put(fbKey(userId), title, { expirationTtl: 600 }).catch(() => {});
    await sendMessage(env, chatId, "✍️ نظرت خیلی کوتاه بود! لطفاً کمی کامل‌تر (حداقل یکی-دو جمله) بنویس و بفرست.");
    return true;
  }
  await env.KV.delete(fbKey(userId)).catch(() => {});
  const rewarded = canReward && (await claimFeedbackReward(env, uid).catch((e) => { console.error("feedbackReward", e); return false; }));
  const from = msg.from;
  const who = isBaleId(userId) || isRubikaId(userId) || isSplusId(userId)
    ? `${esc(displayName(from) || String(userId))} <i>(${isSplusId(userId) ? "سروش‌پلاس" : isRubikaId(userId) ? "روبیکا" : "بله"})</i>${from.username ? ` (@${esc(from.username)})` : ""}` // لینک tg://user برای کاربر بله کار نمی‌کند
    : `<a href="tg://user?id=${userId}">${esc(displayName(from) || String(userId))}</a>${from.username ? ` (@${esc(from.username)})` : ""}`;
  const out = `💬 <b>نظر کاربر</b>\n👤 ${who}\n🆔 <code>${userId}</code>\n📄 ارائه: ${esc(title)}${rewarded ? `\n🎁 ${toFa(String(FEEDBACK_CREDITS))} اعتبار هدیه داده شد` : ""}\n\n${esc(text.slice(0, 2000))}`;
  const adminKb = kb([[{ text: "👤 کارت کاربر", callback_data: `ad:nu:${userId}` }, { text: "🗂 فایل‌ها", callback_data: `ad:nd:${userId}` }]]);
  for (const id of adminIds(env)) await sendMessage(env, Number(id), out, adminKb).catch(() => {});
  await sendMessage(env, chatId, rewarded
    ? `🙏 ممنون از نظرت! پیامت به دست ما رسید.\n\n🎁 به‌خاطر ثبت نظرت، <b>${toFa(String(FEEDBACK_CREDITS))} اعتبار رایگان</b> (یک ارائه‌ی دیگر) به حسابت اضافه شد. موجودی: /credit`
    : "🙏 ممنون از نظرت! پیامت به دست ما رسید.");
  return true;
}

// ---------- پشتیبانی هوشمند (حالت گفتگو) ----------
// در ربات هر پیام متنی عادی «موضوع ارائه» است، پس گفتگو با دستیار یک حالت جدا دارد: کاربر با /support یا دکمه‌ی «🤖 پشتیبانی هوشمند»
// وارد می‌شود و تا وقتی در حالت است پیام متنی‌اش سؤال از دستیار است. هر دستور، فایل یا دکمه‌ی «❌ پایان گفتگو» از حالت خارج می‌کند.
// گفتگو، سقف روزانه و ارجاع به مدیر همان دستیار سایت و اپ است (support-chat.ts؛ حساب وب خودکارِ کاربر ربات).
const supKey = (userId: number) => `sup:${userId}`;
const SUP_TTL = 1800; // بعد از ۳۰ دقیقه بی‌فعالیتی حالت گفتگو خودبه‌خود تمام می‌شود
const supKb = () => kb([[{ text: "❌ پایان گفتگو", callback_data: "sup:x" }]]);

async function showSupport(env: Env, chatId: number, userId: number, uid: Uid) {
  if (typeof uid !== "string") return await sendMessage(env, chatId, "🤖 دستیار هوشمند پشتیبانی برای کاربران است؛ حساب مدیر پروفایل کاربری ندارد.");
  await env.KV.put(supKey(userId), "1", { expirationTtl: SUP_TTL });
  return await sendMessage(env, chatId,
    "🤖 <b>پشتیبانی هوشمند</b>\nهر سؤالی درباره‌ی قیمت و اعتبار، ساخت ارائه، مشکل فنی یا حتی نکته‌های طراحی و سخنرانی داری همین‌جا بنویس.\n\n" +
    "<i>تا وقتی در این گفتگو هستی پیام‌هایت سؤال از دستیار حساب می‌شود، نه موضوع ارائه. هر دستور، فایل یا دکمه‌ی زیر از گفتگو خارجت می‌کند.</i>", supKb());
}

/** پیام بعدیِ کاربری که در حالت گفتگوی پشتیبانی است. true = پیام مصرف شد؛ دستور یا پیام غیرمتنی از حالت خارج می‌کند و پیام عادی پردازش می‌شود */
async function handleSupportInput(env: Env, chatId: number, userId: number, uid: Uid, text: string, isCmd: boolean): Promise<boolean> {
  if (!(await env.KV.get(supKey(userId)))) return false;
  if (isCmd || !text) { await env.KV.delete(supKey(userId)).catch(() => {}); return false; }
  if (text.length > SUPPORT_MAX_TEXT) {
    await sendMessage(env, chatId, `پیامت خیلی بلند است (حداکثر ${toFa(String(SUPPORT_MAX_TEXT))} نویسه)؛ کوتاه‌تر بنویس.`, supKb());
    return true;
  }
  await env.KV.put(supKey(userId), "1", { expirationTtl: SUP_TTL }).catch(() => {});
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {}); // «در حال نوشتن…»؛ در پیام‌رسان‌هایی که ندارند بی‌اثر است
  const r = await supportBotAsk(env, uid, text, botPlatform(userId));
  await sendMessage(env, chatId, esc(r.text), supKb());
  return true;
}

// ---------- منوی اصلی دکمه‌ای (/start، /help، /menu) ----------
// هر دکمه همان کار دستور هم‌نامش را انجام می‌دهد؛ دستورها همچنان کار می‌کنند. callback: h:<کار>
const HOME_TEXT = "🏠 <b>منوی اصلی</b>\nیکی از گزینه‌ها را بزن، یا همین‌جا <b>موضوع ارائه</b> را بنویس و بفرست.";
function homeKb(env: Env, tgId: number, admin: boolean) {
  const rows: Btn[][] = [
    [{ text: "📱 ساخت ارائه (اپ)", web_app: { url: `${miniappUrl(env)}/app` } } as Btn],
    [{ text: "💳 اعتبار و پلن", callback_data: "h:credit" }, { text: "⚙️ تنظیمات", callback_data: "h:set" }],
    [{ text: "📁 فایل‌های من", callback_data: "h:files" }, { text: "🎁 دعوت دوستان", callback_data: "h:inv" }],
    [{ text: "👤 پروفایل", callback_data: "h:pf" }, { text: "🌐 سایت و خرید پلن", callback_data: "h:site" }],
    [{ text: "🤖 پشتیبانی هوشمند", callback_data: "h:sup" }],
  ];
  if (admin) rows.push([{ text: "🛠 پنل مدیریت", callback_data: "h:admin" }]);
  return kb(rows);
}

async function showApp(env: Env, chatId: number) {
  return await sendMessage(env, chatId, "📱 با دکمه‌ی زیر اپ ساخت ارائه باز می‌شود (ساخت، فایل‌ها، تنظیمات و اعتبار، همه با همین حساب).",
    { reply_markup: { inline_keyboard: [[{ text: "📱 باز کردن اپ", web_app: { url: `${miniappUrl(env)}/app` } }]] } });
}
async function showSite(env: Env, chatId: number, userId: number) {
  return await sendMessage(env, chatId, "🌐 با دکمه‌ی زیر بدون ثبت‌نام و رمز، با همین حساب تلگرامت وارد سایت می‌شوی (پلن‌ها، پرداخت آنلاین، پروفایل).",
    kb([[{ text: "🌐 ورود به سایت", url: await siteLoginUrl(env, userId, "home") }]]));
}
async function showSettings(env: Env, chatId: number, uid: Uid) {
  const [s, caps] = await Promise.all([getSettings(env, uid), getCaps(env, uid)]);
  const { text: t, ...extra } = mainMenu(env, s, caps);
  return await sendMessage(env, chatId, t, extra);
}
async function showFiles(env: Env, chatId: number, uid: Uid) {
  const list = await listFiles(env, uid);
  const mineRows = list.map((f) => /\.(png|jpe?g)$/i.test(f.name)
      ? [{ text: `🖼 ${f.title.slice(0, 32)} (پوستر)`, callback_data: `f:${f.id}` }]
      : /\.docx$/i.test(f.name)
      ? [{ text: `📝 ${f.title.slice(0, 32)} (جزوه)`, callback_data: `f:${f.id}` }]
      : isAudioName(f.name) || /-podcast(-\d+)?$/.test(f.id)
      ? [{ text: `🎙 ${f.title.slice(0, 32)} (پادکست)`, callback_data: `f:${f.id}` }]
      : /-audio(-s\d+)?$/.test(f.id)
      ? [{ text: `🔊 ${f.title.slice(0, 32)} (اسلاید صوتی)`, callback_data: `f:${f.id}` }]
      : [
        { text: `📥 ${f.title.slice(0, 32)} (${toFa(String(f.slides))} اسلاید)`, callback_data: `f:${f.id}` },
        ...(hasBrowser(env) ? [{ text: "📄 PDF", callback_data: `g:${f.id}` }] : []),
      ]);
  // نمونه‌های دائمی (برچسب «نمونه»): همیشه پایین فهرست می‌آیند و منقضی نمی‌شوند
  const samples = await listSamples(env).catch(() => []);
  const sampleRows = samples.map((s) => [{ text: `${sampleLabel(s)} · ${s.title.slice(0, 26)} (${SAMPLE_BADGE})`, callback_data: `f:${s.id}` }]);
  return await sendMessage(env, chatId,
    (list.length ? "📁 <b>فایل‌های ۲۴ ساعت اخیر</b>\nبرای دریافت دوباره، یکی را بزن:\n\n" : "📁 فایلی برای ۲۴ ساعت اخیر نداری. فایل هر ارائه بعد از ساخته شدن تا ۲۴ ساعت اینجا می‌ماند.\n\n")
    + (samples.length ? `🧪 <b>نمونه‌ها</b> (همیشه در دسترس): نمونه‌ی خروجی‌های ربات را ببین.` : ""),
    kb([...mineRows, ...sampleRows]));
}
async function showInvite(env: Env, chatId: number, userId: number) {
  // لینک اختصاصی هر پلتفرم (تلگرام/بله/روبیکا: لینک ربات؛ ایتا: لینک برنامک)؛ شمارنده روی شناسه‌ی پیام‌رسان است (همان کلیدی که completeReferral می‌شمارد)
  const link = await inviteLinkFor(env, userId).catch(() => "");
  if (!link) return await sendMessage(env, chatId, "ساخت لینک دعوت ممکن نشد؛ کمی بعد دوباره امتحان کن.");
  const done = Math.min(REF_MAX, Number(await env.KV.get(`refc:${userId}`).catch(() => null)) || 0);
  return await sendMessage(env, chatId, inviteBody(link, done), inviteMarkup(userId, link)); // دکمه‌ی اشتراک‌گذاری t.me فقط برای تلگرام
}
async function showCredit(env: Env, chatId: number, uid: Uid, userId: number) {
  const granted = await grantDailyFree(env, uid).catch(() => false); // اعتبار صفر ⇒ سهم رایگان امروز
  const [c, sub, caps] = await Promise.all([getCredit(env, uid), getActiveSub(env, uid), getCaps(env, uid)]);
  const planName = sub ? (PLANS.find((p) => p.id === sub.plan)?.name ?? sub.plan) : "";
  const head = c.unlimited ? "💳 اعتبار شما <b>نامحدود</b> است.\n"
    : (granted ? "🎁 اعتبار رایگان امروزت اضافه شد.\n" : "") + `💳 اعتبار باقی‌مانده: <b>${toFa(String(c.total))}</b> ارائه\n` +
      (sub ? `• اعتبار پلن: ${toFa(String(sub.credits))}\n` : "") +
      (c.bonus > 0 ? `• اعتبار هدیه و شارژ: ${toFa(String(c.bonus))}\n` : "");
  const out = head +
    `👑 ${sub ? `پلن ${planName} تا ${fmtDate(sub.exp)}` : "پلن رایگان"}\n` +
    `📄 حداکثر ${toFa(String(caps.maxSlides))} اسلاید و 🖼 ${toFa(String(caps.maxImg))} تصویر در هر ارائه\n` +
    (c.unlimited ? "" : `\n<b>📋 پلن‌ها</b> (ماهانه)\n${plansText(sub?.plan)}\n\n${BUY_SITE_NOTE}`);
  return await sendMessage(env, chatId, out, c.unlimited ? undefined : await buyKbFor(env, uid, userId));
}

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
  if (admin && (cmd === "/apppush" || cmd === "/apppush_send")) return await appPushCommand(env, chatId, text); // اعلان به اپ اندروید (FCM)
  if (admin && cmd === "/appver") return await appVerCommand(env, chatId, text); // نسخه‌ی اپ اندروید: آخرین / حداقل مجاز
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
  if (admin && !cmd && text && !msg.document && !msg.photo && !msg.voice && !msg.audio && (await handleAdminInput(env, chatId, userId, text).catch((e) => { console.error("admin input", e); return false; }))) return;

  if (!msg.document && !msg.photo && !msg.voice && !msg.audio && (await handleFeedback(env, msg, userId, uid, chatId, text, !!cmd).catch((e) => { console.error("feedback", e); return false; }))) return;

  // شماره‌ی اشتراک‌گذاری‌شده از Mini App (requestContact تلگرام/بله): ثبت بدون OTP؛ خطایش جلوی ادامه‌ی پیام را نمی‌گیرد
  if (msg.contact && (await handleSharedContact(env, msg, userId, chatId).catch((e) => { console.error("shared contact", e); return true; }))) return;

  if (!msg.document && !msg.photo && !msg.voice && !msg.audio && (await handleContactSkip(env, chatId, text))) return; // «فعلاً نه» زیر درخواست شماره

  // مرحله‌های ثبت موبایل/ایمیل (شماره/ایمیل ← کد OTP): پیام متنی بعدی کاربر ورودی همان مرحله است
  if (!msg.document && !msg.photo && !msg.voice && !msg.audio && (await handleProfileInput(env, userId, chatId, text, !!cmd).catch((e) => { console.error("profile input", e); return false; }))) return;

  // حالت گفتگوی پشتیبانی هوشمند: پیام متنی سؤال از دستیار است؛ دستور/فایل از حالت خارج می‌کند و ادامه می‌یابد
  if (await handleSupportInput(env, chatId, userId, uid, text, !!cmd).catch((e) => { console.error("support input", e); return false; })) return;

  if (cmd === "/profile") return await showProfile(env, chatId, userId, uid);
  if (cmd === "/link" || cmd === "/channels") return await showChannels(env, chatId, userId, uid); // وضعیت اتصال پلتفرم‌ها (اتصال فقط با تایید شماره؛ bot-profile.ts)
  if (cmd === "/app") return await showApp(env, chatId);
  if (cmd === "/site") return await showSite(env, chatId, userId);
  // دعوت دوستان: کاربر جدیدی که با لینک اختصاصی آمده فقط «دعوت در انتظار» ثبت می‌کند؛ وقتی اولین ارائه‌اش ساخته شد (referral.ts ← workflow.ts)
  // شمارنده‌ی دعوت‌کننده بالا می‌رود؛ هر ۳ دعوت موفق = ۱ اعتبار معمولی (تا ۵۱ دعوت)
  if (cmd === "/start" && isNew && args[0]?.startsWith("ref_")) {
    const inviter = parseRefId(args[0].slice(4)); // عدد (پیام‌رسان) یا w_… (دعوت‌کننده‌ی فقط‌وب/اپ)
    // دعوت‌کننده همان لحظه خبردار می‌شود که دوستش وارد شده؛ پاداش هنوز به ساخت اولین ارائه‌ی دوست بسته است
    if (inviter !== null && await holdReferral(env, inviter, userId).catch((e) => { console.error("referral hold", e); return false; })) await notifyInviterJoined(env, inviter);
  }
  if (cmd === "/files") return await showFiles(env, chatId, uid);
  if (cmd === "/support") return await showSupport(env, chatId, userId, uid);
  if (cmd === "/invite") return await showInvite(env, chatId, userId);

  if (cmd === "/credit" || cmd === "/balance") return await showCredit(env, chatId, uid, userId);
  if (cmd === "/start") await env.KV.delete(`blk:${userId}`).catch(() => {}); // اگر ربات را بلاک کرده بود و دوباره آمد (بلاک‌برداشتن = /start)، به فهرست پیام همگانی برمی‌گردد
  if (cmd === "/start" || cmd === "/help") return await sendMessage(env, chatId, helpText(env), homeKb(env, userId, admin));
  if (cmd === "/menu") return await sendMessage(env, chatId, HOME_TEXT, homeKb(env, userId, admin));
  if (cmd === "/settings") return await showSettings(env, chatId, uid);
  if (cmd) return await sendMessage(env, chatId, "دستور ناشناخته است. منوی دکمه‌ای:", homeKb(env, userId, admin));

  // آپلود فایل (سند یا عکس): متن فایل منبع ارائه می‌شود؛ کپشن (اگر باشد) موضوع است، وگرنه نام فایل
  const ref = fileRefOf(msg);
  if (ref) {
    const caption = String(msg.caption ?? "").replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim();
    const { topic: capTopic } = extractSlideCount(caption);
    if (capTopic.length > 600) return await sendMessage(env, chatId, "موضوع بیش از حد طولانی است (حداکثر ۶۰۰ کاراکتر).");
    // آلبوم (چند عکس/فایل با یک media_group_id): تلگرام هر عکس را پیام جدا می‌فرستد. اولی «رهبر» می‌شود و بقیه فقط ثبت می‌شوند؛
    // OcrWorkflow چند ثانیه صبر می‌کند، همه را به‌ترتیب می‌خواند و یک کارت می‌سازد (به‌جای یک کارت و OCR جدا برای هر عکس)
    const gid = msg.media_group_id ? String(msg.media_group_id) : "";
    let group: string | undefined;
    if (gid && env.OCR_WORKFLOW && !ref.isAudio) { // آلبوم فقط برای عکس؛ هر ویس/فایل صوتی جدا خوانده می‌شود
      const gk = `mg:${chatId}:${gid}`;
      if (!(await env.KV.get(`${gk}:done`))) { // بعد از شروع خواندن آلبوم، عکس دیررسیده مثل فایل تکی رفتار می‌کند
        await env.KV.put(`${gk}:i:${String(msg.message_id).padStart(12, "0")}`, JSON.stringify({ ref, caption }), { expirationTtl: 600 });
        if (await hitLimit(env, `${gk}:lead`, 1, 600)) return; // رهبر دیگری هست
        group = gk;
      }
    }
    const gate = await wizardGate(env, chatId, uid, userId);
    if (!gate) return;
    const wait = await sendMessage(env, chatId, ref.isAudio ? "🎙 در حال تبدیل صدا به متن…" : "⏳ در حال خواندن فایل…");
    // PDF و عکس ممکن است OCR شوند (چند ده ثانیه)؛ waitUntil فقط ~۳۰ ثانیه فرصت دارد، پس در Workflow اجرا می‌شود
    const heavy = ref.isPhoto || ref.isAudio || ref.mime === "application/pdf" || ref.mime.startsWith("image/") || /\.(pdf|png|jpe?g)$/i.test(ref.name);
    if (heavy && env.OCR_WORKFLOW) {
      try {
        await env.OCR_WORKFLOW.create({ id: `ocr-${chatId}-${Date.now()}`, params: { chatId, userId, uid, ref, caption, waitId: wait.message_id, ...(group ? { group } : {}) } });
        return;
      } catch (e) {
        console.error("ocr workflow create", e instanceof Error ? e.message : e); // ناموفق ⇒ مسیر درون‌خطی
      }
    }
    return await finishFileUpload(env, chatId, uid, userId, ref, caption, await extractTelegramFile(env, ref, uid), wait.message_id);
  }

  if (!text) return await sendMessage(env, chatId, `لطفاً موضوع ارائه را به‌صورت <b>متن</b> یا <b>ویس</b> بفرست؛ یا یک فایل (${SUPPORTED_NOTE}) تا ارائه از روی محتوایش ساخته شود.`);

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
  // ویس/فایل صوتی: متن کوتاه (تا ۶۰۰ نویسه و بدون کپشن) همان «موضوع» است، مثل پیام متنی (تعداد اسلاید و حالت هم از لابه‌لای حرفت فهمیده می‌شود)؛ متن بلندتر منبع ارائه می‌شود
  if (ref.isAudio) {
    const spoken = ex.text.trim();
    if (capTopic.length < 3 && spoken.length <= 600) {
      const sp = extractSlideCount(spoken);
      if (sp.topic.length >= 3) { await showWizard(env, chatId, uid, gate, { topic: sp.topic, slides: sp.slides, mode: sp.mode, cardId: waitId, orig: spoken }); return null; }
    }
    const aTopic = capTopic.length >= 3 ? capTopic : "ارائه از روی پیام صوتی";
    await showWizard(env, chatId, uid, gate, { topic: aTopic, slides: capSlides, mode: capMode, source: spoken, file: ref.name === "voice.ogg" ? "پیام صوتی" : ref.name, cardId: waitId, orig: caption });
    return null;
  }
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
  if (await grantDailyFree(env, uid).catch(() => false)) await sendMessage(env, chatId, DAILY_FREE_MSG).catch(() => {}); // اعتبار صفر ⇒ سهم رایگان امروز
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
  const modeOk = !o.mode || caps.premium || MODES[o.mode].minSlides === 0; // حالتِ نوشته‌شده در متن: دارای حداقل اسلاید فقط برای پلن‌دارها
  const pend: Pending = {
    topic: o.topic, mid: 0,
    ...(o.orig?.trim() ? { orig: o.orig.replace(/\s+/g, " ").trim().slice(0, 300) } : {}),
    slides: Math.min(o.slides ?? s.slides, caps.maxSlides),
    imgs: wantsImgs(s),
    many: wantsMany(s, caps),
    model: models.some((m) => m.id === s.model) ? (s.model as string) : (models[0]?.id ?? ""),
    poster: "wide", // پیش‌فرض: با پوستر افقی
    handout: false, // جزوه‌ی Word: پیش‌فرض خاموش (۱ اعتبار)
    audio: false, // اسلاید صوتی: پیش‌فرض خاموش (۱ اعتبار)
    podcast: false, // پادکست: پیش‌فرض خاموش (۱ اعتبار)
    step: "model",
    fixed: o.slides !== undefined, // تعداد اسلاید در متن موضوع آمده؛ دوباره پرسیده نمی‌شود
    ...(o.mode && modeOk ? { mode: o.mode } : {}),
    note: o.slides !== undefined && o.slides > caps.maxSlides ? slidesLimitMsg(caps.maxSlides)
      : o.mode && !modeOk ? EXTRA_MODE_MSG.replace("🔒 ", "") + " این ارائه با حالت «عادی» ساخته می‌شود."
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
