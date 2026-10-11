/**
 * خواندن فایل (PDF/عکس، شامل OCR چندصفحه‌ای) برای نسخه‌ی وب در Workflow، دقیقاً مثل ربات تلگرام (ocr-workflow.ts).
 * مسیر پردازش همان extractFileBytes است که تلگرام هم استفاده می‌کند (tg-file.ts)؛ فقط ورودی از KV می‌آید نه از تلگرام.
 * بایت‌های فایل ≤۱ ساعت در KV می‌مانند (پارامتر Workflow سقف ۱ مگابایت دارد) و بعد از پایان پاک می‌شوند؛
 * صفحه‌ی وب هر چند ثانیه GET /api/extract/<jobId> را می‌خواند.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env";
import { extractFileBytes } from "./tg-file";
import { withStore } from "./store";

export interface WebOcrParams { userId: string; jobId: string; name: string; mime: string }
export type WebOcrOut = { ok: true; text: string } | { ok: false; error: string };

export const webOcrKey = (userId: string, jobId: string) => `webocr:${userId}:${jobId}`;
/** سقف متن خروجی؛ خروجی گام Workflow حداکثر ۱ مگابایت می‌تواند باشد (فارسی ≈ ۲–۳ بایت برای هر نویسه) */
const MAX_OUT_CHARS = 150_000;

export class WebOcrWorkflow extends WorkflowEntrypoint<Env, WebOcrParams> {
  constructor(ctx: ExecutionContext, env: Env) { super(ctx, withStore(env)); }

  async run(event: WorkflowEvent<WebOcrParams>, step: WorkflowStep): Promise<WebOcrOut> {
    const { userId, jobId, name, mime } = event.payload;
    const key = webOcrKey(userId, jobId);
    let out: WebOcrOut;
    try {
      out = await step.do("extract", { retries: { limit: 1, delay: "5 seconds" }, timeout: "5 minutes" }, async (): Promise<WebOcrOut> => {
        const bytes = await this.env.FILES.get(key, "arrayBuffer");
        if (!bytes) return { ok: false, error: "فایل منقضی شد؛ دوباره آپلودش کن." };
        const r = await extractFileBytes(this.env, bytes, name, mime, userId);
        return r.ok ? { ok: true, text: r.text.slice(0, MAX_OUT_CHARS) } : r;
      });
    } catch (e) {
      console.error("web ocr workflow", e instanceof Error ? e.message.slice(0, 300) : e);
      out = { ok: false, error: "خواندن فایل ناموفق بود؛ چند لحظه بعد دوباره امتحان کن." };
    }
    await step.do("cleanup", async () => { await this.env.FILES.delete(key).catch(() => {}); });
    return out;
  }
}
