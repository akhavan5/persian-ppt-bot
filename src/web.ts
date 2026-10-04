/** API نسخه‌ی وب: ثبت‌نام/ورود، تنظیمات، ساخت ارائه (با همان Workflow ربات)، وضعیت و دانلود. */
import type { Env } from "./env";
import type { DeckParams, Settings } from "./types";
import { FONTS, THEMES, TONES } from "./themes";
import {
  FREE_MAX_IMAGES, FREE_MAX_SLIDES, SUPPORT_CONTACT, WEB_SLIDE_CHOICES, acquireLock, bumpStat, clampSlides, getCredit, getSettings, getSub,
  isAdmin, isAllowed, isBanned, isLocked, maxImagesFor, maxSlidesFor, planLink, refundCredit, releaseLock, saveSettings, spendCredit,
} from "./settings";
import { toFa } from "./util";
import { modelList } from "./llm";
import { PLANS, payEnabled, paymentCallback, paymentGo, startPayment } from "./payment";
import { listFiles, loadFileDirect } from "./files";
import {
  authUser, clearSessionCookie, createSession, createUser, destroySession, getUserByEmail, googleCallback,
  googleEnabled, googleStart, hashPassword, hitLimit, normEmail, publicUser, randomToken, sessionCookie,
  validEmail, verifyPassword, type WebUser,
} from "./auth";

const SEC_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};
const json = (data: unknown, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...SEC_HEADERS, ...extra } });
const err = (message: string, status = 400) => json({ error: message }, status);

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get("content-length") ?? 0) > 20_000) return null;
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") ?? "unknown";

const imagesLimitMsg = (max: number) => max <= FREE_MAX_IMAGES
  ? `در پلن رایگان حداکثر ${toFa(String(FREE_MAX_IMAGES))} تصویر در هر ارائه می‌گیری؛ برای تصویر بیشتر پلن پلاس (تا ${toFa(String(PLANS[0].maxImages))} تصویر) یا پرو (تا ${toFa(String(PLANS[1].maxImages))} تصویر) را بگیر.`
  : `سقف پلن تو ${toFa(String(max))} تصویر در هر ارائه است.`;
