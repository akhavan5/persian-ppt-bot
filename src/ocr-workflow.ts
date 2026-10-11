/** خواندن فایل تلگرام (PDF/عکس، شامل OCR چندصفحه‌ای) در Workflow؛ ctx.waitUntil بعد از پاسخ به وب‌هوک فقط ~۳۰ ثانیه فرصت دارد و OCR از آن بیشتر طول می‌کشد. */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env";
import type { Uid } from "./settings";
import { extractTelegramFile, type TgFileRef } from "./tg-file";
import { finishFileUpload } from "./bot";
import { editMessage } from "./telegram";
import { withStore } from "./store";

export interface OcrParams { chatId: number; userId: number; uid: Uid; ref: TgFileRef; caption: string; waitId: number }

export class OcrWorkflow extends WorkflowEntrypoint<Env, OcrParams> {
  constructor(ctx: ExecutionContext, env: Env) { super(ctx, withStore(env)); }

  async run(event: WorkflowEvent<OcrParams>, step: WorkflowStep) {
    const { chatId, userId, uid, ref, caption, waitId } = event.payload;
    try {
      const ex = await step.do("extract", { retries: { limit: 1, delay: "5 seconds" }, timeout: "5 minutes" }, () => extractTelegramFile(this.env, ref, uid));
      await step.do("wizard", { retries: { limit: 1, delay: "3 seconds" }, timeout: "1 minute" }, () => finishFileUpload(this.env, chatId, uid, userId, ref, caption, ex, waitId));
    } catch (e) {
      console.error("ocr workflow", e instanceof Error ? e.message.slice(0, 300) : e);
      await editMessage(this.env, chatId, waitId, "⚠️ خواندن فایل ناموفق بود؛ چند لحظه بعد دوباره امتحان کن.").catch(() => {});
    }
  }
}
