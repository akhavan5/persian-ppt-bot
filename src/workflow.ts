import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "./env";
import type { DeckParams } from "./types";
import { LlmError, makeDeck, makeOutline } from "./llm";
import { fetchImages } from "./images";
import { buildPptx } from "./pptx";
import { editMessage, esc, sendDocument, sendMessage } from "./telegram";
import { toFa } from "./util";
import { BUY_NOTE, adminIds, buyKb, bumpStat, getCredit, getUserSeen, refundCredit, releaseLock } from "./settings";
import { MAX_BYTES, logDeck, saveFile } from "./files";
import { setJob, type JobPhase } from "./web";

const LLM_STEP = { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "4 minutes" } as const;

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    // کلید نادرست/مدل ناموجود با تلاش مجدد درست نمی‌شود
    if (e instanceof LlmError && e.fatal) throw new NonRetryableError(e.message);
    throw e;
  }
}

function safeFilename(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
  return `${base || "presentation"}.pptx`;
}

export class DeckWorkflow extends WorkflowEntrypoint<Env, DeckParams> {
  async run(event: WorkflowEvent<DeckParams>, step: WorkflowStep) {
    const { chatId, statusMessageId: mid, userId, topic, settings, credit, day } = event.payload;
    const contentOpts = { mode: settings.mode, sources: settings.sources, questions: settings.questions };
    const web = !!event.payload.web;
    // تلگرام: ویرایش پیام وضعیت. وب: ثبت مرحله در Durable Object (مرورگر آن را می‌خواند)
    const status = (t: string, phase?: JobPhase) => web
      ? (phase ? setJob(this.env, userId, event.instanceId, phase) : Promise.resolve()).catch(() => {})
      : editMessage(this.env, chatId, mid, t).catch(() => {});
    const failText = "ساخت ارائه با خطا مواجه شد" + (credit && credit !== "none" ? "؛ اعتبارت برگردانده شد" : "") + ". چند دقیقه بعد دوباره امتحان کن.";
    let built: { name: string; title: string; slides: number } | null = null;

    try {
      const outline = await step.do("outline", LLM_STEP, () =>
        guard(async () => {
          await status("⏳ ۱/۳ — طراحی سرفصل‌ها…", "outline");
          return makeOutline(this.env, topic, settings.slides, settings.tone, contentOpts);
        }));

      const deck = await step.do("content", LLM_STEP, () =>
        guard(async () => {
          await status("✍️ ۲/۳ — نوشتن محتوای اسلایدها…", "content");
          return makeDeck(this.env, topic, outline.title, outline.slides, settings.tone, contentOpts);
        }));

      // ساخت فایل و ارسال در یک گام: خروجی باینری نباید از گام برگردانده شود (سقف ۱ مگابایت برای وضعیت گام)
      built = await step.do("build-and-send",
        { retries: { limit: 1, delay: "5 seconds" }, timeout: "3 minutes" },
        async () => {
          await status("🎨 ۳/۳ — ساخت فایل پاورپوینت…", "build");
          const images = settings.images ? await fetchImages(this.env, deck.slides) : new Map();
          const bytes = await buildPptx(deck, {
            theme: settings.theme, font: settings.font, persianDigits: settings.digits, images,
          });
          const filename = safeFilename(deck.title);
          if (web) {
            // در وب، همین ذخیره‌سازی تنها راه تحویل فایل است؛ پس خطا باید گام را شکست بدهد (و اعتبار برگردد)
            if (bytes.byteLength > MAX_BYTES) throw new Error("خروجی از سقف اندازه‌ی فایل بزرگ‌تر شد");
            await saveFile(this.env, userId, event.instanceId, bytes, filename, deck.title, deck.slides.length);
          } else {
            await sendDocument(this.env, chatId, bytes, filename,
              `✅ <b>${esc(deck.title)}</b>\n${toFa(String(deck.slides.length))} اسلاید`);
            // نگه‌داری ۲۴ ساعته برای /files؛ خطا در ذخیره نباید گام را شکست بدهد (فایل قبلاً فرستاده شده)
            await saveFile(this.env, userId, event.instanceId, bytes, filename, deck.title, deck.slides.length)
              .catch((err) => console.error("saveFile", err));
          }
          // ثبت در گزارش مدیر (/decks)؛ خطا نباید گام را شکست بدهد
          const seen = await getUserSeen(this.env, userId).catch(() => null);
          await logDeck(this.env, { id: event.instanceId, userId, n: seen?.n ?? "", u: seen?.u ?? null, title: deck.title, slides: deck.slides.length, t: Date.now() })
            .catch((err) => console.error("logDeck", err));
          if (web) return { name: filename, title: deck.title, slides: deck.slides.length };
          const done = "✅ آماده شد! فایل بالا را ببین. برای ساخت ارائه‌ی بعدی، موضوع جدید را بفرست.";
          // اعتبار کم: بهترین لحظه برای نمایش دکمه‌های خرید
          const c = await getCredit(this.env, userId).catch(() => null);
          if (c && !c.unlimited && c.total <= 1) {
            const warn = c.total === 0 ? "⚠️ اعتبارت تمام شد." : "⚠️ فقط ۱ ارائه‌ی دیگر اعتبار داری.";
            await editMessage(this.env, chatId, mid,
              `${done}\n\n${warn}\n${BUY_NOTE}\n🎁 یا با /invite دوستانت را دعوت کن و ارائه‌ی رایگان بگیر.`, buyKb(userId)).catch(() => {});
          } else {
            await status(done);
          }
          return { name: filename, title: deck.title, slides: deck.slides.length };
        });
    } catch (e) {
      console.error("deck workflow failed", e);
      // هر کار در گام جدا تا اگر یکی تکرار شد، بقیه دوباره اجرا نشوند (مثلاً اعتبار دو بار برنگردد)
      await step.do("refund", () => refundCredit(this.env, userId, credit ?? "none", day));
      await step.do("notify-failure", async () => {
        await status("❌ " + failText + " اگر تکرار شد، تنظیمات سرویس هوش مصنوعی را بررسی کن.");
      });
      // خبر به مدیر؛ برای جلوگیری از سیل پیام (مثلاً کلید نادرست)، هر ۵ دقیقه حداکثر یک بار
      await step.do("alert-admin", async () => {
        const ids = adminIds(this.env);
        if (!ids.length || (await this.env.KV.get("alert:fail")) !== null) return;
        await this.env.KV.put("alert:fail", "1", { expirationTtl: 300 });
        const reason = String(e instanceof Error ? e.message : e).slice(0, 300);
        const msg = `🚨 <b>خطا در ساخت ارائه</b>\n👤 <code>${userId}</code>\n📝 ${esc(topic.slice(0, 80))}\n⚠️ <code>${esc(reason)}</code>\n\n<i>خطاهای بعدی تا ۵ دقیقه اعلام نمی‌شوند.</i>`;
        for (const id of ids) await sendMessage(this.env, Number(id), msg).catch(() => {});
      }).catch(() => {});
      await step.do("fail-cleanup", async () => {
        await releaseLock(this.env, userId);
        await bumpStat(this.env, "fail").catch(() => {});
        // وب: خطا بعد از آزاد شدن قفل اعلام می‌شود تا دکمه‌ی «ساخت» بی‌دلیل ۴۰۹ نگیرد
        if (web) await setJob(this.env, userId, event.instanceId, "error", { msg: failText }).catch(() => {});
      });
      throw e;
    }

    // خارج از try: خطا در این گام نباید باعث «برگشت اعتبار» بعد از ارسال موفق فایل شود
    await step.do("finish", async () => {
      await releaseLock(this.env, userId);
      await bumpStat(this.env, "ok").catch(() => {});
      if (web && built) await setJob(this.env, userId, event.instanceId, "done", { name: built.name, title: built.title, slides: built.slides });
    });
  }
}
