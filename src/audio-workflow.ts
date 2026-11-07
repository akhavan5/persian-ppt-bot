/**
 * اسلاید صوتی و پادکست دو‌گوینده؛ همراه ارائه یا با دکمه‌ی زیر ارائه (تلگرام، سایت، Mini App) برای همه‌ی کاربران، هرکدام ۱ اعتبار جدا (extras.ts).
 *  • slides: متن سخنرانی (notes) هر اسلاید با یک صدا خوانده می‌شود و صدا «داخل خود اسلاید» در همان فایل PPTX جاسازی می‌شود (pptx-audio.ts)؛
 *    در نمایش، هر اسلاید صدایش را خودکار پخش می‌کند و بعد از پایان صدا به اسلاید بعد می‌رود. اگر حجم از سقف نشست، اسلایدهای باقی‌مانده جدا فرستاده می‌شوند.
 *  • podcast: LLM یک گفت‌وگوی دو‌نفره می‌نویسد؛ Gemini با دو صدا می‌خواند؛ تکه‌ها به یک فایل می‌چسبند.
 *  • خروجی هر دو MP3 است (تبدیل با مرورگر کلودفلر در mp3.ts؛ حجم حدود یک‌دهمِ WAV). اگر مرورگر در دسترس نبود/خطا داد یا AUDIO_FORMAT=wav بود، همان WAV تحویل می‌شود.
 * هر تکه‌ی صدا در گام جدا ساخته می‌شود تا خطا/سقف کلید فقط همان گام را دوباره امتحان کند (کلیدها در gemini-tts.ts می‌چرخند).
 * بایت‌های صدا از گام‌ها برنمی‌گردند (سقف ۱ مگابایت)؛ یا همان‌جا فرستاده می‌شوند یا موقت در KV فایل‌ها می‌مانند.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "./env";
import type { Uid } from "./settings";
import { LlmError } from "./llm";
import { loadFileDirect, loadPreview, saveFile } from "./files";
import { editMessage, esc, sendAudio, sendDocument, sendMessage } from "./telegram";
import { getLinkedTg } from "./link";
import { withStore } from "./store";
import { refundCredit, type CreditSource } from "./settings";
import { fileNameWithSite, miniappUrl, siteHost } from "./deck-service";
import { toFa } from "./util";
import { unmarkExtra } from "./extras";
import { GeminiError, ttsDialogue, ttsSpeak, type Turn } from "./gemini-tts";
import { narrationFor, splitSpeech } from "./tts-text";
import { chunkTurns, makePodcastScript } from "./podcast";
import { NARRATION_BATCH, makeNarration } from "./narration";
import { audioSeconds, mergeWav } from "./wav";
import { mp3Enabled, wavsToMp3 } from "./mp3";
import { embedAudio, pptxSlideNo, type SlideAudio } from "./pptx-audio";

export interface AudioParams {
  kind: "slides" | "podcast";
  chatId: number;
  statusMessageId: number;
  uid: Uid;
  /** شناسه‌ی ارائه (همان شناسه‌ی نمونه‌ی DeckWorkflow)؛ متن از پیش‌نمایش ۲۴ ساعته خوانده می‌شود */
  deckId: string;
  model?: string;
  /** کانال تحویل: پیش‌فرض تلگرام. در «web» به‌جای ارسال فایل، در فایل‌های ۲۴ ساعته ذخیره می‌شود (شناسه‌ها در خروجی Workflow) و وضعیت در KV (job:<شناسه‌ی نمونه>) نوشته می‌شود */
  channel?: "telegram" | "web";
  /** فقط کانال وب و فقط ساخت‌شده از Mini App: پایان کار یک پیام کوتاه با دکمه‌ی «باز کردن اپ» به تلگرامِ وصل‌شده‌ی کاربر می‌رود */
  notify?: boolean;
  /** کاربر بدون پلن: جمله‌ی تبلیغ سایت در پایان صدا (مثل واترمارک فایل‌ها). خالی = بدون جمله */
  mark?: boolean;
  /** اعتبار این کار (همراه ارائه)؛ اگر کار کاملاً شکست بخورد برگردانده می‌شود. خالی = کار دستی مدیر */
  credit?: { source: CreditSource; day: string };
}

