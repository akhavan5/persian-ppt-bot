/**
 * ساخت کاروسل (پست چندکارتی اینستاگرام) با Gamma — فقط مدیر، فقط از ربات: /gamma موضوع | تعداد | ابعاد
 * Workflow «persian-ppt-gamma»: ساخت (Classic، format=social، ۴:۵، زبان fa، export=png) ← poll هر ۸ ثانیه ← دانلود export ← فرستادن کارت‌ها به چت مدیر.
 * ساخت Gamma تا چند دقیقه طول می‌کشد و بیرون از سقف waitUntil است؛ برای همین Workflow است.
 * کردیت Gamma از حساب صاحب GAMMA_API_KEY کم می‌شود؛ اعتبار کاربران ربات دخالتی ندارد. گام «ساخت» هرگز تکرار نمی‌شود تا کردیت دوباره خرج نشود.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import JSZip from "jszip";
import type { Env } from "./env";
import { withStore } from "./store";
import { editMessage, esc, sendDocument, sendMessage, sendPhoto } from "./telegram";
import { GammaError, createCarousel, downloadExport, exportGamma, gammaEnabled, getExport, getGeneration, type CarouselOptions } from "./gamma";

export interface GammaParams {
  chatId: number;
  statusMessageId: number;
  topic: string;
  numCards: number;
  dimensions: NonNullable<CarouselOptions["dimensions"]>;
}

const ONE = { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" } as const;
const POLL = { retries: { limit: 2, delay: "5 seconds" }, timeout: "30 seconds" } as const;
const SEND = { retries: { limit: 0, delay: "1 second" }, timeout: "3 minutes" } as const;
const POLL_EVERY = "8 seconds";
const MAX_POLLS = 80; // ≈ ۱۰ تا ۱۱ دقیقه
const MAX_EXPORT_POLLS = 15;
const MAX_CARDS_SENT = 12;
const PHOTO_LIMIT = 10 * 1024 * 1024; // سقف sendPhoto تلگرام

const DIMS = new Set(["4x5", "1x1", "9x16"]);

/** /gamma موضوع | تعداد کارت (۱ تا ۱۲) | ابعاد (4x5 | 1x1 | 9x16) */
export async function gammaCommand(env: Env, chatId: number, text: string): Promise<void> {
  const body = text.replace(/^\/gamma\S*\s*/i, "").trim();
  const usage = "قالب: <code>/gamma موضوع | تعداد کارت | ابعاد</code>\nمثال: <code>/gamma ۵ نکته برای ارائه‌ی بهتر | 7 | 4x5</code>\nتعداد (پیش‌فرض ۷) و ابعاد (4x5 پیش‌فرض، یا 1x1 یا 9x16) اختیاری‌اند.";
  if (!gammaEnabled(env)) return void (await sendMessage(env, chatId, "⚠️ Gamma فعال نیست: رمز <code>GAMMA_API_KEY</code> تنظیم نشده است."));
  if (!env.GAMMA_WORKFLOW) return void (await sendMessage(env, chatId, "⚠️ Workflow «persian-ppt-gamma» در wrangler.jsonc تعریف نشده است."));
  if (!body) return void (await sendMessage(env, chatId, usage));
  const [topicRaw, ...rest] = body.split("|").map((s) => s.trim());
  const topic = topicRaw.slice(0, 4000);
  if (topic.length < 3) return void (await sendMessage(env, chatId, usage));
  let numCards = 7;
  let dimensions: GammaParams["dimensions"] = "4x5";
  for (const p of rest) {
    const n = Number(p.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))));
    if (Number.isFinite(n) && n >= 1 && n <= MAX_CARDS_SENT && /^\d+$|^[۰-۹]+$/.test(p)) numCards = n;
    else if (DIMS.has(p.toLowerCase())) dimensions = p.toLowerCase() as GammaParams["dimensions"];
  }
  const m = await sendMessage(env, chatId, `🎠 ساخت کاروسل با Gamma شروع شد (${numCards} کارت، ${dimensions.replace("x", ":")})…\nمعمولاً ۱ تا ۳ دقیقه طول می‌کشد.`);
  try {
    await env.GAMMA_WORKFLOW.create({ id: `gamma-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, params: { chatId, statusMessageId: m.message_id, topic, numCards, dimensions } });
  } catch (e) {
    console.error("gamma workflow create", String(e).slice(0, 200));
    await editMessage(env, chatId, m.message_id, "❌ شروع ساخت ناموفق بود؛ کمی بعد دوباره امتحان کن.").catch(() => {});
  }
}

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;
const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

const errText = (e: unknown) => {
  if (e instanceof GammaError) {
    if (e.status === 401) return "کلید Gamma نامعتبر است (۴۰۱).";
    if (e.noCredits) return "کردیت Gamma کافی نیست.";
    if (e.status === 429) return `سقف نرخ/هم‌زمانی Gamma (۴۲۹)${e.retryAfter ? `؛ ${e.retryAfter} ثانیه بعد دوباره` : ""}.`;
    return e.message;
  }
  return String(e instanceof Error ? e.message : e);
};

export class GammaWorkflow extends WorkflowEntrypoint<Env, GammaParams> {
  constructor(ctx: ExecutionContext, env: Env) { super(ctx, withStore(env)); }

  async run(event: WorkflowEvent<GammaParams>, step: WorkflowStep): Promise<{ cards: number; gammaUrl?: string }> {
    const { chatId, statusMessageId: mid, topic, numCards, dimensions } = event.payload;
    const status = (t: string) => editMessage(this.env, chatId, mid, t).catch(() => {});
    try {
      // ۱) ساخت (بدون تکرار: تکرار = کردیت دوباره)
      const gen = await step.do("create", ONE, async () => {
        try { return await createCarousel(this.env, topic, { numCards, dimensions, exportAs: "png" }); }
        catch (e) { throw new NonRetryableError(errText(e)); }
      });

      // ۲) poll
      type St = { state: string; gammaId?: string; gammaUrl?: string; exportUrl?: string; error?: string; credits?: number; percent?: number };
      let st: St | null = null;
      for (let i = 0; i < MAX_POLLS; i++) {
        await step.sleep(`wait-${i}`, POLL_EVERY);
        const cur: St = await step.do(`poll-${i}`, POLL, async () => {
          try {
            const s = await getGeneration(this.env, gen.generationId);
            return { state: s.state, gammaId: s.gammaId, gammaUrl: s.gammaUrl, exportUrl: s.exportUrl, error: s.error, credits: s.creditsDeducted, percent: s.percent };
          } catch (e) {
            if (e instanceof GammaError && !e.retryable) throw new NonRetryableError(errText(e));
            throw e;
          }
        });
        st = cur;
        if (cur.state === "completed") break;
        if (cur.state === "failed") throw new NonRetryableError(`Gamma: ${cur.error ?? "ساخت ناموفق بود"}`);
        const pct = cur.percent;
        if (i % 3 === 2) await step.do(`prog-${i}`, ONE, () => status(`🎠 در حال ساخت کاروسل…${pct !== undefined ? ` (${Math.round(pct)}٪)` : ""}`));
      }
      if (!st || st.state !== "completed") throw new NonRetryableError("Gamma بیش از ۱۰ دقیقه طول کشید؛ بعداً در حساب Gamma بررسی کن.");

      // ۳) اگر ساخت export همراه نداشت، جدا بخواه
      const done = st; // نسخه‌ی غیر-null برای closureها
      let exportUrl = done.exportUrl;
      if (!exportUrl && done.gammaId) {
        const ex = await step.do("export", ONE, async () => {
          try { return await exportGamma(this.env, done.gammaId!, "png"); }
          catch (e) { throw new NonRetryableError(errText(e)); }
        });
        exportUrl = ex.exportUrl;
        for (let i = 0; i < MAX_EXPORT_POLLS && !exportUrl && ex.exportId; i++) {
          await step.sleep(`ex-wait-${i}`, "5 seconds");
          const r = await step.do(`ex-poll-${i}`, POLL, () => getExport(this.env, ex.exportId!).then((x) => ({ state: x.state, exportUrl: x.exportUrl, error: x.error })));
          if (r.state === "failed") throw new NonRetryableError(`Gamma export: ${r.error ?? "ناموفق"}`);
          exportUrl = r.exportUrl;
        }
      }
      if (!exportUrl) throw new NonRetryableError("فایل خروجی Gamma آماده نشد" + (done.gammaUrl ? `؛ خودِ کاروسل اینجاست: ${done.gammaUrl}` : ""));

      // ۴) دانلود و ارسال کارت‌ها
      const url = exportUrl;
      const sent = await step.do("deliver", SEND, async () => {
        let data: Uint8Array;
        try { data = await downloadExport(url); } catch (e) { throw new NonRetryableError(errText(e)); }
        const cap = (n: number, total: number) => `🎠 کارت ${n} از ${total}${n === 1 ? `\n<b>${esc(topic.slice(0, 200))}</b>` : ""}`;
        if (isZip(data)) {
          const zip = await JSZip.loadAsync(data);
          const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && /\.(png|jpe?g|webp)$/i.test(n))
            .sort((a, b) => a.localeCompare(b, "en", { numeric: true })).slice(0, MAX_CARDS_SENT);
          for (let k = 0; k < names.length; k++) {
            const bytes = await zip.files[names[k]].async("uint8array");
            const fname = `carousel-${String(k + 1).padStart(2, "0")}.${/\.jpe?g$/i.test(names[k]) ? "jpg" : /\.webp$/i.test(names[k]) ? "webp" : "png"}`;
            if (bytes.byteLength <= PHOTO_LIMIT) await sendPhoto(this.env, chatId, bytes, fname, cap(k + 1, names.length), fname.endsWith(".jpg") ? "image/jpeg" : fname.endsWith(".webp") ? "image/webp" : "image/png");
            else await sendDocument(this.env, chatId, bytes, fname, cap(k + 1, names.length), { mime: "image/png" });
          }
          return names.length;
        }
        if (isPng(data)) { await sendPhoto(this.env, chatId, data, "carousel-01.png", cap(1, 1)); return 1; }
        if (isPdf(data)) { await sendDocument(this.env, chatId, data, "carousel.pdf", cap(1, 1), { mime: "application/pdf" }); return 1; }
        throw new NonRetryableError("قالب فایل خروجی Gamma ناشناخته است");
      });

      await step.do("finish", ONE, () => status(
        `✅ کاروسل آماده شد (${sent} کارت).` +
        (done.gammaUrl ? `\n🔗 ${esc(done.gammaUrl)}` : "") +
        (done.credits !== undefined ? `\n💳 کردیت مصرف‌شده‌ی Gamma: ${done.credits}` : "")));
      return { cards: sent, gammaUrl: done.gammaUrl };
    } catch (e) {
      const reason = String(e instanceof Error ? e.message : e).slice(0, 400);
      console.error("gamma workflow failed", reason);
      await step.do("notify-failure", ONE, () => status(`❌ ساخت کاروسل ناموفق بود:\n${esc(reason)}`)).catch(() => {});
      throw e;
    }
  }
}
