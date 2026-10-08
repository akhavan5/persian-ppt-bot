/** API نسخه‌ی وب: ثبت‌نام/ورود، تنظیمات، ساخت ارائه (با همان Workflow ربات)، وضعیت و دانلود. */
import type { Env } from "./env";
import type { Settings } from "./types";
import { FONTS, THEMES, TONES } from "./themes";
import {
  FREE_MAX_IMAGES, FREE_MAX_SLIDES, SUPPORT_CONTACT, WEB_SLIDE_CHOICES, clampSlides, getActiveSub, getCredit, getSettings,
  isAdmin, isAllowed, isBanned, maxImagesFor, maxSlidesFor, planLink, saveSettings,
} from "./settings";
import { modelList } from "./llm";
import { PLANS, payEnabled, paymentCallback, paymentGo, startPayment } from "./payment";
import { listFiles, loadFileDirect, loadPreview, loadPreviewImage } from "./files";
import { renderPreview } from "./preview";
import {
  authUser, checkOtp, clearSessionCookie, createSession, createUser, destroySession, getUserByMobile, googleCallback,
  googleEnabled, googleStart, hitLimit, normMobile, otpEnabled, publicUser, randomToken, renewSession, saveWebUser, sendOtp,
  sessionCookie, type WebUser,
} from "./auth";
import { beginDeck, imagesLimitMsg, launchDeck, runningJob, slidesLimitMsg } from "./deck-service";
import { OCR_MAX_BYTES, OCR_TYPES, ocrSpace } from "./extract";
import { consumeLoginToken, ensureUid } from "./link";

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

const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") ?? "unknown";

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
  if (path === "/api/auth/tg" && method === "GET") return tgLogin(env, url);

  // درگاه سیزپی: انتقال به درگاه (GET) و بازگشت از درگاه (POST از مرورگر کاربر؛ بدون بررسی origin)
  if (path === "/api/pay/go" && method === "GET") return paymentGo(env, url);
  if (path === "/api/pay/callback") return paymentCallback(env, req, url);

  // حفاظت CSRF: درخواست‌های تغییردهنده فقط از همین سایت
  if (method !== "GET" && method !== "HEAD" && req.headers.get("origin") !== url.origin) return err("درخواست نامعتبر", 403);

  if (path === "/api/config" && method === "GET") {
    return json({
      google: googleEnabled(env),
      otp: otpEnabled(env),
      payEnabled: payEnabled(env),
      themes: Object.entries(THEMES).map(([key, t]) => ({ key, name: t.name, primary: t.primary, accent: t.accent })),
      tones: TONES,
      fonts: FONTS,
      slideChoices: WEB_SLIDE_CHOICES,
      freeMaxSlides: FREE_MAX_SLIDES,
      freeMaxImages: FREE_MAX_IMAGES,
      // همه‌ی مدل‌ها برای همه رایگان است
      models: modelList(env).map((m) => ({ id: m.id, name: m.name, brand: m.brand, free: true })),
      plans: PLANS,
    });
  }

  if (path === "/api/auth/otp/send" && method === "POST") return otpSend(req, env);
  if (path === "/api/auth/otp/verify" && method === "POST") return otpVerify(req, env);
  if (path === "/api/auth/logout" && method === "POST") {
    await destroySession(env, req);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  const user = await authUser(env, req);
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

  if (path === "/api/profile" && method === "PUT") return putProfile(req, env, user);
  if (path === "/api/profile/mobile" && method === "POST") return linkMobile(req, env, user);
  if (path === "/api/settings" && method === "PUT") return putSettings(req, env, user);
  if (path === "/api/generate" && method === "POST") return generate(req, env, user);
  if (path === "/api/extract" && method === "POST") return extract(req, env, user);
  if (path === "/api/pay/start" && method === "POST") return startPayment(env, url, user, await readBody(req));

  if (path.startsWith("/api/jobs/") && method === "GET") return jobStatus(env, user, path.slice("/api/jobs/".length));

  if (path === "/api/files" && method === "GET") {
    const list = await listFiles(env, user.id);
    return json({ files: list.map((f) => ({ id: f.id, title: f.title, slides: f.slides, t: f.t })) });
  }
  if (path.startsWith("/api/files/") && method === "GET") return download(env, user, path.slice("/api/files/".length));

  return err("پیدا نشد", 404);
}

