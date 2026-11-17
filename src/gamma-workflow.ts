/**
 * خروجی‌های Gamma «بعد از ساخت ارائه»: پست، کاروسل، استوری، بنر، تصویر بازاریابی، اینفوگرافیک، اسلاید تک‌کارتی و سند.
 * مثل جزوه و پادکست یک دکمه‌ی «همراه» زیر ارائه‌اند (extras.ts؛ کد دکمه ex:g?:<ارائه>) و دستور جدای /gamma حذف شده است.
 * فعلاً فقط برای مدیر و فقط در تلگرام روشن است (isGammaAdmin در extras.ts).
 *
 * مسیر Workflow «persian-ppt-gamma»:
 *  ۱) خواندن متن منبع: فقط متن ذخیره‌ی ۲۴ ساعته‌ی همان ارائه (loadPreview) خوانده می‌شود؛ هیچ درخواستی به مدل هوش مصنوعی نمی‌رود؛
 *  ۲) ساخت در Gamma: همان متن منبع + دستور هر نوع به Gamma داده می‌شود و نوشتن متن و طراحی کامل با خودِ Gamma است
 *     (gamma.ts: ارزان‌ترین مدل تصویر، یک کارت) ← poll هر ۸ ثانیه؛
 *  ۳) دانلود export (png/pptx/pdf) و فرستادن در چت.
 * قواعد اعتبار مثل بقیه‌ی همراه‌ها: ۱ اعتبار جدا (startExtra کسر می‌کند)؛ شکست ⇒ فقط همان اعتبار برمی‌گردد و نشانگر پاک می‌شود تا دکمه دوباره دیده شود.
 * گام «ساخت» در Gamma هرگز تکرار نمی‌شود تا کردیت Gamma دوباره خرج نشود. کردیت Gamma از حساب صاحب GAMMA_API_KEY کم می‌شود.
 * خروجی‌ها فقط در چت فرستاده می‌شوند و در «فایل‌های ۲۴ ساعته» ذخیره نمی‌شوند (تا با فایل‌های ارائه/پوستر/جزوه‌ی وب قاطی نشوند).
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import JSZip from "jszip";
import type { Env } from "./env";
import type { Deck } from "./types";
import { withStore } from "./store";
import { editMessage, esc, sendDocument, sendMessage, sendPhoto } from "./telegram";
import { refundCredit, type CreditSource, type Uid } from "./settings";
import { loadPreview } from "./files";
import { unmarkExtra } from "./extras";
import { notifyPlanCreditsOut } from "./plan-notify";
import { GammaError, createGammaExtra, createImage, downloadExport, exportGamma, getExport, getGeneration, getImage, gammaSpec, type GammaKind, type GammaKindSpec } from "./gamma";

export interface GammaParams {
  kind: GammaKind;
  chatId: number;
  statusMessageId: number;
  uid: Uid;
  /** شناسه‌ی ارائه (همان شناسه‌ی نمونه‌ی DeckWorkflow)؛ متن از پیش‌نمایش ۲۴ ساعته خوانده می‌شود */
  deckId: string;
  /** اعتبار همین کار؛ در شکست برگردانده می‌شود */
  credit: { source: CreditSource; day: string };
}

