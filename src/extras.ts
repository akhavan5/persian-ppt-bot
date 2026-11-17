/**
 * همراهان «بعد از ساخت ارائه»: پوستر، جزوه‌ی Word، اسلاید صوتی و پادکست.
 * کاربر زیر هر ارائه (تلگرام، سایت، Mini App) برای هر کدام یک دکمه می‌بیند؛ هر دکمه ۱ اعتبار جدا می‌خواهد و فقط وقتی نشان داده می‌شود
 * که آن همراه برای همین ارائه ساخته نشده باشد (یا در حال ساخت نباشد).
 *
 * «ساخته شده/در حال ساخت» با یک نشانگر کوتاه در KV (ex:<کاربر>:<ارائه>:<نوع>) نگه داشته می‌شود:
 *  • DeckWorkflow برای همراه‌هایی که همراه ارائه خواسته شده نشانگر می‌گذارد؛
 *  • startExtra نشانگر را اتمی می‌گیرد (دوبار زدن دکمه فقط یک بار اعتبار کم می‌کند)؛
 *  • خطا ⇒ اعتبار برمی‌گردد و نشانگر پاک می‌شود تا دکمه دوباره دیده شود.
 */
import type { Env } from "./env";
import { getSettings, refundCredit, spendCredit, type Uid } from "./settings";
import { hitLimit } from "./auth";
import { listFiles, loadPreview, type FileEntry } from "./files";
import { audioEnabled, posterEnabled } from "./deck-service";
import { hasBrowser } from "./browser-api";
import { editMessage, sendMessage } from "./telegram";
import { GAMMA_CREDIT_COST, GAMMA_KINDS, GAMMA_SPECS, gammaEnabled, gammaSpec, isGammaKind, type GammaKind } from "./gamma";
import { toFa } from "./util";
import { isAdmin } from "./settings";
import { isBaleId } from "./bale-format";
import { isRubikaId } from "./rubika-format";
import { isEitaaId } from "./eitaa-format";
import { isSplusId } from "./splus-format";

export type BaseExtraKind = "poster" | "handout" | "audio" | "podcast";
/** همراه‌های ارائه: چهار همراه‌ی همه‌ی کاربران + خروجی‌های Gamma (فقط مدیر در تلگرام) */
export type ExtraKind = BaseExtraKind | GammaKind;
/** همراه‌های عمومی؛ وب و Mini App فقط همین‌ها را می‌شناسند (خروجی‌های Gamma اینجا نیستند) */
export const EXTRA_KINDS: BaseExtraKind[] = ["audio", "podcast", "handout", "poster"];
/** همه‌ی همراه‌ها (برای نشانگرها و دکمه‌های مدیر) */
export const ALL_EXTRA_KINDS: ExtraKind[] = [...EXTRA_KINDS, ...GAMMA_KINDS];
export { isGammaKind };
/** خروجی‌های Gamma فعلاً فقط برای مدیرِ تلگرام‌اند (نه بله/روبیکا/ایتا/سروش‌پلاس، نه وب) */
export const isGammaAdmin = (env: Env, tgId: unknown): boolean =>
  tgId !== undefined && tgId !== null && isAdmin(env, tgId as number) && !isBaleId(tgId) && !isRubikaId(tgId) && !isEitaaId(tgId) && !isSplusId(tgId);
/** نوع فایل صوتی از روی شناسه: اسلاید صوتی (…-audio و …-audio-sN) یا پادکست (…-podcast) */
export const audioKind = (id: string): "slides" | "podcast" | undefined => (/-audio(-s\d+)?$/.test(id) ? "slides" : /-podcast(-\d+)?$/.test(id) ? "podcast" : undefined);
/** فقط «ارائه‌ی اصلی» (نه پوستر/جزوه/اسلاید صوتی/پادکست): دکمه‌ی PDF و دکمه‌های ساخت همراه فقط برای این است */
export const isMainDeck = (id: string, name: string) => !/\.(png|jpe?g|docx|wav|mp3)$/i.test(name) && !audioKind(id) && !/-(poster|handout)$/.test(id);
export const EXTRA_NAME: Record<ExtraKind, string> = {
  poster: "پوستر", handout: "جزوه", audio: "اسلاید صوتی", podcast: "پادکست",
  ...(Object.fromEntries(GAMMA_SPECS.map((g) => [g.kind, `${g.name} Gamma`])) as Record<GammaKind, string>),
};

