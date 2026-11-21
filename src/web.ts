/** API نسخه‌ی وب: ثبت‌نام/ورود، تنظیمات، ساخت ارائه (با همان Workflow ربات)، وضعیت و دانلود. */
import type { Env } from "./env";
import type { Settings } from "./types";
import { attachContact, contactRewardInfo } from "./profile";
import { FONTS, THEMES, TONES, isMode } from "./themes";
import { TEMPLATES, isTemplate } from "./template";
import {
  DAILY_FREE_CREDITS, FREE_MAX_IMAGES, FREE_MAX_SLIDES, SUPPORT_CONTACT, botPlatform, grantDailyFree, WEB_SLIDE_CHOICES, clampSlides, getActiveSub, getCredit, getSettings,
  AD_REWARD_CREDITS, AD_REWARD_EVERY, adRewardProgress, adRewardLeft, claimAdView, CONTACT_REWARD_NOTE, EXTRA_IMAGES_MSG, EXTRA_MODE_MSG, EXTRA_MODEL_MSG, canUseMode, canUseModel, isAdmin, isAllowed, isBanned, hasPlanAccess, maxImagesFor, maxSlidesFor, planLink, saveSettings, getDeckCount,
} from "./settings";
import { modelList } from "./llm";
import { supportHistory, supportSend } from "./support-chat";
import { appCrash } from "./app-crash";
import { feedbackInfo, submitFeedback } from "./feedback";
import { startSupport, supportCallback, supportWall } from "./support";
import { PLANS, bazaarEnabled, bazaarVerify, myketEnabled, myketVerify, sibappEnabled, sibappStart, sibappVerify, payEnabled, payReport, paymentCallback, paymentGo, startPayment } from "./payment";
import { listFiles, loadFileDirect, loadPreview, loadPreviewImage } from "./files";
import { listSamples, sampleLabel } from "./samples";
import { renderPreview } from "./preview";
import { buildDeckPdf, cachedPdf } from "./pdf";
import { hasBrowser } from "./browser-api";
import { putPushToken } from "./push";
import { removeWebSub, saveWebSub, webPushEnabled } from "./webpush";
import { getAppVersions } from "./app-version";
import { appFields, appPlatform, parseAppUA, pwaOf, pwaPlatform } from "./app-ua";
import {
  authUser, checkOtp, clearSessionCookie, createSession, createUser, destroySession, emailOtpEnabled, getUserByEmail, getUserByMobile, googleCallback,
  googleAppExchange, googleEnabled, googleLoginWithIdToken, googleStart, hitLimit, normEmail, normMobile, otpEnabled, publicUser, randomToken, renewSession, saveWebUser, sendEmailOtp, sendOtpEx,
  sessionCookie, validEmail, type WebUser,
} from "./auth";
import { audioEnabled, beginDeck, fileNameWithSite, launchDeck, posterEnabled, runningJob, siteHost, slidesLimitMsg } from "./deck-service";
import { OCR_TYPES } from "./extract";
import { AUDIO_TYPES, deepgramEnabled } from "./deepgram";
import { VISION_MAX_IMAGE_BYTES } from "./vision-ocr";
import { WEB_MAX_FILE, extractFileBytes } from "./tg-file";
import { webOcrKey, type WebOcrOut } from "./web-ocr-workflow";
import { OCR_CAP_NOTE, ocrLimitHit } from "./ocr-limit";
import { fetchLinkSource, linkCapNote, linkEnabled, linkLimitHit, parseLinkUrl } from "./link-source";
import { consumeLoginToken, ensureUid, getLinkedTg, startTgLink, verifyTgLink } from "./link";
import { EXTRA_KINDS, audioKind, isMainDeck, missingExtras, startExtra } from "./extras";
import { isBaleId, fromBaleId } from "./bale-format";
import { isEitaaId, fromEitaaId } from "./eitaa-format";
import { isSplusId, fromSplusId } from "./splus-format";
import { checkPlatformPolicy, notifyBlockedTopic, BLOCKED_MSG } from "./platform-policy";
import { isRubikaId } from "./rubika-format";
import { inviteClaim, inviteInfo, miniappBuy, miniappSite, miniappDlLink, miniappDownload, miniappContact, miniappLogin, miniappPdf, miniappPdfLink, miniappSend, miniappWelcome } from "./miniapp";
import { isAudioName } from "./wav";

const SEC_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};
const json = (data: unknown, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...SEC_HEADERS, ...extra } });
const err = (message: string, status = 400) => json({ error: message }, status);

async function readBody(req: Request, maxBytes = 20_000): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return null;
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

// x-trusted-ip فقط در index.ts و فقط برای درخواست معتبرِ پروکسی ساخته می‌شود (هدر جعلی کاربر همان‌جا پاک می‌شود)
const clientIp = (req: Request) => req.headers.get("x-trusted-ip") ?? req.headers.get("cf-connecting-ip") ?? "unknown";

