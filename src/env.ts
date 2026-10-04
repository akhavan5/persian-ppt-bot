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
  /** اختیاری: فهرست مدل‌های قابل انتخاب در وب، با کاما/خط جدید (نام نمایشی با «|») یا JSON؛ مدل اول پیش‌فرض است. مثال: gpt-4o-mini|سریع, gpt-4o|دقیق */
  OPENAI_MODELS?: string;
  /** قدیمی: اگر OPENAI_MODELS خالی باشد، مدل دوم از اینجا خوانده می‌شود */
  OPENAI_MODEL_2?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  LLM_PROVIDER?: string;
  /** تصویر نسخه‌ی وب از همان API (OPENAI_BASE_URL) گرفته می‌شود؛ مدل تصویر (پیش‌فرض dall-e-3) و اندازه (اختیاری، مثل 1536x1024) */
  OPENAI_IMAGE_MODEL?: string;
  OPENAI_IMAGE_SIZE?: string;
  PEXELS_API_KEY?: string;
  /** Workers AI (تولید تصویر)؛ در wrangler.jsonc با «ai» تعریف می‌شود و کلید جدا ندارد */
  AI?: Ai;

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
  /** درگاه سیزپی (فقط نسخه‌ی وب): «کلید اصلی» تک‌پارچه (Secret)؛ بدون آن، خرید به تلگرام پشتیبان هدایت می‌شود */
  SIZPAY_KEY?: string;
  /** آدرس اصلی سایت برای canonical/sitemap/OG (پیش‌فرض https://pptsaz.ir) */
  SITE_URL?: string;
}
