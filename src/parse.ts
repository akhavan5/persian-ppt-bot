/** تحلیل متن درخواست کاربر: تعداد اسلاید («۱۰ اسلاید»، «۵ الی ۶ اسلاید») و حالت («حالت دانشجویی»).
 *  اصل پایداری: فقط الگوهای لنگردار و بسته حذف می‌شوند؛ هر چیز دیگر در موضوع می‌ماند.
 *  - بازه فقط وقتی تعداد است که واژه‌ی «اسلاید/صفحه/slide» بلافاصله بعدش بیاید («جنگ ۱۹۱۴ تا ۱۹۱۸» دست‌نخورده می‌ماند).
 *  - حالت فقط با کلیدواژه‌ی «حالت/مود/سبک» + یکی از پنج نام حالت شناخته می‌شود («حالت‌های ماده» دست‌نخورده می‌ماند). */
import type { Mode } from "./types";
import { toEn } from "./util";

/** حروف اضافه/قیدهای آویزان کنار «عدد + اسلاید» («… در ۸ اسلاید»، «در قالب ۱۰ صفحه»، «حدود ۱۲ اسلاید») که بعد از حذف عدد در موضوع می‌مانند */
const DANGLING = "(?:(?:در\\s*)?قالب|به\\s*تعداد|با\\s*تعداد|در\\s*حد|به\\s*(?:صورت|\\u200c?صورت)|بصورت|حدود|تقریباً|تقریبا|حداکثر|حداقل|شامل|طی|تعداد|در|با|به|برای|و|تا|از|حتماً|حتما|in|with|within|for|of|using|to)";
const DANGLING_END = new RegExp(`(?:^|[\\s،,.:;\\-–—])${DANGLING}(?:[\\s،,.:;\\-–—]+${DANGLING})*[\\s،,.:;\\-–—]*$`, "iu");
const trimPunct = (t: string) => t.replace(/\s+/g, " ").replace(/^[\s،,.:;\-–—]+|[\s،,.:;\-–—]+$/g, "");

/** عدد به حروف («ده اسلایدی»، «دوازده اسلاید»، «بیست و پنج اسلاید») ⇒ رقم؛ فقط وقتی بلافاصله بعدش «اسلاید/صفحه» بیاید */
const WORD_VAL: Record<string, number> = { یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, شیش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15, شانزده: 16, هفده: 17, هجده: 18, نوزده: 19, بیست: 20, سی: 30, چهل: 40, پنجاه: 50 };
const ONES = "یک|دو|سه|چهار|پنج|شش|شیش|هفت|هشت|نه";
const WORD_NUM_RE = new RegExp(`(?<![\\p{L}\\p{N}])((?:بیست|سی|چهل|پنجاه)(?:\\s+و\\s+(?:${ONES}))?|یازده|دوازده|سیزده|چهارده|پانزده|شانزده|هفده|هجده|نوزده|${ONES}|ده)(?=\\s*(?:تا\\s*)?(?:اسلایدی|اسلاید|صفحه|slides?)(?![\\p{L}]))`, "giu");
const wordsToDigits = (t: string) => t.replace(WORD_NUM_RE, (w) => String(w.split(/\s+و\s+/).reduce((a, x) => a + (WORD_VAL[x] ?? 0), 0)));
/** «پنج الی شش اسلاید»: عدد حروفی اول بازه هم فقط وقتی رقم می‌شود که بعدش جداکننده‌ی بازه و عدد و «اسلاید» بیاید */
const RANGE_WORD_RE = new RegExp(`(?<![\\p{L}\\p{N}])(${ONES}|ده)(?=\\s*(?:الی|تا)\\s*(?:\\d{1,3}|${ONES}|ده)\\s*(?:اسلایدی|اسلاید|صفحه|slides?)(?![\\p{L}]))`, "giu");

/** «حالت دانشجویی»، «در حالت کسب‌وکار»، «مود معلم»، «سبک دفاع پایان‌نامه»: فقط با کلیدواژه + نام دقیق حالت */
const MODE_RE = /(?<![\p{L}\p{N}])(?:(?:در|با|به)\s+)?(?:حالت|مود|سبک)\s+(دانشجویی|کسب[‌\s]?و[‌\s]?کار|معلم|دفاع(?:\s+از)?(?:\s+پایان[‌\s]?نامه)?|عادی)(?![\p{L}\p{N}])/u;
function modeOf(name: string): Mode {
  const n = name.replace(/[‌\s]/g, "");
  return n.startsWith("دانشجو") ? "student" : n.startsWith("کسب") ? "business" : n.startsWith("معلم") ? "teacher" : n.startsWith("دفاع") ? "thesis" : "normal";
}

