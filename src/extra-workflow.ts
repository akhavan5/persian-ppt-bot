/**
 * پوستر (اینفوگرافیک) و جزوه‌ی Word که «بعد از ساخت ارائه» با دکمه‌ی زیر ارائه خواسته می‌شوند (ex: در ربات، دکمه‌ی فایل‌ها در سایت و Mini App).
 * محتوا از روی متن ذخیره‌ی ۲۴ ساعته‌ی همان ارائه (savePreview) ساخته می‌شود؛ پس نیازی به ساخت دوباره‌ی ارائه نیست.
 * قواعد مثل نسخه‌ی همراهِ DeckWorkflow: ۱ اعتبار جدا (startExtra کسر می‌کند)، خطا ⇒ فقط همان اعتبار برمی‌گردد و نشانگر پاک می‌شود.
 * خروجی کانال وب: فایل در فایل‌های ۲۴ ساعته با شناسه‌ی «<ارائه>-poster» / «<ارائه>-handout» ذخیره می‌شود (مثل حالت همراه ارائه)،
 * تلگرام: فایل مستقیم در چت فرستاده و برای /files هم ذخیره می‌شود.
 */
import type { OutLang } from "./lang";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "./env";
import { alertAdmins } from "./admin-alert";
import type { Deck } from "./types";
import { LlmError } from "./llm";
import { botPlatform, refundCredit, getSettings, type CreditSource, type Uid } from "./settings";
import { autoSendToBale } from "./bale-autosend";
import { loadPreview, saveFile } from "./files";
import { editMessage, esc, sendDocument, sendMessage, sendPhoto } from "./telegram";
import { linkedFor } from "./link";
import { withStore } from "./store";
import { appReadyMarkup, fileNameWithSite, siteMarkup } from "./deck-service";
import { fontCaption } from "./themes";
import { generateImage } from "./images";
import { IG_WIDTH, renderInfographicHtml } from "./infographic-html";
import { makeInfographic, renderInfographicImage } from "./infographic";
import { buildDocx, imageInfo, makeHandout, type DocImage } from "./handout";
import { notifyPlanCreditsOut } from "./plan-notify";
import { unmarkExtra } from "./extras";
import { sendWebPush } from "./webpush";
import { notifyOtherChannels } from "./notify-done";
import type { Platform } from "./settings";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LLM_STEP = { retries: { limit: 1, delay: "10 seconds" }, timeout: "5 minutes" } as const;

export interface ExtraParams {
  kind: "poster" | "handout";
  /** تلگرام: چت مقصد؛ وب: ۰ */
  chatId: number;
  statusMessageId: number;
  uid: Uid;
  /** شناسه‌ی ارائه (همان شناسه‌ی نمونه‌ی DeckWorkflow)؛ متن از پیش‌نمایش ۲۴ ساعته خوانده می‌شود */
  deckId: string;
  channel: "telegram" | "web";
  /** فقط وب و فقط از Mini App: پایان کار پیام کوتاه با دکمه‌ی «باز کردن اپ» به تلگرامِ وصل‌شده می‌رود */
  notify?: boolean;
  /** پلتفرم مبدأ (برای انتخاب پیام‌رسان مینی‌اپ و جلوگیری از اعلان تکراری) */
  plat?: Platform;
  /** فقط پوستر */
  layout?: "wide" | "tall";
  /** کاربر بدون پلن: واترمارک نام سایت (مثل ارائه) */
  mark: boolean;
  /** اعتبار همین کار؛ در شکست برگردانده می‌شود */
  credit: { source: CreditSource; day: string };
}
/** هم‌شکل خروجی AudioWorkflow تا وب هر دو را یک‌جور بخواند */
export interface ExtraOut { kind: "poster" | "handout"; title: string; ids: string[]; note: string }

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof LlmError && e.fatal) throw new NonRetryableError(e.message);
    throw e;
  }
}
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** متن اسلایدها به‌صورت منبعِ پوستر: عنوان، زیرعنوان، بولت‌ها، ستون‌ها، آمار، مراحل، جدول و نقل‌قول هر اسلاید */
export function deckSourceText(deck: Deck): string {
  const out: string[] = [`عنوان ارائه: ${deck.title}`];
  deck.slides.forEach((s, i) => {
    const lines = [
      s.subtitle,
      ...(s.bullets ?? []),
      ...(s.columns ?? []).flatMap((c) => [c.heading, ...(c.bullets ?? [])]),
      ...(s.stats ?? []).map((x) => `${x.value} ${x.label}`),
      ...(s.steps ?? []).map((x) => `${x.label}: ${x.text}`),
      ...(s.items ?? []).map((x) => `${x.heading}: ${x.text}`),
      ...(s.table ? [s.table.headers.join(" | "), ...s.table.rows.map((r) => r.join(" | "))] : []),
      s.quote?.text,
    ].filter((x): x is string => !!x && !!x.trim());
    out.push(`\n[${i + 1}] ${s.title}${lines.length ? "\n" + lines.map((l) => `- ${l}`).join("\n") : ""}`);
  });
  return out.join("\n").slice(0, 11000);
}

