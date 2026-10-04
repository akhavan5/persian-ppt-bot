/** درگاه پرداخت دیجی‌پی (UPG — درگاه یکپارچه، OAuth + tickets/business + purchases/verify) — فقط نسخه‌ی وب. پس از پرداخت موفق، پلن کاربر فعال/تمدید می‌شود. */
import type { Env } from "./env";
import { PLAN_MAX_IMAGES, PLAN_MAX_SLIDES, getActiveSub, getBonus, putSub, setBonus } from "./settings";
import { hitLimit, type WebUser } from "./auth";

/**
 * پلن‌های ماهانه (price: هزار تومان). فعلاً برای تست هر دو پلن ۱ هزار تومان است؛ بعد از تست ۹۹ و ۱۹۹ را برگردان. هر پلن ۳۰ روز اعتبار دارد و تمدید خودکار ندارد.
 * همه‌ی مدل‌ها برای همه رایگان است؛ پلن‌ها فقط اعتبار می‌فروشند و سقف اسلاید هر ارائه را بالا می‌برند
 * (رایگان ۸، پلاس ۲۰، پرو ۳۵ اسلاید) و تعداد تصویر هر ارائه را (رایگان ۱، پلاس ۳، پرو ۶).
 */
export interface Plan { id: string; name: string; price: number; credits: number; days: number; maxSlides: number; maxImages: number }
export const PLANS: Plan[] = [
  { id: "plus", name: "پلاس", price: 1, credits: 10, days: 30, maxSlides: PLAN_MAX_SLIDES.plus, maxImages: PLAN_MAX_IMAGES.plus },
  { id: "pro", name: "پرو", price: 1, credits: 20, days: 30, maxSlides: PLAN_MAX_SLIDES.pro, maxImages: PLAN_MAX_IMAGES.pro },
];

/**
 * فعال‌سازی / تمدید پلن بعد از پرداخت موفق:
 * - بدون پلن فعال (هرگز نخریده، منقضی شده، یا اعتبارش تمام شده): از همین الان ۳۰ روز با اعتبار جدید؛ روزهای باقی‌مانده‌ی پلنِ بی‌اعتبار حساب نمی‌شود.
 * - تمدید همان پلن فعال (پلاس←پلاس یا پرو←پرو): ۳۰ روز به پایان پلن فعلی اضافه می‌شود و اعتبار جدید روی اعتبار باقی‌مانده جمع می‌شود.
 * - خرید پلنِ دیگر (پلاس←پرو یا پرو←پلاس): پلن قبلی با روز و اعتبار باقی‌مانده‌اش منقضی می‌شود و پلن جدید مثل پلن رایگان از همین لحظه با ۳۰ روز و اعتبار جدید شروع می‌شود.
 */
export async function activatePlan(env: Env, uid: string, p: Plan) {
  let cur = await getActiveSub(env, uid); // پلنِ منقضی یا بدون اعتبار = پلن رایگان؛ خرید جدید از نو شروع می‌شود
  // خرید پلنِ دیگر (پلاس ← پرو یا پرو ← پلاس): پلن قبلی منقضی می‌شود و پلنِ جدید مثل کاربر رایگان از همین لحظه شروع می‌شود
  if (cur && cur.plan !== p.id) cur = null;
  const plan = p.id;
  await putSub(env, uid, { plan, exp: (cur ? cur.exp : Date.now()) + p.days * 86_400_000, credits: (cur?.credits ?? 0) + p.credits });
}

/**
 * تنظیمات دیجی‌پی — از متغیرهای داشبورد کلودفلر خوانده می‌شود (Workers → Settings → Variables and Secrets):
 * DIGIPAY_CLIENT_ID, DIGIPAY_CLIENT_SECRET, DIGIPAY_USERNAME, DIGIPAY_PASSWORD
 * تا هر چهار مقدار تنظیم نشوند، پرداخت آنلاین غیرفعال است و دکمه‌ی خرید کاربر را به پشتیبان تلگرام می‌فرستد.
 */
