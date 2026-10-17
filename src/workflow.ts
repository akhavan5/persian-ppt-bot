import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "./env";
import type { DeckParams } from "./types";
import { LlmError, makeDeck, makeOutline, type ContentOpts } from "./llm";
import { fetchImages } from "./images";
import { researchTopic, type Research } from "./research";
import { buildPptx } from "./pptx";
import { editMessage, esc, sendDocument, sendMessage, sendPhoto } from "./telegram";
import { getUserById } from "./auth";
import { toFa } from "./util";
import { adminIds, bumpStat, getCredit, getUserSeen, refundCredit, releaseLock } from "./settings";
import { BUY_SITE_NOTE, buyKbFor } from "./deck-service";
import { logDeck, saveFile, savePreview } from "./files";
import { fontCaption } from "./themes";
import { generateImage } from "./images";
import { IG_WIDTH, renderInfographicHtml } from "./infographic-html";
import { makeInfographic, renderInfographicImage } from "./infographic";
import { buildDocx, imageInfo, makeHandout, type DocImage } from "./handout";
import { withStore } from "./store";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
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

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function safeFilename(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
  return `${base || "presentation"}.pptx`;
}

export class DeckWorkflow extends WorkflowEntrypoint<Env, DeckParams> {
  constructor(ctx: ExecutionContext, env: Env) { super(ctx, withStore(env)); }