export async function handleWeb(req: Request, env: Env, url: URL): Promise<Response> {
  try {
    return await route(req, env, url);
  } catch (e) {
    console.error("web api", url.pathname, e);
    return err("خطای داخلی سرور؛ چند لحظه بعد دوباره امتحان کن.", 500);
  }
}

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname, method = req.method;

  // ورود با گوگل: مرورگر مستقیم به این آدرس‌ها هدایت می‌شود (GET)
  if (path === "/api/auth/google" && method === "GET") return googleStart(env, url);
  if (path === "/api/auth/google/callback" && method === "GET") return googleCallback(env, req, url);

  // ورود خودکار از دکمه‌های ربات تلگرام (لینک یک‌بارمصرف که فقط به چت خود کاربر فرستاده شده)
  if (path === "/api/auth/tg" && method === "GET") return tgLogin(env, req, url);

  // درگاه سیزپی: انتقال به درگاه (GET) و بازگشت از درگاه (POST از مرورگر کاربر؛ بدون بررسی origin)
  if (path === "/api/pay/go" && method === "GET") return paymentGo(env, url);
  if (path === "/api/pay/callback") return paymentCallback(env, req, url);
  if (path === "/api/support/callback" && method === "GET") return supportCallback(env, url);
  if (path === "/api/support/wall" && method === "GET") return supportWall(env, url);

  // حفاظت CSRF: درخواست‌های تغییردهنده فقط از همین سایت
  if (method !== "GET" && method !== "HEAD" && req.headers.get("origin") !== url.origin) return err("درخواست نامعتبر", 403);

  if (path === "/api/support/start" && method === "POST") return startSupport(env, url, req, await readBody(req, 3_000));

  if (path === "/api/config" && method === "GET") {
    const ver = await getAppVersions(env);
    return json({
      google: googleEnabled(env),
      // Web client ID برای ورود داخل اپ اندروید (Credential Manager)؛ عمومی است و محرمانه نیست
      googleClientId: googleEnabled(env) ? env.GOOGLE_CLIENT_ID : undefined,
      otp: otpEnabled(env),
      // ورود/ثبت‌نام با کد ایمیلی (برای ایمیل‌های غیر جیمیل)؛ در همان کادر شماره‌ی موبایل وارد می‌شود
      emailOtp: emailOtpEnabled(env),
      payEnabled: payEnabled(env),
      // خرید درون‌برنامه‌ای کافه‌بازار (فقط اپ اندروید)
      bazaar: bazaarEnabled(env),
      // خرید درون‌برنامه‌ای مایکت (فقط نسخه‌ی مایکت اپ اندروید)
      myket: myketEnabled(env),
      // خرید درون‌برنامه‌ای سیب‌اپ (فقط نسخه‌ی سیب‌اپ اپ iOS)
      sibapp: sibappEnabled(env),
      // نسخه‌ی اپ اندروید برای هر فروشگاه جدا: app.stores.<bazaar|myket> = { latest: آخرین نسخه‌ی منتشرشده، min: کمترین نسخه‌ی مجاز (۰ = بدون بررسی) }
      // مقدار را مدیر از پنل ربات (یا /appver) می‌گذارد (بدون دیپلوی)؛ اگر نگذاشته باشد از متغیرهای ANDROID_* خوانده می‌شود.
      // app.latest/min (کمترین مقدار بین فروشگاه‌ها) و app.url فقط برای نسخه‌های قدیمی اپ‌اند؛ urls لینک مستقیم صفحه‌ی اپ در هر فروشگاه (اپ کلید همان فروشگاه خودش را برمی‌دارد)
      app: { latest: ver.latest, min: ver.min, url: ver.url, urls: ver.urls, stores: { bazaar: { latest: ver.stores.bazaar.latest, min: ver.stores.bazaar.min }, myket: { latest: ver.stores.myket.latest, min: ver.stores.myket.min } } },
      templates: Object.entries(TEMPLATES).map(([key, v]) => ({ key, name: v.name, emoji: v.emoji, hint: v.hint })),
      themes: Object.entries(THEMES).map(([key, t]) => ({ key, name: t.name, primary: t.primary, accent: t.accent, bg: t.bg, surface: t.surface, dark: t.dark, text: t.text, muted: t.muted, onPrimary: t.onPrimary })),
      tones: TONES,
      fonts: FONTS,
      slideChoices: WEB_SLIDE_CHOICES,
      freeMaxSlides: FREE_MAX_SLIDES,
      freeMaxImages: FREE_MAX_IMAGES,
      // اعتبار رایگان روزانه برای حساب‌های با اعتبار صفر (۰ = خاموش)
      dailyFree: DAILY_FREE_CREDITS,
      // پوستر (اینفوگرافیک) اختیاری همراه ارائه با ۱ اعتبار جدا؛ فقط وقتی Browser Rendering وصل است
      poster: posterEnabled(env),
      // اسلاید صوتی و پادکست اختیاری همراه ارائه (هرکدام ۱ اعتبار جدا)؛ فقط وقتی کلید Gemini TTS و Workflow صدا وصل است
      audio: audioEnabled(env),
      // خروجی PDF ارائه (نیاز به Browser Rendering)
      pdf: hasBrowser(env),
      // ساخت ارائه از روی لینک (Tavily Extract)؛ بدون TAVILY_API_KEY دکمه‌اش در سایت نمایش داده نمی‌شود
      link: linkEnabled(env),
      // ورودی صوتی (ویس/فایل صوتی ← متن با Deepgram)؛ بدون DEEPGRAM_API_KEY آپلود صوتی در سایت پذیرفته نمی‌شود
      voice: deepgramEnabled(env),
      // مدل‌های بدون پرچم free فقط برای دارندگان پلن‌اند: free=false
      models: modelList(env).map((m) => ({ id: m.id, name: m.name, brand: m.brand, free: m.free })),
      plans: PLANS,
    });
  }

  // چت پشتیبانی سایت (فقط دستیار هوشمند؛ موضوع‌های خاص به مدیر ارجاع می‌شود)؛ فقط کاربر واردشده، روزی حداکثر ۱۰ پیام (ورود را خود پردازنده‌ها چک می‌کنند)
  if (path === "/api/support/send" && method === "POST") return supportSend(req, env, clientIp(req));
  if (path === "/api/support/history" && method === "GET") return supportHistory(req, env);

  // دانلود مستقیم Mini App: کلاینت تلگرام هدر ندارد؛ فقط توکن کوتاه‌مدت اعتبار است
  if (path.startsWith("/api/miniapp/dl/") && method === "GET") return miniappDownload(env, path.slice("/api/miniapp/dl/".length));
  if (path === "/api/app/crash" && method === "POST") return appCrash(req, env, clientIp(req));
  // Telegram Mini App: ورود با initData امضاشده‌ی تلگرام (بدون کوکی؛ توکن Bearer برمی‌گردد)
  if (path === "/api/auth/miniapp" && method === "POST") return miniappLogin(req, env, clientIp(req));
  if (path === "/api/auth/otp/send" && method === "POST") return otpSend(req, env);
  if (path === "/api/auth/otp/verify" && method === "POST") return otpVerify(req, env);
  if (path === "/api/auth/google/token" && method === "POST") return googleToken(req, env);
  if (path === "/api/auth/google/exchange" && method === "POST") return googleExchange(req, env);
  if (path === "/api/auth/logout" && method === "POST") {
    await destroySession(env, req);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  if (path === "/api/webpush/key" && method === "GET") return json({ key: webPushEnabled(env) ? env.VAPID_PUBLIC_KEY!.trim() : null });

  const user = await authUser(env, req);
  if (user) await noteApp(env, user, req); // علامت «کاربر اپ» و فروشگاه/نسخه برای پنل مدیر (فقط هنگام تغییر نوشته می‌شود)
  if (path === "/api/app/pay-report" && method === "POST") return payReport(env, user, req, clientIp(req)); // خطای پرداخت سمت اپ (بدون ورود هم پذیرفته می‌شود)
  if (path === "/api/me" && method === "GET") {
    if (!user) return json({ user: null });
    const res = await me(env, user);
    const c = await renewSession(env, req).catch(() => null); // نشست ۳۰ روزه‌ی لغزان
    if (c) res.headers.append("set-cookie", c);
    return res;
  }

  // پیش‌نمایش در مرورگر (صفحه‌ی HTML؛ با «ذخیره PDF» همان صفحه چاپ می‌شود) و تصویر اسلایدهایش
  const pv = method === "GET" ? path.match(/^\/api\/files\/([\w-]{1,100})\/(?:(preview)|img\/(\d{1,2}))$/) : null;
  if (pv) {
    if (!user) return pv[2] ? Response.redirect(`${url.origin}/`, 303) : err("ابتدا وارد شو.", 401);
    return pv[2] ? preview(env, user, pv[1]) : previewImage(env, user, pv[1], Number(pv[3]));
  }
  if (!user) return err("ابتدا وارد شو.", 401);

  // خروجی PDF ارائه برای اپ اندروید (و هر کلاینت وب): فایل PDF ساخته/ذخیره‌شده را مستقیم برمی‌گرداند
  const pd = method === "GET" ? path.match(/^\/api\/files\/([\w-]{1,100})\/pdf$/) : null;
  if (pd) return deckPdf(env, user, pd[1]);

  // اعلان وب (PWA/مرورگر؛ webpush.ts): کلید عمومی VAPID، ثبت و حذف اشتراک دستگاه
  if (path === "/api/webpush/sub" && method === "POST") {
    if (!webPushEnabled(env)) return err("اعلان وب فعال نیست.", 503);
    if (await hitLimit(env, `wpsub:${user.id}`, 30, 3600)) return err("تعداد درخواست زیاد بود؛ کمی بعد دوباره امتحان کن.", 429);
    const b = await readBody(req, 3_000);
    const bad = await saveWebSub(env, user.id, b?.subscription);
    return bad ? err(bad, 400) : json({ ok: true });
  }
  if (path === "/api/webpush/unsub" && method === "POST") {
    const b = await readBody(req, 3_000);
    await removeWebSub(env, user.id, b?.endpoint);
    return json({ ok: true });
  }
  if (path === "/api/app/push" && method === "POST") {
    // ثبت/تمدید/حذف توکن FCM دستگاه (اپ اندروید)؛ promo = اعلان تبلیغاتی/خبری روشن است
    const b = await readBody(req, 2_000);
    const bad = await putPushToken(env, b?.token, b?.promo !== false, b?.remove === true, user.id);
    return bad ? err(bad, 400) : json({ ok: true });
  }
  if (path === "/api/feedback" && method === "POST") return submitFeedback(env, user, await readBody(req, 6_000)); // نظر کنار ارائه (سایت/مینی‌اپ/ایتا) + هدیه‌ی یک‌باره
  if (path === "/api/miniapp/send" && method === "POST") return miniappSend(env, user, await readBody(req, 2_000), clientIp(req));
  if (path === "/api/miniapp/dl" && method === "POST") return miniappDlLink(env, user, await readBody(req, 2_000));
  if (path === "/api/miniapp/buy" && method === "POST") return miniappBuy(env, user);
  if (path === "/api/miniapp/site" && method === "POST") return miniappSite(env, user, await readBody(req, 2_000));
  if (path === "/api/miniapp/welcome" && method === "POST") return miniappWelcome(env, user);
  if (path === "/api/miniapp/pdf" && method === "POST") return miniappPdf(env, user, await readBody(req, 2_000));
  if (path === "/api/miniapp/pdf-dl" && method === "POST") return miniappPdfLink(env, user, await readBody(req, 2_000));
  // دعوت دوستان برای همه‌ی پلتفرم‌ها (سایت، اپ اندروید، Mini App تلگرام/بله، برنامک ایتا)؛ /api/miniapp/invite برای نسخه‌های قدیمی Mini App می‌ماند
  if ((path === "/api/invite" && (method === "GET" || method === "POST")) || (path === "/api/miniapp/invite" && method === "POST")) return inviteInfo(env, user);
  if (path === "/api/invite/claim" && method === "POST") return inviteClaim(env, user, await readBody(req, 500), clientIp(req));
  // ویدئوی جایزه‌ای تپسل در اپ اندروید: هر ۵ ویدئو = ۱ اعتبار (settings.ts ← claimAdView)
  if (path === "/api/ad-reward" && method === "POST") {
    const r = await claimAdView(env, user.id);
    return r.ok ? json({ ok: true, progress: r.progress, every: AD_REWARD_EVERY, granted: r.granted }) : err(r.error, r.status);
  }
  if (path === "/api/profile" && method === "PUT") return putProfile(req, env, user);
  if (path === "/api/profile/mobile" && method === "POST") return linkMobile(req, env, user);
  if (path === "/api/profile/mobile/eitaa" && method === "POST") return miniappContact(req, env, user);
  if (path === "/api/profile/email" && method === "POST") return linkEmail(req, env, user);
  if (path === "/api/profile/telegram/send" && method === "POST") return tgLinkSend(req, env, user);
  if (path === "/api/profile/telegram/verify" && method === "POST") return tgLinkVerify(req, env, user);
  if (path === "/api/settings" && method === "PUT") return putSettings(req, env, user);
  if (path === "/api/generate" && method === "POST") return generate(req, env, user);
  const ex = method === "POST" ? path.match(/^\/api\/files\/([\w-]{1,80})\/extra$/) : null;
  if (ex) return startExtraJob(req, env, user, ex[1]);
  if (path === "/api/extract" && method === "POST") return extract(req, env, user);
  if (path === "/api/link" && method === "POST") return linkSource(req, env, user);
  if (path.startsWith("/api/extract/") && method === "GET") return ocrStatus(env, user, path.slice("/api/extract/".length));
  if (path === "/api/pay/start" && method === "POST") return startPayment(env, url, user, await readBody(req));
  if (path === "/api/pay/bazaar" && method === "POST") return bazaarVerify(env, user, await readBody(req));
  if (path === "/api/pay/myket" && method === "POST") return myketVerify(env, user, await readBody(req));
  if (path === "/api/pay/sibapp/start" && method === "POST") return sibappStart(env, user, await readBody(req));
  if (path === "/api/pay/sibapp" && method === "POST") return sibappVerify(env, user, await readBody(req));

  if (path.startsWith("/api/jobs/") && method === "GET") return jobStatus(env, user, path.slice("/api/jobs/".length));

  if (path === "/api/files" && method === "GET") {
    const list = await listFiles(env, user.id);
    // زیر هر ارائه (نه پوستر/جزوه/صدا) دکمه‌ی همراه‌هایی که هنوز ساخته نشده‌اند و روی سرویس روشن‌اند: extras = ["audio","podcast","handout","poster"] (زیرمجموعه)
    const extras = await Promise.all(list.map((f) => (!isMainDeck(f.id, f.name) ? Promise.resolve([]) : missingExtras(env, user.id, f.id, list).catch(() => []))));
    const mine = list.map((f, i) => ({ id: f.id, title: f.title, slides: f.slides, t: f.t, poster: isPosterFile(f.name), handout: isHandoutFile(f.name), ...(audioKind(f.id) ? { audio: audioKind(f.id) } : {}), ...(extras[i].length ? { extras: extras[i] } : {}) }));
    // نمونه‌ها دائمی‌اند و همیشه بعد از فایل‌های خود کاربر می‌آیند؛ sample=true ⇒ برچسب «نمونه»، بدون شمارش‌معکوس ۲۴ ساعت و بدون دکمه‌ی ساخت جداگانه
    const samples = (await listSamples(env)).map((s) => ({ id: s.id, title: s.title, slides: s.slides, t: 0, sample: true, label: sampleLabel(s), poster: s.kind === "poster", handout: s.kind === "handout", pdf: s.kind === "pdf",
      ...(s.kind === "podcast" ? { audio: "podcast" } : s.kind === "audio" ? { audio: "slides" } : {}) }));
    return json({ files: [...mine, ...samples] });
  }
  if (path.startsWith("/api/files/") && method === "GET") return download(env, user, path.slice("/api/files/".length), url.searchParams.get("inline") === "1", req.headers.get("range"));

  return err("پیدا نشد", 404);
}

