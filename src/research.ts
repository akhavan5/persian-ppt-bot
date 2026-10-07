/**
 * جستجوی آنلاین «پشت‌صحنه» برای ساخت ارائه (بدون هیچ تغییری در UI وب/تلگرام) — کاملاً رایگان.
 *
 * منابع (همه‌ی آن‌ها بدون هزینه؛ هر کدام جدا شکست بخورد بقیه ادامه می‌دهند):
 *   ۱) ویکی‌پدیای فارسی + انگلیسی (API رسمی، بدون کلید): چکیده‌ی مقاله‌های مرتبط — متن واقعی، نه فقط عنوان
 *   ۲) DuckDuckGo (نسخه‌ی HTML، بدون کلید): عنوان و خلاصه‌ی نتایج عمومی وب
 *   ۳) اختیاری: Tavily (۱۰۰۰ جستجوی رایگان در ماه) — فقط اگر TAVILY_API_KEY را در داشبورد کلودفلر بگذارید
 *
 * خروجی یک یادداشت کوتاه متنی است که فقط به پرامپت مدل اضافه می‌شود. هر خطا/خالی بودن ⇒ رشته‌ی خالی؛
 * یعنی جستجو هرگز ساخت ارائه را خراب یا کند نمی‌کند.
 *
 * متغیرهای اختیاری: WEB_SEARCH=off (خاموش کردن کامل)، TAVILY_API_KEY
 */
import type { Env } from "./env";

interface Hit { src: string; title: string; text: string; /** موتور جستجو: wiki-fa | wiki-en | ddg | tavily */ via: string }

const MAX_NOTES_CHARS = 4000;
const TIMEOUT_MS = 8_000;
const UA = "persian-ppt-bot/1.0 (+https://pptsaz.ir)";
const clean = (s: unknown, n: number) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim().slice(0, n);

export const searchEnabled = (env: Env) => !/^(off|0|false|no)$/i.test((env.WEB_SEARCH || "").trim());

/** ویکی‌پدیا: جستجوی متنی + چکیده‌ی مقاله‌ها در یک درخواست */
async function wikipedia(lang: "fa" | "en", query: string, limit: number): Promise<Hit[]> {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  const p: Record<string, string> = {
    action: "query", format: "json", formatversion: "2", generator: "search", gsrsearch: query.slice(0, 250), gsrlimit: String(limit),
    prop: "extracts", exintro: "1", explaintext: "1", exchars: "650", exlimit: String(limit),
  };
  for (const k in p) u.searchParams.set(k, p[k]);
  const r = await fetch(u, { headers: { "user-agent": UA, "api-user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`wikipedia ${lang} ${r.status}`);
  const pages = ((await r.json()) as any)?.query?.pages;
  if (!Array.isArray(pages)) return [];
  return pages
    .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
    .filter((x: any) => x?.extract)
    .map((x: any) => ({ src: `${lang}.wikipedia.org`, title: clean(x.title, 100), text: clean(x.extract, 650), via: `wiki-${lang}` }));
}

/** DuckDuckGo HTML (بدون کلید). ممکن است گاهی محدود شود؛ در آن صورت فقط نادیده گرفته می‌شود. */
async function duckduckgo(query: string, limit: number): Promise<Hit[]> {
  const r = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (compatible; persian-ppt-bot/1.0)", "accept-language": "fa,en;q=0.8" },
    body: new URLSearchParams({ q: query.slice(0, 300), ...(/آخرین|اخیر|جدید|امروز|latest|news/i.test(query) ? { df: "m" } : {}) }).toString(), // موضوع‌های «آخرین/اخیر»: فقط نتایج یک ماه گذشته
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`duckduckgo ${r.status}`);
  const html = await r.text();
  const out: Hit[] = [];
  const re = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < limit) {
    let host = "";
    try {
      const raw = m[1].startsWith("//") ? "https:" + m[1] : m[1];
      const link = new URL(raw);
      host = new URL(link.searchParams.get("uddg") || raw).hostname.replace(/^www\./, "");
    } catch { /* آدرس نامعتبر */ }
    const text = clean(m[3], 400);
    if (host && text) out.push({ src: host, title: clean(m[2], 110), text, via: "ddg" });
  }
  return out;
}

/** Tavily (اختیاری، سطح رایگان) */
async function tavily(env: Env, query: string, limit: number): Promise<Hit[]> {
  if (!env.TAVILY_API_KEY) return [];
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query: query.slice(0, 380), max_results: limit, search_depth: "basic" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`tavily ${r.status}`);
  const j = (await r.json()) as any;
  return (Array.isArray(j?.results) ? j.results : []).map((x: any) => {
    let host = ""; try { host = new URL(x.url).hostname.replace(/^www\./, ""); } catch { /* */ }
    return { src: host || "web", title: clean(x.title, 110), text: clean(x.content, 450), via: "tavily" };
  });
}