  async run(event: WorkflowEvent<DeckParams>, step: WorkflowStep) {
    const { chatId, statusMessageId: mid, userId, topic, settings, credit, day } = event.payload;
    const maxImages = Math.max(1, event.payload.maxImages ?? 1); // تلگرام: ۱ تصویر؛ وب: طبق پلن
    const contentOpts: ContentOpts = { model: settings.model, mode: settings.mode, sources: settings.sources, questions: settings.questions, maxImages: settings.images ? maxImages : 0, source: event.payload.source || undefined };
    const web = event.payload.channel === "web";
    const handout = event.payload.handout; // جزوه‌ی Word همراه ارائه (اختیاری، ۱ اعتبار جدا)
    const poster = event.payload.poster; // پوستر همراه ارائه (اختیاری): در همین Workflow و با همان ۱ اعتبار
    // تلگرام: ویرایش پیام وضعیت؛ وب: متن پیشرفت در KV (صفحه‌ی وب هر چند ثانیه می‌خواند)
    const status = (t: string) => (web
      ? this.env.KV.put(`job:${event.instanceId}`, t, { expirationTtl: 3600 })
      : editMessage(this.env, chatId, mid, t)).catch(() => {});

    const notes: string[] = []; // هشدارهای همراهان ناموفق برای پیام پایانی
    let built: { title: string; slides: number; name: string; poster?: "ok" | "failed"; handout?: "ok" | "failed" };
    /** پیام پایانی تلگرام؛ اعتبار کم ⇒ دکمه‌های خرید. با پوستر، بعد از آن نمایش داده می‌شود (posterNote: نتیجه‌ی پوستر) */
    const finalStatus = async (posterNote: string) => {
      const done = `✅ آماده شد! فایل${poster || handout ? "‌ها" : ""} بالا را ببین.${posterNote} برای ساخت ارائه‌ی بعدی، موضوع جدید را بفرست.`;
      const c = await getCredit(this.env, userId).catch(() => null);
      if (c && !c.unlimited && c.total <= 1) {
        const warn = c.total === 0 ? "⚠️ اعتبارت تمام شد." : "⚠️ فقط ۱ ارائه‌ی دیگر اعتبار داری.";
        const buyKb = await buyKbFor(this.env, userId, event.payload.tgId).catch(() => undefined);
        await editMessage(this.env, chatId, mid,
          `${done}\n\n${warn}\n${BUY_SITE_NOTE}\n🎁 یا با /invite دوستانت را دعوت کن و ارائه‌ی رایگان بگیر.`, buyKb).catch(() => {});
      } else {
        await status(done);
      }
    };
    try {
      // جستجوی آنلاین پشت‌صحنه (بدون هیچ پیام یا تغییری در UI)؛ هر خطا ⇒ "" و ساخت ارائه عادی ادامه می‌یابد
      // اگر کاربر فایل آپلود کرده باشد، خودِ فایل منبع اصلی است و جستجوی وب (که به موضوع/نام فایل وابسته است) رد می‌شود
      const found: Research = event.payload.source
        ? { notes: "", images: [] }
        : await step.do("research", { retries: { limit: 0, delay: "1 second" }, timeout: "45 seconds" },
          () => researchTopic(this.env, topic)).catch((): Research => ({ notes: "", images: [] }));
      contentOpts.research = found.notes;

      const outline = await step.do("outline", LLM_STEP, () =>
        guard(async () => {
          await status("⏳ ۱/۳ — طراحی سرفصل‌ها…");
          return makeOutline(this.env, topic, settings.slides, settings.tone, contentOpts);
        }));

      const deck = await step.do("content", LLM_STEP, () =>
        guard(async () => {
          await status("✍️ ۲/۳ — نوشتن محتوای اسلایدها…");
          return makeDeck(this.env, topic, outline.title, outline.slides, settings.tone, contentOpts);
        }));

      // ساخت فایل و ارسال در یک گام: خروجی باینری نباید از گام برگردانده شود (سقف ۱ مگابایت برای وضعیت گام)
      built = await step.do("build-and-send",
        { retries: { limit: 1, delay: "5 seconds" }, timeout: "3 minutes" },
        async () => {
          await status("🎨 ۳/۳ — ساخت فایل پاورپوینت…");
          const images = settings.images ? await fetchImages(this.env, deck.slides, maxImages, web, found.images) : new Map();
          const bytes = await buildPptx(deck, {
            theme: settings.theme, font: settings.font, persianDigits: settings.digits, images,
          });
          const filename = safeFilename(deck.title);
          // متن اسلایدها برای پیش‌نمایش و PDF؛ خطا در ذخیره نباید ساخت ارائه را خراب کند
          await savePreview(this.env, userId, event.instanceId, {
            deck, theme: settings.theme, font: settings.font, digits: settings.digits, images: [...images.keys()],
          }).catch((err) => console.error("savePreview", err));
          if (web) {
            // وب: فایل فقط در KV ذخیره می‌شود و کاربر از صفحه دانلودش می‌کند؛ اگر ذخیره نشد گام باید شکست بخورد (تلاش مجدد/برگشت اعتبار)
            if (!(await saveFile(this.env, userId, event.instanceId, bytes, filename, deck.title, deck.slides.length))) {
              throw new Error("generated file is too large to store");
            }
          } else {
            await sendDocument(this.env, chatId, bytes, filename,
              `✅ <b>${esc(deck.title)}</b>\n${toFa(String(deck.slides.length))} اسلاید${fontCaption(settings.font)}`,
              // دکمه‌ی دریافت نسخه‌ی PDF (فقط اگر پیش‌نمایش ذخیره شده و مرورگر کلودفلر وصل است)
              this.env.BROWSER ? { reply_markup: { inline_keyboard: [[{ text: "📄 دریافت نسخه‌ی PDF", callback_data: `g:${event.instanceId}` }]] } } : {});
            // نگه‌داری ۲۴ ساعته برای /files؛ خطا در ذخیره نباید گام را شکست بدهد (فایل قبلاً فرستاده شده)
            await saveFile(this.env, userId, event.instanceId, bytes, filename, deck.title, deck.slides.length)
              .catch((err) => console.error("saveFile", err));
          }
          // ثبت در گزارش مدیر (/decks)؛ خطا نباید گام را شکست بدهد
          const seen = web
            ? await getUserById(this.env, String(userId)).then((w) => (w ? { n: w.name || w.email || w.mobile || "", u: null } : null)).catch(() => null)
            : await getUserSeen(this.env, (event.payload.tgId ?? userId) as number).catch(() => null);
          await logDeck(this.env, { id: event.instanceId, userId, n: seen?.n ?? "", u: seen?.u ?? null, title: deck.title, slides: deck.slides.length, t: Date.now(), ...(event.payload.orig ? { o: event.payload.orig } : {}) })
            .catch((err) => console.error("logDeck", err));
          if (web) return { title: deck.title.slice(0, 120), slides: deck.slides.length, name: filename };
          if (!poster && !handout) await finalStatus("");
          return { title: deck.title.slice(0, 120), slides: deck.slides.length, name: filename };
        });

      // پوستر (اینفوگرافیک) همراه ارائه: ارائه تا اینجا تحویل شده؛ هر خطای پوستر فقط پیام هشدار می‌دهد و نه اعتبار برمی‌گردد نه کار شکست می‌خورد
      if (poster) {
        let posterOk = false;
        try {
          const psource = event.payload.source || "";
          const pnotes = psource ? "" : found.notes;
          const ig = await step.do("poster-content", { retries: { limit: 1, delay: "10 seconds" }, timeout: "3 minutes" }, () =>
            guard(async () => {
              await status("🖼 طراحی پوستر (اینفوگرافیک)…");
              return makeInfographic(this.env, psource ? deck.title : topic, { layout: poster.layout, tone: settings.tone, model: settings.model, research: pnotes, source: psource || undefined });
            }));
          await step.do("poster-render", { retries: { limit: 1, delay: "5 seconds" }, timeout: "5 minutes" }, async () => {
            await status("🎨 ساخت تصویر پوستر…");
            let image: string | undefined;
            if (ig.image_query) { // تصویر تزئینی ثابت است
              const bytes = await generateImage(this.env, ig.image_query).catch(() => null); // تزئینی است؛ نشد ⇒ بدون تصویر
              if (bytes) image = `data:${bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg"};base64,${toBase64(bytes)}`;
            }
            const html = renderInfographicHtml(ig, { theme: settings.theme, digits: settings.digits, layout: poster.layout, image, site: this.env.SITE_URL || "https://pptsaz.ir" });
            const img = await renderInfographicImage(this.env, html, IG_WIDTH[poster.layout]);
            const pname = `${safeFilename(ig.title).replace(/\.pptx$/, "")} - پوستر.${img.ext}`;
            const pid = `${event.instanceId}-poster`;
            if (web) {
              if (!(await saveFile(this.env, userId, pid, img.data, pname, ig.title, 0))) throw new Error("poster too large to store");
              return;
            }
            const caption = `🖼 <b>${esc(ig.title)}</b>\nپوستر (اینفوگرافیک)`;
            // عکس برای پیش‌نمایش داخل چت؛ اگر تلگرام نپذیرفت، فقط فایل کامل فرستاده می‌شود
            const photoOk = await sendPhoto(this.env, chatId, img.data, pname, caption, img.mime).then(() => true, (e) => { console.error("poster sendPhoto", String(e).slice(0, 200)); return false; });
            await sendDocument(this.env, chatId, img.data, pname, photoOk ? "📎 پوستر با کیفیت کامل" : caption, { mime: img.mime });
            await saveFile(this.env, userId, pid, img.data, pname, ig.title, 0).catch((err) => console.error("saveFile poster", err));
          });
          posterOk = true;
        } catch (pe) {
          console.error("poster failed", pe);
          // پوستر ۱ اعتبار جدا دارد؛ شکست پوستر فقط همان را برمی‌گرداند (ارائه‌ی تحویل‌شده سر جایش می‌ماند)
          await step.do("refund-poster-fail", () => refundCredit(this.env, userId, poster.credit, poster.day)).catch((re) => console.error("refund poster", re));
        }
        built.poster = posterOk ? "ok" : "failed";
        if (!posterOk) notes.push("⚠️ ساخت پوستر ناموفق بود؛ اعتبار پوستر برگردانده شد.");
      }

      // جزوه‌ی Word (حدود ۳ صفحه با یک تصویر) همراه ارائه؛ مثل پوستر: خطایش فقط اعتبار خودش را برمی‌گرداند
      if (handout) {
        let handoutOk = false;
        try {
          const hsource = event.payload.source || "";
          const hnotes = hsource ? "" : found.notes;
          const hd = await step.do("handout-content", { retries: { limit: 1, delay: "10 seconds" }, timeout: "5 minutes" }, () =>
            guard(async () => {
              await status("📝 نوشتن جزوه‌ی Word…");
              return makeHandout(this.env, hsource ? deck.title : topic, deck, { tone: settings.tone, model: settings.model, research: hnotes, source: hsource || undefined });
            }));
          await step.do("handout-build", { retries: { limit: 1, delay: "5 seconds" }, timeout: "4 minutes" }, async () => {
            await status("📝 ساخت فایل جزوه…");
            let image: DocImage | undefined;
            if (hd.image_query) {
              const bytes = await generateImage(this.env, hd.image_query).catch(() => null); // تصویر ثابت است؛ نشد ⇒ جزوه بدون تصویر
              const info = bytes ? imageInfo(bytes) : null;
              if (bytes && info) image = { data: bytes, ...info };
            }
            const data = await buildDocx(hd, { theme: settings.theme, font: settings.font, digits: settings.digits, image });
            const hname = `${safeFilename(hd.title).replace(/\.pptx$/, "")} - جزوه.docx`;
            const hid = `${event.instanceId}-handout`;
            if (web) {
              if (!(await saveFile(this.env, userId, hid, data, hname, hd.title, 0))) throw new Error("handout too large to store");
              return;
            }
            await sendDocument(this.env, chatId, data, hname, `📝 <b>${esc(hd.title)}</b>\nجزوه‌ی Word${fontCaption(settings.font)}`, { mime: DOCX_MIME });
            await saveFile(this.env, userId, hid, data, hname, hd.title, 0).catch((err) => console.error("saveFile handout", err));
          });
          handoutOk = true;
        } catch (he) {
          console.error("handout failed", he);
          await step.do("refund-handout-fail", () => refundCredit(this.env, userId, handout.credit, handout.day)).catch((re) => console.error("refund handout", re));
        }
        built.handout = handoutOk ? "ok" : "failed";
        if (!handoutOk) notes.push("⚠️ ساخت جزوه ناموفق بود؛ اعتبار جزوه برگردانده شد.");
      }
      if ((poster || handout) && !web) await step.do("final-status", () => finalStatus(notes.length ? "\n" + notes.join("\n") : "")).catch(() => {}); // خطای پیام پایانی نباید به «برگشت اعتبار» برسد
    } catch (e) {
      console.error("deck workflow failed", e);
      // هر کار در گام جدا تا اگر یکی تکرار شد، بقیه دوباره اجرا نشوند (مثلاً اعتبار دو بار برنگردد)
      await step.do("refund", () => refundCredit(this.env, userId, credit ?? "none", day));
      if (handout) await step.do("refund-handout", () => refundCredit(this.env, userId, handout.credit, handout.day));
      if (poster) await step.do("refund-poster", () => refundCredit(this.env, userId, poster.credit, poster.day));
      await step.do("notify-failure", async () => {
        await status("❌ ساخت ارائه با خطا مواجه شد" + (credit && credit !== "none" ? "؛ اعتبارت برگردانده شد" : "") +
          ". چند دقیقه بعد دوباره امتحان کن؛ اگر تکرار شد، تنظیمات سرویس هوش مصنوعی را بررسی کن.");
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
      });
      throw e;
    }

    // خارج از try: خطا در این گام نباید باعث «برگشت اعتبار» بعد از ارسال موفق فایل شود
    await step.do("finish", async () => {
      await releaseLock(this.env, userId);
      await bumpStat(this.env, "ok").catch(() => {});
    });
    // خروجی نمونه‌ی Workflow؛ وضعیت وب از همین‌جا خوانده می‌شود
    return built;
  }
}