// ---------- ورود و ثبت‌نام یکپارچه (پیامک یک‌بارمصرف / گوگل) ----------
/** ایمیل داخل بدنه (فیلد email)؛ "" = ایمیلی نیامده (مسیر شماره‌ی موبایل)، null = نامعتبر */
const bodyEmail = (b: Record<string, unknown> | null): string | null => {
  if (b?.email == null || String(b.email).trim() === "") return "";
  const e = normEmail(b.email);
  return validEmail(e) ? e : null;
};

async function otpSend(req: Request, env: Env): Promise<Response> {
  const b = await readBody(req);
  const email = bodyEmail(b);
  if (email === null) return err("ایمیل معتبر نیست؛ مثل name@example.com وارد کن.");
  if (email) {
    const e = await sendEmailOtp(env, clientIp(req), email);
    return e ? err(e.error, e.status) : json({ ok: true });
  }
  const mobile = normMobile(b?.mobile);
  if (!mobile) return err("شماره‌ی موبایل معتبر نیست؛ مثل ۰۹۱۲۳۴۵۶۷۸۹ وارد کن.");
  const r = await sendOtpEx(env, clientIp(req), mobile);
  return "error" in r ? err(r.error, r.status) : json({ ok: true, sms: r.sms, bale: r.bale });
}

/** اپ اندروید: کد یک‌بارمصرف بازگشت از ورود مرورگر ← نشست */
async function googleExchange(req: Request, env: Env): Promise<Response> {
  if (await hitLimit(env, `gx:${clientIp(req)}`, 20, 600)) return err("تعداد تلاش زیاد است؛ کمی بعد دوباره امتحان کن.", 429);
  const b = await readBody(req, 2_000);
  const r = await googleAppExchange(env, String(b?.code ?? ""));
  if (!r) return err("لینک ورود منقضی شده است؛ دوباره امتحان کن.", 401);
  await noteApp(env, r.user, req);
  return json({ user: publicUser(r.user), created: false }, 200, { "set-cookie": sessionCookie(r.token) });
}

async function googleToken(req: Request, env: Env): Promise<Response> {
  if (await hitLimit(env, `gt:${clientIp(req)}`, 20, 600)) return err("تعداد تلاش زیاد است؛ کمی بعد دوباره امتحان کن.", 429);
  const b = await readBody(req, 8_000);
  const r = await googleLoginWithIdToken(env, String(b?.idToken ?? ""));
  if ("error" in r) return err(r.error, r.status);
  await noteApp(env, r.user, req);
  return json({ user: publicUser(r.user), created: Date.now() - r.user.created < 5000 }, 200, { "set-cookie": sessionCookie(r.token) });
}

/** ورود/ثبت‌نام یکپارچه: حساب موجود ⇒ ورود؛ وگرنه حساب جدید با همین شماره ساخته می‌شود */
/** درخواست از اپ بومی؟ اپ در User-Agent عبارت PptSazApp/<نسخه> (<فروشگاه>; Android <نسخه>) یا PptSazApp/<نسخه> (ios; <فروشگاه>; iOS <نسخه>) می‌فرستد (فقط برای آمار؛ امنیتی نیست).
 *  نسخه‌های قدیمی اپ اندروید فقط «PptSazApp/<نسخه>» دارند ⇒ store = null. */
const appUA = (req: Request) => parseAppUA(req.headers.get("user-agent"));
const fromApp = (req: Request) => appUA(req) !== null;
/** وب‌اپ نصب‌شده (PWA)؛ فقط وقتی اپ بومی نباشد (اپ بومی خودش پلتفرم دارد) */
const pwaReq = (req: Request) => (appUA(req) ? null : pwaOf(req));

