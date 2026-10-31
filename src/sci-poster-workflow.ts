/**
 * Workflow «persian-ppt-sciposter»: پوستر علمی چاپی (فقط مدیر، فقط تلگرام).
 * گام‌ها: خواندن فایل (اگر فایل فرستاده شده) ← محتوای پوستر از مدل ← PDF برداری + ارسال ← پیش‌نمایش JPEG (best-effort).
 * اعتبار کم نمی‌شود (مدیر)؛ هر خطا فقط در پیام وضعیت اعلام می‌شود. هر گام جدا تا تلاش مجدد یکی، گام‌های قبلی را تکرار نکند.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "./env";
import { LlmError } from "./llm";
import { withStore } from "./store";
import { editMessage, esc, sendDocument, sendPhoto } from "./telegram";
import { extractTelegramFile, type TgFileRef } from "./tg-file";
import { missingHeader, makeSciPoster, posterGeometry, renderPosterPdf, renderPosterPreview, sizeLabel, type PosterCfg } from "./sci-poster";
import { renderPosterHtml } from "./sci-poster-html";

const LLM_STEP = { retries: { limit: 1, delay: "10 seconds" }, timeout: "5 minutes" } as const;
const RENDER_STEP = { retries: { limit: 1, delay: "5 seconds" }, timeout: "6 minutes" } as const;
const MIN_TEXT = 200;
const MAX_SOURCE = 60_000;

export interface SciPosterParams {
  chatId: number;
  statusMessageId: number;
  cfg: PosterCfg;
  /** مدل انتخابی مدیر در تنظیمات (اختیاری) */
  model?: string;
  /** منبع: متن پیام یا فایل تلگرام (یکی از دو) */
  text?: string;
  ref?: TgFileRef;
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof LlmError && e.fatal) throw new NonRetryableError(e.message);
    throw e;
  }
}

/** نام فایل امن (بدون نویسه‌های ممنوع)؛ عنوان فارسی در نام فایل می‌ماند */
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);

export class SciPosterWorkflow extends WorkflowEntrypoint<Env, SciPosterParams> {
  constructor(ctx: ExecutionContext, env: Env) { super(ctx, withStore(env)); }

  async run(event: WorkflowEvent<SciPosterParams>, step: WorkflowStep): Promise<{ title: string }> {
    const { chatId, statusMessageId: mid, cfg, model, ref } = event.payload;
    const status = (t: string) => editMessage(this.env, chatId, mid, t).catch(() => {});
    const site = this.env.SITE_URL || "https://pptsaz.ir";

    try {
      // ۱) منبع: متن پیام یا متن استخراج‌شده از فایل (PDF متنی، Word، اسکن با OCR)
      const source = await step.do("source", { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" }, async () => {
        if (!ref) return String(event.payload.text ?? "").slice(0, MAX_SOURCE);
        await status("📖 در حال خواندن فایل…");
        const r = await extractTelegramFile(this.env, ref, chatId);
        if (!r.ok) throw new NonRetryableError(r.error);
        return r.text.slice(0, MAX_SOURCE);
      });
      if (source.replace(/\s+/g, " ").trim().length < MIN_TEXT) throw new NonRetryableError("متن کافی در فایل پیدا نشد (حداقل ۲۰۰ نویسه لازم است).");

      // ۲) محتوای پوستر (JSON) از روی همان منبع
      const poster = await step.do("content", LLM_STEP, () =>
        guard(async () => {
          await status("🧠 استخراج ساختار پوستر از متن مقاله…");
          return makeSciPoster(this.env, source, { lang: cfg.lang, model });
        }));
      const g = posterGeometry(cfg);
      const html = () => renderPosterHtml(poster, cfg, { site });
      const missing = missingHeader(poster);
      const base = `Poster-${cfg.size}-${cfg.orient === "p" ? "portrait" : "landscape"}`;

      // ۳) PDF برداری با اندازه‌ی واقعی چاپ
      await step.do("pdf", RENDER_STEP, async () => {
        await status(`🖨 ساخت PDF چاپی ${cfg.size}…`);
        const pdf = await renderPosterPdf(this.env, html(), g);
        const caption =
          `🔬 <b>${esc(poster.title)}</b>\n` +
          `📐 ${sizeLabel(cfg)}${g.bleed ? ` + bleed ${g.bleed}mm در هر لبه (کل صفحه ${g.pageW}×${g.pageH} mm)` : ""}\n` +
          "🖨 PDF برداری؛ فونت‌ها داخل فایل جاسازی شده. رنگ‌ها RGB است؛ اگر چاپخانه CMYK می‌خواهد، در نرم‌افزار خودش تبدیل شود." +
          (missing.length ? `\n\n⚠️ ${missing.join(" و ")} در متن نبود و خالی ماند.` : "");
        await sendDocument(this.env, chatId, pdf, `${base}-${safeName(poster.title)}.pdf`, caption, { mime: "application/pdf" });
      });

      // ۴) پیش‌نمایش داخل چت؛ شکستش نباید کار را خراب کند (PDF قبلاً رسیده)
      await step.do("preview", RENDER_STEP, async () => {
        await status("🖼 ساخت پیش‌نمایش…");
        const jpg = await renderPosterPreview(this.env, html(), g);
        await sendPhoto(this.env, chatId, jpg, `${base}-preview.jpg`, "👁 پیش‌نمایش (فقط برای مرور؛ فایل چاپی همان PDF است)", "image/jpeg");
      }).catch((e) => console.error("sci poster preview", String(e).slice(0, 200)));

      await step.do("finish", () => status("✅ پوستر آماده شد؛ فایل را بالا ببین.")).catch(() => {});
      return { title: poster.title };
    } catch (e) {
      const reason = String(e instanceof Error ? e.message : e).slice(0, 500);
      console.error("sci poster workflow failed", reason);
      // فقط دلیل‌های فارسیِ خودمان (خطای فایل، متن کم) نشان داده می‌شود؛ خطای فنی در لاگ می‌ماند
      const clean = reason.replace(/^(NonRetryableError:\s*)+/, "");
      const userMsg = /[\u0600-\u06FF]/.test(clean) ? ` (${esc(clean.slice(0, 200))})` : "";
      await step.do("notify-failure", () => status(`❌ ساخت پوستر ناموفق بود${userMsg}. کمی بعد دوباره امتحان کن (/poster).`)).catch(() => {});
      throw e;
    }
  }
}
