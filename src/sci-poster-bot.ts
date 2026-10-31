/**
 * رابط تلگرام «پوستر علمی چاپی» (فقط مدیر): دستور /poster ← کارت تنظیمات (اندازه، جهت، زبان، تم، bleed) ← «ارسال متن مقاله» ← Workflow.
 * ورودی: پیام متنی (چکیده/متن مقاله) یا فایل (PDF، Word، PowerPoint، …)؛ خواندن فایل داخل Workflow انجام می‌شود (OCR ممکن است طول بکشد).
 * بدون اعتبار و بدون محدودیت پلن (مدیر)؛ نشانگر ورودی در KV ده دقیقه می‌ماند.
 */
import type { Env } from "./env";
import { editMessage, sendMessage, tg } from "./telegram";
import { isAdmin, getSettings, type Uid } from "./settings";
import { hasBrowser } from "./browser-api";
import { hasKey } from "./llm";
import { fileRefOf } from "./tg-file";
import { DEFAULT_CFG, POSTER_SIZES, POSTER_THEMES, normalizeCfg, posterGeometry, sizeLabel, type PosterCfg } from "./sci-poster";
import { THEMES } from "./themes";
import { toFa } from "./util";

const IN_TTL = 600;
const MIN_CHARS = 200; // کمتر از این برای ساخت پوستر بدون ساختن محتوا کافی نیست
const MAX_CHARS = 60_000;

const cfgKey = (adminId: number) => `sp:cfg:${adminId}`;
const inKey = (adminId: number) => `sp:in:${adminId}`;

async function loadCfg(env: Env, adminId: number): Promise<PosterCfg> {
  try { const raw = await env.KV.get(cfgKey(adminId)); return raw ? normalizeCfg(JSON.parse(raw)) : { ...DEFAULT_CFG }; }
  catch { return { ...DEFAULT_CFG }; }
}
const saveCfg = (env: Env, adminId: number, c: PosterCfg) => env.KV.put(cfgKey(adminId), JSON.stringify(c), { expirationTtl: 30 * 24 * 3600 });

type Btn = { text: string; callback_data: string };
function cardText(c: PosterCfg): string {
  const g = posterGeometry(c);
  const inch = (mm: number) => toFa((mm / 25.4).toFixed(1)).replace(".", "٫");
  return "🔬 <b>پوستر علمی چاپی</b>\n\n" +
    `📐 اندازه: <b>${sizeLabel(c)}</b>\n` +
    `   ≈ ${inch(g.pageW)} × ${inch(g.pageH)} اینچ${g.bleed ? ` (با bleed ${toFa(String(g.bleed))}mm در هر لبه)` : ""}\n` +
    `🌐 زبان پوستر: <b>${c.lang === "fa" ? "فارسی (راست‌به‌چپ)" : "English (LTR)"}</b>\n` +
    `🎨 تم: <b>${THEMES[c.theme]?.name ?? c.theme}</b>\n\n` +
    "<i>تنظیمات را انتخاب کن، بعد «✍️ ارسال متن مقاله» را بزن و چکیده/متن مقاله یا فایل آن را بفرست.</i>";
}
function cardKb(c: PosterCfg): { inline_keyboard: Btn[][] } {
  const mark = (on: boolean, t: string) => (on ? `✅ ${t}` : t);
  return {
    inline_keyboard: [
      POSTER_SIZES.map((s) => ({ text: mark(c.size === s, s), callback_data: `sp:z:${s}` })),
      [{ text: mark(c.orient === "p", "↕️ عمودی"), callback_data: "sp:o:p" }, { text: mark(c.orient === "l", "↔️ افقی"), callback_data: "sp:o:l" }],
      [{ text: mark(c.lang === "fa", "فارسی"), callback_data: "sp:l:fa" }, { text: mark(c.lang === "en", "English"), callback_data: "sp:l:en" }],
      [{ text: `🎨 تم: ${THEMES[c.theme]?.name ?? c.theme}`, callback_data: "sp:t:n" }, { text: c.bleed ? "✂️ Bleed ۳mm: روشن" : "✂️ Bleed ۳mm: خاموش", callback_data: "sp:b:x" }],
      [{ text: "✍️ ارسال متن مقاله", callback_data: "sp:go:x" }, { text: "✖️ بستن", callback_data: "sp:x:x" }],
    ],
  };
}

export async function showSciPosterCard(env: Env, chatId: number, adminId: number) {
  const c = await loadCfg(env, adminId);
  return await sendMessage(env, chatId, cardText(c), { reply_markup: cardKb(c) });
}