/** علامت «کاربر اپ» + سیستم‌عامل/فروشگاه/نسخه‌ی اپ/نسخه‌ی سیستم‌عامل (اندروید یا iOS) یا علامت «کاربر PWA» روی حساب؛ فقط وقتی چیزی عوض شده باشد نوشته می‌شود */
async function noteApp(env: Env, user: WebUser, req: Request): Promise<void> {
  const a = appUA(req);
  let changed = false;
  if (a) {
    const f = appFields(a);
    if (!user.app) { user.app = true; changed = true; }
    // کاربرِ iOS که قبلاً از نسخه‌ی اندروید فروشگاه داشت (یا برعکس): فیلدهای فروشگاه/نسخه‌ی قبلی پاک می‌شود تا قاطی نشود
    if (a.os && user.os !== a.os) { delete user.store; delete user.andv; changed = true; }
    for (const [k, v] of Object.entries(f)) if ((user as any)[k] !== v) { (user as any)[k] = v; changed = true; }
    // اپ iOS قدیمی (بدون فروشگاه) روی حسابی که فروشگاه معلوم دارد، فروشگاه را پاک نمی‌کند؛ فقط مقدارهای معلوم نوشته می‌شود
  } else {
    const p = pwaOf(req);
    if (p && user.pwa !== p) { user.pwa = p; changed = true; }
  }
  if (changed) await saveWebUser(env, user).catch(() => {});
}

async function otpVerify(req: Request, env: Env): Promise<Response> {
  const b = await readBody(req);
  const email = bodyEmail(b);
  if (email === null) return err("ایمیل معتبر نیست.");
  const mobile = email ? null : normMobile(b?.mobile), code = String(b?.code ?? "").replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/\s/g, "");
  if (!email && !mobile) return err("شماره‌ی موبایل معتبر نیست.");
  const bad = await checkOtp(env, (email || mobile)!, code);
  if (bad) return err(bad, 401);

  let user = email ? await getUserByEmail(env, email) : await getUserByMobile(env, mobile!);
  if (user && email && !user.verified) { user.verified = true; await saveWebUser(env, user).catch(() => {}); } // مالکیت ایمیل با کد ثابت شد
  if (!user) {
    // جلوگیری از ساخت انبوه حساب برای گرفتن سهمیه‌ی رایگان
    const day = new Date().toISOString().slice(0, 10);
    // شبکه‌های موبایل ایران (CGNAT) یک IP را بین هزاران کاربر مشترک می‌کنند؛ پس سقف باید بالا باشد. تأیید کد پیامکی خودش سد اصلی است.
    // ایمیل ساخت‌اش ارزان‌تر است، سقف جدا و کمتری دارد. هر دو با SIGNUP_IP_DAILY قابل تنظیم‌اند.
    const cap = Math.max(1, Math.floor(Number(env.SIGNUP_IP_DAILY) || 100));
    if (await hitLimit(env, `rg:${email ? "e" : "m"}:${clientIp(req)}:${day}`, email ? Math.min(cap, 30) : cap, 172_800)) return err("تعداد ثبت‌نام از این شبکه امروز به سقف رسیده است.", 429);
    user = email
      ? await createUser(env, { email, emailVerified: true, name: email.split("@")[0], via: fromApp(req) ? "app" : undefined, appUA: appUA(req), pwa: pwaReq(req) })
      : await createUser(env, { mobile: mobile!, name: `کاربر ${mobile!.slice(-4)}`, via: fromApp(req) ? "app" : undefined, appUA: appUA(req), pwa: pwaReq(req) });
  } else {
    await noteApp(env, user, req);
  }
  const token = await createSession(env, user.id);
  return json({ user: publicUser(user), created: Date.now() - user.created < 5000 }, 200, { "set-cookie": sessionCookie(token) });
}

async function putProfile(req: Request, env: Env, user: WebUser): Promise<Response> {
  const b = await readBody(req);
  const name = String(b?.name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 64) return err("نام را وارد کن (۲ تا ۶۴ نویسه).");
  user.name = name;
  await saveWebUser(env, user);
  return json({ user: publicUser(user) });
}

/** افزودن شماره‌ی موبایل به حساب فعلی (مثلاً حساب گوگل) با تایید کد پیامکی؛ ۱ اعتبار هدیه‌ی تکمیل پروفایل (profile.ts) */
async function linkMobile(req: Request, env: Env, user: WebUser): Promise<Response> {
  const b = await readBody(req);
  const mobile = normMobile(b?.mobile), code = String(b?.code ?? "").replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/\s/g, "");
  if (!mobile) return err("شماره‌ی موبایل معتبر نیست.");
  const r = await attachContact(env, user, "mobile", mobile, code);
  if ("error" in r) return err(r.error, r.status);
  return json({ user: publicUser(r.user), reward: r.reward });
}

/** افزودن ایمیل به حساب فعلی (مثلاً حسابی که با موبایل ساخته شده) با تایید کد ایمیلی؛ رسید خرید به همین ایمیل می‌رود. ۱ اعتبار هدیه‌ی تکمیل پروفایل */
async function linkEmail(req: Request, env: Env, user: WebUser): Promise<Response> {
  const b = await readBody(req);
  const email = bodyEmail(b), code = String(b?.code ?? "").replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/\s/g, "");
  if (!email) return err("ایمیل معتبر نیست؛ مثل name@example.com وارد کن.");
  const r = await attachContact(env, user, "email", email, code);
  if ("error" in r) return err(r.error, r.status);
  return json({ user: publicUser(r.user), reward: r.reward });
}

/** اتصال تلگرام ۱: آیدی عددی را می‌گیرد و ربات یک کد ۶ رقمی به چت تلگرام همان آیدی می‌فرستد */
async function tgLinkSend(req: Request, env: Env, user: WebUser): Promise<Response> {
  const b = await readBody(req);
  const r = await startTgLink(env, user.id, clientIp(req), b?.tgId);
  if ("error" in r) return err(r.error, r.status);
  return json("already" in r ? { already: true, telegram: await getLinkedTg(env, user.id) } : { ok: true });
}

/** اتصال تلگرام ۲: کد ۶ رقمی را تایید می‌کند و تلگرام را به حساب وب وصل می‌کند */
async function tgLinkVerify(req: Request, env: Env, user: WebUser): Promise<Response> {
  const b = await readBody(req);
  const r = await verifyTgLink(env, user.id, b?.code);
  if ("error" in r) return err(r.error, r.status);
  return json({ telegram: r.tg });
}

// ---------- وضعیت کاربر ----------
async function me(env: Env, user: WebUser): Promise<Response> {
  const dailyFree = await grantDailyFree(env, user.id).catch(() => false); // اعتبار صفر ⇒ سهم رایگان امروز؛ dailyFree=true یعنی همین حالا اضافه شد
  const [c, settings, running, sub, maxSlides, maxImages, telegram, decks] = await Promise.all([getCredit(env, user.id), getSettings(env, user.id), runningJob(env, user.id), getActiveSub(env, user.id), maxSlidesFor(env, user.id), maxImagesFor(env, user.id), getLinkedTg(env, user.id), getDeckCount(env, user.id).catch(() => 0)]);
  const feedback = await feedbackInfo(env, user); // available=true ⇒ ثبت نظر هنوز اعتبار هدیه دارد
  const premium = !!sub || isAdmin(env, user.id);
  settings.slides = Math.min(settings.slides, maxSlides); // پلن تمام شده ⇒ سقف رایگان
  if (!premium) settings.imagesMany = false; // تصویر «زیاد» فقط برای پلن‌دارها
  const activeJob = running.busy ? running.jobId : null;
  return json({
    user: publicUser(user),
    telegram, // آیدی عددی تلگرامِ وصل‌شده (یا null)؛ برای بله/ایتا/روبیکا همان شناسه‌ی داخلی (جمع‌شده با پایه) است
    // پروفایل سایت: پیام‌رسانِ وصل‌شده ("tg" | "bale" | "eitaa" | "rubika") و شناسه‌ی واقعی خودش (روبیکا: null چون شناسه‌اش هش است)
    telegramPlat: telegram ? (isSplusId(telegram) ? "splus" : isEitaaId(telegram) ? "eitaa" : isRubikaId(telegram) ? "rubika" : isBaleId(telegram) ? "bale" : "tg") : null,
    telegramShown: telegram ? (isSplusId(telegram) ? fromSplusId(telegram) : isEitaaId(telegram) ? fromEitaaId(telegram) : isRubikaId(telegram) ? null : isBaleId(telegram) ? fromBaleId(telegram) : telegram) : null,
    dailyFree,
    // هدیه‌ی تکمیل پروفایل: available=true یعنی با ثبت و تایید یکی از موارد missing (mobile/email) هنوز می‌شود credits اعتبار گرفت؛ note = جمله‌ی کنار هدیه
    contactReward: { ...(await contactRewardInfo(env, user)), note: CONTACT_REWARD_NOTE },
    feedback,
    adReward: { every: AD_REWARD_EVERY, progress: await adRewardProgress(env, user.id).catch(() => 0), credits: AD_REWARD_CREDITS, left: await adRewardLeft(env, user.id).catch(() => 99) },
    decks, // تعداد ارائه‌های موفق (اپ اندروید برای یادآور فعال‌سازی)
    credit: c.unlimited
      ? { unlimited: true }
      : { unlimited: false, total: c.total, bonus: c.bonus, plan: c.plan },
    premium,
    maxSlides,
    maxImages,
    plan: sub ? { id: sub.plan, exp: sub.exp, credits: sub.credits } : null,
    settings,
    activeJob,
    plans: PLANS.map((p) => ({ ...p, url: planLink(user.id, p.name, p.price) })), // url: لینک تلگرام (جایگزین وقتی درگاه پرداخت فعال نیست)
    support: SUPPORT_CONTACT,
  });
}

