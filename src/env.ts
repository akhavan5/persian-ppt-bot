import type { DeckParams } from "./types";
import type { BroadcastParams } from "./broadcast";
import type { Store } from "./store";

export interface Env {
  /** پایگاه داده‌ی D1: همه‌ی داده‌های کوچک (کاربران، نشست‌ها، اعتبار، آمار، قفل‌ها) اینجا ذخیره می‌شود */
  DB: D1Database;
  /** KV واقعی: فقط برای بایت‌های فایل pptx (یک نوشتن برای هر ارائه، با انقضای خودکار) */
  FILES: KVNamespace;
  /** نمای سازگار با KV روی D1؛ در index.ts و Workflowها با withStore ساخته می‌شود و در wrangler تعریف نمی‌شود */
  KV: Store;
  /** فایل‌های استاتیک نسخه‌ی وب (پوشه‌ی public) */
  ASSETS: Fetcher;
  DECK_WORKFLOW: Workflow<DeckParams>;
  BROADCAST_WORKFLOW: Workflow<BroadcastParams>;

  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;

  /** کلید API؛ می‌تواند فهرست چند حساب باشد (هر خط یا «;»): ACCOUNT_ID|API_TOKEN برای حساب کلودفلر، یا کلید ساده با OPENAI_BASE_URL. با ۴۲۹ (سقف نورون) به حساب بعدی می‌رود */
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
  /** اختیاری: آدرس پایه‌ی اجرای مدل تصویر در کلودفلر (…/ai/run)؛ خالی = از OPENAI_BASE_URL مشتق می‌شود */
  OPENAI_IMAGE_BASE_URL?: string;
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
  /** درگاه دیجی‌پی (فقط نسخه‌ی وب): از داشبورد کلودفلر تنظیم شود؛ بدون هر چهار مقدار، خرید به تلگرام پشتیبان هدایت می‌شود */
  DIGIPAY_CLIENT_ID?: string;
  DIGIPAY_CLIENT_SECRET?: string;
  DIGIPAY_USERNAME?: string;
  DIGIPAY_PASSWORD?: string;
  /** ورود با پیامک یک‌بارمصرف (OTP) از وب‌سرویس s.api.ir؛ بدون SMS_API_TOKEN ورود با شماره‌ی موبایل غیرفعال است */
  SMS_API_TOKEN?: string;
  /** اختیاری: آدرس وب‌سرویس (پیش‌فرض https://s.api.ir/api/sw1/SmsOTP) */
  SMS_API_URL?: string;
  /** اختیاری: نوع قالب پیامک: کد=0، کد ورود=1 (پیش‌فرض)، کد تایید=2، رمز=3، رمز ورود=4 */
  SMS_TEMPLATE?: string;
  /** جستجوی آنلاین پشت‌صحنه (رایگان: ویکی‌پدیا + DuckDuckGo): WEB_SEARCH=off خاموش می‌کند؛ TAVILY_API_KEY اختیاری (سطح رایگان tavily.com) */
  WEB_SEARCH?: string;
  TAVILY_API_KEY?: string;
  /** آدرس اصلی سایت برای canonical/sitemap/OG (پیش‌فرض https://pptsaz.ir) */
  SITE_URL?: string;
}
