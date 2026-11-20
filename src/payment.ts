/** درگاه پرداخت دیجی‌پی (UPG — درگاه یکپارچه، OAuth + tickets/business + purchases/verify) — فقط نسخه‌ی وب. پس از پرداخت موفق، پلن کاربر فعال/تمدید می‌شود. */
import type { Env } from "./env";
import { PLAN_MAX_IMAGES, PLAN_MAX_SLIDES, getActiveSub, getBonus, putSub, setBonus, type Sub } from "./settings";
import { hitLimit, type WebUser } from "./auth";
import { sendReceipt } from "./email-receipt";

/**
 * پلن‌های ماهانه (price: هزار تومان): پلاس ۶۹۰ (۵ اعتبار) و پرو ۱۱۴۰ (۱۱ اعتبار). هر پلن ۳۰ روز اعتبار دارد و تمدید خودکار ندارد.
 * مدل‌های کلودفلر برای همه رایگان است؛ مدل‌های ویژه‌ی ارائه‌دهنده‌ی دوم (EXTRA_LLM_*) فقط برای دارندگان پلن فعال است. پلن‌ها اعتبار می‌فروشند و سقف اسلاید هر ارائه را بالا می‌برند
 * (رایگان ۶، پلاس ۲۰، پرو ۳۵ اسلاید) و تعداد تصویر هر ارائه را (رایگان ۱، پلاس ۳، پرو ۶).
 */
export interface Plan { id: string; name: string; price: number; credits: number; days: number; maxSlides: number; maxImages: number }
export const PLANS: Plan[] = [
  { id: "plus", name: "پلاس", price: 690, credits: 5, days: 30, maxSlides: PLAN_MAX_SLIDES.plus, maxImages: PLAN_MAX_IMAGES.plus },
  { id: "pro", name: "پرو", price: 1140, credits: 11, days: 30, maxSlides: PLAN_MAX_SLIDES.pro, maxImages: PLAN_MAX_IMAGES.pro },
];

/**
 * فعال‌سازی / تمدید پلن بعد از پرداخت موفق:
 * - بدون پلن فعال (هرگز نخریده، منقضی شده، یا اعتبارش تمام شده): از همین الان ۳۰ روز با اعتبار جدید؛ روزهای باقی‌مانده‌ی پلنِ بی‌اعتبار حساب نمی‌شود.
 * - تمدید همان پلن فعال (پلاس←پلاس یا پرو←پرو): ۳۰ روز به پایان پلن فعلی اضافه می‌شود و اعتبار جدید روی اعتبار باقی‌مانده جمع می‌شود.
 * - خرید پلنِ دیگر (پلاس←پرو یا پرو←پلاس): پلن قبلی با روز و اعتبار باقی‌مانده‌اش منقضی می‌شود و پلن جدید مثل پلن رایگان از همین لحظه با ۳۰ روز و اعتبار جدید شروع می‌شود.
 */
/** اشتراک جدید از روی اشتراک فعال فعلی (خالص؛ بدون نوشتن). cur: پلنِ منقضی یا بدون اعتبار = null */
/** سورپرایز خرید: بعد از هر خرید موفق پلن (درگاه، بازار، مایکت) یک اعتبار اضافه به حساب کاربر اضافه می‌شود (۷ ← ۸، ۱۵ ← ۱۶).
 *  عمداً در رسید، ایمیل، پیام‌ها و صفحه‌ی نتیجه‌ی پرداخت ذکر نمی‌شود؛ همه‌جا همان plan.credits نمایش داده می‌شود. */
