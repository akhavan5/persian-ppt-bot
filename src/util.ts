const FA = "۰۱۲۳۴۵۶۷۸۹";
const AR = "٠١٢٣٤٥٦٧٨٩";

export const toFa = (s: string) => s.replace(/[0-9]/g, (d) => FA[Number(d)]);

/** ارقام فارسی و عربی → لاتین */
export const toEn = (s: string) =>
  s.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));

/**
 * فرمول‌های لاتین (مثل u=(x-x₀)/h یا Pₙ(x)=f₀+uΔf₀+…) در متن راست‌به‌چپ:
 *  - ارقام داخل فرمول لاتین می‌مانند (نه ۲ و ۱ فارسی)
 *  - هر فرمول در یک «جزیره‌ی چپ‌به‌راست» قرار می‌گیرد تا ترتیب نویسه‌هایش وارونه نشود
 * بقیه‌ی متن مثل قبل (در صورت digits=true) ارقام فارسی می‌گیرد.
 * mode "isolate" = LRI/PDI (مرورگر/PDF)، "embed" = LRE/PDF (PowerPoint و Word؛ سازگارتر)
 */
const MATH_RUN = /[A-Za-z0-9۰-۹\u0370-\u03FF\u00B1\u00B2\u00B3\u00B7\u00B9\u00D7\u00F7\u2026\u2070-\u209F\u2190-\u22FF=+\-*\/^_!.,;:()[\]{}|<>% ]+/g;
const MATH_LEAD = /^(?:[\s.,;:?)\]}%]|[0-9۰-۹]+(?=\s))+/;
const MATH_TRAIL = /[\s.,;:?(\[{]+$/;
const HAS_LETTER = /[A-Za-z\u0370-\u03FF]/;
const HAS_MATH = /[=+^_\/\u0370-\u03FF\u2070-\u209F\u00B2\u00B3\u00B9\u00B1\u00D7\u00F7\u2200-\u22FF]|(?<![A-Za-z])[A-Za-z]\(|\)[A-Za-z]/;

export function faText(s: string, digits: boolean, mode: "isolate" | "embed" = "isolate"): string {
  const [open, close] = mode === "embed" ? ["\u202A", "\u202C"] : ["\u2066", "\u2069"];
  const plain = (t: string) => (digits ? toFa(t) : t);
  let out = "", last = 0;
  for (const m of s.matchAll(MATH_RUN)) {
    const raw = m[0], at = m.index ?? 0;
    const lead = (raw.match(MATH_LEAD) ?? [""])[0];
    const core = raw.slice(lead.length).replace(MATH_TRAIL, "");
    if (!core || !HAS_LETTER.test(core) || !HAS_MATH.test(core)) continue;
    const start = at + lead.length;
    out += plain(s.slice(last, start)) + open + toEn(core) + close;
    last = start + core.length;
  }
  return out + plain(s.slice(last));
}
