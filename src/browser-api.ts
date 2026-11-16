/**
 * مرورگر کلودفلر از طریق REST API حساب‌های دیگر (پشتیبان وقتی bindingِ BROWSER به سقف ۴۲۹ می‌خورد).
 * متغیر BROWSER_ACCOUNTS: هر خط (یا «;») یک حساب به شکل  ACCOUNT_ID|API_TOKEN
 * توکن باید دسترسی «Browser Rendering - Edit» (Browser Run - Edit) داشته باشد.
 * نکته: خواندن PDF اسکن‌شده (OCR) فقط با binding کار می‌کند؛ تبدیل WAV ← MP3 (remoteMp3) با /content + addScriptTag از راه همین حساب‌ها هم کار می‌کند.
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
async function oneRound(accts: BrowserAccount[], endpoint: string, body: Record<string, unknown>, json = false): Promise<{ data?: Uint8Array; last: string; retryable: boolean }> {
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
        if (r.ok && !json && !ct.includes("application/json")) return { data: new Uint8Array(await r.arrayBuffer()), last: "", retryable: false };
        if (r.ok && json) {
          // /content: پاسخ {success, result:"<html>"}؛ result را به بایت برمی‌گردانیم
          const t = await r.text();
          try { const j = JSON.parse(t); if (j?.success && typeof j.result === "string") return { data: new TextEncoder().encode(j.result), last: "", retryable: false }; } catch { /* خطای ساختار؛ پایین‌تر ثبت می‌شود */ }
          last = `${a.id.slice(0, 6)}… ${r.status} bad json ${t.slice(0, 200)}`;
          console.error("browser api", endpoint, last);
          retryable = true;
          break;
        }
        const txt = (await r.text().catch(() => "")).slice(0, 300);
        last = `${a.id.slice(0, 6)}… ${r.status} ${txt}`;
        console.error("browser api", endpoint, last);
        if (r.status === 404 && base === BASES[0]) continue; // مسیر قدیمی را امتحان کن
        if (r.status === 400) throw new Error(`browser api 400: ${txt}`); // ورودی نامعتبر؛ حساب دیگر و تلاش مجدد فرقی نمی‌کند
        if (r.status === 429 || r.status >= 500) retryable = true;
        break; // ۴۲۹/۵xx/۴۰۱/۴۰۳ ⇒ حساب بعدی
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("browser api 400")) throw e;
        // سقف زیردرخواست (سقف نرم subreq-meter): بقیه‌ی حساب‌ها و دورهای تلاش هم همین‌جا رد می‌شوند؛ بی‌صدا و فوری بالا بدهیم تا زنجیره‌ی صوتی به نمونه‌ی بعد برود
        if (/too many subrequests/i.test(String(e instanceof Error ? e.message : e))) throw e;
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
async function callAny(env: Env, endpoint: "pdf" | "screenshot" | "content", body: Record<string, unknown>): Promise<Uint8Array> {
  const accts = browserAccounts(env);
  if (!accts.length) throw new Error("BROWSER_ACCOUNTS تعریف نشده است");
  let last = "";
  for (let round = 0; ; round++) {
    const r = await oneRound(accts, endpoint, body, endpoint === "content");
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

/**
 * WAV ← MP3 از راه REST حساب‌های پشتیبان (بدون binding).
 * REST اتصال مستقیم puppeteer ندارد، پس PCM داخل HTML (یک <script type=text/plain>) و lamejs + اجراکننده با addScriptTag
 * به /content داده می‌شود؛ اسکریپت MP3 را base64 در <div id="fin"> می‌نویسد و از HTML رندرشده خوانده می‌شود.
 * هر فراخوانی یک تکه‌ی PCM است (فراخواننده تکه‌تکه می‌کند تا بدنه‌ی درخواست بزرگ نشود).
 */
const MP3_RUNNER = `(function(){
  var fin=function(ok,v){var d=document.createElement("div");d.id="fin";d.setAttribute("data-ok",ok?"1":"0");d.textContent=v;document.body.appendChild(d);};
  try{
    var el=document.getElementById("pcm"),b64=el.textContent.trim();el.remove();
    var P=JSON.parse(document.body.getAttribute("data-p"));
    var bin=atob(b64),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);b64="";bin="";
    var pcm=new Int16Array(u.buffer,0,Math.floor(u.length/2)),ch=P.ch,frames=Math.floor(pcm.length/ch);
    var enc=new lamejs.Mp3Encoder(ch,P.sr,P.kbps),out=[],total=0,BLOCK=1152*32;
    var keep=function(x){if(x.length){var c=new Uint8Array(x.buffer,x.byteOffset,x.length).slice();out.push(c);total+=c.length;}};
    for(var i=0;i<frames;i+=BLOCK){
      var end=Math.min(frames,i+BLOCK);
      if(ch===1)keep(enc.encodeBuffer(pcm.subarray(i,end)));
      else{var L=new Int16Array(end-i),R=new Int16Array(end-i);for(var x=0;x<end-i;x++){L[x]=pcm[(i+x)*2];R[x]=pcm[(i+x)*2+1];}keep(enc.encodeBuffer(L,R));}
    }
    keep(enc.flush());
    var res=new Uint8Array(total),o=0;for(var k=0;k<out.length;k++){res.set(out[k],o);o+=out[k].length;}
    var s="";for(var j=0;j<res.length;j+=0x8000)s+=String.fromCharCode.apply(null,res.subarray(j,j+0x8000));
    fin(true,btoa(s));
  }catch(e){fin(false,String(e&&e.message||e).slice(0,200));}
})();`;

export async function remoteMp3(env: Env, lameSrc: string, pcm: Uint8Array, o: { sampleRate: number; channels: number; kbps: number }): Promise<Uint8Array | null> {
  let b64 = "";
  for (let i = 0; i < pcm.length; i += 0x8000) b64 += String.fromCharCode(...pcm.subarray(i, i + 0x8000));
  b64 = btoa(b64);
  const html = `<!doctype html><html><body data-p='${JSON.stringify({ sr: o.sampleRate, ch: o.channels, kbps: o.kbps })}'><script id="pcm" type="text/plain">${b64}</script></body></html>`;
  const raw = await callAny(env, "content", {
    html,
    addScriptTag: [{ content: `${lameSrc}\n;\n${MP3_RUNNER}` }],
    waitForSelector: { selector: "#fin", timeout: 100_000 },
    gotoOptions: { waitUntil: "load", timeout: 40_000 },
    actionTimeout: 120_000,
  });
  const m = /<div id="fin" data-ok="([01])">([^<]*)<\/div>/.exec(new TextDecoder().decode(raw));
  if (!m || m[1] !== "1") { console.error("remote mp3", m ? m[2] : "no #fin"); return null; }
  const bin = atob(m[2]), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.length > 1000 && out[0] === 0xff ? out : null;
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