const PURCHASE_BONUS_CREDITS = 1;
export function nextSub(cur: Sub | null, p: Plan, bonus = 0, paid?: number): Sub {
  // خرید پلنِ دیگر (پلاس ← پرو یا پرو ← پلاس): پلن قبلی منقضی می‌شود و پلنِ جدید مثل کاربر رایگان از همین لحظه شروع می‌شود
  if (cur && cur.plan !== p.id) cur = null;
  // paid: مبلغ واقعیِ آخرین خرید (تومان) در لحظه‌ی خرید؛ برای خروجی پلن‌داران (قیمت پلن بعداً عوض می‌شود). تمدید/فعال‌سازی دستی بدون مبلغ، مبلغ قبلیِ همان پلن را نگه می‌دارد.
  // bought: اعتبارِ پلنِ همان خرید (بدون اعتبار سورپرایز)؛ آن هم با تغییر پلن‌ها عوض می‌شود
  const isBuy = !!paid && paid > 0;
  const keep = isBuy ? Math.round(paid!) : cur?.paid;
  const keepB = isBuy ? p.credits : cur?.bought;
  return { plan: p.id, exp: (cur ? cur.exp : Date.now()) + p.days * 86_400_000, credits: (cur?.credits ?? 0) + p.credits + bonus, ...(keep ? { paid: keep } : {}), ...(keepB ? { bought: keepB } : {}) };
}
export async function activatePlan(env: Env, uid: string, p: Plan) {
  await putSub(env, uid, nextSub(await getActiveSub(env, uid), p));
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

/** issue/it: وقتی کاربر از درگاه «موفق» برگشته ولی تایید یا فعال‌سازی کامل نشده (برای هشدار در گزارش پرداخت پنل مدیر؛ وضعیت pending می‌ماند تا تایید دوباره ممکن باشد) */
interface PayRecord { uid: string; plan?: string; count: number; amount: number; /** مبلغ واقعی پرداخت به تومان در لحظه‌ی خرید */ toman?: number; order: string; state: "pending" | "paid" | "failed"; t: number; ref?: string; redirect?: string; issue?: string; it?: number }
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
const newOrderId = () => `pp${Date.now()}${String(crypto.getRandomValues(new Uint32Array(1))[0] % 10_000).padStart(4, "0")}`; // pp + ۱۳ رقم زمان + ۴ رقم تصادفیِ امن
const ORDER_RE = /^pp\d{13,17}$/;

/** پرداختِ «موفق» از دید درگاه که تایید نشد را برای پنل مدیر علامت می‌زند (فقط رکورد pending؛ ۸۴ روز نگه داشته می‌شود). خطا هرگز مسیر پرداخت را نمی‌شکند. */
async function flagIssue(env: Env, rec: PayRecord, issue: string, trackingCode: string): Promise<void> {
  try {
    await env.DB.prepare("UPDATE kv SET v=?2, exp=?3 WHERE k=?1 AND json_extract(v,'$.state')='pending'")
      .bind(`pay:${rec.order}`, JSON.stringify({ ...rec, issue: issue.slice(0, 40), ref: trackingCode, it: Date.now() }), Math.floor(Date.now() / 1000) + TTL * 6).run();
  } catch (e) { console.error("flagIssue", e); }
}

/** آمار دائمی فروش روزانه (به وقت ایران) برای نمای ماهانه‌ی پنل مدیر: rv:<روز> = {n: تعداد، a: تومان}. رکوردهای pay: فقط ۸۴ روز می‌مانند. */
async function noteSale(env: Env, rec: PayRecord, plan: Plan | undefined): Promise<void> {
  try {
    const day = new Date(rec.t).toLocaleDateString("sv-SE", { timeZone: "Asia/Tehran" });
    const toman = rec.toman ?? (rec.amount > 0 ? Math.round(rec.amount / 10) : plan ? plan.price * 1000 : 0); // مبلغ ثبت‌شده‌ی همان خرید، نه قیمت فعلی پلن
    await env.DB.prepare(
      "INSERT INTO kv (k, v, exp) VALUES (?1, ?2, NULL) ON CONFLICT(k) DO UPDATE SET v = json_set(v, '$.n', COALESCE(json_extract(v, '$.n'), 0) + 1, '$.a', COALESCE(json_extract(v, '$.a'), 0) + ?3)")
      .bind(`rv:${day}`, JSON.stringify({ n: 1, a: toman }), toman).run();
    // نشانه‌ی دائمی «این کاربر دست‌کم یک‌بار پلن خریده» (بدون انقضا) برای خروجی «خریداران» پنل مدیر؛ رکوردهای pay: فقط ۸۴ روز می‌مانند
    await env.DB.prepare(
      "INSERT INTO kv (k, v, exp) VALUES (?1, ?2, NULL) ON CONFLICT(k) DO UPDATE SET v = json_set(v, '$.n', COALESCE(json_extract(v, '$.n'), 0) + 1, '$.l', ?3)")
      .bind(`pbuy:${rec.uid}`, JSON.stringify({ f: rec.t, l: rec.t, n: 1 }), rec.t).run();
  } catch (e) { console.error("noteSale", e); }
}

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
  const rec: PayRecord = { uid: user.id, plan: plan.id, count: plan.credits, amount, toman: plan.price * 1000, order, state: "pending", t: Date.now(), redirect };
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
    // فقط pending ← failed؛ هرگز یک پرداخت «paid» را به failed برنمی‌گردانیم (وگرنه callback بعدی دوباره پلن را فعال می‌کرد)
    await env.DB.prepare("UPDATE kv SET v=?2 WHERE k=?1 AND json_extract(v,'$.state')='pending'")
      .bind(`pay:${order}`, JSON.stringify({ ...rec, state: "failed" })).run();
    return go("pay=cancel");
  }
  if (Number(field("amount")) !== rec.amount) {
    console.error("digipay amount mismatch", order, field("amount"), rec.amount);
    await flagIssue(env, rec, "amount", trackingCode);
    return go("pay=fail");
  }

  // تایید پرداخت؛ وضعیت 9011 یعنی هنوز در حال پردازش است و چند بار دوباره تلاش می‌شود
  let res: any = null;
  for (let i = 0; i < 4; i++) {
    res = await dp(env, `purchases/verify?type=${type}`, { trackingCode, providerId: order }).catch((e) => { console.error("digipay verify", e); return null; });
    if (!res) { await flagIssue(env, rec, "net", trackingCode); return go("pay=error"); } // خطای شبکه: وضعیت pending می‌ماند تا تایید دوباره
    if (String(res?.result?.status) !== "9011") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (dpOk(res) && res?.amount != null && Number(res.amount) !== rec.amount) {
    console.error("digipay verify amount mismatch", order, res.amount, rec.amount);
    await flagIssue(env, rec, "vamount", trackingCode);
    return go("pay=fail");
  }
  if (!dpOk(res)) {
    console.error("digipay verify failed", JSON.stringify({ s: res?.result?.status, m: res?.result?.message }).slice(0, 300));
    await flagIssue(env, rec, `verify:${res?.result?.status ?? "?"}`, trackingCode);
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

  // ادعای اتمی: فقط یک درخواست «برنده» می‌شود. علامت‌زدن «paid» و فعال‌سازی پلن در «یک تراکنش» D1 انجام می‌شود؛
  // پس نه رفرش/callback تکراری پلن را دوبار فعال می‌کند و نه کرش وسط کار باعث «پول رفته، پلن نیامده» می‌شود.
  const by = crypto.randomUUID(); // نشانه‌ی برنده؛ نوشتن اشتراک فقط وقتی انجام می‌شود که رکورد پرداخت همین نشانه را داشته باشد
  const nowSec = Math.floor(Date.now() / 1000);
  // مبلغ واقعیِ همین پرداخت (تومان): از خودِ رکورد (رکوردهای قدیمی‌تر: از مبلغ ارسالی به درگاه)، نه از قیمت فعلی پلن که ممکن است عوض شده باشد
  const paidToman = rec.toman ?? Math.round(rec.amount / (DP_AMOUNT_UNIT === "rial" ? 10 : 1));
  const claim = env.DB.prepare("UPDATE kv SET v=?2, exp=?3 WHERE k=?1 AND json_extract(v,'$.state') != 'paid'")
    .bind(`pay:${order}`, JSON.stringify({ ...rec, toman: paidToman, state: "paid", ref: trackingCode, by, issue: undefined, it: undefined }), nowSec + TTL * 6);
  const plan = rec.plan ? PLANS.find((p) => p.id === rec.plan) : undefined;
  let won: boolean;
  let subExpMs: number | undefined;
  if (plan) {
    const sub = nextSub(await getActiveSub(env, rec.uid), plan, PURCHASE_BONUS_CREDITS, paidToman);
    subExpMs = sub.exp;
    const subExp = nowSec + Math.max(60, Math.ceil((sub.exp - Date.now()) / 1000) + 86_400); // مثل putSub
    const write = env.DB.prepare(
      "INSERT INTO kv (k, v, exp) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM kv WHERE k=?4 AND json_extract(v,'$.by')=?5) " +
      "ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp")
      .bind(`sub:${rec.uid}`, JSON.stringify(sub), subExp, `pay:${order}`, by);
    won = (await env.DB.batch([claim, write]))[0].meta.changes === 1;
  } else {
    // رکوردهای قدیمیِ بسته‌ی اعتباری (پیش از پلن‌ها)
    won = (await claim.run()).meta.changes === 1;
    if (won) await setBonus(env, rec.uid, (await getBonus(env, rec.uid)) + rec.count);
  }
  if (won) {
    console.log("payment ok", rec.uid, rec.plan ?? "pack", rec.count, trackingCode);
    await noteSale(env, { ...rec, toman: paidToman }, plan);
    // رسید خرید به ایمیل حساب و ربات تلگرام (فقط پلن‌ها؛ ایمیل بدون ایمیل ثبت‌شده یا بدون RESEND_API_KEY بی‌اثر است و هرگز پرداخت را خراب نمی‌کند)
    if (plan) await sendReceipt(env, { uid: rec.uid, planName: plan.name, credits: plan.credits, days: plan.days, toman: paidToman, order, idem: order, ref: trackingCode, method: "درگاه پرداخت", paidAt: Date.now(), expAt: subExpMs });
  }
  return go(okQ);
}


// ---------- کافه‌بازار (اپ اندروید) ----------
/**
 * خرید درون‌برنامه‌ای بازار: هر پلن یک محصول «مصرفی» با شناسه‌ی plan_<id> است (plan_plus، plan_pro).
 * اپ پس از خرید، توکن را به POST /api/pay/bazaar می‌فرستد؛ سرور با API توسعه‌دهندگان بازار (OAuth با refresh_token) آن را تایید و پلن را فعال می‌کند،
 * سپس اپ خرید را «مصرف» می‌کند تا ماه بعد دوباره قابل خرید باشد. هر توکن فقط یک بار پلن را فعال می‌کند (کلید bzp:<sha256 توکن>، دائمی).
 */
const BZ_API = "https://pardakht.cafebazaar.ir/devapi/v2";
const bzCfg = (env: Env) => ({
  clientId: (env.BAZAAR_CLIENT_ID ?? "").trim(),
  clientSecret: (env.BAZAAR_CLIENT_SECRET ?? "").trim(),
  refreshToken: (env.BAZAAR_REFRESH_TOKEN ?? "").trim(),
  pkg: (env.ANDROID_PACKAGE ?? "ir.pptsaz.app").trim(),
});
export const bazaarEnabled = (env: Env) => { const c = bzCfg(env); return Boolean(c.clientId && c.clientSecret && c.refreshToken); };
const bzSku = (p: Plan) => `plan_${p.id}`;
const BZ_TOKEN_KEY = "bz:token";

/** توکن دسترسی بازار (۱ ساعت اعتبار) با refresh_token؛ در KV کش می‌شود */
async function bzToken(env: Env, force = false): Promise<string | null> {
  if (!force) {
    const c = (await env.KV.get(BZ_TOKEN_KEY, "json").catch(() => null)) as { t: string } | null;
    if (c?.t) return c.t;
  }
  const c = bzCfg(env);
  const r = await fetch(`${BZ_API}/auth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken }).toString(),
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => { console.error("bazaar auth", e); return null; });
  const d = (await r?.json().catch(() => null)) as any;
  const token = r?.ok ? (d?.access_token as string | undefined) : undefined;
  if (!token) { console.error("bazaar auth failed", r?.status, JSON.stringify(d).slice(0, 300)); return null; }
  const ttl = Math.max(60, Math.min(Number(d?.expires_in) || 3600, 3600) - 300);
  await env.KV.put(BZ_TOKEN_KEY, JSON.stringify({ t: token }), { expirationTtl: ttl }).catch(() => {});
  return token;
}

/** تایید خرید در بازار: ok=true و data (purchaseState: ۰ = خریداری‌شده، ۱ = برگشت‌خورده)؛ invalid = توکن/محصول وجود ندارد؛ error = مشکل ارتباط/تنظیمات */
async function bzValidate(env: Env, sku: string, purchaseToken: string, retry = true): Promise<{ ok: boolean; invalid?: boolean; data?: any }> {
  const at = await bzToken(env, !retry);
  if (!at) return { ok: false };
  const u = `${BZ_API}/api/validate/${encodeURIComponent(bzCfg(env).pkg)}/inapp/${encodeURIComponent(sku)}/purchases/${encodeURIComponent(purchaseToken)}/?access_token=${encodeURIComponent(at)}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(20_000) }).catch((e) => { console.error("bazaar validate", e); return null; });
  if (!r) return { ok: false };
  if (r.status === 401 && retry) return bzValidate(env, sku, purchaseToken, false);
  const d = (await r.json().catch(() => null)) as any;
  if (r.status === 404 || r.status === 400) { console.error("bazaar validate invalid", r.status, sku, JSON.stringify(d).slice(0, 200)); return { ok: false, invalid: true }; }
  if (!r.ok) { console.error("bazaar validate failed", r.status, JSON.stringify(d).slice(0, 300)); return { ok: false }; }
  return { ok: true, data: d };
}

