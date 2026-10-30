/**
 * اسلاید صوتی و پادکست دو‌گوینده (فعلاً فقط تلگرام و فقط مدیر).
 *  • slides: متن سخنرانی (notes) هر اسلاید با یک صدا خوانده و جدا برای هر اسلاید فرستاده می‌شود (مثل یک پلی‌لیست).
 *  • podcast: LLM یک گفت‌وگوی دو‌نفره می‌نویسد؛ Gemini با دو صدا می‌خواند؛ تکه‌ها به یک فایل می‌چسبند.
 * هر تکه‌ی صدا در گام جدا ساخته می‌شود تا خطا/سقف کلید فقط همان گام را دوباره امتحان کند (کلیدها در gemini-tts.ts می‌چرخند).
 * بایت‌های صدا از گام‌ها برنمی‌گردند (سقف ۱ مگابایت)؛ یا همان‌جا فرستاده می‌شوند یا موقت در KV فایل‌ها می‌مانند.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "./env";
import type { Uid } from "./settings";
import { LlmError } from "./llm";
import { loadPreview } from "./files";
import { editMessage, esc, sendAudio, sendDocument } from "./telegram";
import { withStore } from "./store";
import { fileNameWithSite } from "./deck-service";
import { toFa } from "./util";
import { GeminiError, ttsDialogue, ttsSpeak } from "./gemini-tts";
import { narrationFor, splitSpeech } from "./tts-text";
import { chunkTurns, makePodcastScript, transcript } from "./podcast";
import { mergeWav, wavSeconds } from "./wav";

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
const SPEECH_STYLE = "calm, clear, natural, like a confident lecturer";
const STYLE_A = "friendly, curious, conversational";
const STYLE_B = "warm, calm, confident, conversational";

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

  // ---------- اسلاید صوتی ----------
  private async slides(event: WorkflowEvent<AudioParams>, step: WorkflowStep, status: (t: string) => Promise<unknown>) {
    const { chatId, uid, deckId } = event.payload;
    const plan = await step.do("load-deck", { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" }, async () => {
      const p = await loadPreview(this.env, uid, deckId);
      if (!p) throw new NonRetryableError("متن ارائه منقضی شده است (۲۴ ساعت)");
      const items = p.deck.slides.map((s, i) => ({ i, title: s.title, text: narrationFor(s) })).filter((x) => x.text);
      if (!items.length) throw new NonRetryableError("هیچ اسلایدی متن قابل‌خواندن ندارد");
      return { title: p.deck.title, total: p.deck.slides.length, items };
    });

    const failed: string[] = [];
    let sent = 0;
    for (const it of plan.items) {
      try {
        await step.do(`slide-${it.i}`, TTS_STEP, () => guard(async () => {
          await status(`🔊 در حال ساخت صدا… اسلاید ${toFa(String(it.i + 1))} از ${toFa(String(plan.total))}`);
          const wav = await ttsSpeak(this.env, splitSpeech(it.text, 1200), { style: SPEECH_STYLE });
          const name = fileNameWithSite(this.env, plan.title, "wav", `اسلاید ${it.i + 1}`, 40);
          await sendAudio(this.env, chatId, wav, name, `🔊 <b>اسلاید ${toFa(String(it.i + 1))}</b> · ${esc(it.title.slice(0, 80))}`, {
            title: `اسلاید ${toFa(String(it.i + 1))}: ${it.title}`, performer: plan.title, duration: wavSeconds(wav),
          });
          return true;
        }));
        sent++;
      } catch (e) {
        failed.push(`${toFa(String(it.i + 1))}`);
        console.error("slide audio failed", it.i, String(e).slice(0, 300));
      }
    }
    await step.do("finish", async () => {
      if (!sent) throw new NonRetryableError("هیچ صدایی ساخته نشد (کلیدها یا سهمیه را بررسی کن)");
      await status(`✅ اسلاید صوتی آماده شد: ${toFa(String(sent))} فایل${failed.length ? `\n⚠️ ناموفق: اسلاید ${failed.join("، ")} (دوباره دکمه را بزن)` : ""}`);
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

