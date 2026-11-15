// صفحه‌ی حمایت «یک قهوه مهمانم کن» (public/support.html) با درگاه آقای پرداخت (API v2).
// جریان: POST /api/support/start ← create ← کاربر به startpay می‌رود ← GET /api/support/callback ← verify ← /support?thanks=n
// بدون ورود به حساب کار می‌کند. رکورد sup:<transid>؛ پرداخت‌شده‌ها بدون انقضا نگه داشته می‌شوند.
import type { Env } from "./env";
import { hitLimit } from "./auth";

/** حداقل و حداکثر مبلغ حمایت (تومان)؛ باید با MIN در public/support.html یکی باشد */
const MIN = 10_000;
const MAX = 20_000_000;
const BASE = "https://panel.aqayepardakht.ir";
const TRANSID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TTL = 60 * 60 * 24 * 14;
const WALL_PAGE = 8;

interface SupRec { amount: number; name: string; note: string; hide: boolean; state: "pending" | "paid"; t: number; paidAt?: number }

const jres = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** pin = کد پین درگاه؛ مقدار «sandbox» برای آزمایش (بدون پول واقعی) */
export const supportEnabled = (env: Env) => !!(env.AQAYE_PIN ?? "").trim();
const isSandbox = (env: Env) => (env.AQAYE_PIN ?? "").trim() === "sandbox";

/** کدهای خطای create/verify آقای پرداخت (مستندات رسمی) */
const AP_ERR: Record<string, string> = {
  "-1": "مبلغ خالی است", "-2": "کد پین درگاه خالی است", "-3": "آدرس callback خالی است", "-4": "مبلغ باید عددی باشد",
  "-5": "مبلغ باید بین ۱٬۰۰۰ تا ۴۰۰٬۰۰۰٬۰۰۰ تومان باشد", "-6": "کد پین درگاه اشتباه است", "-7": "transid خالی است",
  "-8": "تراکنش وجود ندارد", "-9": "پین با درگاه تراکنش نمی‌خواند", "-10": "مبلغ با تراکنش نمی‌خواند",
  "-11": "درگاه در انتظار تایید یا غیرفعال است", "-12": "ارسال درخواست برای این پذیرنده ممکن نیست", "-14": "درگاه روی سایت دیگری استفاده می‌شود",
  "-15": "دامنه‌ی callback با دامنه‌ی تاییدشده‌ی درگاه نمی‌خواند", "-16": "Referrer ارسال نشده است", "-17": "callback_method نامعتبر است",
};

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

/** POST /api/support/start  { amount (تومان), name?, email?, mobile?, note?, hide? } → { url }
 *  ایمیل و موبایل فقط برای درگاه فرستاده می‌شوند و در رکورد ما ذخیره نمی‌شوند. */
export async function startSupport(env: Env, url: URL, req: Request, b: Record<string, unknown> | null): Promise<Response> {
  if (!supportEnabled(env)) return jres({ error: "پرداخت حمایتی هنوز فعال نشده است." }, 503);
  const amount = Math.round(Number(b?.amount));
  if (!Number.isFinite(amount) || amount < MIN || amount > MAX) return jres({ error: `مبلغ باید بین ${MIN.toLocaleString("fa-IR")} و ${MAX.toLocaleString("fa-IR")} تومان باشد.` }, 400);
  const email = clean(b?.email, 120).toLowerCase(), mobile = clean(b?.mobile, 11);
  if (email && !EMAIL_RE.test(email)) return jres({ error: "ایمیل واردشده معتبر نیست." }, 400);
  if (mobile && !/^09\d{9}$/.test(mobile)) return jres({ error: "شماره‌ی موبایل باید به شکل ۰۹۱۲۳۴۵۶۷۸۹ باشد." }, 400);
  const ip = req.headers.get("x-trusted-ip") ?? req.headers.get("cf-connecting-ip") ?? "unknown";
  if (await hitLimit(env, `suprl:${ip}`, 10, 3600)) return jres({ error: "درخواست‌ها زیاد بود؛ کمی بعد دوباره امتحان کن." }, 429);

  const name = clean(b?.name, 40), note = clean(b?.note, 200), hide = b?.hide === true;
  const r = await ap(env, "create", {
    amount, callback: `${url.origin}/api/support/callback`, callback_method: "GET",
    description: "حمایت از پاورپوینت‌ساز", ...(email ? { email } : {}), ...(mobile ? { mobile } : {}),
  });
  if (!r || r.status !== "success" || !TRANSID_RE.test(r.transid)) {
    console.error("support create failed", r?.status, r?.code, isSandbox(env) ? "sandbox" : "live");
    const why = r?.code ? AP_ERR[r.code] ?? `کد ${r.code}` : "";
    return jres({ error: `ساخت تراکنش ممکن نشد${why ? ` (${why})` : ""}؛ دوباره امتحان کن.` }, 502);
  }
  const rec: SupRec = { amount, name, note, hide, state: "pending", t: Date.now() };
  await env.KV.put(`sup:${r.transid}`, JSON.stringify(rec), { expirationTtl: TTL });
  return jres({ url: `${BASE}/startpay/${isSandbox(env) ? "sandbox/" : ""}${encodeURIComponent(r.transid)}` });
}