async function putSettings(req: Request, env: Env, user: WebUser): Promise<Response> {
  const b = await readBody(req);
  if (!b) return err("درخواست نامعتبر");
  const s = await getSettings(env, user.id);
  if (typeof b.theme === "string" && b.theme in THEMES) s.theme = b.theme;
  if (isTemplate(b.template)) s.template = b.template;
  if (typeof b.tone === "string" && b.tone in TONES) s.tone = b.tone;
  if (typeof b.font === "string" && (FONTS as readonly string[]).includes(b.font)) s.font = b.font;
  if (isMode(b.mode)) {
    if (!(await canUseMode(env, user.id, b.mode))) return json({ error: EXTRA_MODE_MSG.replace("🔒 ", ""), needPlan: true }, 403); // حالت‌های دارای حداقل اسلاید فقط برای پلن‌دارها
    s.mode = b.mode;
  }
  if (typeof b.slides === "number" && Number.isFinite(b.slides)) {
    const max = await maxSlidesFor(env, user.id);
    if (Math.round(b.slides) > max) return json({ error: slidesLimitMsg(max), needPlan: true }, 403);
    s.slides = clampSlides(b.slides, max);
  }
  if (typeof b.model === "string" && modelList(env).some((m) => m.id === b.model)) {
    if (!(await canUseModel(env, user.id, b.model))) return json({ error: EXTRA_MODEL_MSG.replace("🔒 ", ""), needPlan: true }, 403);
    s.model = b.model;
  }
  for (const k of ["digits", "images", "sources", "questions", "notes"] as const) if (typeof b[k] === "boolean") s[k] = b[k] as boolean;
  if (typeof b.imagesMany === "boolean") {
    if (b.imagesMany && !(await hasPlanAccess(env, user.id))) return json({ error: EXTRA_IMAGES_MSG.replace("🔒 ", ""), needPlan: true }, 403);
    s.imagesMany = b.imagesMany;
  }
  await saveSettings(env, user.id, s);
  return json({ settings: await getSettings(env, user.id) });
}

// ---------- ورود خودکار از ربات ----------
/** GET /api/auth/tg?t=توکن&to=buy|home|files[&f=شناسه‌ی فایل] — توکن فقط داخل چت تلگرامِ خود کاربر آمده؛ مصرف می‌شود، نشست ۳۰ روزه ساخته می‌شود و کاربر به سایت می‌رود */
async function tgLogin(env: Env, req: Request, url: URL): Promise<Response> {
  const dest = url.searchParams.get("to"), fid = url.searchParams.get("f") ?? "";
  const to = dest === "buy" ? "/?buy=1" : dest === "files" ? `/?files=${/^[\w-]{1,100}$/.test(fid) ? encodeURIComponent(fid) : "1"}` : "/";
  const noStore = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  // لینک یک‌بارمصرف است؛ اگر درخواست تکراری برسد (nginx/مرورگر) و کاربر همین حالا وارد شده، خطا نشان نمی‌دهیم
  const fail = async () => {
    const already = await authUser(env, req).catch(() => null);
    return new Response(null, { status: 303, headers: { location: `${url.origin}${already ? to : "/?login=expired"}`, ...noStore } });
  };
  const t = url.searchParams.get("t") ?? "";
  let tgId = await consumeLoginToken(env, t);
  if (tgId) await env.KV.put(`tgd:${t}`, String(tgId), { expirationTtl: 60 }).catch(() => {});
  else if (/^[A-Za-z0-9_-]{20,64}$/.test(t)) {
    // تلاش دوباره‌ی همان درخواست (nginx/CDN) تا ۶۰ ثانیه بعد از مصرف: همان نتیجه، نه «منقضی شده»
    const n = Number(await env.KV.get(`tgd:${t}`));
    if (Number.isSafeInteger(n) && n > 0) tgId = n;
  }
  if (!tgId || (await isBanned(env, tgId))) return fail();
  const uid = await ensureUid(env, tgId); // حساب وب خودکار اگر هنوز نبود
  if (typeof uid !== "string") return fail(); // مدیرها پروفایل وب خودکار ندارند
  await env.KV.put(`w2tg:${uid}`, String(tgId)).catch(() => {}); // نمایش تلگرام وصل‌شده در پروفایل (برای حساب‌های قدیمی هم)
  const token = await createSession(env, uid);
  return new Response(null, {
    status: 303,
    headers: { location: `${url.origin}${to}`, "set-cookie": sessionCookie(token), ...noStore },
  });
}