/** کد کوتاه دکمه‌ی تلگرام (ex:<کد>:<شناسه‌ی ارائه>)؛ پوستر برای هر چیدمان یک کد دارد */
const CODES: Record<string, { kind: ExtraKind; layout?: "wide" | "tall"; text: string }> = {
  a: { kind: "audio", text: "🔊 اسلاید صوتی" },
  c: { kind: "podcast", text: "🎙 پادکست" },
  h: { kind: "handout", text: "📝 جزوه (Word)" },
  pw: { kind: "poster", layout: "wide", text: "🖼 پوستر افقی" },
  pt: { kind: "poster", layout: "tall", text: "🖼 پوستر عمودی" },
  ...Object.fromEntries(GAMMA_SPECS.map((g) => [g.code, { kind: g.kind, text: g.button }])),
};
export const extraOfCode = (code: string) => CODES[code];
/** آیا callback_data این دکمه مال همین نوع همراه است؟ (شامل دکمه‌های قدیمی au:/pc: که فقط مدیر داشت) */
export const isButtonOf = (data: string | undefined, kind: ExtraKind): boolean => {
  if (!data) return false;
  if (kind === "audio" && data.startsWith("au:")) return true;
  if (kind === "podcast" && data.startsWith("pc:")) return true;
  const m = /^ex:([a-z]+):/.exec(data);
  return !!m && CODES[m[1]]?.kind === kind;
};

/** کدام همراه‌ها روی این سرویس روشن‌اند (وابسته به Browser Rendering، Workflowها و کلید Gemini) */
export const extraEnabled = (env: Env, kind: ExtraKind): boolean =>
  isGammaKind(kind) ? gammaEnabled(env) && !!env.GAMMA_WORKFLOW
    : kind === "poster" ? posterEnabled(env) && !!env.EXTRA_WORKFLOW
    : kind === "handout" ? !!env.EXTRA_WORKFLOW
    : audioEnabled(env);

// ---------- نشانگر «ساخته شده / در حال ساخت» ----------
const MARK_TTL = 26 * 3600; // کمی بیشتر از نگه‌داری ۲۴ ساعته‌ی فایل‌ها
const markKey = (uid: Uid, deckId: string, kind: ExtraKind) => `ex:${uid}:${deckId}:${kind}`;

export const markExtra = (env: Env, uid: Uid, deckId: string, kind: ExtraKind) =>
  env.KV.put(markKey(uid, deckId, kind), "1", { expirationTtl: MARK_TTL });
export const unmarkExtra = (env: Env, uid: Uid, deckId: string, kind: ExtraKind) =>
  env.KV.delete(markKey(uid, deckId, kind));

/** همراه‌هایی که برای این ارائه ساخته شده یا در حال ساخت‌اند. files = فهرست فایل‌های کاربر (اگر پیش‌تر خوانده شده)؛
 *  فایل‌های ساخته‌شده‌ی پیش از این قابلیت (بدون نشانگر) هم از روی شناسه‌شان شناخته می‌شوند. */
export async function madeExtras(env: Env, uid: Uid, deckId: string, files?: FileEntry[], kinds: ExtraKind[] = EXTRA_KINDS): Promise<Set<ExtraKind>> {
  const [marks, list] = await Promise.all([
    Promise.all(kinds.map(async (k) => ((await env.KV.get(markKey(uid, deckId, k)).catch(() => null)) !== null ? k : null))),
    files ? Promise.resolve(files) : listFiles(env, uid).catch((): FileEntry[] => []),
  ]);
  const made = new Set<ExtraKind>(marks.filter((k): k is ExtraKind => !!k));
  for (const f of list) {
    if (!f.id.startsWith(`${deckId}-`)) continue;
    if (f.id === `${deckId}-poster`) made.add("poster");
    else if (f.id === `${deckId}-handout`) made.add("handout");
    else if (/-audio(-s\d+)?$/.test(f.id)) made.add("audio");
    else if (/-podcast(-\d+)?$/.test(f.id)) made.add("podcast");
  }
  return made;
}

/** همراه‌های روشن‌ی که هنوز برای این ارائه ساخته نشده‌اند */
export async function missingExtras(env: Env, uid: Uid, deckId: string, files?: FileEntry[]): Promise<ExtraKind[]> {
  const made = await madeExtras(env, uid, deckId, files);
  return EXTRA_KINDS.filter((k) => extraEnabled(env, k) && !made.has(k));
}

// ---------- دکمه‌های زیر ارائه در تلگرام ----------
type Btn = { text: string; callback_data: string };
/** عنوان بخش Gamma زیر ارائه؛ «n:» دکمه‌ی بی‌اثر است (bot.ts) */
export const GAMMA_HEADER = "n:gm";
/** دکمه‌های همراه‌های روشن که در hide نیستند؛ دو‌تا در هر ردیف (پوستر افقی/عمودی کنار هم).
 *  admin=true (مدیر در تلگرام): زیر آن‌ها ردیف «خروجی‌های Gamma» هم می‌آید (هرکدام ۱ اعتبار؛ فقط آن‌هایی که برای این ارائه ساخته نشده‌اند) */