const sha256hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** POST /api/pay/bazaar  { productId, purchaseToken } → { ok, plan, already? }  (کاربر باید وارد شده باشد؛ تکراری‌بودن برای همان کاربر مشکلی ندارد) */
async function bazaarVerifyRaw(env: Env, user: WebUser, b: Record<string, unknown> | null): Promise<Response> {
  if (!bazaarEnabled(env)) return json({ error: "پرداخت از طریق کافه‌بازار هنوز فعال نشده است." }, 503);
  const productId = String(b?.productId ?? "");
  const purchaseToken = String(b?.purchaseToken ?? "");
  const plan = PLANS.find((p) => bzSku(p) === productId); // پلن فقط از شناسه‌ی محصول بازار مشخص می‌شود، نه از ادعای کلاینت
  if (!plan) return json({ error: "محصول نامعتبر است." }, 400);
  if (purchaseToken.length < 8 || purchaseToken.length > 500 || /[\s\u0000-\u001f]/.test(purchaseToken)) return json({ error: "اطلاعات خرید نامعتبر است." }, 400);
  if (await hitLimit(env, `bzrl:${user.id}`, 30, 3600)) return json({ error: "درخواست‌های زیاد بود؛ کمی بعد دوباره امتحان کن." }, 429);

  const key = `bzp:${await sha256hex(purchaseToken)}`;
  const seen = async (): Promise<Response | null> => {
    const r = (await env.KV.get(key, "json")) as { uid?: string } | null;
    if (!r) return null;
    return r.uid === user.id ? json({ ok: true, plan: plan.id, already: true }) : json({ error: "این خرید قبلاً برای حساب دیگری ثبت شده است." }, 409);
  };
  const dup = await seen();
  if (dup) return dup;

  const v = await bzValidate(env, productId, purchaseToken);
  if (v.invalid) return json({ error: "خرید در کافه‌بازار پیدا نشد." }, 400);
  if (!v.ok) return json({ error: "تایید خرید با بازار ممکن نشد؛ چند دقیقه بعد دوباره امتحان کن (اپ را باز کنید؛ خرید شما از بین نمی‌رود)." }, 502);
  if (Number(v.data?.purchaseState) !== 0) return json({ error: "این خرید لغو یا برگشت خورده است." }, 400);

  return storeClaim(env, user, plan, productId, key, String(v.data?.orderId ?? ""), "bazaar", seen);
}

