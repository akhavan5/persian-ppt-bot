/**
 * اسلاید صوتی و پادکست دو‌گوینده (فعلاً فقط تلگرام و فقط مدیر).
 *  • slides: متن سخنرانی (notes) هر اسلاید با یک صدا خوانده می‌شود و صدا «داخل خود اسلاید» در همان فایل PPTX جاسازی می‌شود (pptx-audio.ts)؛
 *    در نمایش، هر اسلاید صدایش را خودکار پخش می‌کند و بعد از پایان صدا به اسلاید بعد می‌رود. اگر حجم از سقف نشست، اسلایدهای باقی‌مانده جدا فرستاده می‌شوند.
 *  • podcast: LLM یک گفت‌وگوی دو‌نفره می‌نویسد؛ Gemini با دو صدا می‌خواند؛ تکه‌ها به یک فایل می‌چسبند.
 * هر تکه‌ی صدا در گام جدا ساخته می‌شود تا خطا/سقف کلید فقط همان گام را دوباره امتحان کند (کلیدها در gemini-tts.ts می‌چرخند).
 * بایت‌های صدا از گام‌ها برنمی‌گردند (سقف ۱ مگابایت)؛ یا همان‌جا فرستاده می‌شوند یا موقت در KV فایل‌ها می‌مانند.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "./env";
import type { Uid } from "./settings";
import { LlmError } from "./llm";
import { loadFileDirect, loadPreview } from "./files";
import { editMessage, esc, sendAudio, sendDocument } from "./telegram";
import { withStore } from "./store";
import { fileNameWithSite } from "./deck-service";
import { toFa } from "./util";
import { GeminiError, ttsDialogue, ttsSpeak } from "./gemini-tts";
import { narrationFor, splitSpeech } from "./tts-text";
import { chunkTurns, makePodcastScript, transcript } from "./podcast";
import { NARRATION_BATCH, makeNarration } from "./narration";
import { mergeWav, wavSeconds } from "./wav";
import { embedAudio, pptxSlideNo, type SlideAudio } from "./pptx-audio";

export interface AudioParams {
  kind: "slides" | "podcast";
  chatId: number;
  statusMessageId: number;
  uid: Uid;
  /** شناسه‌ی ارائه (همان شناسه‌ی نمونه‌ی DeckWorkflow)؛ متن از پیش‌نمایش ۲۴ ساعته خوانده می‌شود */
  deckId: string;
  model?: string;
}

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

const tmpKey = (id: string, i: number) => `tmp:aud:${id}:${i}`;

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if ((e instanceof GeminiError || e instanceof LlmError) && e.fatal) throw new NonRetryableError(e.message);
    throw e;
  }
}

export class AudioWorkflow extends WorkflowEntrypoint<Env, AudioParams> {
  constructor(ctx: ExecutionContext, env: Env) { super(ctx, withStore(env)); }

  async run(event: WorkflowEvent<AudioParams>, step: WorkflowStep) {
    const { kind, chatId, statusMessageId: mid } = event.payload;
    const status = (t: string) => editMessage(this.env, chatId, mid, t).catch(() => {});
    try {
      if (kind === "podcast") await this.podcast(event, step, status);
      else await this.slides(event, step, status);
    } catch (e) {
      const reason = String(e instanceof Error ? e.message : e).slice(0, 500);
      console.error("audio workflow failed", reason);
      await step.do("notify-failure", async () => {
        await status(`❌ ساخت ${kind === "podcast" ? "پادکست" : "اسلاید صوتی"} ناموفق بود.\n<code>${esc(reason)}</code>`);
      }).catch(() => {});
      throw e;
    }
  }

