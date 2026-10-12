/**
 * سقف روزانه‌ی خواندن فایل برای هر کاربر = اعتبار ساخت ارائه‌اش + ۲ (روز به وقت UTC).
 * - «ocr»: هر فایلی که واقعاً OCR می‌شود (اسکن، عکس؛ PDFِ دارای متن OCR نمی‌شود)؛ در تلگرام و وب یکسان (tg-file.ts)
 * - «upload»: هر آپلود PDF/تصویر در وب، حتی PDF متنی که OCR نمی‌خواهد (چون بایت‌ها موقتاً در KV نوشته می‌شوند)
 * هیچ کاربری نامحدود نیست: مدیر (و حالت DAILY_LIMIT=0 که getCredit آن را «نامحدود» می‌داند) مثل پلن «پرو» حساب می‌شود.
 */
import type { Env } from "./env";
import { getCredit, today, type Uid } from "./settings";
import { hitLimit } from "./auth";
import { PLANS } from "./payment";

export const OCR_EXTRA = 2;
const PRO_CREDITS = PLANS.find((p) => p.id === "pro")?.credits ?? 20;
export const OCR_CAP_NOTE = "سقف روزانه‌ی خواندن فایل = اعتبار ساخت ارائه‌ات + ۲ است و با شارژ اعتبار بیشتر می‌شود.";

/** سقف امروز این کاربر (اعتبار باقی‌مانده‌ی ساخت ارائه + ۲؛ برای «نامحدود» ها: اعتبار پلن پرو + ۲) */
export async function ocrCap(env: Env, userId: Uid): Promise<number> {
  const c = await getCredit(env, userId);
  return (c.unlimited ? PRO_CREDITS : c.total) + OCR_EXTRA;
}

/** true = سقف امروز تمام است؛ وگرنه یک شمارش مصرف می‌شود */
export async function ocrLimitHit(env: Env, userId: Uid, kind: "ocr" | "upload" = "ocr"): Promise<boolean> {
  return hitLimit(env, `${kind === "ocr" ? "ocr" : "ocrjob"}:${userId}:${today()}`, await ocrCap(env, userId), 172_800);
}