/** خروجی نمونه (کانال وب): شناسه‌ی فایل‌های ذخیره‌شده به ترتیب + توضیح کوتاه برای اسلایدهای ناموفق/جدا */
export interface AudioOut { kind: "slides" | "podcast"; title: string; ids: string[]; note: string }

/** صدا گران است: خطای هر گام تا ۴ بار با فاصله‌ی افزایشی تکرار می‌شود (سقف دقیقه‌ای کلیدها) */
const TTS_STEP = { retries: { limit: 4, delay: "30 seconds", backoff: "exponential" }, timeout: "6 minutes" } as const;
const LLM_STEP = { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "4 minutes" } as const;
const TG_LIMIT = 45 * 1024 * 1024; // سقف آپلود ربات ۵۰ مگابایت؛ کمی حاشیه
// اسلاید صوتی هم‌لحن پادکست: گفتاری و خودمانی، نه سخنرانی رسمی
const SPEECH_STYLE = "warm, relaxed and friendly, like a person explaining something to a friend, natural informal Tehrani Persian speech, not reading a script";
// سرعت گفتار از روی توضیح سبک تنظیم می‌شود (زیر‌و‌بمی صدا تغییر نمی‌کند)؛ GEMINI_TTS_PACE = normal | brisk | fast
const PACE: Record<string, string> = { brisk: ", at a lively pace, a bit faster than normal speech, no long pauses", fast: ", at a quick, energetic pace, clearly faster than normal speech, short pauses" };
const speechStyle = (env: Env) => SPEECH_STYLE + (PACE[(env.GEMINI_TTS_PACE || "brisk").trim().toLowerCase()] ?? "");
// پادکست: لحن دوستانه و خودمانی (نه خواندن متن)؛ با متن محاوره‌ای podcast.ts هماهنگ است
const STYLE_A = "casual, relaxed, cheerful and curious, like chatting with a close friend, natural informal Tehrani Persian speech, not reading a script";
const STYLE_B = "warm, easygoing and confident, like explaining something to a friend over tea, natural informal Tehrani Persian speech, not reading a script";
// حجم PPTX + صدا در حافظه‌ی Worker (۱۲۸ مگابایت) چند نسخه می‌شود؛ بیشتر از این مقدار صدا داخل فایل نمی‌رود و بقیه‌ی اسلایدها جدا فرستاده می‌شوند
const EMBED_BUDGET = 30 * 1024 * 1024;

// وب: مقدار هر فایل در KV حداکثر ۲۴ مگابایت است؛ با حاشیه
const WEB_FILE_LIMIT = 22 * 1024 * 1024;
// جمله‌ی پایانیِ تبلیغ سایت برای کاربران بدون پلن (مثل واترمارک فایل‌ها). نشانی سایت با حروف نوشته شده تا TTS درست تلفظ کند.
const OUTRO_SLIDES = "اگه از این اسلاید خوشتون اومد، به سایت ما سر بزنید: پی پی تی ساز، دات آی آر.";
const OUTRO_PODCAST = "اگه از این پادکست خوشتون اومد، به سایت ما سر بزنید: پی پی تی ساز، دات آی آر.";

const tmpKey = (id: string, i: number) => `tmp:aud:${id}:${i}`;

/** درصد پیشرفت (۰ تا ۱۰۰ و صحیح)؛ اپ اندروید و سایت همین عدد را در نوار و اعلان نشان می‌دهند */
const clampPct = (p: number) => Math.max(0, Math.min(100, Math.round(p)));
/** نوار متنی برای پیام وضعیت تلگرام: «▰▰▰▱▱▱▱▱▱▱ ۳۰٪» */
const pctBar = (p: number) => { const n = Math.round(clampPct(p) / 10); return `${"▰".repeat(n)}${"▱".repeat(10 - n)} ${toFa(String(clampPct(p)))}٪`; };
/** درصد گام k از n داخل بازه‌ی [from, to] */
const lerp = (from: number, to: number, k: number, n: number) => from + (to - from) * (n > 0 ? Math.min(1, k / n) : 0);

