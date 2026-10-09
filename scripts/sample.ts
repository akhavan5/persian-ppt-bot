// اجرا: npm run sample  → فایل sample.pptx در ریشه‌ی پروژه ساخته می‌شود (بدون نیاز به کلید API)
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { buildPptx } from "../src/pptx";
import type { Deck } from "../src/types";

const deck: Deck = {
  title: "هوش مصنوعی در آموزش",
  slides: [
    { layout: "title", title: "هوش مصنوعی در آموزش", subtitle: "فرصت‌ها، چالش‌ها و آینده", bullets: [], columns: [], stats: [], notes: "خوش‌آمدگویی و معرفی موضوع." },
    { layout: "bullets", title: "چرا این موضوع مهم است؟", bullets: ["یادگیری شخصی‌سازی‌شده برای هر دانش‌آموز", "صرفه‌جویی در زمان معلمان", "دسترسی بیشتر به منابع آموزشی", "بازخورد سریع‌تر به یادگیرندگان"], columns: [], stats: [], notes: "چهار دلیل اصلی." },
    { layout: "two_column", title: "فرصت‌ها و چالش‌ها", bullets: [], columns: [{ heading: "فرصت‌ها", bullets: ["آموزش تطبیقی", "ارزیابی خودکار"] }, { heading: "چالش‌ها", bullets: ["حریم خصوصی داده‌ها", "وابستگی بیش از حد"] }], stats: [], notes: "مقایسه." },
    { layout: "stats", title: "اعداد کلیدی (نمونه)", bullets: ["اعداد فقط نمونه‌اند"], columns: [], stats: [{ value: "24/7", label: "دسترسی همیشگی" }, { value: "3x", label: "سرعت بازخورد" }, { value: "100", label: "نمونه" }], notes: "" },
    { layout: "section", title: "بخش دوم: پیاده‌سازی", subtitle: "از ایده تا کلاس درس", bullets: [], columns: [], stats: [] },
    { layout: "closing", title: "با تشکر از توجه شما", subtitle: "پرسش و پاسخ", bullets: [], columns: [], stats: [] },
  ],
};

for (const theme of ["ocean", "midnight"]) {
  const t0 = performance.now();
  const bytes = await buildPptx(deck, { theme, font: "Vazirmatn", persianDigits: true,
    embed: [{ typeface: "Vazirmatn", regular: readFileSync("src/fonts/Vazirmatn-Regular.fntdata"), bold: readFileSync("src/fonts/Vazirmatn-Bold.fntdata") }] });
  console.log(theme, bytes.length, "bytes", (performance.now() - t0).toFixed(1), "ms");
  writeFileSync(theme === "ocean" ? "sample.pptx" : `sample-${theme}.pptx`, bytes);
}