export class ExtraWorkflow extends WorkflowEntrypoint<Env, ExtraParams> {
  constructor(ctx: ExecutionContext, env: Env) { super(ctx, withStore(env)); }

  async run(event: WorkflowEvent<ExtraParams>, step: WorkflowStep): Promise<ExtraOut> {
    const { kind, chatId, statusMessageId: mid, uid, deckId, credit } = event.payload;
    const web = event.payload.channel === "web";
    const name = kind === "poster" ? "پوستر" : "جزوه";
    // تلگرام: ویرایش پیام وضعیت؛ وب: متن پیشرفت در KV (صفحه‌ی وب هر چند ثانیه می‌خواند)
    const status = (t: string) => (web
      ? this.env.KV.put(`job:${event.instanceId}`, t, { expirationTtl: 3600 })
      : editMessage(this.env, chatId, mid, t)).catch(() => {});
    try {
      const plan = await step.do("load-deck", { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" }, async () => {
        const p = await loadPreview(this.env, uid, deckId);
        if (!p) throw new NonRetryableError("متن ارائه منقضی شده است (۲۴ ساعت)");
        const s = await getSettings(this.env, uid).catch(() => null);
        return { title: p.deck.title, theme: p.theme, font: p.font, digits: p.digits, lang: p.lang, tone: s?.tone, model: s?.model };
      });
      const out = kind === "poster" ? await this.poster(event, step, plan, status, web) : await this.handout(event, step, plan, status, web);

      if (!web) await step.do("finish", () => status(`✅ ${name} آماده شد؛ فایل را بالا ببین.`)).catch(() => {}); // خطای پیام پایانی نباید به «برگشت اعتبار» برسد
      let miniAppChat: number | null = null; // چتی که پیام مینی‌اپ را گرفته (برای جلوگیری از پیام تکراری در notify-others)
      // Mini App: اگر کاربر اپ را بسته باشد از آماده شدن خبردار نمی‌شود؛ پیام کوتاه با دکمه‌ی باز کردن اپ (خطایش به اعتبار نمی‌رسد)
      if (web && event.payload.notify) {
        await step.do("notify-app", { retries: { limit: 0, delay: "1 second" }, timeout: "120 seconds" }, async () => {
          const tgChat = await linkedFor(this.env, String(uid), event.payload.plat);
          if (!tgChat) return;
          miniAppChat = tgChat;
          const autoSent = botPlatform(tgChat) === "bale" ? await autoSendToBale(this.env, uid, tgChat, out.ids) > 0 : false; // مینی‌اپ بله: فایل خودکار به چت می‌رود
          await sendMessage(this.env, tgChat, `✅ ${kind === "poster" ? "🖼 پوستر" : "📝 جزوه"} «${esc(out.title)}» آماده شد.\n${autoSent ? "فایل همین‌جا برایت فرستاده شد؛ بعداً هم می‌توانی از داخل اپ دوباره بگیری." : "برای گرفتن فایل، اپ را باز کن؛ فایل‌ها ۲۴ ساعت نگه داشته می‌شوند."}`,
            await appReadyMarkup(this.env, tgChat, out.ids[0]));
        }).catch((ne) => console.error("notify-app", String(ne).slice(0, 200)));
      }
      // اعلان وب (PWA): کاربر وب که تب را بسته از آماده شدن پوستر/جزوه خبردار می‌شود (مثل «ارائه آماده شد» در workflow.ts)؛ بدون اشتراک یا VAPID بی‌اثر است
      if (web && !event.payload.notify && typeof uid === "string") {
        await step.do("notify-webpush", { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" }, async () => {
          await sendWebPush(this.env, uid, { title: `${kind === "poster" ? "🖼 پوستر" : "📝 جزوه"} آماده شد ✅`, body: `«${out.title}»؛ برای گرفتن فایل بزن. فایل‌ها ۲۴ ساعت نگه داشته می‌شوند.`, url: "/", tag: "extra-done" });
        }).catch((ne) => console.error("notify-webpush", String(ne).slice(0, 200)));
      }
      // اعلان به بقیه‌ی کانال‌های کاربر (پیام‌رسان‌های دیگر، اپ اندروید، مرورگر)؛ کانال مبدأ حذف می‌شود. بدون تلاش مجدد و بی‌اثر روی اعتبار.
      await step.do("notify-others", { retries: { limit: 0, delay: "1 second" }, timeout: "60 seconds" }, async () => {
        const label = kind === "poster" ? "🖼 پوستر" : "📝 جزوه";
        await notifyOtherChannels(this.env, uid, {
          title: `${label} آماده شد ✅`,
          body: `«${out.title}»؛ برای گرفتن فایل، اپ را باز کن. فایل‌ها ۲۴ ساعت نگه داشته می‌شوند.`,
          html: `✅ ${label} «${esc(out.title)}» آماده شد.\nبرای گرفتن فایل، اپ را باز کن؛ فایل‌ها ۲۴ ساعت نگه داشته می‌شوند.`,
          tag: "extra-done", fileId: out.ids[0],
          web, viaMiniApp: !!event.payload.notify, plat: event.payload.plat, originChat: web ? miniAppChat : chatId,
        });
      }).catch((ne) => console.error("notify-others", String(ne).slice(0, 200)));
      if (credit.source === "plan") {
        await step.do("plan-credits-out", { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" }, () => notifyPlanCreditsOut(this.env, uid))
          .catch((e) => console.error("plan-credits-out", String(e).slice(0, 200)));
      }
      return out;
    } catch (e) {
      const reason = String(e instanceof Error ? e.message : e).slice(0, 500);
      console.error("extra workflow failed", kind, reason);
      // هر کار در گام جدا تا اگر یکی تکرار شد اعتبار دو بار برنگردد
      await step.do("refund", () => refundCredit(this.env, uid, credit.source, credit.day)).catch((re) => console.error("refund extra", re));
      await step.do("unmark", () => unmarkExtra(this.env, uid, deckId, kind)).catch(() => {}); // تا دکمه دوباره دیده شود
      await step.do("notify-failure", async () => {
        await status(`❌ ساخت ${name} ناموفق بود${credit.source !== "none" ? "؛ اعتبارش برگردانده شد" : ""}. کمی بعد دوباره امتحان کن.`);
      }).catch(() => {});
      await step.do("alert-admin", () => alertAdmins(this.env, `ساخت ${name}`, { user: uid as string | number, reason })).catch(() => {});
      throw e;
    }
  }

  // ---------- پوستر (اینفوگرافیک) ----------
  private async poster(event: WorkflowEvent<ExtraParams>, step: WorkflowStep, plan: { title: string; theme: string; font: string; digits: boolean; lang?: OutLang; tone?: string; model?: string },
    status: (t: string) => Promise<unknown>, web: boolean): Promise<ExtraOut> {
    const { chatId, uid, deckId, mark } = event.payload;
    const layout = event.payload.layout === "wide" ? "wide" : "tall";
    const ig = await step.do("poster-content", LLM_STEP, () =>
      guard(async () => {
        await status("🖼 طراحی پوستر (اینفوگرافیک)…");
        const p = await loadPreview(this.env, uid, deckId);
        if (!p) throw new NonRetryableError("متن ارائه منقضی شده است (۲۴ ساعت)");
        return makeInfographic(this.env, plan.title, { lang: plan.lang, layout, tone: plan.tone, model: plan.model, source: deckSourceText(p.deck) });
      }));
    const fid = `${deckId}-poster`;
    await step.do("poster-render", { retries: { limit: 1, delay: "5 seconds" }, timeout: "5 minutes" }, async () => {
      await status("🎨 ساخت تصویر پوستر…");
      let image: string | undefined;
      if (ig.image_query) { // تصویر تزئینی است؛ نشد ⇒ بدون تصویر
        const bytes = await generateImage(this.env, ig.image_query).catch(() => null);
        if (bytes) image = `data:${bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg"};base64,${toBase64(bytes)}`;
      }
      const html = renderInfographicHtml(ig, { lang: plan.lang, theme: plan.theme, digits: plan.digits, layout, image, site: this.env.SITE_URL || "https://pptsaz.ir", mark });
      const img = await renderInfographicImage(this.env, html, IG_WIDTH[layout]);
      const pname = fileNameWithSite(this.env, ig.title, img.ext, "پوستر");
      if (web) {
        if (!(await saveFile(this.env, uid, fid, img.data, pname, ig.title, 0))) throw new Error("poster too large to store");
        return;
      }
      const caption = `🖼 <b>${esc(ig.title)}</b>\nپوستر (اینفوگرافیک)`;
      // عکس برای پیش‌نمایش داخل چت؛ اگر تلگرام نپذیرفت، فقط فایل کامل فرستاده می‌شود
      const photoOk = await sendPhoto(this.env, chatId, img.data, pname, caption, img.mime).then(() => true, (e) => { console.error("poster sendPhoto", String(e).slice(0, 200)); return false; });
      await sendDocument(this.env, chatId, img.data, pname, photoOk ? "📎 پوستر با کیفیت کامل" : caption, { mime: img.mime, reply_markup: siteMarkup(fid) });
      await saveFile(this.env, uid, fid, img.data, pname, ig.title, 0).catch((err) => console.error("saveFile poster", err));
    });
    return { kind: "poster", title: ig.title, ids: web ? [fid] : [], note: "" };
  }

  // ---------- جزوه‌ی Word ----------
  private async handout(event: WorkflowEvent<ExtraParams>, step: WorkflowStep, plan: { title: string; theme: string; font: string; digits: boolean; lang?: OutLang; tone?: string; model?: string },
    status: (t: string) => Promise<unknown>, web: boolean): Promise<ExtraOut> {
    const { chatId, uid, deckId, mark } = event.payload;
    const hd = await step.do("handout-content", LLM_STEP, () =>
      guard(async () => {
        await status("📝 نوشتن جزوه‌ی Word…");
        const p = await loadPreview(this.env, uid, deckId);
        if (!p) throw new NonRetryableError("متن ارائه منقضی شده است (۲۴ ساعت)");
        return makeHandout(this.env, plan.title, p.deck, { lang: plan.lang, tone: plan.tone, model: plan.model });
      }));
    const fid = `${deckId}-handout`;
    await step.do("handout-build", { retries: { limit: 1, delay: "5 seconds" }, timeout: "4 minutes" }, async () => {
      await status("📝 ساخت فایل جزوه…");
      let image: DocImage | undefined;
      if (hd.image_query) {
        const bytes = await generateImage(this.env, hd.image_query).catch(() => null); // نشد ⇒ جزوه بدون تصویر
        const info = bytes ? imageInfo(bytes) : null;
        if (bytes && info) image = { data: bytes, ...info };
      }
      const data = await buildDocx(hd, { lang: plan.lang, theme: plan.theme, font: plan.font, digits: plan.digits, image, site: this.env.SITE_URL || "https://pptsaz.ir", mark });
      const hname = fileNameWithSite(this.env, hd.title, "docx", "جزوه");
      if (web) {
        if (!(await saveFile(this.env, uid, fid, data, hname, hd.title, 0))) throw new Error("handout too large to store");
        return;
      }
      await sendDocument(this.env, chatId, data, hname, `📝 <b>${esc(hd.title)}</b>\nجزوه‌ی Word${fontCaption(plan.font)}`, { mime: DOCX_MIME, reply_markup: siteMarkup(fid) });
      await saveFile(this.env, uid, fid, data, hname, hd.title, 0).catch((err) => console.error("saveFile handout", err));
    });
    return { kind: "handout", title: hd.title, ids: web ? [fid] : [], note: "" };
  }
}
