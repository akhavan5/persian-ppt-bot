/** Workers Analytics Engine: ثبت رویدادها برای تحلیل (خطای هر مدل، زمان ساخت، رویدادهای وب/ربات).
 *  فقط ۳ ماه داده نگه می‌دارد؛ پس چیزهای بلندمدت (اعتبار، پلن، شمارنده‌های ماهانه‌ی پنل مدیر) همچنان در D1 می‌مانند.
 *  نوشتن بدون await و بدون CPU قابل‌توجه است؛ نبودن binding یا هر خطا هرگز کار اصلی را خراب نمی‌کند.
 *
 *  ساختار هر نقطه (ثابت بماند تا کوئری‌ها خراب نشوند):
 *    index1 = event
 *    blob1 = event, blob2 = plat, blob3 = model, blob4 = errClass, blob5 = template, blob6 = theme
 *    double1 = ms (مدت)، double2 = n (تعداد اسلاید/عکس/بایت، بسته به رویداد) */
import type { Env } from "./env";

export interface TrackFields {
  plat?: string;
  model?: string;
  err?: unknown;
  template?: string;
  theme?: string;
  ms?: number;
  n?: number;
}

/** خطا را به چند دسته‌ی کوچک تبدیل می‌کند تا روی آن group by شود (نه متن آزاد) */
export function errClass(e: unknown): string {
  if (e === undefined || e === null) return "";
  const m = String(e instanceof Error ? e.message : e).toLowerCase();
  if (m.includes("cpu time")) return "cpu_limit";
  if (m.includes("timeout") || m.includes("timed out") || m.includes("aborted")) return "timeout";
  if (m.includes("429") || m.includes("rate limit") || m.includes("quota")) return "rate_limit";
  if (/\b5\d\d\b/.test(m) || m.includes("overloaded") || m.includes("unavailable")) return "upstream_5xx";
  if (/\b40[13]\b/.test(m) || m.includes("api key") || m.includes("unauthorized")) return "auth";
  if (m.includes("json") || m.includes("parse")) return "bad_output";
  if (m.includes("too large")) return "too_large";
  return "other";
}

export function track(env: Env, event: string, f: TrackFields = {}): void {
  try {
    env.AE?.writeDataPoint({
      indexes: [event.slice(0, 90)],
      blobs: [event, f.plat ?? "", f.model ?? "", errClass(f.err), f.template ?? "", f.theme ?? ""],
      doubles: [Math.round(f.ms ?? 0), Math.round(f.n ?? 0)],
    });
  } catch { /* آمار نباید کار اصلی را خراب کند */ }
}
