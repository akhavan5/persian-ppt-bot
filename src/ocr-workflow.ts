/** خواندن فایل تلگرام (PDF/عکس، شامل OCR چندصفحه‌ای) در Workflow؛ ctx.waitUntil بعد از پاسخ به وب‌هوک فقط ~۳۰ ثانیه فرصت دارد و OCR از آن بیشتر طول می‌کشد. */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env";
import type { Uid } from "./settings";
import { extractTelegramFile, type TgFileRef } from "./tg-file";
import { finishFileUpload } from "./bot";
import { editMessage, sendMessage } from "./telegram";
import { withStore } from "./store";

/** سقف آلبوم تلگرام ۱۰ مورد است */
const ALBUM_MAX = 10;

export interface OcrParams { chatId: number; userId: number; uid: Uid; ref: TgFileRef; caption: string; waitId: number; /** کلید آلبوم (چند عکس یک پیام): همه خوانده و یک کارت ساخته می‌شود */ group?: string }

export class OcrWorkflow extends WorkflowEntrypoint<Env, OcrParams> {
  constructor(ctx: ExecutionContext, env: Env) { super(ctx, withStore(env)); }

  async run(event: WorkflowEvent<OcrParams>, step: WorkflowStep) {
    const { chatId, userId, uid, ref, caption, waitId, group } = event.payload;
    try {
      if (group) return await this.runAlbum(step, { chatId, userId, uid, caption, waitId, group, first: ref });
      const ex = await step.do("extract", { retries: { limit: 1, delay: "5 seconds" }, timeout: "5 minutes" }, () => extractTelegramFile(this.env, ref, uid));
      await step.do("wizard", { retries: { limit: 1, delay: "3 seconds" }, timeout: "1 minute" }, () => finishFileUpload(this.env, chatId, uid, userId, ref, caption, ex, waitId));
    } catch (e) {
      console.error("ocr workflow", e instanceof Error ? e.message.slice(0, 300) : e);
      await editMessage(this.env, chatId, waitId, "⚠️ خواندن فایل ناموفق بود؛ چند لحظه بعد دوباره امتحان کن.").catch(() => {});
    }
  }
  /** آلبوم: چند ثانیه صبر برای رسیدن همه‌ی عکس‌ها ← خواندن به‌ترتیب ← متن‌ها پشت هم ← یک کارت. هر فایل یک شمارش از سقف OCR مصرف می‌کند. */
  private async runAlbum(step: WorkflowStep, o: { chatId: number; userId: number; uid: Uid; caption: string; waitId: number; group: string; first: TgFileRef }) {
    const { chatId, userId, uid, waitId, group } = o;
    await step.sleep("collect-wait", "5 seconds");
    const items = await step.do("collect", { retries: { limit: 1, delay: "2 seconds" }, timeout: "1 minute" }, async () => {
      await this.env.KV.put(`${group}:done`, "1", { expirationTtl: 600 }); // از این لحظه عکس دیرتر، فایل تکی حساب می‌شود
      const l = await this.env.KV.list({ prefix: `${group}:i:` });
      const out: { ref: TgFileRef; caption: string }[] = [];
      for (const k of l.keys.slice(0, ALBUM_MAX)) {
        const v = (await this.env.KV.get(k.name, "json")) as { ref?: TgFileRef; caption?: string } | null;
        if (v?.ref) out.push({ ref: v.ref, caption: String(v.caption ?? "") });
      }
      return out.length ? out : [{ ref: o.first, caption: o.caption }];
    });
    if (items.length > 1) await step.do("notify", { retries: { limit: 0 }, timeout: "30 seconds" }, () => editMessage(this.env, chatId, waitId, `⏳ در حال خواندن ${items.length} فایل…`).then(() => true).catch(() => false));

    const parts: string[] = [];
    let skipped = 0, lastErr = "";
    for (let i = 0; i < items.length; i++) {
      const ex = await step.do(`extract-${i}`, { retries: { limit: 1, delay: "5 seconds" }, timeout: "5 minutes" }, () => extractTelegramFile(this.env, items[i].ref, uid));
      if (ex.ok) { parts.push(ex.text); continue; }
      skipped += 1; lastErr = ex.error;
      if (/سقف روزانه/.test(ex.error)) { skipped += items.length - i - 1; break; } // سقف تمام شد؛ بقیه بی‌فایده است
    }
    const caption = items.map((x) => x.caption).find((c) => c.trim()) ?? "";
    const ref: TgFileRef = { ...items[0].ref, name: items.length > 1 ? `${items.length} فایل` : items[0].ref.name, isPhoto: true };
    const ex = parts.length ? { ok: true as const, text: parts.join("\n\n") } : { ok: false as const, error: lastErr || "متن قابل‌خواندنی در فایل‌ها پیدا نشد." };
    await step.do("wizard", { retries: { limit: 1, delay: "3 seconds" }, timeout: "1 minute" }, () => finishFileUpload(this.env, chatId, uid, userId, ref, caption, ex, waitId));
    if (parts.length && skipped) {
      await sendMessage(this.env, chatId, `ℹ️ ${skipped} فایل از ${items.length} فایل خوانده نشد${/سقف روزانه/.test(lastErr) ? " (سقف روزانه‌ی خواندن فایل تمام شد)" : ""}؛ ارائه از روی بقیه ساخته می‌شود.`).catch(() => {});
    }
  }
}