/** ادعای اتمی (مثل callback دیجی‌پی) برای خرید فروشگاه‌ها: ثبت توکن و فعال‌سازی پلن در «یک تراکنش» D1؛ فقط یک درخواست برنده می‌شود */
async function storeClaim(
  env: Env, user: WebUser, plan: Plan, productId: string, key: string, orderId: string, tag: string,
  seen: () => Promise<Response | null>,
): Promise<Response> {
  const by = crypto.randomUUID();
  const nowSec = Math.floor(Date.now() / 1000);
  const claim = env.DB.prepare("INSERT INTO kv (k, v, exp) VALUES (?1, ?2, NULL) ON CONFLICT(k) DO NOTHING")
    .bind(key, JSON.stringify({ uid: user.id, plan: plan.id, sku: productId, order: orderId, t: Date.now(), by }));
  const paidToman = plan.price * 1000; // قیمتِ پلن در همین لحظه‌ی خرید
  const sub = nextSub(await getActiveSub(env, user.id), plan, PURCHASE_BONUS_CREDITS, paidToman);
  const subExp = nowSec + Math.max(60, Math.ceil((sub.exp - Date.now()) / 1000) + 86_400); // مثل putSub
  const write = env.DB.prepare(
    "INSERT INTO kv (k, v, exp) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM kv WHERE k=?4 AND json_extract(v,'$.by')=?5) " +
    "ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp")
    .bind(`sub:${user.id}`, JSON.stringify(sub), subExp, key, by);
  const won = (await env.DB.batch([claim, write]))[0].meta.changes === 1;
  if (!won) return (await seen()) ?? json({ error: "ثبت خرید انجام نشد؛ دوباره امتحان کن." }, 409);

  console.log(`${tag} payment ok`, user.id, plan.id);
  await noteSale(env, { uid: user.id, plan: plan.id, count: plan.credits, amount: plan.price * 10_000, toman: paidToman, order: key, state: "paid", t: Date.now() }, plan);
  // رسید خرید به ایمیل حساب و ربات تلگرام (هرکدام که موجود باشد)
  await sendReceipt(env, { uid: user.id, planName: plan.name, credits: plan.credits, days: plan.days, toman: paidToman, order: orderId, idem: key, method: tag === "myket" ? "مایکت" : tag === "sibapp" ? "سیب‌اپ" : "کافه‌بازار", paidAt: Date.now(), expAt: sub.exp });
  return json({ ok: true, plan: plan.id });
}