const ONE = { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" } as const;
const POLL = { retries: { limit: 2, delay: "5 seconds" }, timeout: "30 seconds" } as const;
const SEND = { retries: { limit: 0, delay: "1 second" }, timeout: "3 minutes" } as const;
const LOAD = { retries: { limit: 1, delay: "5 seconds" }, timeout: "30 seconds" } as const;
const POLL_EVERY = "8 seconds";
const MAX_POLLS = 80; // ≈ ۱۰ تا ۱۱ دقیقه
const MAX_EXPORT_POLLS = 15;
const MAX_FILES_SENT = 12;
const PHOTO_LIMIT = 10 * 1024 * 1024; // سقف sendPhoto تلگرام

// ---------- ۱) متن منبع جمع‌وجور ----------
const SOURCE_CAP = 3500;

/** خلاصه‌ی ارائه برای Gamma: عنوان + عنوان هر اسلاید با حداکثر ۲ نکته‌ی اول (برای خروجی ۱ کارتی ورودی بلند فقط نویز است)؛ همه‌ی اسلایدها پوشش داده می‌شود نه ابتدای متن */
export function compactSource(deck: Deck): string {
  type Slide = Deck["slides"][number];
  const points = (s: Slide): string[] =>
    [...(s.bullets ?? []), ...(s.columns ?? []).flatMap((c) => c.bullets ?? []), ...(s.items ?? []).map((x) => `${x.heading}: ${x.text}`), ...(s.steps ?? []).map((x) => `${x.label}: ${x.text}`), s.subtitle ?? ""]
      .map((x) => x.trim()).filter(Boolean);
  const lines = deck.slides.filter((s) => s.title).map((s) => {
    const p = points(s).slice(0, 2).map((x) => x.slice(0, 140));
    return `- ${s.title}${p.length ? `: ${p.join(" / ")}` : ""}`;
  });
  return [`عنوان ارائه: ${deck.title}`, ...lines].join("\n").slice(0, SOURCE_CAP);
}

/** پرامپت تصویر بدون مدل: فقط موضوع (عنوان ارائه و عنوان چند اسلاید اول)؛ طراحی و متن داخل تصویر کاملاً با Gamma */
export function imagePrompt(deck: Deck): string {
  const topics = deck.slides.map((s) => s.title).filter(Boolean).slice(1, 5).join("، ");
  return `An image about the topic "${deck.title}".${topics ? ` Related ideas: ${topics}.` : ""}`.slice(0, 1500);
}

// ---------- خطاها ----------
const errText = (e: unknown) => {
  if (e instanceof GammaError) {
    if (e.status === 401) return "کلید Gamma نامعتبر است (۴۰۱).";
    if (e.noCredits) return "کردیت Gamma کافی نیست.";
    if (e.status === 429) return `سقف نرخ/هم‌زمانی Gamma (۴۲۹)${e.retryAfter ? `؛ ${e.retryAfter} ثانیه بعد دوباره` : ""}.`;
    return e.message;
  }
  return String(e instanceof Error ? e.message : e);
};

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;
const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

export class GammaWorkflow extends WorkflowEntrypoint<Env, GammaParams> {
  constructor(ctx: ExecutionContext, env: Env) { super(ctx, withStore(env)); }

  /** تصویر تکی از POST /images؛ ساخت تکرار نمی‌شود (هزینه‌ی Gamma)، شکست را run() با برگشت اعتبار می‌گیرد */
  private async runImage(step: WorkflowStep, spec: GammaKindSpec, written: { title: string; prompt: string }, p: GammaParams, status: (t: string) => Promise<unknown>): Promise<{ files: number }> {
    const { chatId, uid, credit } = p;
    await step.do("status-create", ONE, () => status(`🎨 ساخت ${spec.name} در Gamma…\nمعمولاً کمتر از ۲ دقیقه طول می‌کشد.`));
    const gen = await step.do("create-image", ONE, async () => {
      try { return { id: (await createImage(this.env, written.prompt, spec.imageSize ?? "social-square")).imageGenerationId }; }
      catch (e) { throw new NonRetryableError(errText(e)); }
    });
    type Im = { state: string; url?: string; mimeType?: string; credits?: number; error?: string };
    let im: Im | null = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      await step.sleep(`img-wait-${i}`, "5 seconds");
      const cur: Im = await step.do(`img-poll-${i}`, POLL, async () => {
        try { return await getImage(this.env, gen.id); }
        catch (e) { if (e instanceof GammaError && !e.retryable) throw new NonRetryableError(errText(e)); throw e; }
      });
      im = cur;
      if (cur.state === "completed") break;
      if (cur.state === "failed") throw new NonRetryableError(`Gamma: ${cur.error ?? "ساخت تصویر ناموفق بود"}`);
    }
    if (!im || im.state !== "completed" || !im.url) throw new NonRetryableError("تصویر Gamma آماده نشد");
    const done = im;
    const url = done.url!;
    await step.do("deliver-image", SEND, async () => {
      let data: Uint8Array;
      try { data = await downloadExport(url); } catch (e) { throw new NonRetryableError(errText(e)); }
      const mime = done.mimeType && /^image\//.test(done.mimeType) ? done.mimeType : isPng(data) ? "image/png" : "image/jpeg";
      const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      const fname = `gamma-picture.${ext}`;
      const cap = `🎨 <b>${esc(written.title.slice(0, 200))}</b>\n${esc(spec.name)} Gamma`;
      const photoOk = data.byteLength <= PHOTO_LIMIT && (await sendPhoto(this.env, chatId, data, fname, cap, mime).then(() => true, (e) => { console.error("gamma sendPhoto", String(e).slice(0, 200)); return false; }));
      if (!photoOk) await sendDocument(this.env, chatId, data, fname, cap, { mime });
      return 1;
    });
    await step.do("finish", ONE, () => status(`✅ ${spec.name} Gamma آماده شد (بالا را ببین).` + (done.credits !== undefined ? `\n💳 کردیت مصرف‌شده‌ی Gamma: ${done.credits}` : ""))).catch(() => {});
    if (credit.source === "plan") await step.do("plan-credits-out", ONE, () => notifyPlanCreditsOut(this.env, uid)).catch((e) => console.error("plan-credits-out", String(e).slice(0, 200)));
    return { files: 1 };
  }

  async run(event: WorkflowEvent<GammaParams>, step: WorkflowStep): Promise<{ files: number; gammaUrl?: string }> {
    const { kind, chatId, statusMessageId: mid, uid, deckId, credit } = event.payload;
    const spec = gammaSpec(kind);
    if (!spec) throw new NonRetryableError(`نوع ناشناخته: ${kind}`);
    const name = `${spec.name} Gamma`;
    const status = (t: string) => editMessage(this.env, chatId, mid, t).catch(() => {});
    try {
      // ۱) متن منبع: همان متن ارائه، بدون هیچ مدل هوش مصنوعی (متن و طراحی را خودِ Gamma می‌نویسد)
      const written = await step.do("load-source", LOAD, async () => {
        await status(`📄 آماده‌سازی ${spec.name}…`);
        const p = await loadPreview(this.env, uid, deckId);
        if (!p) throw new NonRetryableError("متن ارائه منقضی شده است (۲۴ ساعت)");
        return { title: p.deck.title, source: compactSource(p.deck), prompt: imagePrompt(p.deck) };
      });
      if (!written.source.trim()) throw new NonRetryableError("متن ارائه خالی است");

      if (spec.engine === "image") return await this.runImage(step, spec, written, event.payload, status);

      // ۲) ساخت (بدون تکرار: تکرار = کردیت Gamma دوباره)
      await step.do("status-create", ONE, () => status(`🎨 ساخت ${spec.name} در Gamma…\nمعمولاً ۱ تا ۳ دقیقه طول می‌کشد.`));
      const gen = await step.do("create", ONE, async () => {
        try { return { generationId: (await createGammaExtra(this.env, spec, written.source, written.title)).generationId }; } // فقط شناسه (هشدارها قابل‌ذخیره در گام نیستند)
        catch (e) { throw new NonRetryableError(errText(e)); }
      });

      // ۳) poll
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
        if (i % 3 === 2) await step.do(`prog-${i}`, ONE, () => status(`🎨 در حال ساخت ${spec.name}…${cur.percent !== undefined ? ` (${Math.round(cur.percent)}٪)` : ""}`));
      }
      if (!st || st.state !== "completed") throw new NonRetryableError("Gamma بیش از ۱۰ دقیقه طول کشید؛ بعداً در حساب Gamma بررسی کن.");

      // وب‌پیج: خروجی فایل ندارد؛ فقط لینک (view) فرستاده می‌شود
      if (spec.linkOnly) {
        const link = st.gammaUrl;
        if (!link) throw new NonRetryableError("لینک صفحه‌ی Gamma آماده نشد");
        await step.do("deliver-link", SEND, () => sendMessage(this.env, chatId, `🌍 <b>${esc(written.title.slice(0, 200))}</b>\n${esc(spec.name)} Gamma\n${esc(link)}`));
        await step.do("finish", ONE, () => status(`✅ ${name} آماده شد (لینک بالا را ببین).` + (st!.credits !== undefined ? `\n💳 کردیت مصرف‌شده‌ی Gamma: ${st!.credits}` : ""))).catch(() => {});
        if (credit.source === "plan") await step.do("plan-credits-out", ONE, () => notifyPlanCreditsOut(this.env, uid)).catch((e) => console.error("plan-credits-out", String(e).slice(0, 200)));
        return { files: 0, gammaUrl: link };
      }

      // ۴) اگر ساخت export همراه نداشت، جدا بخواه
      const done = st; // نسخه‌ی غیر-null برای closureها
      let exportUrl = done.exportUrl;
      if (!exportUrl && done.gammaId) {
        const ex = await step.do("export", ONE, async () => {
          try { return await exportGamma(this.env, done.gammaId!, spec.exportAs); }
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
      if (!exportUrl) throw new NonRetryableError("فایل خروجی Gamma آماده نشد" + (done.gammaUrl ? `؛ خودِ طرح اینجاست: ${done.gammaUrl}` : ""));

      // ۵) دانلود و ارسال
      const url = exportUrl;
      const sent = await step.do("deliver", SEND, async () => {
        let data: Uint8Array;
        try { data = await downloadExport(url); } catch (e) { throw new NonRetryableError(errText(e)); }
        const cap = (n: number, total: number) => `🎨 <b>${esc(written.title.slice(0, 200))}</b>\n${esc(spec.name)} Gamma${total > 1 ? ` — ${n} از ${total}` : ""}`;
        // فایل واحد: اسلاید (pptx) و سند (pdf)
        if (spec.file) {
          if (spec.file.ext === "pdf" && !isPdf(data)) throw new NonRetryableError("قالب فایل خروجی Gamma ناشناخته است");
          await sendDocument(this.env, chatId, data, `gamma-${spec.kind.slice(1)}.${spec.file.ext}`, cap(1, 1), { mime: spec.file.mime });
          return 1;
        }
        // تصویر: یک PNG یا زیپ چندکارتی؛ هر کارت یک عکس (بیش از ۱۰ مگابایت یا ردشده‌ی تلگرام ⇒ فایل)
        const images: { bytes: Uint8Array; ext: string }[] = [];
        if (isZip(data)) {
          const zip = await JSZip.loadAsync(data);
          const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && /\.(png|jpe?g|webp)$/i.test(n))
            .sort((a, b) => a.localeCompare(b, "en", { numeric: true })).slice(0, MAX_FILES_SENT);
          for (const n of names) images.push({ bytes: await zip.files[n].async("uint8array"), ext: /\.jpe?g$/i.test(n) ? "jpg" : /\.webp$/i.test(n) ? "webp" : "png" });
        } else if (isPng(data)) images.push({ bytes: data, ext: "png" });
        else if (isPdf(data)) { await sendDocument(this.env, chatId, data, `gamma-${spec.kind.slice(1)}.pdf`, cap(1, 1), { mime: "application/pdf" }); return 1; }
        if (!images.length) throw new NonRetryableError("قالب فایل خروجی Gamma ناشناخته است");
        for (let k = 0; k < images.length; k++) {
          const { bytes, ext } = images[k];
          const fname = `gamma-${spec.kind.slice(1)}-${String(k + 1).padStart(2, "0")}.${ext}`;
          const mime = ext === "jpg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
          const photoOk = bytes.byteLength <= PHOTO_LIMIT && (await sendPhoto(this.env, chatId, bytes, fname, cap(k + 1, images.length), mime).then(() => true, (e) => { console.error("gamma sendPhoto", String(e).slice(0, 200)); return false; }));
          if (!photoOk) await sendDocument(this.env, chatId, bytes, fname, cap(k + 1, images.length), { mime });
        }
        return images.length;
      });

      await step.do("finish", ONE, () => status(
        `✅ ${name} آماده شد (${sent} فایل؛ بالا را ببین).` +
        (done.gammaUrl ? `\n🔗 ${esc(done.gammaUrl)}` : "") +
        (done.credits !== undefined ? `\n💳 کردیت مصرف‌شده‌ی Gamma: ${done.credits}` : ""))).catch(() => {}); // خطای پیام پایانی نباید به «برگشت اعتبار» برسد
      if (credit.source === "plan") {
        await step.do("plan-credits-out", ONE, () => notifyPlanCreditsOut(this.env, uid)).catch((e) => console.error("plan-credits-out", String(e).slice(0, 200)));
      }
      return { files: sent, gammaUrl: done.gammaUrl };
    } catch (e) {
      const reason = String(e instanceof Error ? e.message : e).slice(0, 400);
      console.error("gamma workflow failed", kind, reason);
      // هر کار در گام جدا تا اگر یکی تکرار شد اعتبار دو بار برنگردد
      await step.do("refund", () => refundCredit(this.env, uid, credit.source, credit.day)).catch((re) => console.error("refund gamma", re));
      await step.do("unmark", () => unmarkExtra(this.env, uid, deckId, kind)).catch(() => {}); // تا دکمه دوباره دیده شود
      await step.do("notify-failure", ONE, () => status(`❌ ساخت ${name} ناموفق بود${credit.source !== "none" ? "؛ اعتبارش برگردانده شد" : ""}:\n${esc(reason)}`)).catch(() => {});
      throw e;
    }
  }
}
