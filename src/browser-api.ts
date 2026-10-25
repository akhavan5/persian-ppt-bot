/**
 * مرورگر کلودفلر از طریق REST API حساب‌های دیگر (پشتیبان وقتی bindingِ BROWSER به سقف ۴۲۹ می‌خورد).
 * متغیر BROWSER_ACCOUNTS: هر خط (یا «;») یک حساب به شکل  ACCOUNT_ID|API_TOKEN
 * توکن باید دسترسی «Browser Rendering - Edit» (Browser Run - Edit) داشته باشد.
 * نکته: خواندن PDF اسکن‌شده (OCR) به اجرای اسکریپت داخل صفحه نیاز دارد و فقط با binding کار می‌کند.
 */
import type { Env } from "./env";

export interface BrowserAccount { id: string; token: string }

export function browserAccounts(env: Env): BrowserAccount[] {
  return String(env.BROWSER_ACCOUNTS ?? "")
    .split(/[\n;]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => { const i = l.indexOf("|"); return i > 0 ? { id: l.slice(0, i).trim(), token: l.slice(i + 1).trim() } : null; })
    .filter((a): a is BrowserAccount => !!a && !!a.id && !!a.token);
}

/** مرورگر در دسترس است؟ (binding یا حداقل یک حساب پشتیبان) */
export const hasBrowser = (env: Env) => !!env.BROWSER || browserAccounts(env).length > 0;
/** حساب پشتیبان تعریف شده؟ (برای اینکه با ۴۲۹ binding بی‌معطلی سراغ آن‌ها برویم) */
export const hasRemoteBrowser = (env: Env) => browserAccounts(env).length > 0;

/** binding برای PDF/پوستر استفاده شود؟ (BROWSER_MODE=api و وجود حساب پشتیبان ⇒ خیر) */
export const useBindingForRender = (env: Env) => !!env.BROWSER && !(String(env.BROWSER_MODE ?? "").trim().toLowerCase() === "api" && hasRemoteBrowser(env));

const BASES = ["browser-run", "browser-rendering"]; // نام جدید و قدیم مسیر API؛ اگر اولی ۴۰۴ داد دومی

/** فاصله‌ی دور تلاش مجدد وقتی همه‌ی حساب‌ها هم‌زمان ۴۲۹/۵xx/خطای شبکه بدهند (مثل تلاش مجدد قدیمیِ binding): ۴ دور در مجموع */
const ROUND_WAITS = [3000, 7000, 12000];

/** یک دور: همه‌ی حساب‌ها به ترتیب تصادفی؛ ۴۲۹/۵xx/خطای شبکه ⇒ حساب بعدی. null = همه رد شدند (retryable می‌گوید ارزش تلاش مجدد دارد) */
async function oneRound(accts: BrowserAccount[], endpoint: string, body: Record<string, unknown>): Promise<{ data?: Uint8Array; last: string; retryable: boolean }> {
  const start = Math.floor(Math.random() * accts.length);
  let last = "", retryable = false;
  for (let k = 0; k < accts.length; k++) {
    const a = accts[(start + k) % accts.length];
    for (const base of BASES) {
      try {
        const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${a.id}/${base}/${endpoint}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(100_000),
        });
        const ct = r.headers.get("content-type") ?? "";
        if (r.ok && !ct.includes("application/json")) return { data: new Uint8Array(await r.arrayBuffer()), last: "", retryable: false };
        const txt = (await r.text().catch(() => "")).slice(0, 300);
        last = `${a.id.slice(0, 6)}… ${r.status} ${txt}`;
        console.error("browser api", endpoint, last);
        if (r.status === 404 && base === BASES[0]) continue; // مسیر قدیمی را امتحان کن
        if (r.status === 400) throw new Error(`browser api 400: ${txt}`); // ورودی نامعتبر؛ حساب دیگر و تلاش مجدد فرقی نمی‌کند
        if (r.status === 429 || r.status >= 500) retryable = true;
        break; // ۴۲۹/۵xx/۴۰۱/۴۰۳ ⇒ حساب بعدی
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("browser api 400")) throw e;
        last = `${a.id.slice(0, 6)}… ${String(e instanceof Error ? e.message : e).slice(0, 200)}`;
        console.error("browser api", endpoint, last);
        retryable = true; // خطای شبکه/تایم‌اوت
        break;
      }
    }
  }
  return { last, retryable };
}

/** حساب‌ها را دور می‌زند؛ اگر همه‌ی حساب‌ها به‌خاطر محدودیت/خطای موقت رد شدند، با فاصله‌ی ۳، ۷ و ۱۲ ثانیه دوباره تلاش می‌کند. */
async function callAny(env: Env, endpoint: "pdf" | "screenshot", body: Record<string, unknown>): Promise<Uint8Array> {
  const accts = browserAccounts(env);
  if (!accts.length) throw new Error("BROWSER_ACCOUNTS تعریف نشده است");
  let last = "";
  for (let round = 0; ; round++) {
    const r = await oneRound(accts, endpoint, body);
    if (r.data) return r.data;
    last = r.last;
    if (!r.retryable || round >= ROUND_WAITS.length) break;
    await new Promise((res) => setTimeout(res, ROUND_WAITS[round]));
  }
  throw new Error(`همه‌ی حساب‌های مرورگر ناموفق بودند: ${last}`);
}

/** HTML ← PDF (همان گزینه‌های puppeteer: width/height/printBackground/preferCSSPageSize) */
export async function remotePdf(env: Env, html: string, o: { width: string; height: string }): Promise<Uint8Array> {
  const base = { html, gotoOptions: { waitUntil: "networkidle0", timeout: 40_000 } };
  try {
    return await callAny(env, "pdf", { ...base, pdfOptions: { width: o.width, height: o.height, printBackground: true, preferCSSPageSize: true } });
  } catch (e) {
    if (!String(e instanceof Error ? e.message : e).startsWith("browser api 400")) throw e;
    return await callAny(env, "pdf", { ...base, pdfOptions: { printBackground: true, preferCSSPageSize: true } }); // اگر width/height پذیرفته نشد، اندازه از CSS صفحه
  }
}

/** HTML ← تصویر تمام‌صفحه */
export async function remoteScreenshot(env: Env, html: string, o: { width: number; scale: number; type: "png" | "jpeg"; quality?: number }): Promise<Uint8Array> {
  return await callAny(env, "screenshot", {
    html,
    viewport: { width: o.width, height: 900, deviceScaleFactor: o.scale },
    screenshotOptions: { fullPage: true, type: o.type, ...(o.type === "jpeg" ? { quality: o.quality ?? 92 } : {}) },
    gotoOptions: { waitUntil: "networkidle0", timeout: 40_000 },
  });
}