// ---------- مایکت (اپ اندروید، نسخه‌ی مایکت) ----------
/**
 * خرید درون‌برنامه‌ای مایکت: همان محصولات مصرفی plan_<id> (plan_plus، plan_pro) در پنل توسعه‌دهندگان مایکت ساخته می‌شوند.
 * اپ بعد از خرید { j: JSON خرید (getOriginalJson), s: امضا (getSignature) } را در purchaseToken به POST /api/pay/myket می‌فرستد؛
 * سرور امضا (SHA1withRSA) را با کلید عمومی مایکت تایید می‌کند و پلن را فعال می‌کند؛ سپس اپ خرید را «مصرف» می‌کند.
 * هر توکن خرید فقط یک بار پلن را فعال می‌کند (کلید mkp:<sha256 توکن>، دائمی). کلید عمومی محرمانه نیست؛ با MYKET_PUBLIC_KEY قابل تغییر است.
 */
const MK_DEFAULT_KEY =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD39JomlD/MfP2+OYY9DCw6fRp5mnBKBHYuWYrAvg3wml2Njceh0LivP3iTo0w7b3UfSgQBi9Of7op9y0lr3Px6AkORg07mk71tbmsZqY/IKO60zGI273bxEJOnRDH2aL4Ce+TW4A7IFE2h3bh/MtmZKRF1p9JFdhR3r96PckFcNwIDAQAB";
export const myketEnabled = (env: Env) => (env.MYKET_PAY ?? "").trim().toLowerCase() !== "off";
const b64Bytes = (b64: string) => Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0));

async function mkVerifySignature(env: Env, data: string, signatureB64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "spki", b64Bytes((env.MYKET_PUBLIC_KEY ?? "").trim() || MK_DEFAULT_KEY),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" }, false, ["verify"],
    );
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64Bytes(signatureB64), new TextEncoder().encode(data));
  } catch (e) {
    console.error("myket signature", e);
    return false;
  }
}

/**
 * وضعیت خرید از API سرور-به-سرور مایکت (purchaseState: ۰ = موفق، ۱ = ناموفق). فقط وقتی MYKET_ACCESS_TOKEN تنظیم شده؛
 * هر خطا/قطعی/پاسخ نامشخص → null (امضای خرید که قبلاً تایید شده کافی است و پرداخت به‌خاطر مشکل API مایکت گیر نمی‌کند).
 */
async function mkApiState(env: Env, sku: string, token: string): Promise<number | null> {
  const at = (env.MYKET_ACCESS_TOKEN ?? "").trim();
  if (!at) return null;
  try {
    const r = await fetch(`https://developer.myket.ir/api/partners/applications/${encodeURIComponent(bzCfg(env).pkg)}/purchases/products/${encodeURIComponent(sku)}/verify`, {
      method: "POST",
      headers: { "X-Access-Token": at, "content-type": "application/json" },
      body: JSON.stringify({ tokenId: token }),
      signal: AbortSignal.timeout(10_000),
    });
    const d = (await r.json().catch(() => null)) as { purchaseState?: unknown } | null;
    if (!r.ok) { console.error("myket verify api", r.status, JSON.stringify(d).slice(0, 200)); return null; }
    return d?.purchaseState === undefined ? null : Number(d.purchaseState);
  } catch (e) { console.error("myket verify api", e); return null; }
}

/** POST /api/pay/myket  { productId, purchaseToken: '{"j":"<originalJson>","s":"<signature>"}' } → { ok, plan, already? } */
async function myketVerifyRaw(env: Env, user: WebUser, b: Record<string, unknown> | null): Promise<Response> {
  if (!myketEnabled(env)) return json({ error: "پرداخت از طریق مایکت هنوز فعال نشده است." }, 503);
  const productId = String(b?.productId ?? "");
  const plan = PLANS.find((p) => bzSku(p) === productId); // پلن فقط از شناسه‌ی محصول مشخص می‌شود، نه از ادعای کلاینت
  if (!plan) return json({ error: "محصول نامعتبر است." }, 400);
  let pack: { j?: unknown; s?: unknown } = {};
  try { pack = JSON.parse(String(b?.purchaseToken ?? "")); } catch { /* پایین رد می‌شود */ }
  const raw = typeof pack.j === "string" ? pack.j : "";
  const sig = typeof pack.s === "string" ? pack.s : "";
  if (!raw || !sig || raw.length > 4000 || sig.length > 1000) return json({ error: "اطلاعات خرید نامعتبر است." }, 400);
  if (await hitLimit(env, `mkrl:${user.id}`, 30, 3600)) return json({ error: "درخواست‌های زیاد بود؛ کمی بعد دوباره امتحان کن." }, 429);

  let d: any;
  try { d = JSON.parse(raw); } catch { return json({ error: "اطلاعات خرید نامعتبر است." }, 400); }
  if (!(await mkVerifySignature(env, raw, sig))) return json({ error: "امضای خرید معتبر نیست." }, 400);
  if (String(d?.productId ?? "") !== productId) return json({ error: "محصول خرید با درخواست نمی‌خواند." }, 400);
  if (d?.packageName && String(d.packageName) !== bzCfg(env).pkg) return json({ error: "این خرید برای این برنامه نیست." }, 400);
  if (d?.purchaseState !== undefined && Number(d.purchaseState) !== 0) return json({ error: "این خرید لغو یا برگشت خورده است." }, 400);
  const token = String(d?.purchaseToken ?? d?.token ?? d?.orderId ?? "");
  if (token.length < 4 || token.length > 500) return json({ error: "اطلاعات خرید نامعتبر است." }, 400);

  const key = `mkp:${await sha256hex(token)}`;
  const seen = async (): Promise<Response | null> => {
    const r = (await env.KV.get(key, "json")) as { uid?: string } | null;
    if (!r) return null;
    return r.uid === user.id ? json({ ok: true, plan: plan.id, already: true }) : json({ error: "این خرید قبلاً برای حساب دیگری ثبت شده است." }, 409);
  };
  const dup = await seen();
  if (dup) return dup;
  const apiState = await mkApiState(env, productId, token);
  if (apiState !== null && apiState !== 0) return json({ error: "این خرید لغو یا برگشت خورده است." }, 400);
  return storeClaim(env, user, plan, productId, key, String(d?.orderId ?? ""), "myket", seen);
}


