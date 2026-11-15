// صفحه‌ی حمایت «یک قهوه مهمانم کن» (public/support.html) با درگاه آقای پرداخت (API v2).
// جریان: POST /api/support/start ← create ← کاربر به startpay می‌رود ← GET /api/support/callback ← verify ← /support?thanks=n
// بدون ورود به حساب کار می‌کند. رکورد sup:<transid>؛ پرداخت‌شده‌ها بدون انقضا نگه داشته می‌شوند.
import type { Env } from "./env";
import { hitLimit } from "./auth";

/** قیمت هر قهوه (تومان)؛ باید با PRICE در public/support.html یکی باشد */
const PRICE = 50_000;
const MAX_COFFEES = 50;
const BASE = "https://panel.aqayepardakht.ir";
const TRANSID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const TTL = 60 * 60 * 24 * 14;

interface SupRec { coffees: number; amount: number; name: string; note: string; state: "pending" | "paid"; t: number }

const jres = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** pin = کد پین درگاه؛ مقدار «sandbox» برای آزمایش (بدون پول واقعی) */
export const supportEnabled = (env: Env) => !!(env.AQAYE_PIN ?? "").trim();
const isSandbox = (env: Env) => (env.AQAYE_PIN ?? "").trim() === "sandbox";

async function ap(env: Env, path: "create" | "verify", body: Record<string, unknown>): Promise<{ status: string; code: string; transid: string } | null> {
  try {
    const r = await fetch(`${BASE}/api/v2/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ pin: (env.AQAYE_PIN ?? "").trim(), ...body }),
    });
    const d = (await r.json().catch(() => null)) as { status?: string; code?: string | number; transid?: string | number } | null;
    if (!d) return null;
    return { status: String(d.status ?? ""), code: String(d.code ?? ""), transid: String(d.transid ?? "") };
  } catch (e) { console.error("aqayepardakht", path, e); return null; }
}

/** POST /api/support/start  { coffees, name?, note? } → { url } */
export async function startSupport(env: Env, url: URL, req: Request, b: Record<string, unknown> | null): Promise<Response> {
  if (!supportEnabled(env)) return jres({ error: "پرداخت حمایتی هنوز فعال نشده است." }, 503);
  const coffees = Math.round(Number(b?.coffees));
  if (!Number.isFinite(coffees) || coffees < 1 || coffees > MAX_COFFEES) return jres({ error: `تعداد قهوه باید بین ۱ تا ${MAX_COFFEES} باشد.` }, 400);
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (await hitLimit(env, `suprl:${ip}`, 10, 3600)) return jres({ error: "درخواست‌ها زیاد بود؛ کمی بعد دوباره امتحان کن." }, 429);

  const amount = coffees * PRICE;
  const name = clean(b?.name, 40), note = clean(b?.note, 140);
  const r = await ap(env, "create", {
    amount, callback: `${url.origin}/api/support/callback`, callback_method: "GET",
    description: `حمایت پاورپوینت‌ساز — ${coffees} قهوه`,
  });
  if (!r || r.status !== "success" || !TRANSID_RE.test(r.transid)) {
    console.error("support create failed", r?.status, r?.code);
    return jres({ error: "ساخت تراکنش ممکن نشد؛ چند لحظه بعد دوباره امتحان کن." }, 502);
  }
  const rec: SupRec = { coffees, amount, name, note, state: "pending", t: Date.now() };
  await env.KV.put(`sup:${r.transid}`, JSON.stringify(rec), { expirationTtl: TTL });
  return jres({ url: `${BASE}/startpay/${isSandbox(env) ? "sandbox/" : ""}${encodeURIComponent(r.transid)}` });
}

/** GET /api/support/callback?transid=…&status=1|0 — بازگشت از درگاه؛ تایید با verify و ثبت دائمی */
export async function supportCallback(env: Env, url: URL): Promise<Response> {
  const back = (q: string) => new Response(null, { status: 303, headers: { location: `${url.origin}/support?${q}`, "cache-control": "no-store" } });
  const transid = url.searchParams.get("transid") ?? "";
  if (!supportEnabled(env) || !TRANSID_RE.test(transid)) return back("pay=fail");
  const rec = (await env.KV.get(`sup:${transid}`, "json")) as SupRec | null;
  if (!rec) return back("pay=fail");
  if (rec.state === "paid") return back(`thanks=${rec.coffees}`);
  if (url.searchParams.get("status") !== "1") return back("pay=cancel"); // طبق مستند، status=0 یعنی ناموفق؛ verify لازم نیست

  const v = await ap(env, "verify", { amount: rec.amount, transid });
  if (!v) return back("pay=error"); // خطای شبکه: رکورد pending می‌ماند و کاربر می‌تواند دوباره از لینک بانک برگردد
  if (v.status !== "success" || v.code !== "1") return back("pay=fail");

  await env.KV.ready();
  // ادعای اتمی: فقط یک درخواست «paid» می‌کند؛ رکورد پرداخت‌شده دیگر منقضی نمی‌شود
  await env.DB.prepare("UPDATE kv SET v=?2, exp=NULL WHERE k=?1 AND json_extract(v,'$.state') != 'paid'")
    .bind(`sup:${transid}`, JSON.stringify({ ...rec, state: "paid", paidAt: Date.now() })).run();
  console.log("support payment ok", transid, rec.coffees);
  return back(`thanks=${rec.coffees}`);
}