const slidesLimitMsg = (max: number) => max <= FREE_MAX_SLIDES
  ? `در پلن رایگان حداکثر ${toFa(String(FREE_MAX_SLIDES))} اسلاید می‌توانی بسازی؛ برای تعداد بیشتر پلن پلاس (تا ${toFa(String(PLANS[0].maxSlides))} اسلاید) یا پرو (تا ${toFa(String(PLANS[1].maxSlides))} اسلاید) را بگیر.`
  : `پلن فعلی تو حداکثر ${toFa(String(max))} اسلاید در هر ارائه را پشتیبانی می‌کند؛ برای تعداد بیشتر پلن را ارتقا بده.`;

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

  // درگاه سیزپی: انتقال به درگاه (GET) و بازگشت از درگاه (POST از مرورگر کاربر؛ بدون بررسی origin)
  if (path === "/api/pay/go" && method === "GET") return paymentGo(env, url);
  if (path === "/api/pay/callback") return paymentCallback(env, req, url);

  // حفاظت CSRF: درخواست‌های تغییردهنده فقط از همین سایت
  if (method !== "GET" && method !== "HEAD" && req.headers.get("origin") !== url.origin) return err("درخواست نامعتبر", 403);

  if (path === "/api/config" && method === "GET") {
    return json({
      google: googleEnabled(env),
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

  if (path === "/api/auth/register" && method === "POST") return register(req, env);
  if (path === "/api/auth/login" && method === "POST") return login(req, env);
  if (path === "/api/auth/logout" && method === "POST") {
    await destroySession(env, req);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  const user = await authUser(env, req);
  if (path === "/api/me" && method === "GET") return user ? me(env, user) : json({ user: null });
  if (!user) return err("ابتدا وارد شو.", 401);

  if (path === "/api/settings" && method === "PUT") return putSettings(req, env, user);
  if (path === "/api/generate" && method === "POST") return generate(req, env, user);
  if (path === "/api/pay/start" && method === "POST") return startPayment(env, url, user, await readBody(req));

  if (path.startsWith("/api/jobs/") && method === "GET") return jobStatus(env, user, path.slice("/api/jobs/".length));

  if (path === "/api/files" && method === "GET") {
    const list = await listFiles(env, user.id);
    return json({ files: list.map((f) => ({ id: f.id, title: f.title, slides: f.slides, t: f.t })) });
  }
  if (path.startsWith("/api/files/") && method === "GET") return download(env, user, path.slice("/api/files/".length));

  return err("پیدا نشد", 404);
}

// ---------- ثبت‌نام و ورود ----------
async function register(req: Request, env: Env): Promise<Response> {
  const b = await readBody(req);
  const email = normEmail(b?.email), password = String(b?.password ?? ""), name = String(b?.name ?? "").trim();
  if (!validEmail(email)) return err("ایمیل معتبر نیست.");
  if (password.length < 8 || password.length > 128) return err("رمز عبور باید بین ۸ تا ۱۲۸ نویسه باشد.");
  if (name.length < 2 || name.length > 64) return err("نام را وارد کن (۲ تا ۶۴ نویسه).");

  // جلوگیری از ساخت انبوه حساب برای گرفتن سهمیه‌ی رایگان
  const day = new Date().toISOString().slice(0, 10);
  if (await hitLimit(env, `rg:${clientIp(req)}:${day}`, 5, 172_800)) return err("تعداد ثبت‌نام از این شبکه امروز به سقف رسیده است.", 429);

  const exist = await getUserByEmail(env, email);
  if (exist) return err(exist.hash ? "این ایمیل قبلاً ثبت شده است؛ وارد شو." : "این ایمیل با گوگل ثبت شده است؛ با دکمه‌ی گوگل وارد شو.", 409);

  const user = await createUser(env, { email, name, hash: await hashPassword(password) });
  const token = await createSession(env, user.id);
  return json({ user: publicUser(user) }, 200, { "set-cookie": sessionCookie(token) });
}

async function login(req: Request, env: Env): Promise<Response> {
  const b = await readBody(req);
  const email = normEmail(b?.email), password = String(b?.password ?? "");
  if (!validEmail(email) || !password || password.length > 128) return err("ایمیل یا رمز عبور درست نیست.", 401);

  const failKey = `lgf:${email}`;
  if ((Number(await env.KV.get(failKey)) || 0) >= 8) return err("تلاش‌های ناموفق زیاد بود؛ ۱۵ دقیقه بعد دوباره امتحان کن.", 429);

  const user = await getUserByEmail(env, email);
  const ok = await verifyPassword(password, user?.hash); // برای کاربر ناموجود هم محاسبه می‌شود (زمان یکسان)
  if (!user || !ok) {
    await hitLimit(env, failKey, 8, 900);
    return err(user && !user.hash ? "این حساب با گوگل ساخته شده است؛ با دکمه‌ی گوگل وارد شو." : "ایمیل یا رمز عبور درست نیست.", 401);
  }
  await env.KV.delete(failKey);
  const token = await createSession(env, user.id);
  return json({ user: publicUser(user) }, 200, { "set-cookie": sessionCookie(token) });
}

// ---------- وضعیت کاربر ----------
async function me(env: Env, user: WebUser): Promise<Response> {
  const [c, settings, locked, sub, maxSlides, maxImages] = await Promise.all([getCredit(env, user.id), getSettings(env, user.id), isLocked(env, user.id), getSub(env, user.id), maxSlidesFor(env, user.id), maxImagesFor(env, user.id)]);
  const premium = !!sub || isAdmin(env, user.id);
  settings.slides = Math.min(settings.slides, maxSlides); // پلن تمام شده ⇒ سقف رایگان
  settings.imageCount = Math.min(settings.imageCount ?? (settings.images ? FREE_MAX_IMAGES : 0), maxImages);
  const activeJob = locked ? await env.KV.get(`wj:${user.id}`) : null;
  return json({
    user: publicUser(user),
    credit: c.unlimited
      ? { unlimited: true }
      : { unlimited: false, total: c.total, dailyLeft: c.dailyLeft, limit: c.limit, bonus: c.bonus, plan: c.plan },
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

// ---------- ساخت ارائه ----------
async function generate(req: Request, env: Env, user: WebUser): Promise<Response> {
  if (!isAllowed(env, user.id)) return err("این سرویس خصوصی است و دسترسی نداری.", 403);
  if (await isBanned(env, user.id)) return err("دسترسی شما مسدود شده است.", 403);

  const b = await readBody(req);
  const topic = String(b?.topic ?? "").replace(/\s+/g, " ").trim();
  if (topic.length < 3) return err("موضوع خیلی کوتاه است؛ کمی کامل‌تر بنویس.");
  if (topic.length > 600) return err("موضوع بیش از حد طولانی است (حداکثر ۶۰۰ کاراکتر).");

  // سقف اسلاید بر اساس پلن؛ پیش از کسر اعتبار بررسی می‌شود
  const maxSlides = await maxSlidesFor(env, user.id);
  if (typeof b?.slides === "number" && Number.isFinite(b.slides) && Math.round(b.slides) > maxSlides) {
    return json({ error: slidesLimitMsg(maxSlides), needPlan: true }, 403);
  }

  // تعداد تصویر: انتخاب کاربر (یا تنظیم ذخیره‌شده) در سقف پلن
  const maxImg = await maxImagesFor(env, user.id);
  if (typeof b?.imageCount === "number" && Number.isFinite(b.imageCount) && Math.round(b.imageCount) > maxImg) {
    return json({ error: imagesLimitMsg(maxImg), needPlan: true }, 403);
  }

  if (await isLocked(env, user.id)) return err("ارائه‌ی قبلی هنوز در حال ساخته شدن است؛ کمی صبر کن.", 409);

  const quota = await spendCredit(env, user.id);
  if (!quota.ok) return json({ error: "اعتبارت تمام شده است.", noCredit: true }, 402);
  await acquireLock(env, user.id);

  const settings: Settings = await getSettings(env, user.id);
  settings.slides = typeof b?.slides === "number" && Number.isFinite(b.slides) ? clampSlides(b.slides, maxSlides) : Math.min(settings.slides, maxSlides);
  const wantImg = typeof b?.imageCount === "number" && Number.isFinite(b.imageCount) ? Math.round(b.imageCount) : (settings.imageCount ?? (settings.images ? FREE_MAX_IMAGES : 0));
  const imageCount = Math.max(0, Math.min(wantImg, maxImg));
  settings.images = imageCount > 0;
  if (settings.mode === "student") settings.slides = Math.max(settings.slides, 8);

  const undo = async () => {
    await refundCredit(env, user.id, quota.source, quota.day).catch((e) => console.error("refund", e));
    await releaseLock(env, user.id).catch((e) => console.error("unlock", e));
  };

  // شناسه‌ی کار = شناسه‌ی نمونه‌ی Workflow؛ پیشوندش شناسه‌ی کاربر است تا مالکیت بدون خواندن KV بررسی شود
  const jobId = `${user.id}-${randomToken(8).replace(/[^A-Za-z0-9]/g, "x")}`;
  const params: DeckParams = {
    chatId: 0, statusMessageId: 0, userId: user.id, channel: "web",
    topic, settings, maxImages: imageCount, credit: quota.source, day: quota.day,
  };
  try {
    await env.KV.put(`job:${jobId}`, "⏳ در صف…", { expirationTtl: 3600 });
    await env.KV.put(`wj:${user.id}`, jobId, { expirationTtl: 900 });
    await env.DECK_WORKFLOW.create({ id: jobId, params });
  } catch (e) {
    console.error("workflow create failed", e);
    await undo();
    return err("شروع ساخت ارائه ممکن نشد؛ چند دقیقه بعد دوباره امتحان کن.", 503);
  }
  await bumpStat(env, "started").catch(() => {});
  return json({ jobId });
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