export function extraButtons(env: Env, id: string, hide: Set<ExtraKind>, admin = false): Btn[][] {
  const show = (codes: string[]) => codes.filter((c) => extraEnabled(env, CODES[c].kind) && !hide.has(CODES[c].kind))
    .map((c): Btn => ({ text: CODES[c].text, callback_data: `ex:${c}:${id}` }));
  const rows = [show(["a", "c"]), show(["h"]), show(["pw", "pt"])].filter((r) => r.length);
  if (admin) {
    const g = GAMMA_SPECS.map((s) => s.code);
    const grows = [g.slice(0, 2), g.slice(2, 4), g.slice(4, 6), g.slice(6, 8)].map(show).filter((r) => r.length);
    // «n:gm» = عنوان بخش (بی‌اثر)؛ ربات بعد از ساخته‌شدن همه‌ی خروجی‌ها آن را برمی‌دارد
    if (grows.length) rows.push([{ text: `✨ خروجی‌های Gamma (هرکدام ${toFa(String(GAMMA_CREDIT_COST))} اعتبار)`, callback_data: GAMMA_HEADER }], ...grows);
  }
  return rows;
}

/** جمله‌ی راهنمای کپشن ارائه (قیمت هر دکمه را پیش از زدن می‌گوید)؛ بدون دکمه = "" */
export const extrasHint = (rows: Btn[][]) => rows.length ? "\n\n➕ پوستر، جزوه، اسلاید صوتی و پادکست را هم می‌توانی با دکمه‌های زیر بسازی (هرکدام ۱ اعتبار)." : "";
/** کیبورد کامل زیر فایل ارائه: PDF + همراه‌ها + ارسال نظر */
export function deckKeyboard(env: Env, id: string, hide: Set<ExtraKind>, o: { feedback?: boolean; pdf?: boolean; /** مدیر در تلگرام: دکمه‌های Gamma هم */ admin?: boolean } = {}) {
  const rows: Btn[][] = [];
  if (o.pdf !== false && hasBrowser(env)) rows.push([{ text: "📄 دریافت نسخه‌ی PDF", callback_data: `g:${id}` }]);
  rows.push(...extraButtons(env, id, hide, !!o.admin));
  if (o.feedback !== false) rows.push([{ text: "💬 ارسال نظر", callback_data: "fb:s" }]);
  return { inline_keyboard: rows };
}

// ---------- شروع ساخت ----------
export interface ExtraStart {
  channel: "telegram" | "web";
  /** تلگرام: چت مقصد */
  chatId?: number;
  /** وب: فقط وقتی از Mini App ساخته شده؛ پایان کار پیام کوتاه به تلگرامِ وصل‌شده می‌رود */
  notify?: boolean;
  /** فقط پوستر */
  layout?: "wide" | "tall";
  /** مدیر در تلگرام (isGammaAdmin)؛ خروجی‌های Gamma بدون آن رد می‌شوند */
  admin?: boolean;
}
export type ExtraStarted = { ok: true; jobId: string } | { ok: false; error: string; status: number; noCredit?: boolean };
const fail = (error: string, status: number, noCredit?: boolean): ExtraStarted => ({ ok: false, error, status, ...(noCredit ? { noCredit } : {}) });

/**
 * اعتبارسنجی + نشانگر اتمی + کسر ۱ اعتبار + شروع Workflow مناسب.
 * پوستر/جزوه ← ExtraWorkflow؛ اسلاید صوتی/پادکست ← AudioWorkflow (همان کدی که همراه ارائه هم استفاده می‌شود).
 * شناسه‌ی کار: «<کاربر>-x<۶ حرف>-<نوع>» (همان قاعده‌ی /api/jobs)؛ فایل خروجی پوستر/جزوه «<ارائه>-poster» و «<ارائه>-handout» است.
 */