// ---------- ثبت و ردیابی همه‌ی تلاش‌های خرید فروشگاه‌ها (برای پنل مدیر و لاگ) ----------
type StoreTag = "bz" | "mk" | "sb";
const STORE_NAME: Record<StoreTag, string> = { bz: "کافه‌بازار", mk: "مایکت", sb: "سیب‌اپ" };

/**
 * رکورد pay:<سفارش> برای خرید فروشگاه‌ها تا در «💰 پرداخت‌ها» و «⚠️ مشکل‌دار» پنل مدیر دیده شود (قبلاً فقط درگاه دیجی‌پی رکورد داشت).
 * رکورد «paid» هرگز به وضعیت دیگری برنمی‌گردد؛ هر تلاش دوباره‌ی همان خرید (همان توکن) همان رکورد را به‌روز می‌کند.
 */
async function putStoreRec(env: Env, order: string, rec: PayRecord): Promise<void> {
  try {
    const exp = Math.floor(Date.now() / 1000) + (rec.state === "paid" ? TTL * 6 : TTL);
    await env.DB.prepare(
      "INSERT INTO kv (k, v, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp WHERE json_extract(kv.v,'$.state') <> 'paid'")
      .bind(`pay:${order}`, JSON.stringify(rec), exp).run();
  } catch (e) { console.error("putStoreRec", e); }
}

/** اجرای تاییدکننده‌ی فروشگاه + ثبت نتیجه (موفق یا هر دلیل رد). خطای غیرمنتظره هم به پاسخ 500 قابل‌تلاش‌مجدد تبدیل می‌شود تا اپ دوباره امتحان کند. */
async function trackStore(env: Env, user: WebUser, tag: StoreTag, b: Record<string, unknown> | null, run: () => Promise<Response>): Promise<Response> {
  const t0 = Date.now();
  const productId = String(b?.productId ?? "");
  console.log(`${STORE_NAME[tag]} verify request`, user.id, productId);
  let res: Response;
  try { res = await run(); }
  catch (e) {
    console.error(`${STORE_NAME[tag]} verify crash`, user.id, productId, e);
    res = json({ error: "خطای موقت سرور؛ چند لحظه بعد دوباره امتحان کن (خرید شما از بین نمی‌رود)." }, 500);
  }
  try {
    const token = String(b?.purchaseToken ?? "");
    const plan = PLANS.find((p) => `plan_${p.id}` === productId);
    const d = (await res.clone().json().catch(() => null)) as { error?: string } | null;
    const order = `${tag}${(await sha256hex(token)).slice(0, 24)}`;
    const base = { uid: user.id, plan: plan?.id, count: plan?.credits ?? 0, amount: plan ? plan.price * 10_000 : 0, toman: plan ? plan.price * 1000 : 0, order, t: Date.now() };
    if (res.ok) {
      await putStoreRec(env, order, { ...base, state: "paid" });
    } else {
      const msg = String(d?.error ?? "").replace(/\s+/g, " ").slice(0, 40);
      console.error(`${STORE_NAME[tag]} verify rejected`, JSON.stringify({ uid: user.id, sku: productId, status: res.status, ms: Date.now() - t0, err: msg }));
      await putStoreRec(env, order, { ...base, state: "pending", issue: `${tag}:${res.status}:${msg}`, it: Date.now() });
    }
  } catch (e) { console.error("trackStore", e); }
  return res;
}

/**
 * مصرف خرید از سمت سرور (API توسعه‌دهندگان بازار: POST consume/<package>/purchases/ با بدنه‌ی {"token"}).
 * بعد از فعال‌سازی پلن صدا زده می‌شود تا حتی اگر اپ نتواند خرید را مصرف کند، خرید روی حساب بازار کاربر گیر نکند و دوباره قابل خرید باشد.
 * خطا بی‌اثر است (اپ هم خودش مصرف می‌کند)؛ «قبلاً مصرف شده» موفق حساب می‌شود.
 */
async function bzConsume(env: Env, token: string, retry = true): Promise<boolean> {
  try {
    const at = await bzToken(env, !retry);
    if (!at) return false;
    const r = await fetch(`${BZ_API}/api/consume/${encodeURIComponent(bzCfg(env).pkg)}/purchases/?access_token=${encodeURIComponent(at)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 401 && retry) return bzConsume(env, token, false);
    if (r.ok) return true;
    const d = (await r.json().catch(() => null)) as { error?: string } | null;
    if (d?.error === "already_consumed") return true;
    console.error("bazaar consume failed", r.status, JSON.stringify(d).slice(0, 200));
  } catch (e) { console.error("bazaar consume", e); }
  return false;
}

export const bazaarVerify = async (env: Env, user: WebUser, b: Record<string, unknown> | null) => {
  const res = await trackStore(env, user, "bz", b, () => bazaarVerifyRaw(env, user, b));
  if (res.ok) await bzConsume(env, String(b?.purchaseToken ?? ""));
  return res;
};
/**
 * مصرف خرید مایکت از سمت سرور (PUT .../purchases/products/<sku>/tokens/<token>/consume با هدر X-Access-Token)؛ فقط وقتی MYKET_ACCESS_TOKEN
 * تنظیم شده و فقط بعد از فعال‌سازی پلن. «SkuAlreadyConsumed» موفق حساب می‌شود؛ هر خطای دیگر فقط لاگ می‌شود (اپ هم خودش مصرف می‌کند).
 */
async function mkConsume(env: Env, sku: string, packed: string): Promise<boolean> {
  const at = (env.MYKET_ACCESS_TOKEN ?? "").trim();
  if (!at) return false;
  try {
    const d = JSON.parse((JSON.parse(packed) as { j?: string }).j ?? "{}") as Record<string, unknown>;
    const token = String(d.purchaseToken ?? d.token ?? d.orderId ?? "");
    if (!token) return false;
    const r = await fetch(`https://developer.myket.ir/api/partners/applications/${encodeURIComponent(bzCfg(env).pkg)}/purchases/products/${encodeURIComponent(sku)}/tokens/${encodeURIComponent(token)}/consume`, {
      method: "PUT",
      headers: { "X-Access-Token": at },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) return true;
    const e = (await r.json().catch(() => null)) as { messageCode?: string } | null;
    if (e?.messageCode === "SkuAlreadyConsumed") return true;
    console.error("myket consume failed", r.status, JSON.stringify(e).slice(0, 200));
  } catch (e) { console.error("myket consume", e); }
  return false;
}