/** بازه‌ی اختیاری «۵ الی ۶ / ۵ تا ۶ / ۵-۶» + عدد + واحد؛ گروه ۱ = پیشوند بازه، ۲ = ابتدای بازه، ۳ = تعداد (بالاترین عدد)، ۴ = واحد */
const COUNT_RE = /(?<!\d)((\d{1,3})\s*(?:الی|تا|-|–|—|to)\s*)?(\d{1,3})\s*(?:تا\s*)?(اسلایدی|اسلاید|صفحه[‌\s]*ای|صفحه|slides?)/gi;

export interface ParsedRequest { topic: string; slides?: number; mode?: Mode }

export function parseRequest(text: string, clamp: (n: number) => number): ParsedRequest {
  let norm = wordsToDigits(toEn(text).replace(RANGE_WORD_RE, (w) => String(WORD_VAL[w.toLowerCase()] ?? w)));
  // ۱) حالت: فقط اگر بعد از حذفش موضوع معنادار بماند
  let mode: Mode | undefined;
  const mm = norm.match(MODE_RE);
  if (mm && mm.index !== undefined) {
    const rest = trimPunct(`${norm.slice(0, mm.index)} ${norm.slice(mm.index + mm[0].length)}`);
    if (rest.length >= 3) { mode = modeOf(mm[1]); norm = rest; }
  }
  // ۲) تعداد اسلاید
  // «اسلاید/slide» همیشه تعداد اسلاید است؛ «صفحه» فقط وقتی که متن از ارائه حرف بزند یا «… ۱۰ صفحه» آخر جمله باشد
  // (تا موضوع‌هایی مثل «طراحی وب‌سایت ۳ صفحه‌ای برای شرکت» دست‌نخورده بمانند)
  const isPpt = /ارائه|پاورپوینت|پرزنت|اسلاید|slide|presentation|ppt/i.test(norm);
  const all = [...norm.matchAll(COUNT_RE)];
  const m = all.find((x) => !/^صفحه/.test(x[4])) // «اسلاید» بر «صفحه» مقدم است
    ?? all.find((x) => isPpt || /^[\s،,.:;!؟?]*$/.test(norm.slice((x.index ?? 0) + x[0].length)));
  if (!m) return { topic: mode ? cleanTail(norm, text) : text.trim(), ...(mode ? { mode } : {}) };
  // بازه فقط وقتی معتبر است که ابتدا < انتها باشد؛ وگرنه پیشوند جزو موضوع می‌ماند
  const validRange = !!m[1] && Number(m[2]) < Number(m[3]);
  const start = (m.index ?? 0) + (m[1] && !validRange ? m[1].length : 0);
  const end = (m.index ?? 0) + m[0].length;
  let before = trimPunct(norm.slice(0, start));
  let after = trimPunct(norm.slice(end));
  // «پرستار و خانواده در ۸ اسلاید» ⇒ «در» هم حذف شود؛ فقط وقتی چیزی از موضوع باقی بماند
  const b2 = trimPunct(before.replace(DANGLING_END, ""));
  if (b2.length >= 3 || after.length >= 3) before = b2; // «حدود ۱۲ اسلاید درباره X» ⇒ «حدود» هم می‌رود (بخش بعدی موضوع را نگه می‌دارد)
  let topic = trimPunct(`${before} ${after}`);
  const t2 = trimPunct(topic.replace(DANGLING_END, "")); // مثلاً «… ۸ اسلاید با» ⇒ «با» آویزان در انتها
  if (t2.length >= 3) topic = t2;
  return { topic, slides: clamp(Number(m[3])), ...(mode ? { mode } : {}) }; // سقف پلن در beginDeck بررسی می‌شود
}

/** وقتی فقط حالت حذف شده: «با» و مانند آن که در انتها آویزان مانده پاک شود (اگر موضوع کوتاه نشود) */
function cleanTail(norm: string, original: string): string {
  const t = trimPunct(norm.replace(DANGLING_END, ""));
  return t.length >= 3 ? t : norm.length >= 3 ? norm : original.trim();
}