/** نرمال‌سازی فارسی: ی/ک عربی، نیم‌فاصله، اعراب، حروف بزرگ */
const norm = (s: string) => s.toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[\u064B-\u065F\u0640]/g, "").replace(/\u200c/g, " ");
const STOP = new Set(["و", "در", "به", "از", "که", "با", "برای", "این", "آن", "را", "یا", "درباره", "مورد", "ارائه", "پاورپوینت", "اسلاید", "دیدگاه", "دیدگاهها", "نگاه", "نظر", "نظرات", "استاد", "دکتر", "آقای", "بررسی", "تحلیل", "چیست", "چگونه", "آخرین", "وضعیت", "سناریو", "سناریوها", "سناریوی", "سناریوهای", "پیش", "رو", "روی", "پیشرو", "آینده", "تحولات", "چشم", "انداز", "اخیر", "جدید", "مورد", "بین", "the", "of", "and", "in", "to", "for", "a", "about", "presentation"]);
/** کلمه‌های معنادار پرسش */
const keyTokens = (q: string) => norm(q).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2 && !STOP.has(t));
/** نتایج بی‌ربط (جستجوی متنی ویکی‌پدیا/وب گاهی فقط یک کلمه‌ی مشترک دارند) حذف می‌شوند:
 *  دست‌کم بخش بزرگی از کلمه‌های موضوع باید در عنوان/متن بیاید (با چشم‌پوشی از فاصله و نیم‌فاصله: «رحیم‌پور» = «رحیم پور») */
function relevant(tokens: string[], h: Hit): boolean {
  if (BAD_HOSTS.test(h.src)) return false;
  if (!tokens.length) return true;
  const words = norm(`${h.title} ${h.text}`).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const bag = new Set(words);
  for (let i = 0; i + 1 < words.length; i++) bag.add(words[i] + words[i + 1]); // «رحیم‌پور» = «رحیم پور»
  const same = (t: string, w: string) => t === w || (t.length >= 4 && w.length >= 4 && (w.startsWith(t) || t.startsWith(w))); // ایران ~ ایرانی (بدون تطبیق وسط کلمه)
  const hit = tokens.filter((t) => { for (const w of bag) if (same(t.replace(/\s+/g, ""), w)) return true; return false; }).length;
  return hit >= Math.min(2, tokens.length) && hit / tokens.length >= (tokens.length <= 2 ? 1 : 0.6);
}
/** شبکه‌های اجتماعی/ویدیویی منبع مناسبی برای یادداشت پژوهشی نیستند */
const BAD_HOSTS = /(facebook|instagram|twitter|(^|\.)x\.com|t\.me|telegram|youtube|youtu\.be|tiktok|pinterest|aparat|eitaa|rubika)/i;

const safe = (name: string, p: Promise<Hit[]>): Promise<Hit[]> => p.catch((e) => { console.error("search", name, e instanceof Error ? e.message : e); return []; });

/** یادداشت پژوهشی درباره‌ی موضوع؛ در هر مشکلی "" */
export async function researchTopic(env: Env, topic: string): Promise<string> {
  if (!searchEnabled(env)) return "";
  try {
    const q = topic.replace(/^(یک\s+)?(ارائه|پاورپوینت|اسلاید)\s*(درباره(‌|\s)?ی|در مورد|پیرامون)?\s*/u, "").trim() || topic;
    const [wfa, wen, ddg, tav] = await Promise.all([
      safe("wiki-fa", wikipedia("fa", q, 3)),
      /[A-Za-z]{3}/.test(q) ? safe("wiki-en", wikipedia("en", q, 2)) : Promise.resolve([] as Hit[]), // پرسش کاملاً فارسی در ویکی انگلیسی نتیجه‌ی مفیدی ندارد
      safe("ddg", duckduckgo(q, 5)),
      safe("tavily", tavily(env, q, 5)),
    ]);
    // ترتیب اهمیت: Tavily/DDG (تازه‌تر) و ویکی‌پدیا (دقیق‌تر)؛ از هر منبع به‌نوبت برداشته می‌شود تا یکی بقیه را پر نکند
    const tokens = keyTokens(q);
    const raw = { "wiki-fa": wfa, tavily: tav, ddg, "wiki-en": wen };
    const lists = [wfa, tav, ddg, wen].map((l) => l.filter((h) => relevant(tokens, h)));
    // فقط در لاگ Worker (داشبورد کلودفلر ← Logs): هر منبع چند نتیجه آورد → چند تا ماند
    console.log("research", JSON.stringify(Object.fromEntries(Object.entries(raw).map(([k, v], i) => [k, `${v.length}→${lists[i].length}`]))), "q:", q.slice(0, 80));
    const lines: string[] = [];
    const seen = new Set<string>();
    let used = 0;
    for (let i = 0; used < MAX_NOTES_CHARS; i++) {
      let any = false;
      for (const l of lists) {
        const h = l[i];
        if (!h) continue;
        any = true;
        const key = (h.src + h.title).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const line = `- [${h.src} · ${h.via}] ${h.title}: ${h.text}`;
        if (used + line.length > MAX_NOTES_CHARS) continue;
        lines.push(line);
        console.log("research-hit", h.via, h.src, "|", h.title.slice(0, 90));
        used += line.length;
      }
      if (!any) break;
    }
    return lines.join("\n");
  } catch (e) {
    console.error("researchTopic", e instanceof Error ? e.message : e);
    return "";
  }
}
