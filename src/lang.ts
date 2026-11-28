/**
 * زبان خروجی (تنظیمات کاربر): فارسی (پیش‌فرض، راست‌به‌چپ) یا انگلیسی (چپ‌به‌راست).
 * روی همه‌ی خروجی‌ها اعمال می‌شود: محتوای اسلاید، PPTX، پیش‌نمایش/PDF، جزوه (DOCX)، اینفوگرافیک، روایت صوتی و پادکست.
 */
export type OutLang = "fa" | "en";
export const OUT_LANGS: readonly OutLang[] = ["fa", "en"];
export const DEFAULT_LANG: OutLang = "fa";
export const isOutLang = (v: unknown): v is OutLang => v === "fa" || v === "en";
export const normLang = (v: unknown): OutLang => (isOutLang(v) ? v : DEFAULT_LANG);

/** برچسب نمایشی (برای دکمه‌ها و پیام‌ها) */
export const LANG_LABEL: Record<OutLang, string> = { fa: "فارسی", en: "English" };
export const isRtl = (l?: OutLang) => normLang(l) === "fa";

export interface LangInfo {
  /** نام زبان در پرامپت */
  name: string;
  rtl: boolean;
  dir: "rtl" | "ltr";
  /** مقدار lang در HTML / OOXML */
  html: string;
  ooxml: string;
}
export const langInfo = (l?: OutLang): LangInfo =>
  normLang(l) === "en"
    ? { name: "English", rtl: false, dir: "ltr", html: "en", ooxml: "en-US" }
    : { name: "Persian", rtl: true, dir: "rtl", html: "fa", ooxml: "fa-IR" };

/**
 * پرامپت‌های پروژه برای فارسی نوشته شده‌اند. برای انگلیسی، واژه‌ی Persian در متن پرامپت با English عوض می‌شود
 * و یک دستور نهایی (که بر همه‌ی قواعد فارسی‌محور پیشی می‌گیرد) به انتهای پرامپت اضافه می‌شود.
 * برای فارسی متن بدون تغییر برمی‌گردد.
 */
export function forLang(prompt: string, lang?: OutLang): string {
  if (normLang(lang) !== "en") return prompt;
  const swapped = prompt.replace(/Persian \(Farsi\)/g, "English").replace(/Tehrani Persian/g, "natural English").replace(/Persian/g, "English").replace(/Farsi/g, "English");
  return swapped + LANG_EN_DIRECTIVE;
}

export const LANG_EN_DIRECTIVE =
  "\n\nOUTPUT LANGUAGE OVERRIDE (highest priority): write EVERY user-facing text value in natural, fluent ENGLISH (left-to-right), " +
  "including titles, bullets, notes, headings, labels, captions, spoken scripts and episode titles. Do NOT write Persian. " +
  "Any rule above that is specific to Persian (half-spaces/نیم‌فاصله, Persian digits, Tehrani colloquial verb forms, «را»/«رو», Persian examples, " +
  "Persian filler phrases) does not apply: use the natural English equivalent (for spoken scripts: relaxed, conversational English with contractions). " +
  "Write numbers in Latin digits (in spoken scripts, spell numbers out in words). If the topic or the source document is in Persian, " +
  "translate its content into English. JSON keys, enum values and fields documented as English stay exactly as specified.";

/** برای system prompt (جای «native Persian writer») */
export const systemFor = (system: string, lang?: OutLang): string =>
  normLang(lang) === "en"
    ? system.replace("a native Persian (Farsi) writer", "a native English writer")
        .replace(/Write natural, fluent Persian:[^"]*?(?=Bullets are short)/s, "Write natural, fluent English, no literal translation, no unnecessary jargon. ")
    : system;