const cfg = (env: Env) => ({
  clientId: (env.DIGIPAY_CLIENT_ID ?? "").trim(),
  clientSecret: (env.DIGIPAY_CLIENT_SECRET ?? "").trim(),
  username: (env.DIGIPAY_USERNAME ?? "").trim(),
  password: (env.DIGIPAY_PASSWORD ?? "").trim(),
});
const DP_API = "https://api.mydigipay.com/digipay/api";
/** طبق مستند رسمی: نوع تیکت برای «تمام فیچرهای UPG» همیشه ۱۱ است (نوع واقعی پرداخت — ۰ کارتی، ۱۱ کیف پول، ۵/۱۳ اعتباری — در callback برمی‌گردد) */
const DP_TICKET_TYPE = "11";
/** درگاه ترجیحی: ۲ = مستقیم به درگاه کارتی (IPG)، ۰ = مستقیم کیف پول، null = نمایش صفحه‌ی انتخاب ابزار پرداخت دیجی‌پی */
const DP_GATEWAY: number | null = null;
/** نوع پیش‌فرض تایید اگر callback نوع را نفرستاد (IPG) */
const DP_VERIFY_FALLBACK = "0";
/** واحد مبلغی که به دیجی‌پی فرستاده می‌شود: "rial" (۱ هزار تومان ⇒ 10000؛ مقدار درست و استاندارد) یا "toman" (⇒ 1000).
 *  توجه: خود درگاه حداقل مبلغ دارد؛ مبلغ‌های پایین‌تر از آن به‌صورت خودکار بالا برده می‌شوند. */
const DP_AMOUNT_UNIT: "toman" | "rial" = "rial";

export const payEnabled = (env: Env) => { const c = cfg(env); return Boolean(c.clientId && c.clientSecret && c.username && c.password); };

interface PayRecord { uid: string; plan?: string; count: number; amount: number; order: string; state: "pending" | "paid" | "failed"; t: number; ref?: string; redirect?: string }
const TTL = 60 * 60 * 24 * 14;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const DP_HEADERS = { Agent: "WEB", "Digipay-Version": "2022-02-02" };
const TOKEN_KEY = "dp:token";