// ---------- ورود و ثبت‌نام یکپارچه (پیامک یک‌بارمصرف / گوگل) ----------
async function otpSend(req: Request, env: Env): Promise<Response> {
  const b = await readBody(req);
  const mobile = normMobile(b?.mobile);
  if (!mobile) return err("شماره‌ی موبایل معتبر نیست؛ مثل ۰۹۱۲۳۴۵۶۷۸۹ وارد کن.");
  const e = await sendOtp(env, clientIp(req), mobile);
  return e ? err(e.error, e.status) : json({ ok: true });
}

/** ورود/ثبت‌نام یکپارچه: حساب موجود ⇒ ورود؛ وگرنه حساب جدید با همین شماره ساخته می‌شود */
async function otpVerify(req: Request, env: Env): Promise<Response> {
  const b = await readBody(req);
  const mobile = normMobile(b?.mobile), code = String(b?.code ?? "").replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/\s/g, "");
  if (!mobile) return err("شماره‌ی موبایل معتبر نیست.");
  const bad = await checkOtp(env, mobile, code);
  if (bad) return err(bad, 401);

  let user = await getUserByMobile(env, mobile);
  if (!user) {
    // جلوگیری از ساخت انبوه حساب برای گرفتن سهمیه‌ی رایگان
    const day = new Date().toISOString().slice(0, 10);
    if (await hitLimit(env, `rg:${clientIp(req)}:${day}`, 5, 172_800)) return err("تعداد ثبت‌نام از این شبکه امروز به سقف رسیده است.", 429);
    user = await createUser(env, { mobile, name: `کاربر ${mobile.slice(-4)}` });
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

/** افزودن شماره‌ی موبایل به حساب فعلی (مثلاً حساب گوگل) با تایید کد پیامکی */
async function linkMobile(req: Request, env: Env, user: WebUser): Promise<Response> {
  const b = await readBody(req);
  const mobile = normMobile(b?.mobile), code = String(b?.code ?? "").replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/\s/g, "");
  if (!mobile) return err("شماره‌ی موبایل معتبر نیست.");
  if (user.mobile) return err("برای حساب شما شماره‌ی موبایل ثبت شده است.", 409);
  const other = await getUserByMobile(env, mobile);
  if (other && other.id !== user.id) return err("این شماره برای حساب دیگری ثبت شده است.", 409);
  const bad = await checkOtp(env, mobile, code);
  if (bad) return err(bad, 401);
  user.mobile = mobile;
  await saveWebUser(env, user);
  await env.KV.put(`wm:${mobile}`, user.id);
  return json({ user: publicUser(user) });
}