/** GET /api/support/wall?page=n — دیوار حامیان: فقط پرداخت‌شده‌ها، جدیدترین اول؛ فقط نام و پیام (نه مبلغ و تماس) */
export async function supportWall(env: Env, url: URL): Promise<Response> {
  await env.KV.ready();
  const page = Math.max(1, Math.min(500, Math.floor(Number(url.searchParams.get("page"))) || 1));
  const w = "FROM kv WHERE k >= ?1 AND k < ?2 AND json_extract(v,'$.state')='paid'";
  const lo = "sup:", hi = "sup:\u{10FFFF}";
  const total = Number((await env.DB.prepare(`SELECT COUNT(*) c ${w}`).bind(lo, hi).first<{ c: number | null }>())?.c ?? 0);
  const rs = (await env.DB.prepare(
    `SELECT json_extract(v,'$.name') n, json_extract(v,'$.note') m, json_extract(v,'$.hide') h ${w} ORDER BY json_extract(v,'$.paidAt') DESC LIMIT ?3 OFFSET ?4`,
  ).bind(lo, hi, WALL_PAGE, (page - 1) * WALL_PAGE).all<{ n: string | null; m: string | null; h: number | null }>()).results ?? [];
  const items = rs.map((r) => ({
    n: r.h || !r.n ? "یک حامی مهربان" : r.n,
    m: r.h ? "این حامی گرامی ترجیح داده است پیام خود را خصوصی نگه دارد. 🤝" : r.m || "ممنون از قهوه‌ات ☕",
  }));
  const res = jres({ items, page, pages: Math.max(1, Math.ceil(total / WALL_PAGE)), total });
  res.headers.set("cache-control", "public, max-age=30");
  return res;
}

/** GET /api/support/callback?transid=…&status=1|0 — بازگشت از درگاه؛ تایید با verify و ثبت دائمی */
export async function supportCallback(env: Env, url: URL): Promise<Response> {
  const back = (q: string) => new Response(null, { status: 303, headers: { location: `${url.origin}/support?${q}`, "cache-control": "no-store" } });
  const transid = url.searchParams.get("transid") ?? "";
  if (!supportEnabled(env) || !TRANSID_RE.test(transid)) return back("pay=fail");
  const rec = (await env.KV.get(`sup:${transid}`, "json")) as SupRec | null;
  if (!rec) return back("pay=fail");
  if (rec.state === "paid") return back("thanks=1");
  if (url.searchParams.get("status") !== "1") return back("pay=cancel"); // طبق مستند، status=0 یعنی ناموفق؛ verify لازم نیست

  const v = await ap(env, "verify", { amount: rec.amount, transid });
  if (!v) return back("pay=error"); // خطای شبکه: رکورد pending می‌ماند و کاربر می‌تواند دوباره از لینک بانک برگردد
  if (v.status !== "success" || v.code !== "1") return back("pay=fail");

  await env.KV.ready();
  // ادعای اتمی: فقط یک درخواست «paid» می‌کند؛ رکورد پرداخت‌شده دیگر منقضی نمی‌شود
  await env.DB.prepare("UPDATE kv SET v=?2, exp=NULL WHERE k=?1 AND json_extract(v,'$.state') != 'paid'")
    .bind(`sup:${transid}`, JSON.stringify({ ...rec, state: "paid", paidAt: Date.now() })).run();
  console.log("support payment ok", transid, rec.amount);
  return back("thanks=1");
}
