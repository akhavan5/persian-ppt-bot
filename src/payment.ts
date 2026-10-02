/** درگاه پرداخت زرین‌پال (API نسخه‌ی ۴) — فقط نسخه‌ی وب. پس از پرداخت موفق، اعتبار اضافه (bonus) به حساب کاربر افزوده می‌شود. */
import type { Env } from "./env";
import { getBonus, setBonus } from "./settings";
import { hitLimit, type WebUser } from "./auth";

/** price: هزار تومان */
export const PLANS = [
  { id: "p10", count: 10, price: 50 },
  { id: "p20", count: 20, price: 80 },
];

const ZP = "https://payment.zarinpal.com/pg/v4/payment";
export const payEnabled = (env: Env) => /^[0-9a-fA-F-]{36}$/.test(env.ZARINPAL_MERCHANT_ID ?? "");

interface PayRecord { uid: string; count: number; amount: number; state: "pending" | "paid" | "failed"; t: number; ref?: number }
const TTL = 60 * 60 * 24 * 14;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function zp(env: Env, endpoint: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${ZP}/${endpoint}.json`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ merchant_id: env.ZARINPAL_MERCHANT_ID, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  return r.json().catch(() => null);
}

/** POST /api/pay/start  { plan } → { url }  (کاربر باید وارد شده باشد) */
export async function startPayment(env: Env, url: URL, user: WebUser, b: Record<string, unknown> | null): Promise<Response> {
  if (!payEnabled(env)) return json({ error: "پرداخت آنلاین هنوز فعال نشده است." }, 503);
  const plan = PLANS.find((p) => p.id === b?.plan);
  if (!plan) return json({ error: "بسته‌ی انتخابی نامعتبر است." }, 400);
  if (await hitLimit(env, `payrl:${user.id}`, 20, 3600)) return json({ error: "تعداد درخواست پرداخت زیاد بود؛ کمی بعد دوباره امتحان کن." }, 429);

  const amount = plan.price * 1000 * 10; // تومان → ریال
  const res = await zp(env, "request", {
    amount,
    description: `خرید ${plan.count} اعتبار ساخت پاورپوینت`,
    callback_url: `${url.origin}/api/pay/callback`,
    metadata: { email: user.email },
  }).catch((e) => { console.error("zarinpal request", e); return null; });

  const authority = res?.data?.authority as string | undefined;
  if (res?.data?.code !== 100 || !authority) {
    console.error("zarinpal request failed", JSON.stringify(res?.errors ?? res).slice(0, 300));
    return json({ error: "اتصال به درگاه پرداخت ممکن نشد؛ چند دقیقه بعد دوباره امتحان کن." }, 502);
  }
  const rec: PayRecord = { uid: user.id, count: plan.count, amount, state: "pending", t: Date.now() };
  await env.KV.put(`pay:${authority}`, JSON.stringify(rec), { expirationTtl: TTL });
  return json({ url: `https://payment.zarinpal.com/pg/StartPay/${authority}` });
}

/** GET /api/pay/callback?Authority=…&Status=OK|NOK — بازگشت کاربر از درگاه؛ پرداخت را تایید (verify) و اعتبار را اضافه می‌کند */
export async function paymentCallback(env: Env, url: URL): Promise<Response> {
  const go = (q: string) => Response.redirect(`${url.origin}/?${q}`, 302);
  const authority = url.searchParams.get("Authority") ?? "";
  if (!/^[A-Za-z0-9]{10,64}$/.test(authority)) return go("pay=fail");

  const rec = (await env.KV.get(`pay:${authority}`, "json")) as PayRecord | null;
  if (!rec) return go("pay=fail");
  if (rec.state === "paid") return go(`pay=ok&n=${rec.count}`);
  if (url.searchParams.get("Status") !== "OK") {
    await env.KV.put(`pay:${authority}`, JSON.stringify({ ...rec, state: "failed" }), { expirationTtl: TTL });
    return go("pay=cancel");
  }

  const res = await zp(env, "verify", { amount: rec.amount, authority }).catch((e) => { console.error("zarinpal verify", e); return null; });
  const code = res?.data?.code;
  if (code !== 100 && code !== 101) {
    // خطای شبکه: وضعیت pending می‌ماند تا بازگشت دوباره‌ی کاربر (یا رفرش) دوباره تایید کند
    console.error("zarinpal verify failed", JSON.stringify(res?.errors ?? res).slice(0, 300));
    return go(code === undefined ? "pay=error" : "pay=fail");
  }

  // ابتدا پرداخت‌شده علامت می‌خورد، بعد اعتبار اضافه می‌شود (جلوگیری از افزودن دوباره با رفرش)
  const fresh = (await env.KV.get(`pay:${authority}`, "json")) as PayRecord | null;
  if (fresh?.state !== "paid") {
    await env.KV.put(`pay:${authority}`, JSON.stringify({ ...rec, state: "paid", ref: res.data.ref_id }), { expirationTtl: TTL * 6 });
    await setBonus(env, rec.uid, (await getBonus(env, rec.uid)) + rec.count);
    console.log("payment ok", rec.uid, rec.count, res.data.ref_id);
  }
  return go(`pay=ok&n=${rec.count}`);
}
