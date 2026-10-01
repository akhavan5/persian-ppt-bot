import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "./env";
import type { DeckParams } from "./types";
import { LlmError, makeDeck, makeOutline } from "./llm";
import { fetchImages } from "./images";
import { buildPptx } from "./pptx";
import { editMessage, esc, sendDocument } from "./telegram";
import { toFa } from "./util";
import { bumpStat, refundCredit, releaseLock } from "./settings";

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
    const status = (t: string) => editMessage(this.env, chatId, mid, t).catch(() => {});

    try {
      const outline = await step.do("outline", LLM_STEP, () =>
        guard(async () => {
          await status("⏳ ۱/۳ — طراحی سرفصل‌ها…");
          return makeOutline(this.env, topic, settings.slides, settings.tone);
        }));

      const deck = await step.do("content", LLM_STEP, () =>
        guard(async () => {
          await status("✍️ ۲/۳ — نوشتن محتوای اسلایدها…");
          return makeDeck(this.env, topic, outline.title, outline.slides, settings.tone);
        }));

      // ساخت فایل و ارسال در یک گام: خروجی باینری نباید از گام برگردانده شود (سقف ۱ مگابایت برای وضعیت گام)
      await step.do("build-and-send",
        { retries: { limit: 1, delay: "5 seconds" }, timeout: "3 minutes" },
        async () => {
          await status("🎨 ۳/۳ — ساخت فایل پاورپوینت…");
          const images = settings.images ? await fetchImages(this.env, deck.slides) : new Map();
          const bytes = await buildPptx(deck, {
            theme: settings.theme, font: settings.font, persianDigits: settings.digits, images,
          });
          await sendDocument(this.env, chatId, bytes, safeFilename(deck.title),
            `✅ <b>${esc(deck.title)}</b>\n${toFa(String(deck.slides.length))} اسلاید`);
          await status("✅ آماده شد! فایل بالا را ببین. برای ساخت ارائه‌ی بعدی، موضوع جدید را بفرست.");
        });
    } catch (e) {
      console.error("deck workflow failed", e);
      // هر کار در گام جدا تا اگر یکی تکرار شد، بقیه دوباره اجرا نشوند (مثلاً اعتبار دو بار برنگردد)
      await step.do("refund", () => refundCredit(this.env, userId, credit ?? "none", day));
      await step.do("notify-failure", async () => {
        await status("❌ ساخت ارائه با خطا مواجه شد" + (credit && credit !== "none" ? "؛ اعتبارت برگردانده شد" : "") +
          ". چند دقیقه بعد دوباره امتحان کن؛ اگر تکرار شد، تنظیمات سرویس هوش مصنوعی را بررسی کن.");
      });
      await step.do("fail-cleanup", async () => {
        await releaseLock(this.env, userId);
        await bumpStat(this.env, "fail").catch(() => {});
      });
      throw e;
    }

    // خارج از try: خطا در این گام نباید باعث «برگشت اعتبار» بعد از ارسال موفق فایل شود
    await step.do("finish", async () => {
      await releaseLock(this.env, userId);
      await bumpStat(this.env, "ok").catch(() => {});
    });
  }
}
