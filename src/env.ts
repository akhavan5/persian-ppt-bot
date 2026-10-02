import type { DeckParams } from "./types";
import type { BroadcastParams } from "./broadcast";

export interface Env {
  KV: KVNamespace;
  /** فایل‌های استاتیک نسخه‌ی وب (پوشه‌ی public) */
  ASSETS: Fetcher;
  DECK_WORKFLOW: Workflow<DeckParams>;
  BROADCAST_WORKFLOW: Workflow<BroadcastParams>;

  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;

  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  LLM_PROVIDER?: string;
  PEXELS_API_KEY?: string;

  /** فقط برای تست محلی با سرور شبیه‌ساز تلگرام؛ در تولید تنظیم نکنید */
  TELEGRAM_API_BASE?: string;

  /** اختیاری: شناسه عددی کاربران مجاز، با کاما جدا شود. خالی = همه مجازند */
  ALLOWED_USER_IDS?: string;
  /** اختیاری: شناسه عددی مدیرها، با کاما. مدیرها اعتبار نامحدود دارند و به دستورهای /admin دسترسی دارند */
  ADMIN_IDS?: string;
  /** سقف روزانه‌ی هر کاربر (پیش‌فرض ۵؛ ۰ = نامحدود) */
  DAILY_LIMIT?: string;
  /** اختیاری: سقف روزانه‌ی کاربران وب (اگر خالی باشد همان DAILY_LIMIT) */
  WEB_DAILY_LIMIT?: string;
  /** ورود با گوگل (اختیاری): بدون این دو مقدار، دکمه‌ی گوگل نمایش داده نمی‌شود */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** درگاه زرین‌پال (فقط نسخه‌ی وب): مرچنت‌کد ۳۶ حرفی؛ بدون آن، خرید به تلگرام پشتیبان هدایت می‌شود */
  ZARINPAL_MERCHANT_ID?: string;
}
