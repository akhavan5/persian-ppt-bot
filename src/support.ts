// صفحه‌ی حمایت «یک قهوه مهمانم کن» (public/support.html) با درگاه نکس‌پال (NexPal IPG v1).
// جریان: POST /api/support/start ← create (token + payUrl) ← کاربر به payUrl می‌رود ← GET /api/support/callback?invoiceId&status ← verify (با token ذخیره‌شده) ← /support?thanks=1
// callback مرورگر فقط نشانه است؛ تایید نهایی با verify (و در صورت «already verified» با transaction) انجام می‌شود. مبلغ‌ها در سایت تومان و در نکس‌پال ریال‌اند (×۱۰).
// درگاه قبلی (آقای پرداخت) کامل در همین فایل مانده ولی استفاده نمی‌شود؛ فقط اگر SUPPORT_GATEWAY=aqaye تنظیم شود فعال می‌شود.
// بدون ورود به حساب کار می‌کند. رکورد sup:<invoiceId|transid>؛ پرداخت‌شده‌ها بدون انقضا نگه داشته می‌شوند.
import type { Env } from "./env";
import { hitLimit } from "./auth";

/** حداقل و حداکثر مبلغ حمایت (تومان)؛ باید با MIN در public/support.html یکی باشد */
const MIN = 10_000;
const MAX = 20_000_000;
export const BASE = "https://panel.aqayepardakht.ir";
export const TRANSID_RE =/^[A-Za-z0-9_-]{4,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TTL = 60 * 60 * 24 * 14;
const WALL_PAGE = 8;

interface SupRec { amount: number; name: string; note: string; hide: boolean; state: "pending" | "paid"; t: number; paidAt?: number; token?: string }

const jres = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** درگاه فعال صفحه‌ی حمایت: پیش‌فرض نکس‌پال؛ «aqaye» فقط با تنظیم صریح SUPPORT_GATEWAY (درگاه قبلی، استفاده‌نشده) */
const useAqaye = (env: Env) => (env.SUPPORT_GATEWAY ?? "").trim().toLowerCase() === "aqaye";
/** نکس‌پال: NEXPAL_API_KEY (فقط روی سرور)؛ NEXPAL_SANDBOX=1 برای محیط آزمایشی بدون پول واقعی */
const nexpalKey = (env: Env) => (env.NEXPAL_API_KEY ?? "").trim();
const nexpalSandbox = (env: Env) => /^(1|true|yes)$/i.test((env.NEXPAL_SANDBOX ?? "").trim());
export const supportEnabled = (env: Env) => (useAqaye(env) ? !!(env.AQAYE_PIN ?? "").trim() : !!nexpalKey(env));

/** ادعای اتمی: فقط یک درخواست «paid» می‌کند؛ رکورد پرداخت‌شده دیگر منقضی نمی‌شود */
async function markPaid(env: Env, id: string, rec: SupRec): Promise<void> {
  await env.KV.ready();
  await env.DB.prepare("UPDATE kv SET v=?2, exp=NULL WHERE k=?1 AND json_extract(v,'$.state') != 'paid'")
    .bind(`sup:${id}`, JSON.stringify({ ...rec, token: undefined, state: "paid", paidAt: Date.now() })).run();
}

// ───────────────────────── نکس‌پال (درگاه فعال) ─────────────────────────
const NP_BASE = "https://api.nexpal.io/v1/payment";
const INVOICE_RE = /^sup_[a-f0-9]{32}$/;
const rial = (toman: number) => toman * 10;

/** کدهای خطای create نکس‌پال (مستندات رسمی) */
const NP_ERR: Record<string, string> = {
  "13": "مبلغ نامعتبر است", "14": "شناسه فاکتور نامعتبر است", "15": "شماره موبایل نامعتبر است", "17": "کد ملی نامعتبر است",
  "18": "آدرس بازگشت با دامنه‌ی تاییدشده‌ی درگاه نمی‌خواند", "19": "شناسه فاکتور تکراری است", "20": "کلید تکراری است",
  "21": "ترمینال فعال پیدا نشد", "30": "کلید API معتبر نیست", "33": "خطای عمومی درگاه", "34": "اعتبار کارمزد درگاه کافی نیست",
};

interface NpRes { code?: number | string; message?: string; description?: string; token?: string; payUrl?: string; invoice?: string; invoiceId?: string; amount?: number | string }

/** apiKey فقط در بدنه‌ی درخواست سمت سرور می‌رود؛ null = خطای شبکه */
async function np(env: Env, path: "create" | "verify" | "transaction", body: Record<string, unknown>): Promise<{ http: number; d: NpRes | null } | null> {
  try {
    const r = await fetch(`${NP_BASE}${nexpalSandbox(env) ? "/sandbox" : ""}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ apiKey: nexpalKey(env), ...body }),
    });
    return { http: r.status, d: (await r.json().catch(() => null)) as NpRes | null };
  } catch (e) { console.error("nexpal", path, e); return null; }
}

async function startNexpal(env: Env, url: URL, b: Record<string, unknown> | null, amount: number, email: string, mobile: string): Promise<Response> {
  const name = clean(b?.name, 40), note = clean(b?.note, 200), hide = b?.hide === true;
  const invoiceId = `sup_${crypto.randomUUID().replace(/-/g, "")}`;
  const r = await np(env, "create", {
    idempotencyKey: invoiceId, amount: rial(amount), invoiceId,
    callbackUrl: `${url.origin}/api/support/callback`, description: "حمایت از پاورپوینت‌ساز",
    ...(email ? { email } : {}), ...(mobile ? { mobile } : {}),
  });
  const d = r?.d;
  const payUrl = typeof d?.payUrl === "string" && /^https:\/\//i.test(d.payUrl) ? d.payUrl : "";
  if (!r || Number(d?.code) !== 100 || typeof d?.token !== "string" || !d.token || !payUrl) {
    console.error("support create failed (nexpal)", r?.http, d?.code, nexpalSandbox(env) ? "sandbox" : "live");
    const why = d?.code != null ? NP_ERR[String(d.code)] ?? `کد ${d.code}` : "";
    return jres({ error: `ساخت تراکنش ممکن نشد${why ? ` (${why})` : ""}؛ دوباره امتحان کن.` }, 502);
  }
  const rec: SupRec = { amount, name, note, hide, state: "pending", t: Date.now(), token: d.token }; // token در callback نمی‌آید؛ فقط سمت سرور نگه داشته می‌شود
  await env.KV.put(`sup:${invoiceId}`, JSON.stringify(rec), { expirationTtl: TTL });
  return jres({ url: payUrl });
}

async function callbackNexpal(env: Env, url: URL, back: (q: string) => Response): Promise<Response> {
  const invoiceId = url.searchParams.get("invoiceId") ?? "";
  if (!INVOICE_RE.test(invoiceId)) return back("pay=fail");
  const rec = (await env.KV.get(`sup:${invoiceId}`, "json")) as SupRec | null;
  if (!rec) return back("pay=fail");
  if (rec.state === "paid") return back("thanks=1");
  if (url.searchParams.get("status") !== "true") return back("pay=cancel"); // انصراف/انقضا؛ verify لازم نیست
  const want = rial(rec.amount);
  const cb = Number(url.searchParams.get("amount"));
  if (!rec.token || (Number.isFinite(cb) && cb !== want)) return back("pay=fail");

  const same = (d: NpRes | null | undefined) => !!d && String(d.invoice ?? d.invoiceId) === invoiceId && Number(d.amount) === want;
  const v = await np(env, "verify", { token: rec.token });
  if (!v) return back("pay=error"); // خطای شبکه: رکورد pending می‌ماند و کاربر می‌تواند دوباره از لینک بانک برگردد
  let ok = Number(v.d?.code) === 100 && same(v.d);
  if (!ok && Number(v.d?.code) === 13) { // «already verified»: رفرش callback یا درخواست هم‌زمان ⇒ وضعیت را از استعلام می‌گیریم
    const t = await np(env, "transaction", { token: rec.token });
    if (!t) return back("pay=error");
    ok = (Number(t.d?.code) === 100 || Number(t.d?.code) === 200) && same(t.d);
    if (!ok && Number(t.d?.code) === 12) return back("pay=error"); // هنوز در حال تایید
  }
  if (!ok) { console.error("support verify failed (nexpal)", v.http, v.d?.code); return back("pay=fail"); }

  await markPaid(env, invoiceId, rec);
  console.log("support payment ok (nexpal)", invoiceId, rec.amount);
  return back("thanks=1");
}

// ───────────────────── آقای پرداخت (درگاه قبلی؛ استفاده نمی‌شود) ─────────────────────
export const isSandbox = (env: Env) => (env.AQAYE_PIN ?? "").trim() === "sandbox";

/** کدهای خطای create/verify آقای پرداخت (مستندات رسمی) */
export const AP_ERR: Record<string, string> = {
  "-1": "مبلغ خالی است", "-2": "کد پین درگاه خالی است", "-3": "آدرس callback خالی است", "-4": "مبلغ باید عددی باشد",
  "-5": "مبلغ باید بین ۱٬۰۰۰ تا ۴۰۰٬۰۰۰٬۰۰۰ تومان باشد", "-6": "کد پین درگاه اشتباه است", "-7": "transid خالی است",
  "-8": "تراکنش وجود ندارد", "-9": "پین با درگاه تراکنش نمی‌خواند", "-10": "مبلغ با تراکنش نمی‌خواند",
  "-11": "درگاه در انتظار تایید یا غیرفعال است", "-12": "ارسال درخواست برای این پذیرنده ممکن نیست", "-14": "درگاه روی سایت دیگری استفاده می‌شود",
  "-15": "دامنه‌ی callback با دامنه‌ی تاییدشده‌ی درگاه نمی‌خواند", "-16": "Referrer ارسال نشده است", "-17": "callback_method نامعتبر است",
};

export async function ap(env: Env, path: "create" | "verify", body: Record<string, unknown>, referer?: string): Promise<{ status: string; code: string; transid: string } | null> {
  try {
    const r = await fetch(`${BASE}/api/v2/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...(referer ? { referer } : {}) }, // آقای پرداخت بدون Referer خطای -16 می‌دهد
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

  if (!useAqaye(env)) return startNexpal(env, url, b, amount, email, mobile);

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
  if (!supportEnabled(env)) return back("pay=fail");
  if (!useAqaye(env)) return callbackNexpal(env, url, back);
  const transid = url.searchParams.get("transid") ?? "";
  if (!TRANSID_RE.test(transid)) return back("pay=fail");
  const rec = (await env.KV.get(`sup:${transid}`, "json")) as SupRec | null;
  if (!rec) return back("pay=fail");
  if (rec.state === "paid") return back("thanks=1");
  if (url.searchParams.get("status") !== "1") return back("pay=cancel"); // طبق مستند، status=0 یعنی ناموفق؛ verify لازم نیست

  const v = await ap(env, "verify", { amount: rec.amount, transid });
  if (!v) return back("pay=error"); // خطای شبکه: رکورد pending می‌ماند و کاربر می‌تواند دوباره از لینک بانک برگردد
  if (v.status !== "success" || v.code !== "1") return back("pay=fail");

  await markPaid(env, transid, rec);
  console.log("support payment ok", transid, rec.amount);
  return back("thanks=1");
}