export async function startExtra(env: Env, uid: Uid, deckId: string, kind: ExtraKind, d: ExtraStart): Promise<ExtraStarted> {
  const name = EXTRA_NAME[kind];
  if (!/^[\w-]{1,80}$/.test(deckId)) return fail("ارائه پیدا نشد.", 404);
  if (!extraEnabled(env, kind)) return fail(`ساخت ${name} فعلاً روی این سرویس فعال نیست.`, 503);
  const web = d.channel === "web";
  if (!web && !d.chatId) return fail("چت مقصد مشخص نیست.", 400);
  // خروجی‌های Gamma: فعلاً فقط مدیر و فقط تلگرام
  if (isGammaKind(kind) && (web || !d.admin)) return fail(`ساخت ${name} فعلاً فقط برای مدیر در تلگرام فعال است.`, 403);

  // مالکیت: متن ارائه با کلید کاربر خوانده می‌شود، پس ارائه‌ی دیگران پیدا نمی‌شود
  if (!(await loadPreview(env, uid, deckId).catch(() => null))) return fail("⌛️ متن این ارائه منقضی شده است (ارائه‌ها ۲۴ ساعت نگه داشته می‌شوند).", 410);
  if ((await madeExtras(env, uid, deckId)).has(kind)) return fail(`${name} برای این ارائه قبلاً ساخته شده یا در حال ساخت است.`, 409);
  // نشانگر اتمی: دو درخواست هم‌زمان فقط یکی‌شان رد می‌شود
  if (await hitLimit(env, markKey(uid, deckId, kind), 1, MARK_TTL)) return fail(`ساخت ${name} همین حالا شروع شده است.`, 409);
  const release = () => unmarkExtra(env, uid, deckId, kind).catch(() => {});

  let quota: Awaited<ReturnType<typeof spendCredit>>;
  try {
    quota = await spendCredit(env, uid);
  } catch (e) {
    await release();
    throw e;
  }
  if (!quota.ok) {
    await release();
    return fail(`ساخت ${name} ۱ اعتبار می‌خواهد و اعتبارت تمام شده است.`, 402, true);
  }
  const credit = { source: quota.source, day: quota.day };
  const undo = async () => { await refundCredit(env, uid, quota.source, quota.day).catch((e) => console.error("refund extra", e)); await release(); };

  // پیشوند = شناسه‌ی کاربر (مالکیتِ GET /api/jobs/<شناسه> از همین پیشوند بررسی می‌شود؛ ارائه‌ی ساخته‌شده در تلگرام شناسه‌اش با شناسه‌ی کاربر شروع نمی‌شود)
  const jobId = `${uid}-x${Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(2, 8).padEnd(6, "x")}-${kind}`;
  if (jobId.length > 100) { await undo(); return fail("ارائه پیدا نشد.", 404); }
  const gs = gammaSpec(kind);
  const queued = gs ? `🎨 ${gs.name} Gamma در صف است… (معمولاً ۱ تا ۳ دقیقه)`
    : kind === "podcast" ? "🎙 پادکست در صف است… (چند دقیقه طول می‌کشد)"
    : kind === "audio" ? "🔊 اسلاید صوتی در صف است… (صدای هر اسلاید داخل خود فایل پاورپوینت گذاشته می‌شود)"
    : kind === "handout" ? "📝 جزوه‌ی Word در صف است… (چند دقیقه طول می‌کشد)" : "🖼 پوستر در صف است… (چند دقیقه طول می‌کشد)";
  let statusId = 0;
  try {
    if (!web) statusId = (await sendMessage(env, d.chatId!, queued)).message_id;
    const mark = quota.source !== "plan"; // مثل ارائه: کاربر دارای پلن بدون واترمارک
    if (isGammaKind(kind)) {
      // متن کارت‌ها را «مدل انتخابی کاربر» از روی متن همین ارائه می‌نویسد؛ ساخت و poll و ارسال در GammaWorkflow
      const model = (await getSettings(env, uid).catch(() => null))?.model;
      await env.GAMMA_WORKFLOW!.create({ id: jobId, params: { kind, chatId: d.chatId!, statusMessageId: statusId, uid, deckId, ...(model ? { model } : {}), credit } });
    } else if (kind === "audio" || kind === "podcast") {
      const model = (await getSettings(env, uid).catch(() => null))?.model;
      await env.AUDIO_WORKFLOW!.create({
        id: jobId,
        params: {
          kind: kind === "podcast" ? "podcast" : "slides", chatId: web ? 0 : d.chatId!, statusMessageId: statusId, uid, deckId, channel: d.channel, mark,
          ...(web && d.notify ? { notify: true } : {}), ...(model ? { model } : {}), credit,
        },
      });
    } else {
      await env.EXTRA_WORKFLOW!.create({
        id: jobId,
        params: { kind, chatId: web ? 0 : d.chatId!, statusMessageId: statusId, uid, deckId, channel: d.channel, mark, layout: d.layout ?? "tall", ...(web && d.notify ? { notify: true } : {}), credit },
      });
    }
  } catch (e) {
    console.error("extra workflow create failed", kind, e);
    await undo();
    if (statusId) await editMessage(env, d.chatId!, statusId, `❌ شروع ساخت ${name} ناموفق بود؛ اعتبارت برگردانده شد. کمی بعد دوباره امتحان کن.`).catch(() => {});
    return fail(`شروع ساخت ${name} ممکن نشد؛ چند دقیقه بعد دوباره امتحان کن.`, 503);
  }
  return { ok: true, jobId };
}