type Status = (t: string, pct?: number) => Promise<unknown>;

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if ((e instanceof GeminiError || e instanceof LlmError) && e.fatal) throw new NonRetryableError(e.message);
    throw e;
  }
}

export class AudioWorkflow extends WorkflowEntrypoint<Env, AudioParams> {
  constructor(ctx: ExecutionContext, env: Env) { super(ctx, withStore(env)); }

  async run(event: WorkflowEvent<AudioParams>, step: WorkflowStep): Promise<AudioOut> {
    const { kind, chatId, statusMessageId: mid, uid, credit } = event.payload;
    const web = event.payload.channel === "web";
    // تلگرام: ویرایش پیام وضعیت (با نوار درصد)؛ وب و اپ: متن پیشرفت در KV (job:<شناسه>) و درصد عددی جدا (jobp:<شناسه>)؛ GET /api/jobs/<شناسه> هر دو را برمی‌گرداند
    const status = (t: string, pct?: number) => (web
      ? Promise.all([
        this.env.KV.put(`job:${event.instanceId}`, t, { expirationTtl: 3600 }),
        pct === undefined ? Promise.resolve() : this.env.KV.put(`jobp:${event.instanceId}`, String(clampPct(pct)), { expirationTtl: 3600 }),
      ])
      : editMessage(this.env, chatId, mid, pct === undefined ? t : `${t}\n${pctBar(pct)}`)).catch(() => {});
    try {
      const out = kind === "podcast" ? await this.podcast(event, step, status, web) : await this.slides(event, step, status, web);
      // Mini App: اگر کاربر اپ را بسته باشد از آماده شدن خبردار نمی‌شود؛ پیام کوتاه با دکمه‌ی باز کردن اپ. خطایش نباید به «برگشت اعتبار» برسد (فایل ذخیره شده)
      if (web && event.payload.notify && out.ids.length) {
        await step.do("notify-app", { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" }, async () => {
          const tgChat = await getLinkedTg(this.env, String(uid));
          if (!tgChat) return;
          await sendMessage(this.env, tgChat, `✅ ${kind === "podcast" ? "🎙 پادکست" : "🔊 اسلاید صوتی"} «${esc(out.title)}» آماده شد.\nبرای گرفتن فایل، اپ را باز کن؛ فایل‌ها ۲۴ ساعت نگه داشته می‌شوند.`,
            { reply_markup: { inline_keyboard: [[{ text: "📱 باز کردن اپ", web_app: { url: `${miniappUrl(this.env)}/app` } }]] } });
        }).catch((ne) => console.error("notify-app", String(ne).slice(0, 200)));
      }
      return out;
    } catch (e) {
      const reason = String(e instanceof Error ? e.message : e).slice(0, 500);
      console.error("audio workflow failed", reason);
      // هر کار در گام جدا تا اگر یکی تکرار شد اعتبار دو بار برنگردد
      if (credit) {
        await step.do("refund", () => refundCredit(this.env, uid, credit.source, credit.day)).catch((re) => console.error("refund audio", re));
        // نشانگر «ساخته شده» پاک می‌شود تا دکمه‌ی این همراه زیر ارائه دوباره دیده شود
        await step.do("unmark", () => unmarkExtra(this.env, uid, event.payload.deckId, kind === "podcast" ? "podcast" : "audio")).catch(() => {});
      }
      await step.do("notify-failure", async () => {
        await status(`❌ ساخت ${kind === "podcast" ? "پادکست" : "اسلاید صوتی"} ناموفق بود${credit && credit.source !== "none" ? "؛ اعتبارش برگردانده شد" : ""}.\n<code>${esc(reason)}</code>`);
      }).catch(() => {});
      throw e;
    }
  }