// ---------- ساخت ارائه ----------
// قوانین (سقف پلن، اعتبار، قفل، برگشت اعتبار) در سرویس مشترک deck-service است و ربات تلگرام هم از همان استفاده می‌کند.
async function generate(req: Request, env: Env, user: WebUser): Promise<Response> {
  if (!isAllowed(env, user.id)) return err("این سرویس خصوصی است و دسترسی نداری.", 403);
  if (await isBanned(env, user.id)) return err("دسترسی شما مسدود شده است.", 403);

  const b = await readBody(req, 300_000); // متن فایل آپلودی (حداکثر ۱۲۰ هزار نویسه ≈ ۲۴۰ کیلوبایت UTF-8 برای فارسی) هم در بدنه می‌آید
  // سیاست محتوایی پلتفرم (platform-policy.ts): هوش مصنوعی موضوع و متن فایل را برای ایتا بررسی می‌کند؛ قبل از کسر اعتبار و ساخت ارائه
  if (b?.via === "eitaa") {
    // با مدلِ انتخابیِ خود کاربر (اگر دیگر به آن دسترسی ندارد، مدل پیش‌فرض)
    const chosen = (await getSettings(env, user.id).catch(() => null))?.model;
    const polModel = chosen && (await canUseModel(env, user.id, chosen).catch(() => false)) ? chosen : undefined;
    const pol = await checkPlatformPolicy(env, "eitaa", String(b?.topic ?? ""), typeof b?.source === "string" ? b.source : undefined, undefined, polModel);
    if (pol.blocked) {
      console.warn("platform-policy blocked", "eitaa", pol.category, pol.by, user.id);
      await notifyBlockedTopic(env, "eitaa", user, String(b?.topic ?? ""), pol, typeof b?.source === "string" && b.source.length > 0); // پیام به مدیرها در تلگرام
      return json({ error: BLOCKED_MSG, blockedTopic: true }, 422);
    }
  }
  // پوستر اختیاری همراه ارائه، ۱ اعتبار دیگر: "wide" | "tall"؛ هر مقدار دیگر = بدون پوستر
  const posterWant = (b?.poster === "wide" || b?.poster === "tall") && posterEnabled(env) ? { layout: b.poster as "wide" | "tall" } : undefined;
  const begin = await beginDeck(env, user.id, String(b?.topic ?? ""), {
    poster: !!posterWant,
    handout: b?.handout === true,
    audio: b?.audio === true,
    podcast: b?.podcast === true,
    source: typeof b?.source === "string" ? b.source : undefined,
    slides: typeof b?.slides === "number" ? b.slides : undefined,
    images: typeof b?.images === "boolean" ? b.images : undefined,
    imagesMany: typeof b?.imagesMany === "boolean" ? b.imagesMany : undefined,
  });
  if (!begin.ok) {
    const d = begin.denied;
    return json({ error: d.error, ...(d.needPlan ? { needPlan: true } : {}), ...(d.noCredit ? { noCredit: true } : {}), ...(d.extras ? { extras: true } : {}) }, d.status);
  }

  // شناسه‌ی کار = شناسه‌ی نمونه‌ی Workflow؛ پیشوندش شناسه‌ی کاربر است تا مالکیت بدون خواندن KV بررسی شود
  const jobId = `${user.id}-${randomToken(8).replace(/[^A-Za-z0-9]/g, "x")}`;
  // Mini App در تلگرام، بله و روبیکا یک کلاینت است؛ پلتفرم واقعی از شناسه‌ی حساب لینک‌شده‌ی همان ورود (w2tg) می‌آید، نه ثابت «تلگرام»
  const ua = appUA(req);
  const miniPlat = b?.via === "miniapp" ? botPlatform(await getLinkedTg(env, user.id).catch(() => null)) : "tg";
  if (!(await launchDeck(env, begin, user.id, jobId, { chatId: 0, statusMessageId: 0, channel: "web", plat: b?.via === "eitaa" ? "eitaa" : b?.via === "miniapp" ? miniPlat : ua ? appPlatform(ua) : pwaReq(req) ? pwaPlatform(pwaReq(req)!) : "web", ...(ua && b?.via !== "eitaa" && b?.via !== "miniapp" ? { appv: ua.ver, ...(ua.osv ? { andv: ua.osv } : {}) } : {}), ...(b?.via === "miniapp" || b?.via === "eitaa" ? { notify: true } : {}) }, posterWant))) {
    return err("شروع ساخت ارائه ممکن نشد؛ چند دقیقه بعد دوباره امتحان کن.", 503);
  }
  return json({ jobId });
}

// ---------- خواندن PDF / تصویر (همان مسیر ربات تلگرام) ----------
// بدنه = بایت‌های خام فایل (نه JSON). PDF و عکس دقیقاً مثل تلگرام پردازش می‌شود (extractFileBytes در tg-file.ts):
// PDFِ دارای متنِ قابل‌قبول (حتی اگر تصویر هم داخلش باشد) ← فقط toMarkdown و بدون OCR؛ فقط اسکنِ بدون متن ← OCR با مدل vision (تا ۲۰ صفحه، ۴ مگابایت برای هر تصویر).
// کار در Workflow اجرا و با GET /api/extract/<jobId> پیگیری می‌شود (مثل OcrWorkflow تلگرام)؛ بقیه‌ی فرمت‌ها در مرورگر خوانده می‌شوند.
const ocrMagic = (bytes: ArrayBuffer, mime: string): boolean => {
  const u = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 1024));
  if (mime === "application/pdf") return new TextDecoder("latin1").decode(u).includes("%PDF-");
  if (mime === "image/png") return u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47;
  return u[0] === 0xff && u[1] === 0xd8; // JPEG
};

async function extract(req: Request, env: Env, user: WebUser): Promise<Response> {
  if (!isAllowed(env, user.id)) return err("این سرویس خصوصی است و دسترسی نداری.", 403);
  if (await isBanned(env, user.id)) return err("دسترسی شما مسدود شده است.", 403);
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const isAudio = AUDIO_TYPES.has(mime); // ویس/فایل صوتی ← متن با Deepgram (همان مسیر مشترک extractFileBytes)
  if (!OCR_TYPES.has(mime) && !isAudio) return err("فقط تصویر PNG/JPG، فایل PDF یا فایل صوتی پشتیبانی می‌شود.", 415);
  if (isAudio && !deepgramEnabled(env)) return err("ورودی صوتی فعال نیست.", 404);
  const isPdf = mime === "application/pdf";
  const max = isPdf || isAudio ? WEB_MAX_FILE : VISION_MAX_IMAGE_BYTES; // PDF و صدا ۲۴ مگابایت (وب)، تصویر ۴ مگابایت
  const tooBig = () => err(isPdf || isAudio ? "حجم فایل حداکثر ۲۴ مگابایت می‌تواند باشد." : "حجم تصویر برای تبدیل به متن حداکثر ۴ مگابایت می‌تواند باشد.", 413);
  if (Number(req.headers.get("content-length") ?? 0) > max) return tooBig();
  // سقف روزانه‌ی آپلود (حتی PDF متنی) = اعتبار ساخت ارائه + ۲؛ سقف جداگانه‌ی «تبدیل اسکن/تصویر» هم داخل خود مسیر مشترک اعمال می‌شود (ocr-limit.ts)
  if (await ocrLimitHit(env, user.id, "upload")) return err(`سقف امروزت برای آپلود PDF/تصویر/صدا تمام شد؛ فردا دوباره امتحان کن. ${OCR_CAP_NOTE}`, 429);
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > max) return tooBig();
  if (bytes.byteLength < 100 || (!isAudio && !ocrMagic(bytes, mime))) return err("فایل معتبر نیست؛ فایل دیگری را امتحان کن.", 415);
  const name = isAudio ? `audio.${AUDIO_TYPES.get(mime)}` : isPdf ? "file.pdf" : mime === "image/png" ? "image.png" : "image.jpg"; // پسوند همیشه با نوع واقعی می‌خواند

  if (env.WEB_OCR_WORKFLOW) {
    const jobId = `${user.id}-ocr-${randomToken(8).replace(/[^A-Za-z0-9]/g, "x")}`;
    try {
      await env.FILES.put(webOcrKey(user.id, jobId), bytes, { expirationTtl: 3600 });
      await env.WEB_OCR_WORKFLOW.create({ id: jobId, params: { userId: user.id, jobId, name, mime } });
      return json({ jobId });
    } catch (e) {
      console.error("web ocr workflow create", e instanceof Error ? e.message : e); // ناموفق ⇒ مسیر درون‌خطی (مثل تلگرام)
      await env.FILES.delete(webOcrKey(user.id, jobId)).catch(() => {});
    }
  }
  const r = await extractFileBytes(env, bytes, name, mime, user.id);
  return r.ok ? json({ text: r.text }) : err(r.error, 422);
}

// ---------- خواندن متن یک لینک (Tavily Extract) ----------
// متن صفحه فقط به مرورگر برمی‌گردد و مثل متن فایل آپلودی در درخواست ساخت (source) فرستاده می‌شود؛ جایی ذخیره نمی‌شود.
async function linkSource(req: Request, env: Env, user: WebUser): Promise<Response> {
  if (!linkEnabled(env)) return err("خواندن از روی لینک فعال نیست.", 404);
  if (!isAllowed(env, user.id)) return err("این سرویس خصوصی است و دسترسی نداری.", 403);
  if (await isBanned(env, user.id)) return err("دسترسی شما مسدود شده است.", 403);
  const b = await readBody(req, 4_000);
  const u = parseLinkUrl(typeof b?.url === "string" ? b.url : "");
  if (!u) return err("آدرس لینک معتبر نیست؛ آدرس کامل صفحه را با http یا https وارد کن.", 400);
  if (await linkLimitHit(env, user.id)) return err(`سقف امروزت برای خواندن لینک تمام شد؛ فردا دوباره امتحان کن. ${linkCapNote(env)}`, 429);
  const r = await fetchLinkSource(env, u.href, true);
  return r.ok ? json({ text: r.text, title: r.title, host: r.host, truncated: r.truncated }) : err(r.error, 422);
}