  // ---------- اسلاید صوتی (صدا داخل خود اسلاید) ----------
  private async slides(event: WorkflowEvent<AudioParams>, step: WorkflowStep, status: (t: string) => Promise<unknown>) {
    const { chatId, uid, deckId } = event.payload;
    const id = event.instanceId;
    const plan = await step.do("load-deck", { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" }, async () => {
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
    for (let k = 0; k < plan.items.length; k += NARRATION_BATCH) {
      const idxs = plan.items.slice(k, k + NARRATION_BATCH).map((x) => x.i);
      try {
        const part = await step.do(`narration-${k / NARRATION_BATCH}`, LLM_STEP, () => guard(async () => {
          await status("✍️ در حال نوشتن متن گفتاری اسلایدها…");
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
    const made: { i: number; no: number; title: string; bytes: number }[] = [];
    for (const it of plan.items) {
      try {
        const bytes = await step.do(`slide-${it.i}`, TTS_STEP, () => guard(async () => {
          await status(`🔊 در حال ساخت صدا… اسلاید ${toFa(String(it.i + 1))} از ${toFa(String(plan.total))}`);
          const wav = await ttsSpeak(this.env, splitSpeech(spoken[it.i] ?? it.text, 1200), { style: speechStyle(this.env) });
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
      await status("🔊 جاسازی صدا داخل اسلایدها و ارسال فایل…");
      const f = await loadFileDirect(this.env, uid, deckId);
      if (!f) throw new NonRetryableError("فایل پاورپوینت منقضی شده است (۲۴ ساعت)");
      let budget = EMBED_BUDGET - f.data.byteLength;
      const items: SlideAudio[] = [];
      const inFile: number[] = [], apart: typeof made = [];
      for (const m of made) {
        if (m.bytes > budget) { apart.push(m); continue; }
        const b = await this.env.FILES.get(tmpKey(id, m.i), "arrayBuffer");
        if (!b) throw new Error(`audio of slide ${m.i} missing`);
        items.push({ slide: m.no, wav: new Uint8Array(b) });
        inFile.push(m.i);
        budget -= m.bytes;
      }
      if (items.length) {
        const out = await embedAudio(f.data, items, { autoPlay: true, autoAdvance: true });
        await sendDocument(this.env, chatId, out.bytes, fileNameWithSite(this.env, plan.title, "pptx", "صوتی", 40),
          `🔊 <b>${esc(plan.title)}</b>\nصدای ${toFa(String(items.length))} اسلاید داخل خود اسلایدها گذاشته شده است؛ در حالت نمایش (Slide Show) خودکار پخش می‌شود و بعد از پایان صدا اسلاید عوض می‌شود.`);
      }
      // اسلایدهایی که در فایل جا نشدند مثل قبل جدا فرستاده می‌شوند
      for (const m of apart) {
        const b = await this.env.FILES.get(tmpKey(id, m.i), "arrayBuffer");
        if (!b) continue;
        const wav = new Uint8Array(b);
        await sendAudio(this.env, chatId, wav, fileNameWithSite(this.env, plan.title, "wav", `اسلاید ${m.i + 1}`, 40),
          `🔊 <b>اسلاید ${toFa(String(m.i + 1))}</b> · ${esc(m.title.slice(0, 80))}`, { title: `اسلاید ${toFa(String(m.i + 1))}: ${m.title}`, performer: plan.title, duration: wavSeconds(wav) });
      }
      for (const m of made) await this.env.FILES.delete(tmpKey(id, m.i)).catch(() => {});
      return { inFile: inFile.length, apart: apart.map((m) => toFa(String(m.i + 1))) };
    });
    await step.do("finish", async () => {
      await status(`✅ اسلاید صوتی آماده شد: صدا داخل ${toFa(String(summary.inFile))} اسلاید گذاشته شد${summary.apart.length ? `\n📎 اسلاید ${summary.apart.join("، ")} به‌خاطر حجم جدا فرستاده شد` : ""}${failed.length ? `\n⚠️ ناموفق: اسلاید ${failed.join("، ")} (دوباره دکمه را بزن)` : ""}`);
    });
  }

  // ---------- پادکست ----------
  private async podcast(event: WorkflowEvent<AudioParams>, step: WorkflowStep, status: (t: string) => Promise<unknown>) {
    const { chatId, uid, deckId, model } = event.payload;
    const id = event.instanceId;

    const script = await step.do("script", LLM_STEP, () => guard(async () => {
      await status("🎙 ۱/۳ — نوشتن گفت‌وگوی پادکست…");
      const p = await loadPreview(this.env, uid, deckId);
      if (!p) throw new NonRetryableError("متن ارائه منقضی شده است (۲۴ ساعت)");
      return makePodcastScript(this.env, p.deck, { model });
    }));
    const chunks = chunkTurns(script.turns);

    for (let i = 0; i < chunks.length; i++) {
      await step.do(`voice-${i}`, TTS_STEP, () => guard(async () => {
        await status(`🎙 ۲/۳ — ساخت صدا… بخش ${toFa(String(i + 1))} از ${toFa(String(chunks.length))}`);
        const wav = await ttsDialogue(this.env, chunks[i], { styleA: STYLE_A, styleB: STYLE_B });
        await this.env.FILES.put(tmpKey(id, i), wav, { expirationTtl: 3600 }); // فقط برای چسباندن؛ یک ساعته پاک می‌شود
        return wav.length;
      }));
    }

    await step.do("merge-send", { retries: { limit: 1, delay: "10 seconds" }, timeout: "6 minutes" }, async () => {
      await status("🎙 ۳/۳ — چسباندن و ارسال…");
      const wavs: Uint8Array[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const b = await this.env.FILES.get(tmpKey(id, i), "arrayBuffer");
        if (!b) throw new Error(`voice chunk ${i} missing`);
        wavs.push(new Uint8Array(b));
      }
      // تقریباً هیچ‌وقت پیش نمی‌آید، ولی اگر مجموع از سقف تلگرام گذشت به چند قسمت تقسیم می‌شود
      const groups: Uint8Array[][] = [[]];
      let size = 0;
      for (const w of wavs) {
        if (size + w.length > TG_LIMIT && groups[groups.length - 1].length) { groups.push([]); size = 0; }
        groups[groups.length - 1].push(w); size += w.length;
      }
      for (let g = 0; g < groups.length; g++) {
        const merged = mergeWav(groups[g], 450);
        const part = groups.length > 1 ? ` (قسمت ${toFa(String(g + 1))})` : "";
        await sendAudio(this.env, chatId, merged, fileNameWithSite(this.env, script.title, "wav", `پادکست${groups.length > 1 ? ` ${g + 1}` : ""}`, 40),
          `🎙 <b>${esc(script.title)}</b>${part}\nپادکست دو‌گوینده · ${toFa(String(script.turns.length))} نوبت`, { title: script.title, performer: "علی و سارا", duration: wavSeconds(merged) });
      }
      // متن گفت‌وگو برای بازبینی (اگر تلفظ جایی غلط بود، متن را ببین)
      await sendDocument(this.env, chatId, new TextEncoder().encode(transcript(script)), fileNameWithSite(this.env, script.title, "txt", "متن پادکست", 40), "📝 متن گفت‌وگوی پادکست", { mime: "text/plain" }).catch((e) => console.error("transcript", String(e).slice(0, 200)));
      for (let i = 0; i < chunks.length; i++) await this.env.FILES.delete(tmpKey(id, i)).catch(() => {});
    });
    await step.do("finish", async () => { await status("✅ پادکست آماده شد؛ فایل صوتی و متن گفت‌وگو را بالا ببین."); });
  }
}