export const myketVerify = async (env: Env, user: WebUser, b: Record<string, unknown> | null) => {
  const res = await trackStore(env, user, "mk", b, () => myketVerifyRaw(env, user, b));
  if (res.ok) await mkConsume(env, String(b?.productId ?? ""), String(b?.purchaseToken ?? ""));
  return res;
};

/**
 * POST /api/app/pay-report { store, code, msg?, sku?, v? } — خطای سمت اپ که هیچ‌وقت به سرور نمی‌رسید
 * (نبودن اتصال به بازار، شروع‌نشدن صفحه‌ی پرداخت، رد شدن خرید توسط بازار، …). بدون ورود هم پذیرفته می‌شود و همیشه 200 برمی‌گرداند.
 */
export async function payReport(env: Env, user: WebUser | null, req: Request, ip: string): Promise<Response> {
  try {
    if (!/PptSazApp\//.test(req.headers.get("user-agent") ?? "")) return json({ ok: true });
    if (Number(req.headers.get("content-length") ?? 0) > 4_000) return json({ ok: true });
    if (await hitLimit(env, `payrep:${user?.id ?? ip}`, 40, 3600)) return json({ ok: true });
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const s = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, n);
    const tag: StoreTag = b?.store === "myket" ? "mk" : "bz";
    const code = s(b?.code, 30), msg = s(b?.msg, 60), sku = s(b?.sku, 30);
    if (!code) return json({ ok: true });
    const plan = PLANS.find((p) => `plan_${p.id}` === sku);
    const order = `${tag}app${Date.now()}${String(crypto.getRandomValues(new Uint32Array(1))[0] % 10_000).padStart(4, "0")}`;
    console.error(`${STORE_NAME[tag]} app report`, JSON.stringify({ uid: user?.id ?? "-", code, sku, msg, v: s(b?.v, 20) }));
    await putStoreRec(env, order, {
      uid: user?.id ?? "unknown", plan: plan?.id, count: plan?.credits ?? 0, amount: plan ? plan.price * 10_000 : 0, toman: plan ? plan.price * 1000 : 0, order,
      state: "failed", issue: `app:${code}${msg ? ":" + msg : ""}`.slice(0, 90), t: Date.now(),
    });
  } catch (e) { console.error("payReport", e); }
  return json({ ok: true });
}


// ---------- سیب‌اپ (اپ iOS، نسخه‌ی سیب‌اپ) ----------
/**
 * خرید درون‌برنامه‌ای سیب‌اپ (api.sibapp.net، هدر Secret-Key = توکن پنل توسعه‌دهندگان). هر پلن یک بسته‌ی «خریدنی» در پنل سیب‌اپ است.
 * جریان: اپ POST /api/pay/sibapp/start {plan} ← { url: "sibapp://package_purchase?package=<id>&developer_payload=<nonce>" } را باز می‌کند؛
 * سیب‌اپ بعد از خرید اسکیم اپ (pptsaz://?purchase_id=…) را باز می‌کند؛ اپ purchase_id را به POST /api/pay/sibapp می‌فرستد؛
 * سرور با GET /purchase/<id>/validate تایید می‌کند، پلن را فقط یک بار فعال می‌کند (کلید sbp:<sha256 شناسه>) و خرید را Consume می‌کند.
 * پاسخ Validate شناسه‌ی بسته ندارد؛ پلن از قیمت بسته (و nonce شروع خرید در developer_payload) مشخص می‌شود، نه از ادعای کلاینت.
 * متغیرها: SIBAPP_TOKEN (secret)، SIBAPP_PACKAGES مثل «plus:123,pro:456» (شناسه‌ی بسته‌ی هر پلن)، SIBAPP_APP_ID (اختیاری؛ اگر باشد با target.application.id مقایسه می‌شود).
 */
const SB_API = "https://api.sibapp.net/api/v1";
const sbToken = (env: Env) => (env.SIBAPP_TOKEN ?? "").trim();
export const sibappEnabled = (env: Env) => Boolean(sbToken(env)) && sbPackages(env).size > 0;
function sbPackages(env: Env): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (env.SIBAPP_PACKAGES ?? "").split(",")) {
    const [k, v] = part.split(":").map((x) => x.trim());
    if (k && v && PLANS.some((p) => p.id === k) && /^[\w-]{1,64}$/.test(v)) m.set(k, v);
  }
  return m;
}

/** POST /api/pay/sibapp/start { plan } → { ok, url } */
export async function sibappStart(env: Env, user: WebUser, b: Record<string, unknown> | null): Promise<Response> {
  if (!sibappEnabled(env)) return json({ error: "پرداخت از طریق سیب‌اپ هنوز فعال نشده است." }, 503);
  const plan = PLANS.find((p) => p.id === b?.plan);
  const pkg = plan ? sbPackages(env).get(plan.id) : undefined;
  if (!plan || !pkg) return json({ error: "پلن نامعتبر است." }, 400);
  if (await hitLimit(env, `sbrl:${user.id}`, 30, 3600)) return json({ error: "درخواست‌های زیاد بود؛ کمی بعد دوباره امتحان کن." }, 429);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  await env.KV.put(`sbn:${nonce}`, JSON.stringify({ uid: user.id, plan: plan.id }), { expirationTtl: 86_400 });
  return json({ ok: true, url: `sibapp://package_purchase?package=${encodeURIComponent(pkg)}&developer_payload=${nonce}` });
}

