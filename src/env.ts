import type { DeckParams } from "./types";
import type { BroadcastParams } from "./broadcast";
import type { Store } from "./store";
import type { OcrParams } from "./ocr-workflow";
import type { WebOcrParams } from "./web-ocr-workflow";

export interface Env {
  /** پایگاه داده‌ی D1: همه‌ی داده‌های کوچک (کاربران، نشست‌ها، اعتبار، آمار، قفل‌ها) اینجا ذخیره می‌شود */
  DB: D1Database;
  /** KV واقعی: فقط برای بایت‌های فایل pptx (یک نوشتن برای هر ارائه، با انقضای خودکار) */
  FILES: KVNamespace;
  /** نمای سازگار با KV روی D1؛ در index.ts و Workflowها با withStore ساخته می‌شود و در wrangler تعریف نمی‌شود */
  KV: Store;
  /** فایل‌های استاتیک نسخه‌ی وب (پوشه‌ی public) */
  ASSETS: Fetcher;
  /** Browser Rendering (مرورگر بدون‌سر کلودفلر) برای ساخت PDF در ربات تلگرام؛ در wrangler.jsonc با کلید browser تعریف می‌شود */
  BROWSER?: Fetcher;
  DECK_WORKFLOW: Workflow<DeckParams>;
  BROADCAST_WORKFLOW: Workflow<BroadcastParams>;
  /** خواندن فایل‌های PDF/عکس تلگرام (OCR چندصفحه‌ای) خارج از سقف ۳۰ ثانیه‌ی waitUntil؛ اختیاری: اگر تعریف نشود، مسیر درون‌خطی */
  OCR_WORKFLOW?: Workflow<OcrParams>;
  /** همان کار برای نسخه‌ی وب (آپلود PDF/عکس از صفحه‌ی سایت)؛ اختیاری: اگر تعریف نشود، خواندن در همان درخواست انجام می‌شود */
  WEB_OCR_WORKFLOW?: Workflow<WebOcrParams>;

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
  /** اختیاری: ارائه‌دهنده‌ی دوم فقط برای مدل‌های متنی (سازگار با OpenAI). مدل‌هایش در فهرست «قبل از» مدل‌های کلودفلر می‌آیند و تصویر همچنان فقط از کلودفلر است.
   *  EXTRA_LLM_BASE_URL: آدرس گیت‌وی تا /v1 (مثل https://example.com/v1)؛ EXTRA_LLM_API_KEY: کلید همان گیت‌وی؛
   *  EXTRA_LLM_MODELS: فهرست مدل‌ها با همان قالب OPENAI_MODELS (کاما/خط جدید، نام نمایشی با «|») یا JSON */
  EXTRA_LLM_BASE_URL?: string;
  EXTRA_LLM_API_KEY?: string;
  EXTRA_LLM_MODELS?: string;
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
  /** ساخت ارائه از روی لینک (Tavily Extract): با داشتن TAVILY_API_KEY فعال است؛ LINK_SOURCE=off خاموش می‌کند.
   *  LINK_DAILY_LIMIT: سقف لینک در روز برای هر کاربر (پیش‌فرض ۱۰)؛ LINK_GLOBAL_DAILY: سقف کل سایت در روز (اختیاری، خالی = بدون سقف) */
  LINK_SOURCE?: string;
  LINK_DAILY_LIMIT?: string;
  LINK_GLOBAL_DAILY?: string;
  /** تبدیل تصویر/PDF اسکن‌شده به متن (OCR) با ocr.space؛ کلید رایگان از ocr.space/ocrapi/freekey. بدون آن از کلید دموی عمومی (با سقف بسیار کم) استفاده می‌شود */
  OCR_SPACE_API_KEY?: string;
  /** اختیاری: مدل‌های vision کلودفلر برای OCR (با کاما، به ترتیب اولویت). پیش‌فرض: gemma-4-26b-a4b-it ← qwen3.8-27b ← mistral-small-3.1 */
  OCR_VISION_MODELS?: string;
  /** آدرس اصلی سایت برای canonical/sitemap/OG (پیش‌فرض https://pptsaz.ir) */
  SITE_URL?: string;
  /** اختیاری: اپ اندروید (کافه بازار). ANDROID_PACKAGE: شناسه‌ی بسته (پیش‌فرض ir.pptsaz.app)؛ ANDROID_CERT_SHA256: اثر انگشت SHA-256 کلید امضای APK (چند مقدار با کاما)؛ برای /.well-known/assetlinks.json */
  ANDROID_PACKAGE?: string;
  ANDROID_CERT_SHA256?: string;
}
