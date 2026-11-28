/**
 * آماده‌سازی متن فارسی برای خواندن با TTS (Gemini).
 * - عدد به حروف (مثل ۱۴۱ ⇒ «صد و چهل و یک»، ۲٫۵ ⇒ «دو ممیز پنج»، ۲۰٪ ⇒ «بیست درصد»)؛ مدل‌های TTS اعداد را بد می‌خوانند
 * - حذف نشانه‌های مارک‌دان، ایموجی، لینک و علائمی که خوانده می‌شوند یا لحن را خراب می‌کنند
 * - شکستن متن بلند به تکه‌های مناسب برای یک درخواست
 */
import { toEn } from "./util";
import type { Slide } from "./types";
import type { OutLang } from "./lang";

const ONES = ["صفر", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه", "ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
const TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
const HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
const SCALES = ["", "هزار", "میلیون", "میلیارد", "تریلیون", "کوادریلیون"];

function below1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else {
      const t = Math.floor(r / 10), o = r % 10;
      parts.push(o ? `${TENS[t]} و ${ONES[o]}` : TENS[t]);
    }
  }
  return parts.join(" و ");
}

const digitByDigit = (s: string) => s.split("").map((d) => ONES[Number(d)]).join(" ");

/** رشته‌ی ارقام لاتین ⇒ حروف. شماره‌های بلند یا با صفر ابتدایی (مثل موبایل) رقم‌به‌رقم خوانده می‌شوند. */
export function intToWords(digits: string): string {
  if (!/^\d+$/.test(digits)) return digits;
  if ((digits.length > 1 && digits[0] === "0") || digits.length > 15) return digitByDigit(digits);
  let n = BigInt(digits);
  if (n === 0n) return ONES[0];
  const groups: number[] = [];
  while (n > 0n) { groups.push(Number(n % 1000n)); n /= 1000n; }
  const out: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    if (i === 1 && g === 1) out.push(SCALES[1]); // «هزار» نه «یک هزار»
    else out.push(i ? `${below1000(g)} ${SCALES[i]}` : below1000(g));
  }
  return out.join(" و ");
}

function decimalToWords(int: string, frac: string): string {
  const lead = frac.match(/^0*/)![0];
  const rest = frac.slice(lead.length);
  const fracWords = [...lead].map(() => ONES[0]).concat(rest ? [intToWords(rest)] : []).join(" ");
  return `${intToWords(int)} ممیز ${fracWords}`;
}

/** همه‌ی ارقام (فارسی/عربی/لاتین) در متن به حروف فارسی تبدیل می‌شوند. */
export function numbersToWords(text: string): string {
  let t = toEn(text).replace(/٫/g, ".").replace(/٬/g, ",");
  t = t.replace(/\d{1,3}(?:,\d{3})+(?!\d)/g, (m) => m.replace(/,/g, "")); // ۱٬۲۰۰٬۰۰۰ ⇒ ۱۲۰۰۰۰۰
  t = t.replace(/(\d+(?:\.\d+)?)\s*[%٪]/g, (_, n: string) => `${n} درصد`);
  t = t.replace(/(\d+)\/(?=\d)/g, "$1 "); // ۱۴۰۳/۰۵/۱۲ ⇒ اعداد جدا
  t = t.replace(/(\d+)\.(\d+)/g, (_, a: string, b: string) => decimalToWords(a, b));
  t = t.replace(/\d+/g, (m) => intToWords(m));
  return t;
}