// وضعیت خواندن فایل؛ شناسه‌ی کار = شناسه‌ی نمونه‌ی Workflow و پیشوندش شناسه‌ی کاربر است تا مالکیت بررسی شود
async function ocrStatus(env: Env, user: WebUser, id: string): Promise<Response> {
  if (!/^[\w-]{1,100}$/.test(id) || !id.startsWith(`${user.id}-ocr-`) || !env.WEB_OCR_WORKFLOW) return err("پیدا نشد", 404);
  const inst = await env.WEB_OCR_WORKFLOW.get(id).catch(() => null);
  if (!inst) return err("پیدا نشد", 404);
  const st = await inst.status();
  if (st.status === "complete") {
    const o = st.output as WebOcrOut | undefined;
    return o?.ok ? json({ state: "done", text: o.text }) : json({ state: "error", message: o?.error ?? "خواندن فایل ناموفق بود؛ چند لحظه بعد دوباره امتحان کن." });
  }
  if (st.status === "errored" || st.status === "terminated") return json({ state: "error", message: "خواندن فایل ناموفق بود؛ چند لحظه بعد دوباره امتحان کن." });
  return json({ state: "running" });
}

// وضعیت قطعی از خود Workflow می‌آید (سازگاری قوی)؛ متن پیشرفت از KV و ممکن است چند ثانیه عقب باشد
async function jobStatus(env: Env, user: WebUser, id: string): Promise<Response> {
  if (!/^[\w-]{1,100}$/.test(id) || !id.startsWith(`${user.id}-`)) return err("پیدا نشد", 404);
  // کار صوتی همراه ارائه: شناسه‌ی «<کار>-audio» (اسلاید صوتی) یا «<کار>-podcast»؛ در AudioWorkflow جدا ساخته می‌شود
  if (/-(audio|podcast)$/.test(id)) return audioJobStatus(env, id);
  // پوستر/جزوه‌ای که بعد از ساخت ارائه با دکمه‌ی زیر ارائه خواسته شده: «<کاربر>-x<۶ حرف>-poster|handout»؛ در ExtraWorkflow جدا ساخته می‌شود
  if (/-(poster|handout)$/.test(id)) return extraJobStatus(env, id);
  const inst = await env.DECK_WORKFLOW.get(id).catch(() => null);
  if (!inst) return err("پیدا نشد", 404);
  const st = await inst.status();

  if (st.status === "complete") {
    const o = (st.output ?? {}) as { title?: string; slides?: number; name?: string; poster?: "ok" | "failed"; handout?: "ok" | "failed"; audio?: "pending" | "failed"; podcast?: "pending" | "failed" };
    // poster: "ok" ⇒ فایل پوستر با شناسه‌ی «<کار>-poster» ذخیره شده؛ "failed" ⇒ ارائه آماده است ولی پوستر ساخته نشد
    return json({ state: "done", title: o.title ?? "", slides: o.slides ?? 0, name: o.name ?? "presentation.pptx", ...(o.poster ? { poster: o.poster, ...(o.poster === "ok" ? { posterId: `${id}-poster` } : {}) } : {}),
      // جزوه‌ی Word همراه: "ok" ⇒ فایل با شناسه‌ی «<کار>-handout»؛ "failed" ⇒ ساخته نشد و اعتبارش برگشت
      ...(o.handout ? { handout: o.handout, ...(o.handout === "ok" ? { handoutId: `${id}-handout` } : {}) } : {}),
      // اسلاید صوتی / پادکست: "pending" ⇒ در حال ساخت؛ وضعیتش را با GET /api/jobs/<audioId> بخوان؛ "failed" ⇒ شروع نشد و اعتبارش برگشت
      ...(o.audio ? { audio: o.audio, ...(o.audio === "pending" ? { audioId: `${id}-audio` } : {}) } : {}),
      ...(o.podcast ? { podcast: o.podcast, ...(o.podcast === "pending" ? { podcastId: `${id}-podcast` } : {}) } : {}) });
  }
  if (st.status === "errored" || st.status === "terminated") {
    return json({ state: "error", message: "ساخت ارائه با خطا مواجه شد؛ اعتبارت برگردانده شد. چند دقیقه بعد دوباره امتحان کن." });
  }
  const message = (await env.KV.get(`job:${id}`)) ?? "⏳ در حال ساخت…";
  return json({ state: "running", message });
}

/** دکمه‌ی همراه زیر ارائه (سایت و Mini App): POST /api/files/<ارائه>/extra با بدنه‌ی {kind, layout?, via?}؛ ۱ اعتبار جدا کم می‌شود و jobId برمی‌گردد (وضعیت: GET /api/jobs/<jobId>) */
async function startExtraJob(req: Request, env: Env, user: WebUser, deckId: string): Promise<Response> {
  if (!isAllowed(env, user.id)) return err("این سرویس خصوصی است و دسترسی نداری.", 403);
  if (await isBanned(env, user.id)) return err("دسترسی شما مسدود شده است.", 403);
  const b = await readBody(req, 2_000);
  const kind = EXTRA_KINDS.find((k) => k === b?.kind);
  if (!kind) return err("نوع درخواست نامعتبر است.", 400);
  const r = await startExtra(env, user.id, deckId, kind, { channel: "web", layout: b?.layout === "wide" ? "wide" : "tall", ...(b?.via === "miniapp" || b?.via === "eitaa" ? { notify: true } : {}) });
  if (!r.ok) return json({ error: r.error, ...(r.noCredit ? { noCredit: true, extras: true } : {}) }, r.status);
  return json({ jobId: r.jobId });
}

/** وضعیت پوستر/جزوه‌ی خواسته‌شده بعد از ساخت ارائه؛ خروجی هم‌شکل کار صوتی: ids = شناسه‌ی فایل ذخیره‌شده */
async function extraJobStatus(env: Env, id: string): Promise<Response> {
  const handout = id.endsWith("-handout");
  const inst = await env.EXTRA_WORKFLOW?.get(id).catch(() => null);
  if (!inst) return err("پیدا نشد", 404);
  const st = await inst.status();
  if (st.status === "complete") {
    const o = (st.output ?? {}) as { ids?: string[]; note?: string };
    return json({ state: "done", ids: Array.isArray(o.ids) ? o.ids : [], note: o.note ?? "" });
  }
  if (st.status === "errored" || st.status === "terminated") {
    return json({ state: "error", message: `ساخت ${handout ? "جزوه" : "پوستر"} ناموفق بود؛ اعتبارش برگردانده شد.` });
  }
  const message = (await env.KV.get(`job:${id}`)) ?? (handout ? "📝 جزوه در صف است…" : "🖼 پوستر در صف است…");
  return json({ state: "running", message });
}

/** وضعیت کار صوتی (اسلاید صوتی یا پادکست): خروجی کامل = شناسه‌ی فایل‌های ذخیره‌شده (ids)؛ خطا ⇒ اعتبار همان برگشته است */
async function audioJobStatus(env: Env, id: string): Promise<Response> {
  const podcast = id.endsWith("-podcast");
  const inst = await env.AUDIO_WORKFLOW?.get(id).catch(() => null);
  if (!inst) return err("پیدا نشد", 404);
  const st = await inst.status();
  const failMsg = `ساخت ${podcast ? "پادکست" : "اسلاید صوتی"} ناموفق بود؛ اعتبارش برگردانده شد.`;
  // اسلاید صوتیِ زنجیره‌ای: نمونه‌ی اول «complete» می‌شود ولی کار در نمونه‌های بعدی ادامه دارد؛ نتیجه‌ی نهایی را آخرین نمونه در KV «jobres:<id>» می‌گذارد
  const chained = st.status === "complete" && !!(st.output as { chain?: string } | null)?.chain;
  if (st.status === "complete" && !chained) {
    const o = (st.output ?? {}) as { ids?: string[]; note?: string };
    return json({ state: "done", ids: Array.isArray(o.ids) ? o.ids : [], note: o.note ?? "" });
  }
  if (st.status === "errored" || st.status === "terminated") return json({ state: "error", message: failMsg });
  if (chained) {
    const res = await env.KV.get(`jobres:${id}`);
    if (res) {
      try {
        const r = JSON.parse(res) as { state?: string; ids?: string[]; note?: string };
        if (r.state === "done") return json({ state: "done", ids: Array.isArray(r.ids) ? r.ids : [], note: r.note ?? "" });
        if (r.state === "error") return json({ state: "error", message: failMsg });
      } catch { /* خراب بود: مثل «هنوز در حال کار» */ }
    }
  }
  const message = (await env.KV.get(`job:${id}`)) ?? (podcast ? "🎙 پادکست در صف است…" : "🔊 اسلاید صوتی در صف است…");
  // درصد پیشرفت (۰ تا ۱۰۰) که AudioWorkflow جدا از متن می‌نویسد؛ هنوز ننوشته باشد (در صف) ⇒ فیلد نمی‌آید و کلاینت نوار نامعین نشان می‌دهد
  const raw = await env.KV.get(`jobp:${id}`);
  const n = raw === null ? NaN : Number(raw);
  return json({ state: "running", message, ...(Number.isFinite(n) ? { progress: Math.max(0, Math.min(100, Math.round(n))) } : {}) });
}
/** فایل صوتی از روی شناسه: «<کار>-audio[-s<n>]» = اسلاید صوتی (یا صدای یک اسلاید)، «<کار>-podcast[-<n>]» = پادکست */
const isWavFile = (name: string) => isAudioName(name); // WAV یا MP3

