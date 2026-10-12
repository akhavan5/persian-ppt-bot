import { parseRequest } from "../src/parse";
import { searchQuery } from "../src/research";
const clamp = (n: number) => Math.min(35, Math.max(3, Math.round(n)));
type C = [string, string, number | undefined, string | undefined];
const cases: C[] = [
  // مورد گزارش‌شده
  ["هوش مصنوعی ۵ الی ۶ اسلاید حالت دانشجویی", "هوش مصنوعی", 6, "student"],
  ["هوش مصنوعی 5 تا 6 اسلاید در حالت دانشجویی", "هوش مصنوعی", 6, "student"],
  ["هوش مصنوعی ۵-۶ اسلاید", "هوش مصنوعی", 6, undefined],
  ["هوش مصنوعی پنج الی شش اسلاید", "هوش مصنوعی", 6, undefined],
  ["حالت کسب و کار هوش مصنوعی ۱۰ اسلاید", "هوش مصنوعی", 10, "business"],
  ["بازاریابی دیجیتال مود کسب‌وکار", "بازاریابی دیجیتال", undefined, "business"],
  ["فتوسنتز سبک معلم ۸ اسلاید", "فتوسنتز", 8, "teacher"],
  ["هوش مصنوعی حالت دفاع پایان‌نامه ۱۲ اسلاید", "هوش مصنوعی", 12, "thesis"],
  // رگرسیون: رفتار قبلی
  ["هوش مصنوعی در آموزش، ۱۰ اسلاید", "هوش مصنوعی در آموزش", 10, undefined],
  ["پرستار و خانواده در ۸ اسلاید", "پرستار و خانواده", 8, undefined],
  ["ده اسلایدی درباره انرژی خورشیدی", "درباره انرژی خورشیدی", 10, undefined],
  ["انرژی خورشیدی در قالب ۱۰ صفحه", "انرژی خورشیدی", 10, undefined],
  ["طراحی وب‌سایت ۳ صفحه‌ای برای شرکت", "طراحی وب‌سایت ۳ صفحه‌ای برای شرکت", undefined, undefined],
  ["هوش مصنوعی", "هوش مصنوعی", undefined, undefined],
  // خطرناک‌ها: نباید دست بخورند
  ["جنگ ۱۹۱۴ تا ۱۹۱۸", "جنگ ۱۹۱۴ تا ۱۹۱۸", undefined, undefined],
  ["جنگ ۱۹۱۴ تا ۱۹۱۸ در ۱۰ اسلاید", "جنگ ۱۹۱۴ تا ۱۹۱۸", 10, undefined],
  ["سال‌های ۵ تا ۱۰ زندگی کودک", "سال‌های ۵ تا ۱۰ زندگی کودک", undefined, undefined],
  ["حالت‌های ماده", "حالت‌های ماده", undefined, undefined],
  ["حالت فیزیکی ماده ۸ اسلاید", "حالت فیزیکی ماده", 8, undefined],
  ["حالت دانشجویی", "حالت دانشجویی", undefined, undefined], // چیزی از موضوع نمی‌ماند ⇒ حذف نمی‌شود
  ["رشد ۶ تا ۵ اسلاید", "رشد ۶", 5, undefined], // بازه‌ی نامعتبر
];
let bad = 0;
for (const [inp, topic, slides, mode] of cases) {
  const r = parseRequest(inp, clamp);
  const ok = r.topic === topic.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))) || r.topic === topic;
  const pass = ok && r.slides === slides && r.mode === mode;
  if (!pass) bad++;
  console.log(pass ? "PASS" : "FAIL", JSON.stringify(inp), "=>", JSON.stringify(r), pass ? "" : `expected ${JSON.stringify({ topic, slides, mode })}`);
}
for (const q of ["هوش مصنوعی ۵ الی ۶ اسلاید", "هوش مصنوعی 5 تا 6 اسلاید", "جنگ ۱۹۱۴ تا ۱۹۱۸"]) console.log("searchQuery", JSON.stringify(q), "=>", JSON.stringify(searchQuery(q)));
console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