/** دریافت (و کش در KV) توکن دسترسی OAuth دیجی‌پی با grant_type=password */
async function dpToken(env: Env, force = false): Promise<string | null> {
  if (!force) {
    const c = (await env.KV.get(TOKEN_KEY, "json").catch(() => null)) as { t: string } | null;
    if (c?.t) return c.t;
  }
  const c = cfg(env);
  const r = await fetch(`${DP_API}/oauth/token`, {
    method: "POST",
    headers: {
      ...DP_HEADERS,
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      authorization: `Basic ${btoa(`${c.clientId}:${c.clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "password", username: c.username, password: c.password }).toString(),
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => { console.error("digipay auth", e); return null; });
  const d = (await r?.json().catch(() => null)) as any;
  const token = r?.ok ? (d?.access_token as string | undefined) : undefined;
  if (!token) { console.error("digipay auth failed", r?.status, JSON.stringify(d).slice(0, 300)); return null; }
  const ttl = Math.max(60, Math.min(Number(d?.expires_in) || 3600, 86_400) - 120);
  await env.KV.put(TOKEN_KEY, JSON.stringify({ t: token }), { expirationTtl: ttl }).catch(() => {});
  return token;
}

/** فراخوانی API دیجی‌پی (JSON)؛ در صورت 401 یک‌بار توکن را تازه می‌کند */
async function dp(env: Env, endpoint: string, body: Record<string, unknown>, retry = true): Promise<any> {
  const token = await dpToken(env, !retry);
  if (!token) return null;
  const r = await fetch(`${DP_API}/${endpoint}`, {
    method: "POST",
    headers: { ...DP_HEADERS, "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (r.status === 401 && retry) return dp(env, endpoint, body, false);
  return r.json().catch(() => null);
}
const dpOk = (res: any) => res?.result?.status === 0 || res?.result?.status === "0";

/** شماره‌ی موبایل ایران → قالب 09XXXXXXXXX (ارقام فارسی/عربی، +98 و 0098 هم پذیرفته می‌شود)؛ نامعتبر → null */
function normalizeMobile(v: unknown): string | null {
  let m = String(v ?? "")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\s\-()]/g, "");
  m = m.replace(/^(\+98|0098|98)/, "0");
  if (/^9\d{9}$/.test(m)) m = "0" + m;
  return /^09\d{9}$/.test(m) ? m : null;
}

/** شماره‌ی سفارش یکتا (providerId) */
const newOrderId = () => `pp${Date.now()}${Math.floor(Math.random() * 1000)}`;
const ORDER_RE = /^pp\d{13,17}$/;

/** POST /api/pay/start  { plan } → { url }  (کاربر باید وارد شده باشد) */
export async function startPayment(env: Env, url: URL, user: WebUser, b: Record<string, unknown> | null): Promise<Response> {
  if (!payEnabled(env)) return json({ error: "پرداخت آنلاین هنوز فعال نشده است." }, 503);
  const plan = PLANS.find((p) => p.id === b?.plan);
  if (!plan) return json({ error: "بسته‌ی انتخابی نامعتبر است." }, 400);
  if (await hitLimit(env, `payrl:${user.id}`, 20, 3600)) return json({ error: "تعداد درخواست پرداخت زیاد بود؛ کمی بعد دوباره امتحان کن." }, 429);

  // شماره‌ی موبایل خریدار: طبق مستند دیجی‌پی (و افزونه‌ی رسمی) فیلد cellNumber در تیکت اجباری است؛
  // نبودنش باعث خطای 1103 «فیچر یافت نشد» می‌شود
  const mobile = normalizeMobile(user.mobile); // شماره‌ی تاییدشده‌ی حساب؛ بدون آن پرداخت ممکن نیست
  if (!mobile) return json({ error: "برای پرداخت، ابتدا شماره‌ی موبایلت را در پروفایل تایید کن.", needMobile: true }, 400);

  const amount = plan.price * 1000 * (DP_AMOUNT_UNIT === "rial" ? 10 : 1); // price: هزار تومان
  const order = newOrderId();
  const base = {
    amount,
    cellNumber: mobile,
    providerId: order,
    callbackUrl: `${url.origin}/api/pay/callback?o=${order}`,
    ...(DP_GATEWAY === null ? {} : { additionalInfo: { preferredGateway: DP_GATEWAY } }),
  };
  // سبد خرید: طبق مستند دیجی‌پی برای نمایش پرداخت اعتباری/اقساطی اجباری است (افزونه‌ی رسمی هم همیشه می‌فرستد)
  const basket = {
    basketId: order,
    items: [{ sellerId: "1", supplierId: "1", productCode: plan.id, brand: "", productType: 3, count: 1, categoryId: "0" }],
  };
  const ticket = (body: Record<string, unknown>) =>
    dp(env, `tickets/business?type=${DP_TICKET_TYPE}`, body).catch((e) => { console.error("digipay ticket", e); return null; });
  let res = await ticket({ ...base, basketDetailsDto: basket });
  // 1103 = «فیچر یافت نشد»: ابزار اعتباری/اقساطی برای این حساب فعال نیست؛ بدون سبد دوباره تلاش می‌کنیم تا پرداخت (کیف پول/کارتی) از کار نیفتد
  if (String(res?.result?.status) === "1103") {
    console.error("digipay ticket 1103 with basket — retrying without basket");
    res = await ticket(base);
  }
  // هنوز 1103: احتمالاً فقط درگاه کارتی (IPG) روی حساب فعال است؛ مستقیم به IPG می‌فرستیم (preferredGateway=2)
  if (String(res?.result?.status) === "1103" && DP_GATEWAY === null) {
    console.error("digipay ticket 1103 without basket — retrying direct IPG");
    res = await ticket({ ...base, additionalInfo: { preferredGateway: 2 } });
  }

  const redirect = res?.redirectUrl as string | undefined;
  if (!dpOk(res) || !redirect || !/^https:\/\//i.test(redirect)) {
    console.error("digipay ticket failed", JSON.stringify({ s: res?.result?.status, m: res?.result?.message }).slice(0, 300));
    return json({ error: "اتصال به درگاه پرداخت ممکن نشد؛ چند دقیقه بعد دوباره امتحان کن." }, 502);
  }
  const rec: PayRecord = { uid: user.id, plan: plan.id, count: plan.credits, amount, order, state: "pending", t: Date.now(), redirect };
  await env.KV.put(`pay:${order}`, JSON.stringify(rec), { expirationTtl: TTL });
  return json({ url: `/api/pay/go?t=${encodeURIComponent(order)}` });
}

/** GET /api/pay/go?t=سفارش — انتقال کاربر به صفحه‌ی پرداخت دیجی‌پی */
export async function paymentGo(env: Env, url: URL): Promise<Response> {
  const order = url.searchParams.get("t") ?? "";
  const rec = ORDER_RE.test(order) ? ((await env.KV.get(`pay:${order}`, "json")) as PayRecord | null) : null;
  if (!rec || rec.state !== "pending" || !rec.redirect) return Response.redirect(`${url.origin}/?pay=fail`, 303);
  return new Response(null, { status: 303, headers: { location: rec.redirect, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

/** POST /api/pay/callback — بازگشت کاربر از دیجی‌پی؛ پرداخت را تایید (purchases/verify) و پلن را فعال می‌کند */
export async function paymentCallback(env: Env, req: Request, url: URL): Promise<Response> {
  const go = (q: string) => Response.redirect(`${url.origin}/?${q}`, 303);
  if (!payEnabled(env)) return go("pay=fail");

  // نتیجه‌ی پرداخت با POST می‌آید (فرم یا JSON)؛ هر دو قالب پشتیبانی می‌شود
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    if ((req.headers.get("content-type") ?? "").includes("json")) body = ((await req.json().catch(() => null)) as Record<string, unknown>) ?? {};
    else { const f = await req.formData().catch(() => null); if (f) for (const [k, v] of f.entries()) body[k] = String(v); }
  }
  const field = (n: string) => String(body[n] ?? "");
  const order = url.searchParams.get("o") || field("providerId");
  if (!ORDER_RE.test(order) || (field("providerId") && field("providerId") !== order)) return go("pay=fail");

  const rec = (await env.KV.get(`pay:${order}`, "json")) as PayRecord | null;
  if (!rec) return go("pay=fail");
  const okQ = `pay=ok&n=${rec.count}${rec.plan ? `&p=${encodeURIComponent(rec.plan)}` : ""}`;
  if (rec.state === "paid") return go(okQ);

  const trackingCode = field("trackingCode");
  const type = /^\d{1,3}$/.test(field("type")) ? field("type") : DP_VERIFY_FALLBACK;
  if (field("result") !== "SUCCESS" || !trackingCode) {
    await env.KV.put(`pay:${order}`, JSON.stringify({ ...rec, state: "failed" }), { expirationTtl: TTL });
    return go("pay=cancel");
  }
  if (Number(field("amount")) !== rec.amount) {
    console.error("digipay amount mismatch", order, field("amount"), rec.amount);
    return go("pay=fail");
  }

  // تایید پرداخت؛ وضعیت 9011 یعنی هنوز در حال پردازش است و چند بار دوباره تلاش می‌شود
  let res: any = null;
  for (let i = 0; i < 4; i++) {
    res = await dp(env, `purchases/verify?type=${type}`, { trackingCode, providerId: order }).catch((e) => { console.error("digipay verify", e); return null; });
    if (!res) return go("pay=error"); // خطای شبکه: وضعیت pending می‌ماند تا تایید دوباره
    if (String(res?.result?.status) !== "9011") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (dpOk(res) && res?.amount != null && Number(res.amount) !== rec.amount) {
    console.error("digipay verify amount mismatch", order, res.amount, rec.amount);
    return go("pay=fail");
  }
  if (!dpOk(res)) {
    console.error("digipay verify failed", JSON.stringify({ s: res?.result?.status, m: res?.result?.message }).slice(0, 300));
    return go("pay=fail");
  }

  // پرداخت‌های اعتباری/اقساطی (نوع ۵ و ۱۳): دیجی‌پی بدون تایید تحویل اقساط را شروع نمی‌کند (مثل افزونه‌ی رسمی ۱.۷.۱)
  if (type === "5" || type === "13") {
    const title = PLANS.find((x) => x.id === rec.plan)?.name ?? "اعتبار";
    const d = await dp(env, `purchases/deliver?type=${type}`, {
      deliveryDate: Date.now(), invoiceNumber: order, trackingCode, products: [`اشتراک ماهانه پلن ${title}`],
    }).catch((e) => { console.error("digipay deliver", e); return null; });
    if (!dpOk(d)) console.error("digipay deliver failed", JSON.stringify({ s: d?.result?.status, m: d?.result?.message }).slice(0, 300));
  }

  // ابتدا پرداخت‌شده علامت می‌خورد، بعد پلن فعال می‌شود (جلوگیری از افزودن دوباره با رفرش)
  const fresh = (await env.KV.get(`pay:${order}`, "json")) as PayRecord | null;
  if (fresh?.state !== "paid") {
    await env.KV.put(`pay:${order}`, JSON.stringify({ ...rec, state: "paid", ref: trackingCode }), { expirationTtl: TTL * 6 });
    const plan = rec.plan ? PLANS.find((p) => p.id === rec.plan) : undefined;
    if (plan) await activatePlan(env, rec.uid, plan);
    else await setBonus(env, rec.uid, (await getBonus(env, rec.uid)) + rec.count); // رکوردهای قدیمیِ بسته‌ی اعتباری (پیش از پلن‌ها)
    console.log("payment ok", rec.uid, rec.plan ?? "pack", rec.count, trackingCode);
  }
  return go(okQ);
}