// ---------- وضعیت کاربر ----------
async function me(env: Env, user: WebUser): Promise<Response> {
  const [c, settings, running, sub, maxSlides, maxImages] = await Promise.all([getCredit(env, user.id), getSettings(env, user.id), runningJob(env, user.id), getActiveSub(env, user.id), maxSlidesFor(env, user.id), maxImagesFor(env, user.id)]);
  const premium = !!sub || isAdmin(env, user.id);
  settings.slides = Math.min(settings.slides, maxSlides); // پلن تمام شده ⇒ سقف رایگان
  settings.imageCount = Math.min(settings.imageCount ?? (settings.images ? FREE_MAX_IMAGES : 0), maxImages);
  const activeJob = running.busy ? running.jobId : null;
  return json({
    user: publicUser(user),
    credit: c.unlimited
      ? { unlimited: true }
      : { unlimited: false, total: c.total, dailyLeft: c.dailyLeft, limit: sub ? 0 : c.limit, bonus: c.bonus, plan: c.plan },
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
  if (typeof b.tone === "string" && b.tone in TONES) s.tone = b.tone;
  if (typeof b.font === "string" && (FONTS as readonly string[]).includes(b.font)) s.font = b.font;
  if (typeof b.mode === "string" && (b.mode === "normal" || b.mode === "student")) s.mode = b.mode;
  if (typeof b.slides === "number" && Number.isFinite(b.slides)) {
    const max = await maxSlidesFor(env, user.id);
    if (Math.round(b.slides) > max) return json({ error: slidesLimitMsg(max), needPlan: true }, 403);
    s.slides = clampSlides(b.slides, max);
  }
  if (typeof b.imageCount === "number" && Number.isFinite(b.imageCount)) {
    const maxImg = await maxImagesFor(env, user.id);
    if (Math.round(b.imageCount) > maxImg) return json({ error: imagesLimitMsg(maxImg), needPlan: true }, 403);
    s.imageCount = Math.max(0, Math.round(b.imageCount));
    s.images = s.imageCount > 0;
  }
  if (typeof b.model === "string" && modelList(env).some((m) => m.id === b.model)) s.model = b.model;
  for (const k of ["digits", "images", "sources", "questions"] as const) if (typeof b[k] === "boolean") s[k] = b[k] as boolean;
  await saveSettings(env, user.id, s);
  return json({ settings: await getSettings(env, user.id) });
}

// ---------- ورود خودکار از ربات ----------
/** GET /api/auth/tg?t=توکن&to=buy|home — توکن فقط داخل چت تلگرامِ خود کاربر آمده؛ مصرف می‌شود، نشست ۳۰ روزه ساخته می‌شود و کاربر به سایت می‌رود */
async function tgLogin(env: Env, url: URL): Promise<Response> {
  const fail = () => Response.redirect(`${url.origin}/?login=expired`, 303);
  const tgId = await consumeLoginToken(env, url.searchParams.get("t") ?? "");
  if (!tgId || (await isBanned(env, tgId))) return fail();
  const uid = await ensureUid(env, tgId); // حساب وب خودکار اگر هنوز نبود
  if (typeof uid !== "string") return fail(); // مدیرها پروفایل وب خودکار ندارند
  const token = await createSession(env, uid);
  const to = url.searchParams.get("to") === "buy" ? "/?buy=1" : "/";
  return new Response(null, {
    status: 303,
    headers: { location: `${url.origin}${to}`, "set-cookie": sessionCookie(token), "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

// ---------- ساخت ارائه ----------
// قوانین (سقف پلن، اعتبار، قفل، برگشت اعتبار) در سرویس مشترک deck-service است و ربات تلگرام هم از همان استفاده می‌کند.
async function generate(req: Request, env: Env, user: WebUser): Promise<Response> {
  if (!isAllowed(env, user.id)) return err("این سرویس خصوصی است و دسترسی نداری.", 403);
  if (await isBanned(env, user.id)) return err("دسترسی شما مسدود شده است.", 403);

  const b = await readBody(req, 80_000); // متن فایل آپلودی (حداکثر ۱۲ هزار نویسه) هم در بدنه می‌آید
  const begin = await beginDeck(env, user.id, String(b?.topic ?? ""), {
    source: typeof b?.source === "string" ? b.source : undefined,
    slides: typeof b?.slides === "number" ? b.slides : undefined,
    imageCount: typeof b?.imageCount === "number" ? b.imageCount : undefined,
  });
  if (!begin.ok) {
    const d = begin.denied;
    return json({ error: d.error, ...(d.needPlan ? { needPlan: true } : {}), ...(d.noCredit ? { noCredit: true } : {}) }, d.status);
  }

  // شناسه‌ی کار = شناسه‌ی نمونه‌ی Workflow؛ پیشوندش شناسه‌ی کاربر است تا مالکیت بدون خواندن KV بررسی شود
  const jobId = `${user.id}-${randomToken(8).replace(/[^A-Za-z0-9]/g, "x")}`;
  if (!(await launchDeck(env, begin, user.id, jobId, { chatId: 0, statusMessageId: 0, channel: "web" }))) {
    return err("شروع ساخت ارائه ممکن نشد؛ چند دقیقه بعد دوباره امتحان کن.", 503);
  }
  return json({ jobId });
}

// ---------- OCR تصویر / PDF اسکن‌شده ----------
// بدنه = بایت‌های خام فایل (نه JSON)؛ فقط برای تصویر و PDFِ بدون لایه‌ی متن. بقیه‌ی فرمت‌ها در مرورگر خوانده می‌شوند.
async function extract(req: Request, env: Env, user: WebUser): Promise<Response> {
  if (!isAllowed(env, user.id)) return err("این سرویس خصوصی است و دسترسی نداری.", 403);
  if (await isBanned(env, user.id)) return err("دسترسی شما مسدود شده است.", 403);
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!OCR_TYPES.has(mime)) return err("فقط تصویر PNG/JPG یا فایل PDF پشتیبانی می‌شود.", 415);
  if (Number(req.headers.get("content-length") ?? 0) > OCR_MAX_BYTES) return err("حجم فایل برای تبدیل به متن حداکثر ۱ مگابایت است.", 413);
  const day = new Date().toISOString().slice(0, 10);
  if (await hitLimit(env, `ocr:${user.id}:${day}`, 15, 172_800)) return err("سقف روزانه‌ی تبدیل تصویر به متن تمام شد؛ فردا دوباره امتحان کن.", 429);
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength < 100 || bytes.byteLength > OCR_MAX_BYTES) return err("حجم فایل برای تبدیل به متن حداکثر ۱ مگابایت است.", 413);
  const r = await ocrSpace(env, bytes, mime);
  return r.ok ? json({ text: r.text }) : err(r.error, 422);
}

// وضعیت قطعی از خود Workflow می‌آید (سازگاری قوی)؛ متن پیشرفت از KV و ممکن است چند ثانیه عقب باشد
async function jobStatus(env: Env, user: WebUser, id: string): Promise<Response> {
  if (!/^[\w-]{1,100}$/.test(id) || !id.startsWith(`${user.id}-`)) return err("پیدا نشد", 404);
  const inst = await env.DECK_WORKFLOW.get(id).catch(() => null);
  if (!inst) return err("پیدا نشد", 404);
  const st = await inst.status();

  if (st.status === "complete") {
    const o = (st.output ?? {}) as { title?: string; slides?: number; name?: string };
    return json({ state: "done", title: o.title ?? "", slides: o.slides ?? 0, name: o.name ?? "presentation.pptx" });
  }
  if (st.status === "errored" || st.status === "terminated") {
    return json({ state: "error", message: "ساخت ارائه با خطا مواجه شد؛ اعتبارت برگردانده شد. چند دقیقه بعد دوباره امتحان کن." });
  }
  const message = (await env.KV.get(`job:${id}`)) ?? "⏳ در حال ساخت…";
  return json({ state: "running", message });
}

async function download(env: Env, user: WebUser, id: string): Promise<Response> {
  if (!/^[\w-]{1,100}$/.test(id)) return err("پیدا نشد", 404);
  const f = await loadFileDirect(env, user.id, id);
  if (!f) return err("فایل پیدا نشد یا منقضی شده است (فایل‌ها ۲۴ ساعت نگه داشته می‌شوند).", 404);
  const ascii = "presentation.pptx";
  return new Response(f.data, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.entry.name)}`,
      ...SEC_HEADERS,
    },
  });
}

// ---------- پیش‌نمایش و PDF ----------
const page = (body: string, status: number) => new Response(
  `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Tahoma,sans-serif;padding:32px;line-height:2">${body}<p><a href="/">بازگشت به سایت</a></p></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", ...SEC_HEADERS } });

async function preview(env: Env, user: WebUser, id: string): Promise<Response> {
  const p = await loadPreview(env, user.id, id);
  if (!p) return page("پیش‌نمایش پیدا نشد یا منقضی شده است (ارائه‌ها ۲۴ ساعت نگه داشته می‌شوند).", 404);
  const nonce = randomToken(12);
  return new Response(renderPreview(p.deck, { id, theme: p.theme, font: p.font, digits: p.digits, images: p.images, nonce }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // اسکریپت فقط با nonce؛ فونت و استایل فقط از Google Fonts؛ تصویر فقط از همین سایت
      "content-security-policy": `default-src 'none'; img-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      ...SEC_HEADERS,
    },
  });
}

async function previewImage(env: Env, user: WebUser, id: string, slide: number): Promise<Response> {
  const img = await loadPreviewImage(env, user.id, id, slide).catch(() => null);
  if (!img) return err("پیدا نشد", 404);
  return new Response(img.data, { headers: { "content-type": img.type, ...SEC_HEADERS, "cache-control": "private, max-age=3600" } });
}