  // ---------- اسلاید صوتی (صدا داخل خود اسلاید) ----------
  private async slides(event: WorkflowEvent<AudioParams>, step: WorkflowStep, status: Status, web: boolean): Promise<AudioOut> {
    const { chatId, uid, deckId, mark } = event.payload;
    const id = event.instanceId;
    const plan = await step.do("load-deck", { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" }, async () => {
      await status("🔊 آماده‌سازی اسلایدها…", 2);
      const p = await loadPreview(this.env, uid, deckId);
      if (!p) throw new NonRetryableError("متن ارائه منقضی شده است (۲۴ ساعت)");
      // صدا باید داخل همان فایل PPTX برود؛ پیش از خرج‌کردن سهمیه‌ی TTS مطمئن می‌شویم فایل هنوز هست
      if (!(await loadFileDirect(this.env, uid, deckId))) throw new NonRetryableError("فایل پاورپوینت منقضی شده است (۲۴ ساعت)");
      const items = p.deck.slides.map((s, i) => ({ i, no: pptxSlideNo(p.template, i), title: s.title, text: narrationFor(s) })).filter((x) => x.text);
      if (!items.length) throw new NonRetryableError("هیچ اسلایدی متن قابل‌خواندن ندارد");
      return { title: p.deck.title, total: p.deck.slides.length, items };
    });

    // متن گفتاریِ مناسبِ صدا برای اسلایدها (دسته‌های ۸تایی)؛ اگر LLM جواب نداد همان متن قبلی (یادداشت/نکته‌ها) خوانده می‌شود
    const spoken: Record<number, string> = {};
    const batches = Math.ceil(plan.items.length / NARRATION_BATCH);
    for (let k = 0; k < plan.items.length; k += NARRATION_BATCH) {
      const idxs = plan.items.slice(k, k + NARRATION_BATCH).map((x) => x.i);
      try {
        const part = await step.do(`narration-${k / NARRATION_BATCH}`, LLM_STEP, () => guard(async () => {
          // درصد: نوشتن متن گفتاری ۳ تا ۲۵٪
          await status("✍️ در حال نوشتن متن گفتاری اسلایدها…", lerp(3, 25, k / NARRATION_BATCH, batches));
          const p = await loadPreview(this.env, uid, deckId);
          if (!p) throw new NonRetryableError("متن ارائه منقضی شده است (۲۴ ساعت)");
          return makeNarration(this.env, p.deck, idxs, { model: event.payload.model });
        }));
        Object.assign(spoken, part);
      } catch (e) {
        console.error("narration failed", idxs[0], String(e).slice(0, 300));
      }
    }

    // هر اسلاید در گام جدا ساخته و موقت در KV نگه داشته می‌شود (بایت‌های صدا از گام‌ها برنمی‌گردند)
    const failed: string[] = [];
    const lastIdx = plan.items[plan.items.length - 1].i;
    const made: { i: number; no: number; title: string; bytes: number }[] = [];
    for (let pos = 0; pos < plan.items.length; pos++) {
      const it = plan.items[pos];
      try {
        const bytes = await step.do(`slide-${it.i}`, TTS_STEP, () => guard(async () => {
          // درصد: ساخت صدای اسلایدها ۲۵ تا ۸۸٪ (به نسبت تعداد اسلایدهای دارای متن)
          await status(`🔊 در حال ساخت صدا… اسلاید ${toFa(String(it.i + 1))} از ${toFa(String(plan.total))}`, lerp(25, 88, pos, plan.items.length));
          // کاربر بدون پلن: جمله‌ی تبلیغ سایت در پایانِ آخرین اسلاید گفته می‌شود
          const body = spoken[it.i] ?? it.text;
          const text = mark && it.i === lastIdx ? `${body} ${OUTRO_SLIDES}` : body;
          const wav = await ttsSpeak(this.env, splitSpeech(text, 1200), { style: speechStyle(this.env) });
          await this.env.FILES.put(tmpKey(id, it.i), wav, { expirationTtl: 3600 }); // فقط تا لحظه‌ی جاسازی؛ یک ساعته پاک می‌شود
          return wav.length;
        }));
        made.push({ i: it.i, no: it.no, title: it.title, bytes });
      } catch (e) {
        failed.push(`${toFa(String(it.i + 1))}`);
        console.error("slide audio failed", it.i, String(e).slice(0, 300));
      }
    }
    if (!made.length) await step.do("fail", async () => { throw new NonRetryableError("هیچ صدایی ساخته نشد (کلیدها یا سهمیه را بررسی کن)"); });

    const summary = await step.do("embed-send", { retries: { limit: 1, delay: "10 seconds" }, timeout: "6 minutes" }, async () => {
      await status("🔊 جاسازی صدا داخل اسلایدها و ارسال فایل…", 90);
      const f = await loadFileDirect(this.env, uid, deckId);
      if (!f) throw new NonRetryableError("فایل پاورپوینت منقضی شده است (۲۴ ساعت)");
      // MP3 با مرورگر کلودفلر: حجم حدود یک‌دهم می‌شود (اسلایدهای بیشتری داخل فایل جا می‌شوند)؛ اسلایدی که تبدیل نشد با همان WAV می‌ماند
      if (mp3Enabled(this.env)) await status("🔊 تبدیل صدا به MP3…", 92);
      const mp3s = await wavsToMp3(this.env, made.length, async (k) => {
        const b = await this.env.FILES.get(tmpKey(id, made[k].i), "arrayBuffer");
        return b ? new Uint8Array(b) : null;
      });
      let budget = (web ? WEB_FILE_LIMIT : EMBED_BUDGET) - f.data.byteLength;
      const items: SlideAudio[] = [];
      const saved: string[] = []; // وب: شناسه‌ی فایل‌های ذخیره‌شده
      const inFile: number[] = [], apart: (typeof made[number] & { mp3: Uint8Array | null })[] = [];
      for (let k = 0; k < made.length; k++) {
        const m = made[k], mp3 = mp3s[k];
        const size = mp3 ? mp3.length : m.bytes;
        if (size > budget) { apart.push({ ...m, mp3 }); continue; }
        if (mp3) items.push({ slide: m.no, mp3 });
        else {
          const b = await this.env.FILES.get(tmpKey(id, m.i), "arrayBuffer");
          if (!b) throw new Error(`audio of slide ${m.i} missing`);
          items.push({ slide: m.no, wav: new Uint8Array(b) });
        }
        inFile.push(m.i);
        budget -= size;
      }
      if (items.length) {
        const out = await embedAudio(f.data, items, { autoPlay: true, autoAdvance: true });
        await status("🔊 ذخیره و ارسال فایل…", 97);
        const name = fileNameWithSite(this.env, plan.title, "pptx", "صوتی", 40);
        if (web) {
          // وب: فایل در KV می‌ماند و کاربر از صفحه دانلودش می‌کند؛ اگر ذخیره نشد گام باید شکست بخورد (تلاش مجدد/برگشت اعتبار)
          if (!(await saveFile(this.env, uid, id, out.bytes, name, plan.title, items.length))) throw new Error("audio pptx too large to store");
          saved.push(id);
        } else {
          await sendDocument(this.env, chatId, out.bytes, name,
            `🔊 <b>${esc(plan.title)}</b>\nصدای ${toFa(String(items.length))} اسلاید داخل خود اسلایدها گذاشته شده است؛ در حالت نمایش (Slide Show) خودکار پخش می‌شود و بعد از پایان صدا اسلاید عوض می‌شود.`);
          // ربات: نسخه‌ای هم در «فایل‌ها» (سایت، Mini App و اپ) نگه می‌داریم؛ بهترین‌تلاش است و اگر ذخیره نشد (مثلاً بزرگ‌تر از ۲۴ مگابایت) ارسال به چت خراب نمی‌شود
          await saveFile(this.env, uid, id, out.bytes, name, plan.title, items.length).catch((e) => console.error("audio save (bot)", String(e).slice(0, 200)));
        }
      }
      // اسلایدهایی که در فایل جا نشدند مثل قبل جدا فرستاده می‌شوند (MP3 اگر ساخته شده بود، وگرنه WAV)
      for (const m of apart) {
        let audio = m.mp3;
        if (!audio) {
          const b = await this.env.FILES.get(tmpKey(id, m.i), "arrayBuffer");
          if (!b) continue;
          audio = new Uint8Array(b);
        }
        const ext = m.mp3 ? "mp3" : "wav";
        const wname = fileNameWithSite(this.env, plan.title, ext, `اسلاید ${m.i + 1}`, 40);
        if (web) {
          const fid = `${id}-s${m.i + 1}`;
          if (!(await saveFile(this.env, uid, fid, audio, wname, `اسلاید ${m.i + 1}: ${m.title}`.slice(0, 120), 0))) throw new Error("slide audio too large to store");
          saved.push(fid);
          continue;
        }
        await sendAudio(this.env, chatId, audio, wname,
          `🔊 <b>اسلاید ${toFa(String(m.i + 1))}</b> · ${esc(m.title.slice(0, 80))}`, { title: `اسلاید ${toFa(String(m.i + 1))}: ${m.title}`, performer: plan.title, duration: audioSeconds(audio) });
        await saveFile(this.env, uid, `${id}-s${m.i + 1}`, audio, wname, `اسلاید ${m.i + 1}: ${m.title}`.slice(0, 120), 0).catch((e) => console.error("slide audio save (bot)", String(e).slice(0, 200)));
      }
      for (const m of made) await this.env.FILES.delete(tmpKey(id, m.i)).catch(() => {});
      return { inFile: inFile.length, apart: apart.map((m) => toFa(String(m.i + 1))), saved };
    });
    await step.do("finish", async () => {
      if (web) return;
      await status(`✅ اسلاید صوتی آماده شد: صدا داخل ${toFa(String(summary.inFile))} اسلاید گذاشته شد${summary.apart.length ? `\n📎 اسلاید ${summary.apart.join("، ")} به‌خاطر حجم جدا فرستاده شد` : ""}${failed.length ? `\n⚠️ ناموفق: اسلاید ${failed.join("، ")}${event.payload.credit ? "" : " (دوباره دکمه را بزن)"}` : ""}`);
    }).catch(() => {}); // خطای پیام پایانی نباید به «برگشت اعتبار» برسد (فایل قبلاً تحویل شده)
    return {
      kind: "slides",
      title: plan.title,
      ids: summary.saved,
      note: [summary.apart.length ? `اسلاید ${summary.apart.join("، ")} به‌خاطر حجم، جدا ذخیره شد.` : "", failed.length ? `اسلاید ${failed.join("، ")} ساخته نشد.` : ""].filter(Boolean).join(" "),
    };
  }