/** دکمه‌های sp:<کار>:<مقدار> */
export async function handleSciPosterCallback(env: Env, cq: any) {
  const adminId: number = cq.from.id, chatId: number = cq.message.chat.id, mid: number = cq.message.message_id;
  const answer = (text?: string) => tg(env, "answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text: text.slice(0, 200) } : {}) }).catch(() => {});
  if (!isAdmin(env, adminId)) return await answer();

  const [, a, b] = String(cq.data ?? "").split(":");
  if (a === "x") { await answer(); await tg(env, "deleteMessage", { chat_id: chatId, message_id: mid }).catch(() => {}); return; }

  const c = await loadCfg(env, adminId);
  if (a === "z" && (POSTER_SIZES as string[]).includes(b)) c.size = b as PosterCfg["size"];
  else if (a === "o") c.orient = b === "l" ? "l" : "p";
  else if (a === "l") c.lang = b === "en" ? "en" : "fa";
  else if (a === "t") c.theme = POSTER_THEMES[(POSTER_THEMES.indexOf(c.theme as any) + 1) % POSTER_THEMES.length];
  else if (a === "b") c.bleed = !c.bleed;
  else if (a === "go") {
    await answer();
    await env.KV.put(inKey(adminId), "1", { expirationTtl: IN_TTL });
    const lim = `${toFa(String(MIN_CHARS))}`;
    await sendMessage(env, chatId,
      `✍️ حالا <b>متن مقاله</b> (حداقل ${lim} نویسه؛ چکیده، مقدمه، روش، نتایج، منابع) را در یک پیام بفرست، یا <b>فایل</b> مقاله را (PDF، Word، PowerPoint، …).\n\n` +
      "• نام نویسندگان، دانشگاه، نام کنفرانس و ایمیل را هم در متن بنویس تا در سربرگ بیاید؛ اگر نباشند، خالی می‌مانند و ساخته نمی‌شوند.\n" +
      "• فقط چیزی که در متن هست در پوستر می‌آید (داده، جدول و منبع ساخته نمی‌شود).\n\n" +
      "<i>۱۰ دقیقه اعتبار دارد؛ برای لغو /cancel.</i>");
    return;
  } else return await answer();

  await saveCfg(env, adminId, c);
  await answer();
  await editMessage(env, chatId, mid, cardText(c), { reply_markup: cardKb(c) });
}

/**
 * پیش از بقیه‌ی منطق پیام مدیر صدا زده می‌شود. true = پیام مصرف شد.
 *  • /poster ← کارت تنظیمات؛ هر دستور دیگر ورودیِ در انتظارِ پوستر را پاک می‌کند (تا پیام بعدی اشتباهی منبع پوستر نشود)
 *  • اگر ورودی در انتظار است: متن یا فایل بعدی منبع پوستر است
 */
export async function sciPosterIntercept(env: Env, msg: any, chatId: number, adminId: number, uid: Uid, text: string, cmd: string): Promise<boolean> {
  if (cmd) {
    if (cmd === "/poster") {
      await env.KV.delete(inKey(adminId)).catch(() => {});
      await showSciPosterCard(env, chatId, adminId);
      return true;
    }
    await env.KV.delete(inKey(adminId)).catch(() => {});
    return false;
  }
  if (!(await env.KV.get(inKey(adminId)).catch(() => null))) return false;

  const ref = fileRefOf(msg);
  if (!ref && !text) return false;
  if (!ref && text.length < MIN_CHARS) {
    await sendMessage(env, chatId, `متن کوتاه است (${toFa(String(text.length))} نویسه). برای اینکه پوستر از روی محتوای واقعی ساخته شود، حداقل ${toFa(String(MIN_CHARS))} نویسه بفرست (مثلاً چکیده و روش)، یا فایل مقاله را بفرست. برای لغو: /cancel`);
    return true;
  }
  if (!env.SCI_POSTER_WORKFLOW) { await sendMessage(env, chatId, "⚠️ Workflow پوستر علمی (SCI_POSTER_WORKFLOW) در wrangler.jsonc تعریف نشده است."); return true; }
  if (!hasBrowser(env)) { await sendMessage(env, chatId, "⚠️ ساخت PDF روی این سرویس فعال نیست (BROWSER یا BROWSER_ACCOUNTS تعریف نشده)."); return true; }
  if (!hasKey(env)) { await sendMessage(env, chatId, "⚠️ کلید API مدل زبانی تنظیم نشده است."); return true; }

  const cfg = await loadCfg(env, adminId);
  await env.KV.delete(inKey(adminId)).catch(() => {});
  const wait = await sendMessage(env, chatId, `🔬 پوستر ${sizeLabel(cfg)} در صف است… (چند دقیقه طول می‌کشد)`);
  const model = (await getSettings(env, uid).catch(() => null))?.model;
  try {
    await env.SCI_POSTER_WORKFLOW.create({
      id: `sp-${adminId}-${Date.now().toString(36)}`,
      params: { chatId, statusMessageId: wait.message_id, cfg, ...(model ? { model } : {}), ...(ref ? { ref } : { text: text.slice(0, MAX_CHARS) }) },
    });
  } catch (e) {
    console.error("sci poster workflow create", e instanceof Error ? e.message : e);
    await editMessage(env, chatId, wait.message_id, "❌ شروع ساخت پوستر ممکن نشد؛ کمی بعد دوباره امتحان کن.").catch(() => {});
  }
  return true;
}