async function sbCall(env: Env, method: "GET" | "POST", path: string): Promise<{ status: number; data: any } | null> {
  const r = await fetch(`${SB_API}${path}`, { method, headers: { "content-type": "application/json", "secret-key": sbToken(env) }, signal: AbortSignal.timeout(20_000) })
    .catch((e) => { console.error("sibapp api", path.replace(/\/purchase\/[^/]+/, "/purchase/…"), e); return null; });
  if (!r) return null;
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function sibappVerifyRaw(env: Env, user: WebUser, b: Record<string, unknown> | null): Promise<Response> {
  if (!sibappEnabled(env)) return json({ error: "پرداخت از طریق سیب‌اپ هنوز فعال نشده است." }, 503);
  const purchaseId = String(b?.purchaseToken ?? "").trim();
  if (!/^[\w-]{4,100}$/.test(purchaseId)) return json({ error: "اطلاعات خرید نامعتبر است." }, 400);
  if (await hitLimit(env, `sbrl:${user.id}`, 30, 3600)) return json({ error: "درخواست‌های زیاد بود؛ کمی بعد دوباره امتحان کن." }, 429);

  const key = `sbp:${await sha256hex(purchaseId)}`;
  let planOf: Plan | undefined;
  const seen = async (): Promise<Response | null> => {
    const r = (await env.KV.get(key, "json")) as { uid?: string; plan?: string } | null;
    if (!r) return null;
    return r.uid === user.id ? json({ ok: true, plan: r.plan ?? planOf?.id, already: true }) : json({ error: "این خرید قبلاً برای حساب دیگری ثبت شده است." }, 409);
  };
  const dup = await seen();
  if (dup) return dup;

  const v = await sbCall(env, "GET", `/purchase/${encodeURIComponent(purchaseId)}/validate`);
  if (!v) return json({ error: "تایید خرید با سیب‌اپ ممکن نشد؛ چند دقیقه بعد دوباره امتحان کن (اپ را باز کنید؛ خرید شما از بین نمی‌رود)." }, 502);
  if (v.status === 404 || v.status === 400 || v.status === 403) { console.error("sibapp validate invalid", v.status, JSON.stringify(v.data).slice(0, 200)); return json({ error: "خرید در سیب‌اپ پیدا نشد." }, 400); }
  if (v.status < 200 || v.status >= 300) { console.error("sibapp validate failed", v.status, JSON.stringify(v.data).slice(0, 300)); return json({ error: "تایید خرید با سیب‌اپ ممکن نشد؛ چند دقیقه بعد دوباره امتحان کن (خرید شما از بین نمی‌رود)." }, 502); }
  const d = v.data as { id?: unknown; developer_payload?: unknown; target?: { price?: unknown; application?: { id?: unknown }; package?: { id?: unknown } } } | null;
  if (!d || String(d.id ?? "") !== purchaseId) { console.error("sibapp validate mismatch", JSON.stringify(d).slice(0, 200)); return json({ error: "خرید نامعتبر است." }, 400); }
  const appId = (env.SIBAPP_APP_ID ?? "").trim();
  if (appId && String(d.target?.application?.id ?? "") !== appId) return json({ error: "این خرید برای این برنامه نیست." }, 400);

  // پلن: از قیمت بسته (تومان یا ریال) و شناسه‌ی بسته اگر پاسخ داشت؛ nonce شروع خرید (اگر بود) باید برای همین کاربر و همین پلن باشد
  const price = Number(d.target?.price);
  const byPrice = PLANS.filter((p) => price === p.price * 1000 || price === p.price * 10_000);
  const pkgId = d.target?.package?.id != null ? String(d.target.package.id) : "";
  const byPkg = pkgId ? PLANS.filter((p) => sbPackages(env).get(p.id) === pkgId) : byPrice;
  const plan = byPrice.find((p) => byPkg.includes(p));
  if (!plan) { console.error("sibapp unknown package", price, pkgId); return json({ error: "این بسته مربوط به هیچ پلنی نیست." }, 400); }
  planOf = plan;
  const nonce = String(d.developer_payload ?? "");
  if (/^[0-9a-f]{32}$/.test(nonce)) {
    const n = (await env.KV.get(`sbn:${nonce}`, "json")) as { uid?: string; plan?: string } | null;
    if (n && (n.uid !== user.id || n.plan !== plan.id)) return json({ error: "این خرید برای حساب دیگری شروع شده است." }, 409);
  }

  return storeClaim(env, user, plan, `plan_${plan.id}`, key, purchaseId, "sibapp", seen);
}

export const sibappVerify = async (env: Env, user: WebUser, b: Record<string, unknown> | null) => {
  const b2 = { productId: "sibapp", purchaseToken: String(b?.purchaseId ?? b?.purchaseToken ?? "") };
  const res = await trackStore(env, user, "sb", b2, () => sibappVerifyRaw(env, user, b2));
  if (res.ok && b2.purchaseToken) {
    const c = await sbCall(env, "POST", `/purchase/${encodeURIComponent(b2.purchaseToken.trim())}/consume`);
    if (!c || c.status < 200 || c.status >= 300) console.error("sibapp consume failed", c?.status, JSON.stringify(c?.data).slice(0, 200)); // اپ/سرور بعداً هم می‌تواند دوباره تلاش کند؛ پلن فعال شده است
  }
  return res;
};