/** پوستر به‌صورت تصویر PNG/JPG ذخیره می‌شود (پسوند تصویر)؛ ارائه‌ها PPTX */
const isPosterFile = (name: string) => /\.(png|jpe?g)$/i.test(name);
const isHandoutFile = (name: string) => /\.docx$/i.test(name);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Range سازگار با RFC 7233 (فقط یک بازه)؛ برای پخش و جلو/عقب‌کردن فایل صوتی. null = بدون Range، "bad" = نامعتبر */
function parseRange(h: string | null, size: number): { start: number; end: number } | "bad" | null {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null; // بازه‌ی چندتکه یا ناشناخته: کل فایل (۲۰۰) برگردانده می‌شود
  let a: number, b: number;
  if (m[1] === "") { const n = Number(m[2]); if (n <= 0) return "bad"; a = Math.max(0, size - n); b = size - 1; }
  else { a = Number(m[1]); b = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  return a >= size || a > b ? "bad" : { start: a, end: b };
}

/** inline=true: نمایش در تگ img (پیش‌نمایش پوستر) یا پخش در تگ audio (پادکست/صدای اسلاید)، با پشتیبانی از Range؛ وگرنه دانلود */
async function download(env: Env, user: WebUser, id: string, inline = false, range: string | null = null): Promise<Response> {
  if (!/^[\w-]{1,100}$/.test(id)) return err("پیدا نشد", 404);
  const f = await loadFileDirect(env, user.id, id);
  if (!f) return err("فایل پیدا نشد یا منقضی شده است (فایل‌ها ۲۴ ساعت نگه داشته می‌شوند).", 404);
  if (/^sample-.*-pdf$/.test(id)) // نمونه‌ی PDF: همان بایت‌های اصلی، بدون تغییر
    return new Response(f.data, { headers: { "content-type": "application/pdf", "content-disposition": `${inline ? "inline" : "attachment"}; filename="sample-${siteHost(env)}.pdf"; filename*=UTF-8''${encodeURIComponent(f.entry.name)}`, ...SEC_HEADERS } });
  const poster = isPosterFile(f.entry.name);
  const png = /\.png$/i.test(f.entry.name);
  const docx = isHandoutFile(f.entry.name);
  const wav = isWavFile(f.entry.name);
  const mp3 = /\.mp3$/i.test(f.entry.name);
  const ascii = poster ? `poster-${siteHost(env)}.${png ? "png" : "jpg"}` : docx ? `handout-${siteHost(env)}.docx` : wav ? `audio-${siteHost(env)}.${mp3 ? "mp3" : "wav"}` : audioKind(id) === "slides" ? `audio-presentation-${siteHost(env)}.pptx` : `presentation-${siteHost(env)}.pptx`;
  const headers: Record<string, string> = {
    "content-type": poster ? (png ? "image/png" : "image/jpeg") : docx ? DOCX_MIME : wav ? (mp3 ? "audio/mpeg" : "audio/wav") : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "content-disposition": `${(poster || wav) && inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.entry.name)}`,
    ...SEC_HEADERS,
  };
  // فقط برای پخش صوتی: Range تا مرورگر (به‌ویژه Safari/iOS) بتواند شروع به پخش کند و جلو/عقب برود
  if (wav && inline) {
    const size = f.data.byteLength;
    headers["accept-ranges"] = "bytes";
    const r = parseRange(range, size);
    if (r === "bad") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    if (r) {
      const body = new Uint8Array(f.data, r.start, r.end - r.start + 1);
      return new Response(body, { status: 206, headers: { ...headers, "content-range": `bytes ${r.start}-${r.end}/${size}`, "content-length": String(body.byteLength) } });
    }
  }
  return new Response(f.data, { headers });
}

// ---------- پیش‌نمایش و PDF ----------
const WEB_PDF_DAILY_LIMIT = 8;
async function deckPdf(env: Env, user: WebUser, id: string): Promise<Response> {
  const headers = (title: string) => ({
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="presentation-${siteHost(env)}.pdf"; filename*=UTF-8''${encodeURIComponent(fileNameWithSite(env, title, "pdf", "", 80))}`,
    ...SEC_HEADERS,
  });
  try {
    const hit = await cachedPdf(env, user.id, id).catch(() => null); // قبلاً ساخته شده: بدون مصرف مرورگر و سقف
    if (hit) {
      const f = (await listFiles(env, user.id).catch(() => [])).find((x) => x.id === id);
      return new Response(hit, { headers: headers(f?.title ?? "presentation") });
    }
    if (!hasBrowser(env)) return err("ساخت PDF روی این سرویس فعال نیست.", 503);
    const day = new Date().toISOString().slice(0, 10);
    if (await hitLimit(env, `pdf:${user.id}:${day}`, WEB_PDF_DAILY_LIMIT, 172_800)) return err("سقف روزانه‌ی ساخت PDF تمام شد؛ فردا دوباره امتحان کن (فایل PPTX همیشه در دسترس است).", 429);
    const r = await buildDeckPdf(env, user.id, id);
    if (!r.ok) return err(r.error.replace(/^[^\p{L}\p{N}]+/u, ""), 404);
    return new Response(r.data, { headers: headers(r.title) });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    console.error("web pdf", msg.slice(0, 400));
    return err(/time limit/i.test(msg) ? "سقف ساخت PDF برای امروز تمام شده است؛ فردا دوباره امتحان کن." : /429|rate|too many|concurrent/i.test(msg) ? "الان سرویس ساخت PDF شلوغ است؛ حدود یک دقیقه دیگر دوباره امتحان کن." : "ساخت PDF ناموفق بود؛ کمی بعد دوباره امتحان کن.", 502);
  }
}

const page = (body: string, status: number) => new Response(
  `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Tahoma,sans-serif;padding:32px;line-height:2">${body}<p><a href="/">بازگشت به سایت</a></p></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", ...SEC_HEADERS } });

async function preview(env: Env, user: WebUser, id: string): Promise<Response> {
  const p = await loadPreview(env, user.id, id);
  if (!p) return page("پیش‌نمایش پیدا نشد یا منقضی شده است (ارائه‌ها ۲۴ ساعت نگه داشته می‌شوند).", 404);
  const nonce = randomToken(12);
  return new Response(renderPreview(p.deck, { id, theme: p.theme, template: p.template, font: p.font, digits: p.digits, images: p.images, nonce }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // اسکریپت فقط با nonce؛ فونت و استایل فقط از Google Fonts و خود سایت (فونت‌های B)؛ تصویر فقط از همین سایت
      "content-security-policy": `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com https://pptsaz.ir; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      ...SEC_HEADERS,
    },
  });
}

async function previewImage(env: Env, user: WebUser, id: string, slide: number): Promise<Response> {
  const pv = await loadPreview(env, user.id, id).catch(() => null); // قالب لازم است: در آکادمیک اسلاید «بسم‌الله» شماره‌ی اسلایدهای PPTX را یکی جلو می‌برد
  const img = await loadPreviewImage(env, user.id, id, slide, pv?.template).catch(() => null);
  if (!img) return err("پیدا نشد", 404);
  return new Response(img.data, { headers: { "content-type": img.type, ...SEC_HEADERS, "cache-control": "private, max-age=3600" } });
}