/** پاک‌سازی نشانه‌ها و تبدیل عدد؛ خروجی آماده‌ی خواندن است. */
// ---------- انگلیسی: عدد به حروف ----------
const EN_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const EN_SCALES = ["", "thousand", "million", "billion", "trillion"];
const enBelow1000 = (n: number): string => {
  const out: string[] = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) out.push(`${EN_ONES[h]} hundred`);
  if (r) out.push(r < 20 ? EN_ONES[r] : EN_TENS[Math.floor(r / 10)] + (r % 10 ? `-${EN_ONES[r % 10]}` : ""));
  return out.join(" ");
};
export function intToWordsEn(digits: string): string {
  if (!/^\d+$/.test(digits)) return digits;
  if ((digits.length > 1 && digits[0] === "0") || digits.length > 15) return digits.split("").map((d) => EN_ONES[Number(d)]).join(" ");
  let n = BigInt(digits);
  if (n === 0n) return EN_ONES[0];
  const groups: number[] = [];
  while (n > 0n) { groups.push(Number(n % 1000n)); n /= 1000n; }
  const out: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) if (groups[i]) out.push(i ? `${enBelow1000(groups[i])} ${EN_SCALES[i]}` : enBelow1000(groups[i]));
  return out.join(" ");
}
/** همه‌ی ارقام متن انگلیسی به حروف (۲٫۵ ⇒ two point five، ۲۰٪ ⇒ twenty percent) */
export function numbersToWordsEn(text: string): string {
  let t = toEn(text).replace(/٫/g, ".").replace(/٬/g, ",");
  t = t.replace(/\d{1,3}(?:,\d{3})+(?!\d)/g, (m) => m.replace(/,/g, ""));
  t = t.replace(/(\d+(?:\.\d+)?)\s*[%٪]/g, (_, n: string) => `${n} percent`);
  t = t.replace(/(\d+)\.(\d+)/g, (_, i: string, f: string) => `${intToWordsEn(i)} point ${f.split("").map((d) => EN_ONES[Number(d)]).join(" ")}`);
  return t.replace(/\d+/g, (m) => intToWordsEn(m));
}

export function prepareSpeech(raw: string, lang?: OutLang): string {
  const en = lang === "en";
  let t = String(raw ?? "");
  t = t.replace(/https?:\/\/\S+/gi, " ").replace(/\bwww\.\S+/gi, " ");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // مارک‌دان: عکس و لینک
  t = t.replace(/^[ \t]*(?:#{1,6}|[-*•●▪◦>])\s+/gm, ""); // سرفصل و بولت ابتدای خط
  t = t.replace(/[*_`~#|]+/g, " ");
  t = t.replace(/[\p{Extended_Pictographic}️‍]/gu, " ");
  t = t.replace(/[→←↔⇒⇐▶◀■□★☆✓✔✗✘]/g, " ");
  t = t.replace(/&/g, en ? " and " : " و ").replace(/\s*[(){}\[\]«»"]\s*/g, en ? ", " : "، "); // پرانتز و گیومه ⇒ مکث کوتاه
  t = en ? numbersToWordsEn(t) : numbersToWords(t);
  t = t.replace(/\.{3,}|…/g, "...").replace(/[،,]\s*(?=[،,.؟?!])/g, "").replace(/(?:،\s*){2,}/g, "، ");
  t = t.replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, ". ").replace(/\.\s*\./g, ".").replace(/^[\s،.]+/, "").trim();
  if (t && !/[.!؟?…]$/.test(t)) t += ".";
  return t;
}

/** تقسیم به تکه‌های حداکثر max نویسه در مرز جمله (جمله‌ی خیلی بلند روی ویرگول/فاصله شکسته می‌شود). */
export function splitSpeech(text: string, max = 1200): string[] {
  const sentences = text.split(/(?<=[.!؟?…])\s+/).map((s) => s.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) { pieces.push(s); continue; }
    let rest = s;
    while (rest.length > max) {
      let cut = Math.max(rest.lastIndexOf("،", max), rest.lastIndexOf(" ", max));
      if (cut < max / 2) cut = max;
      pieces.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) pieces.push(rest);
  }
  const out: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (cur && cur.length + 1 + p.length > max) { out.push(cur); cur = p; }
    else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

/** متنی که برای اسلاید خوانده می‌شود: یادداشت سخنرانی؛ اگر نبود عنوان + نکته‌ها. اسلاید منابع بدون یادداشت خوانده نمی‌شود. */
export function narrationFor(s: Slide): string {
  const notes = prepareSpeech(s.notes ?? "");
  if (notes.length >= 25) return notes;
  if (s.layout === "sources") return "";
  const body = [s.title, s.subtitle, ...(s.bullets ?? []), ...(s.columns ?? []).flatMap((c) => [c.heading, ...c.bullets]), ...(s.steps ?? []).map((x) => `${x.label}. ${x.text}`), ...(s.items ?? []).map((x) => `${x.heading}. ${x.text}`)]
    .filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim().replace(/[.!؟?،:]+$/, "")).join(". ");
  return prepareSpeech(body);
}
