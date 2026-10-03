/** درگاه پرداخت سیزپی (SizPay، API ساده: GetTokenSimple / ConfirmSimple) — فقط نسخه‌ی وب. پس از پرداخت موفق، اعتبار اضافه (bonus) به حساب کاربر افزوده می‌شود. */
import type { Env } from "./env";
import { getBonus, setBonus } from "./settings";
import { hitLimit, type WebUser } from "./auth";

/** price: هزار تومان */
export const PLANS = [
  { id: "p10", count: 10, price: 50 },
  { id: "p20", count: 20, price: 80 },
];

const API = "https://rt.sizpay.ir/api/PaymentSimple";
const ROUTE = "https://rt.sizpay.ir/Route/Payment";

interface SizKey { merchant: string; terminal: string; username: string; password: string }

/**
 * «کلید اصلی» سیزپی یک رشته‌ی تک‌پارچه است: نسخه (۲ حرف، مثل V0) و سپس چند بخش که هرکدام با طولش (۳ رقم) شروع می‌شود:
 *   ۱) Base64 از «کد پذیرنده (۱۵ رقم) + کد ترمینال»  ۲) نام کاربری  ۳) رمز عبور
 */
export function parseSizKey(raw: string | undefined): SizKey | null {
  const k = (raw ?? "").replace(/["'\s]/g, "");
  if (k.length < 20) return null;
  const parts: string[] = [];
  for (let i = 2; i < k.length;) {
    const n = Number(k.slice(i, i + 3));
    if (!Number.isInteger(n) || n <= 0 || i + 3 + n > k.length) return null;
    parts.push(k.slice(i + 3, i + 3 + n)); i += 3 + n;
  }
  if (parts.length < 3) return null;
  let ids: string;
  try { ids = atob(parts[0]); } catch { return null; }
  if (!/^\d{16,}$/.test(ids)) return null;
  return { merchant: ids.slice(0, 15), terminal: ids.slice(15), username: parts[1], password: parts[2] };
}
export const payEnabled = (env: Env) => parseSizKey(env.SIZPAY_KEY) !== null;

interface PayRecord { uid: string; count: number; amount: number; order: string; state: "pending" | "paid" | "failed"; t: number; ref?: string }
const TTL = 60 * 60 * 24 * 14;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function siz(endpoint: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${API}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return r.json().catch(() => null);
}
const ok = (code: unknown) => code === 0 || code === "0" || code === "00";

/** شماره‌ی سفارش عددی و یکتا (۱۳ رقم زمان + ۲ رقم تصادفی) */
const newOrderId = () => String(Date.now()) + String(Math.floor(Math.random() * 100)).padStart(2, "0");

/** POST /api/pay/start  { plan } → { url }  (کاربر باید وارد شده باشد) */
export async function startPayment(env: Env, url: URL, user: WebUser, b: Record<string, unknown> | null): Promise<Response> {
  const key = parseSizKey(env.SIZPAY_KEY);
  if (!key) return json({ error: "پرداخت آنلاین هنوز فعال نشده است." }, 503);
  const plan = PLANS.find((p) => p.id === b?.plan);
  if (!plan) return json({ error: "بسته‌ی انتخابی نامعتبر است." }, 400);
  if (await hitLimit(env, `payrl:${user.id}`, 20, 3600)) return json({ error: "تعداد درخواست پرداخت زیاد بود؛ کمی بعد دوباره امتحان کن." }, 429);

  const amount = plan.price * 1000 * 10; // تومان → ریال
  const order = newOrderId();
  const res = await siz("GetTokenSimple", {
    Username: key.username, Password: key.password, MerchantID: key.merchant, TerminalID: key.terminal,
    DocDate: "", ReturnURL: `${url.origin}/api/pay/callback`, ExtraInf: "",
    Amount: String(amount), OrderID: order, InvoiceNo: order,
    AppExtraInf: { PayerNm: user.name ?? "", PayerMobile: "", PayerEmail: user.email, Descr: `خرید ${plan.count} اعتبار ساخت پاورپوینت`, PayerIP: "", PayTitle: "" },
    SignData: "",
  }).catch((e) => { console.error("sizpay token", e); return null; });

  const token = res?.Token as string | undefined;
  if (!ok(res?.ResCod) || !token || !/^[A-Za-z0-9+/=_-]{6,200}$/.test(token)) {
    console.error("sizpay token failed", JSON.stringify({ c: res?.ResCod, m: res?.Message }).slice(0, 300));
    return json({ error: "اتصال به درگاه پرداخت ممکن نشد؛ چند دقیقه بعد دوباره امتحان کن." }, 502);
  }
  const rec: PayRecord = { uid: user.id, count: plan.count, amount, order, state: "pending", t: Date.now() };
  await env.KV.put(`pay:${token}`, JSON.stringify(rec), { expirationTtl: TTL });
  return json({ url: `/api/pay/go?t=${encodeURIComponent(token)}` });
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** GET /api/pay/go?t=توکن — صفحه‌ی کوچکی که کاربر را با POST به درگاه سیزپی می‌فرستد (درگاه فقط POST می‌پذیرد) */
export async function paymentGo(env: Env, url: URL): Promise<Response> {
  const key = parseSizKey(env.SIZPAY_KEY);
  const token = url.searchParams.get("t") ?? "";
  const rec = key && token ? ((await env.KV.get(`pay:${token}`, "json")) as PayRecord | null) : null;
  if (!key || !rec || rec.state !== "pending") return Response.redirect(`${url.origin}/?pay=fail`, 303);
  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>انتقال به درگاه پرداخت</title></head>
<body style="font-family:Tahoma,sans-serif;text-align:center;padding:60px 16px;color:#0f1b33">
<p>در حال انتقال به درگاه امن پرداخت…</p>
<form id="f" method="POST" action="${ROUTE}">
<input type="hidden" name="MerchantID" value="${esc(key.merchant)}"><input type="hidden" name="TerminalID" value="${esc(key.terminal)}"><input type="hidden" name="Token" value="${esc(token)}">
<noscript><button type="submit">ادامه به درگاه پرداخت</button></noscript>
</form>
<script>document.getElementById("f").submit()</script>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

/** POST /api/pay/callback — بازگشت کاربر از درگاه (ReturnURL، متد POST)؛ پرداخت را تایید (ConfirmSimple) و اعتبار را اضافه می‌کند */
export async function paymentCallback(env: Env, req: Request, url: URL): Promise<Response> {
  const go = (q: string) => Response.redirect(`${url.origin}/?${q}`, 303);
  const key = parseSizKey(env.SIZPAY_KEY);
  if (!key || req.method !== "POST") return go("pay=fail");

  const form = await req.formData().catch(() => null);
  const field = (n: string) => String(form?.get(n) ?? "");
  const token = field("Token");
  if (!/^[A-Za-z0-9+/=_-]{6,200}$/.test(token)) return go("pay=fail");

  const rec = (await env.KV.get(`pay:${token}`, "json")) as PayRecord | null;
  if (!rec) return go("pay=fail");
  if (rec.state === "paid") return go(`pay=ok&n=${rec.count}`);
  if (!ok(field("ResCod"))) {
    await env.KV.put(`pay:${token}`, JSON.stringify({ ...rec, state: "failed" }), { expirationTtl: TTL });
    return go("pay=cancel");
  }

  const res = await siz("ConfirmSimple", {
    UserName: key.username, Password: key.password, MerchantID: key.merchant, TerminalID: key.terminal, Token: token, SignData: "",
  }).catch((e) => { console.error("sizpay confirm", e); return null; });

  if (!res) return go("pay=error"); // خطای شبکه: وضعیت pending می‌ماند تا تایید دوباره
  const amountOk = res.Amount === undefined || res.Amount === null || Number(res.Amount) === rec.amount;
  const orderOk = res.OrderID === undefined || res.OrderID === null || String(res.OrderID) === rec.order;
  if (!ok(res.ResCod) || !amountOk || !orderOk) {
    console.error("sizpay confirm failed", JSON.stringify({ c: res.ResCod, m: res.Message, a: res.Amount, o: res.OrderID }).slice(0, 300));
    return go("pay=fail");
  }

  // ابتدا پرداخت‌شده علامت می‌خورد، بعد اعتبار اضافه می‌شود (جلوگیری از افزودن دوباره با رفرش)
  const fresh = (await env.KV.get(`pay:${token}`, "json")) as PayRecord | null;
  if (fresh?.state !== "paid") {
    await env.KV.put(`pay:${token}`, JSON.stringify({ ...rec, state: "paid", ref: String(res.RefNo ?? "") }), { expirationTtl: TTL * 6 });
    await setBonus(env, rec.uid, (await getBonus(env, rec.uid)) + rec.count);
    console.log("payment ok", rec.uid, rec.count, res.RefNo);
  }
  return go(`pay=ok&n=${rec.count}`);
}