  // ---------- پادکست ----------
  private async podcast(event: WorkflowEvent<AudioParams>, step: WorkflowStep, status: Status, web: boolean): Promise<AudioOut> {
    const { chatId, uid, deckId, model, mark } = event.payload;
    const id = event.instanceId;

    const script = await step.do("script", LLM_STEP, () => guard(async () => {
      await status("🎙 ۱/۳ — نوشتن گفت‌وگوی پادکست…", 5); // درصد: نوشتن گفت‌وگو ۵ تا ۲۵٪
      const p = await loadPreview(this.env, uid, deckId);
      if (!p) throw new NonRetryableError("متن ارائه منقضی شده است (۲۴ ساعت)");
      return makePodcastScript(this.env, p.deck, { model });
    }));
    // کاربر بدون پلن: مجری (علی) در پایان پادکست سایت را معرفی می‌کند
    const turns: Turn[] = mark ? [...script.turns, { speaker: "A", text: OUTRO_PODCAST }] : script.turns;
    const chunks = chunkTurns(turns);

    for (let i = 0; i < chunks.length; i++) {
      await step.do(`voice-${i}`, TTS_STEP, () => guard(async () => {
        // درصد: ساخت صدا ۲۵ تا ۸۸٪ به نسبت بخش‌ها
        await status(`🎙 ۲/۳ — ساخت صدا… بخش ${toFa(String(i + 1))} از ${toFa(String(chunks.length))}`, lerp(25, 88, i, chunks.length));
        const wav = await ttsDialogue(this.env, chunks[i], { styleA: STYLE_A, styleB: STYLE_B });
        await this.env.FILES.put(tmpKey(id, i), wav, { expirationTtl: 3600 }); // فقط برای چسباندن؛ یک ساعته پاک می‌شود
        return wav.length;
      }));
    }

    const saved = await step.do("merge-send", { retries: { limit: 1, delay: "10 seconds" }, timeout: "6 minutes" }, async () => {
      await status("🎙 ۳/۳ — چسباندن و ارسال…", 90);
      const ids: string[] = []; // وب: شناسه‌ی فایل‌های ذخیره‌شده
      const wavs: Uint8Array[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const b = await this.env.FILES.get(tmpKey(id, i), "arrayBuffer");
        if (!b) throw new Error(`voice chunk ${i} missing`);
        wavs.push(new Uint8Array(b));
      }
      const limit = web ? WEB_FILE_LIMIT : TG_LIMIT;
      // MP3 (مرورگر کلودفلر): همه‌ی تکه‌ها اول به یک WAV چسبانده و یک‌جا فشرده می‌شود (بدون درز بین تکه‌ها)؛ حجم حدود یک‌دهم و همیشه یک فایل.
      // اگر مرورگر در دسترس نبود یا خطا داد، مثل قبل WAV تحویل می‌شود.
      let files: { bytes: Uint8Array; ext: "mp3" | "wav" }[] = [];
      if (mp3Enabled(this.env)) {
        await status("🎙 ۳/۳ — تبدیل به MP3…", 93);
        const [mp3] = await wavsToMp3(this.env, 1, async () => mergeWav(wavs, 450));
        if (mp3 && mp3.length <= limit) files = [{ bytes: mp3, ext: "mp3" }];
      }
      if (!files.length) {
        // WAV: تقریباً هیچ‌وقت پیش نمی‌آید، ولی اگر مجموع از سقف تلگرام (یا سقف فایل در وب) گذشت به چند قسمت تقسیم می‌شود
        const groups: Uint8Array[][] = [[]];
        let size = 0;
        for (const w of wavs) {
          if (size + w.length > limit && groups[groups.length - 1].length) { groups.push([]); size = 0; }
          groups[groups.length - 1].push(w); size += w.length;
        }
        files = groups.map((g) => ({ bytes: mergeWav(g, 450), ext: "wav" as const }));
      }
      await status("🎙 ۳/۳ — ذخیره و ارسال فایل…", 96);
      for (let g = 0; g < files.length; g++) {
        const merged = files[g].bytes;
        const part = files.length > 1 ? ` (قسمت ${toFa(String(g + 1))})` : "";
        const pname = fileNameWithSite(this.env, script.title, files[g].ext, `پادکست${files.length > 1 ? ` ${g + 1}` : ""}`, 40);
        if (web) {
          // وب: فایل در KV می‌ماند و کاربر از صفحه دانلودش می‌کند؛ اگر ذخیره نشد گام شکست می‌خورد (تلاش مجدد/برگشت اعتبار)
          const fid = g === 0 ? id : `${id}-${g + 1}`;
          if (!(await saveFile(this.env, uid, fid, merged, pname, `${script.title}${part}`.slice(0, 120), 0))) throw new Error("podcast too large to store");
          ids.push(fid);
          continue;
        }
        await sendAudio(this.env, chatId, merged, pname,
          `🎙 <b>${esc(script.title)}</b>${part}`, { title: script.title, performer: siteHost(this.env), duration: audioSeconds(merged) });
        // ربات: علاوه بر چت، نسخه‌ای هم در «فایل‌ها» (سایت، Mini App و اپ) نگه می‌داریم تا پلیر و دانلود آن‌جا هم باشد.
        // بهترین‌تلاش است: اگر فایل از سقف ذخیره (۲۴ مگابایت) بزرگ‌تر بود یا ذخیره نشد، ارسال به چت که انجام شده خراب نمی‌شود.
        try {
          await saveFile(this.env, uid, g === 0 ? id : `${id}-${g + 1}`, merged, pname, `${script.title}${part}`.slice(0, 120), 0);
        } catch (e) { console.error("podcast save (bot)", String(e).slice(0, 200)); }
      }
      for (let i = 0; i < chunks.length; i++) await this.env.FILES.delete(tmpKey(id, i)).catch(() => {});
      return ids;
    });
    await step.do("finish", async () => { if (!web) await status("✅ پادکست آماده شد؛ فایل صوتی را بالا ببین."); }).catch(() => {}); // خطای پیام پایانی نباید به «برگشت اعتبار» برسد
    return { kind: "podcast", title: script.title, ids: saved, note: "" };
  }
}

