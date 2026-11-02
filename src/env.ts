import type { DeckParams } from "./types";
import type { BroadcastParams } from "./broadcast";
import type { Store } from "./store";
import type { OcrParams } from "./ocr-workflow";
import type { WebOcrParams } from "./web-ocr-workflow";
import type { AudioParams } from "./audio-workflow";
import type { ExtraParams } from "./extra-workflow";

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
  /** اختیاری: حساب‌های کلودفلر پشتیبان برای مرورگر (وقتی binding به سقف ۴۲۹ می‌خورد). هر خط یا «;» یک حساب: ACCOUNT_ID|API_TOKEN (توکن با دسترسی Browser Rendering - Edit) */
  BROWSER_ACCOUNTS?: string;
  /** اختیاری: api ⇒ PDF و پوستر فقط از BROWSER_ACCOUNTS ساخته می‌شود و binding نادیده گرفته می‌شود (OCR همچنان از binding استفاده می‌کند). خالی = اول binding، با خطا حساب‌های پشتیبان */
  BROWSER_MODE?: string;
  DECK_WORKFLOW: Workflow<DeckParams>;
  BROADCAST_WORKFLOW: Workflow<BroadcastParams>;
  /** خواندن فایل‌های PDF/عکس تلگرام (OCR چندصفحه‌ای) خارج از سقف ۳۰ ثانیه‌ی waitUntil؛ اختیاری: اگر تعریف نشود، مسیر درون‌خطی */
  OCR_WORKFLOW?: Workflow<OcrParams>;
  /** همان کار برای نسخه‌ی وب (آپلود PDF/عکس از صفحه‌ی سایت)؛ اختیاری: اگر تعریف نشود، خواندن در همان درخواست انجام می‌شود */
  WEB_OCR_WORKFLOW?: Workflow<WebOcrParams>;

  /** اسلاید صوتی و پادکست (فقط مدیر، فقط تلگرام): خواندن متن سخنرانی/گفت‌وگو با Gemini؛ اختیاری: اگر تعریف نشود، دکمه‌های صوتی نمایش داده نمی‌شوند */
  AUDIO_WORKFLOW?: Workflow<AudioParams>;
  /** پوستر و جزوه‌ی Word که بعد از ساخت ارائه با دکمه‌ی زیر ارائه خواسته می‌شوند (Workflow «persian-ppt-extra»)؛ بدون آن این دو دکمه نمایش داده نمی‌شوند */
  EXTRA_WORKFLOW?: Workflow<ExtraParams>;
  /** کلیدهای Gemini (هر خط یا «;» یا «,» یک کلید). هر کلید ۳ درخواست می‌گیرد و بعد نوبت کلید بعدی است؛ با هر خطا (۴۲۹، ۴۰۱، ۴۰۳، ۴۰۰، ۵xx، تایم‌اوت) همان درخواست با کلید بعدی تکرار می‌شود. به‌صورت secret بگذارید */
  GEMINI_API_KEYS?: string;
  /** اختیاری: تعداد درخواست پشت‌سرهم هر کلید قبل از رفتن به کلید بعدی (پیش‌فرض ۳) */
  GEMINI_KEY_STEP?: string;
  /** اختیاری: مدل(های) صدا به ترتیب اولویت، با «,» جدا می‌شود. پیش‌فرض: gemini-3.8-flash-tts ← gemini-3.8-flash-lite-tts ← gemini-3.1-flash-tts-preview (اگر مدل اول شلوغ بود به بعدی می‌رود) */
  GEMINI_TTS_MODEL?: string;
  /** اختیاری: صدای خواندن اسلایدها (پیش‌فرض Kore) و صدای مجری/مهمان پادکست (پیش‌فرض Achird و Sulafat) */
  GEMINI_TTS_VOICE?: string;
  GEMINI_TTS_VOICE_A?: string;
  GEMINI_TTS_VOICE_B?: string;
  /** اختیاری: سرعت گفتار اسلاید صوتی؛ normal | brisk (پیش‌فرض، کمی تندتر) | fast (تند) */
  GEMINI_TTS_PACE?: string;
  /** اختیاری: آدرس پایه‌ی Gemini (پیش‌فرض https://generativelanguage.googleapis.com)؛ اگر منطقه‌ی اجرای Worker پشتیبانی نشد، آدرس پروکسی را بگذارید */
  GEMINI_BASE_URL?: string;
  /** اختیاری: نرخ نمونه‌برداری صدا (۸۰۰۰، ۱۶۰۰۰ یا ۲۴۰۰۰؛ پیش‌فرض ۲۴۰۰۰). ۱۶۰۰۰ حجم فایل را یک‌سوم کم می‌کند */
  GEMINI_TTS_SAMPLE_RATE?: string;

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
  /** اختیاری: ارائه‌دهنده‌ی دوم فقط برای مدل‌های متنی (سازگار با OpenAI). مدل‌هایش در فهرست «قبل از» مدل‌های کلودفلر می‌آیند و تصویر همچنان فقط از کلودفلر است. فقط برای پلن/مدیر.
   *  EXTRA_LLM_BASE_URL: آدرس گیت‌وی تا /v1 (مثل https://example.com/v1)؛ EXTRA_LLM_API_KEY: کلید همان گیت‌وی؛
   *  EXTRA_LLM_MODELS: فهرست مدل‌ها با همان قالب OPENAI_MODELS (کاما/خط جدید، نام نمایشی با «|») یا JSON */
  EXTRA_LLM_BASE_URL?: string;
  EXTRA_LLM_API_KEY?: string;
  EXTRA_LLM_MODELS?: string;
  /** اختیاری: مدل‌های متنیِ مستقل، JSON: یک شیء برای هر مدل با آدرس و کلید خودش. free: true ⇒ برای کاربران رایگان هم باز است (پیش‌فرض false = فقط پلن/مدیر)؛ name اختیاری.
   *  [{"model":"...","base":"https://host/v1","key":"...","free":true,"name":"نام نمایشی"}] */
  CUSTOM_LLM_MODELS?: string | object; // نوع «Text» (رشته) یا «JSON» (شیء/آرایه) در داشبورد
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

  /** ربات بله (اختیاری): بدون BALE_BOT_TOKEN ربات بله خاموش است و رفتار تلگرام هیچ تغییری نمی‌کند.
   *  BALE_BOT_TOKEN: توکن بازو از @botfather در بله (secret)
   *  BALE_WEBHOOK_SECRET: بخش مخفی آدرس وبهوک (/bale/<secret>)؛ بله هدر محرمانه نمی‌فرستد. خالی = از TELEGRAM_WEBHOOK_SECRET استفاده می‌شود. فقط حروف/عدد/خط‌تیره/زیرخط، حداقل ۱۶ نویسه
   *  BALE_WEBHOOK_BASE: دامنه‌ای که بله به آن وبهوک می‌زند (پیش‌فرض SITE_URL)؛ باید از ایران قابل دسترس و روی پورت ۴۴۳ یا ۸۸ باشد
   *  BALE_API_BASE: آدرس API بله (پیش‌فرض https://tapi.bale.ai)؛ اگر Worker از خارج ایران به آن نرسید، آدرس یک رله‌ی ایرانی را بگذارید */
  BALE_BOT_TOKEN?: string;
  BALE_WEBHOOK_SECRET?: string;
  BALE_WEBHOOK_BASE?: string;
  BALE_API_BASE?: string;
  /** ربات روبیکا (اختیاری): بدون RUBIKA_BOT_TOKEN ربات روبیکا خاموش است و رفتار تلگرام و بله هیچ تغییری نمی‌کند.
   *  RUBIKA_BOT_TOKEN: توکن بازو از @BotFather در روبیکا (secret)
   *  RUBIKA_WEBHOOK_SECRET: بخش مخفی آدرس وبهوک (/rubika/<secret>)؛ روبیکا هدر محرمانه نمی‌فرستد. خالی = از TELEGRAM_WEBHOOK_SECRET استفاده می‌شود. فقط حروف/عدد/خط‌تیره/زیرخط، حداقل ۱۶ نویسه
   *  RUBIKA_WEBHOOK_BASE: دامنه‌ای که روبیکا به آن وبهوک می‌زند (پیش‌فرض SITE_URL)؛ باید از ایران قابل دسترس و HTTPS باشد
   *  RUBIKA_API_BASE: آدرس API روبیکا (پیش‌فرض https://botapi.rubika.ir، بدون /v3)؛ اگر Worker از خارج ایران به آن نرسید، آدرس یک رله‌ی ایرانی را بگذارید */
  RUBIKA_BOT_TOKEN?: string;
  RUBIKA_WEBHOOK_SECRET?: string;
  RUBIKA_WEBHOOK_BASE?: string;
  RUBIKA_API_BASE?: string;
  /** پرچم داخلی (در wrangler تعریف نمی‌شود): env ساخته‌شده برای پردازش آپدیت بله؛ متدهای بدون chat_id مثل answerCallbackQuery و getFile با آن به بله می‌روند */
  PLATFORM?: "bale" | "rubika";

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
  /** پرداخت درون‌برنامه‌ای کافه‌بازار (اپ اندروید): از پنل پیشخان ← تنظیمات ← API توسعه‌دهندگان (Client ID / Client Secret) و refresh_token همان کلاینت؛
   *  شناسه‌ی محصول‌های مصرفی در بازار: plan_plus و plan_pro. بدون هر سه مقدار، خرید از طریق بازار در اپ غیرفعال است */
  /** بررسی نسخه‌ی اپ اندروید (versionCode): آخرین نسخه‌ی منتشرشده → پیشنهاد به‌روزرسانی؛ حداقل نسخه‌ی مجاز → به‌روزرسانی اجباری.
   *  ANDROID_UPDATE_URL اختیاری است (پیش‌فرض: صفحه‌ی اپ در کافه‌بازار) */
  ANDROID_LATEST_VERSION?: string;
  ANDROID_MIN_VERSION?: string;
  ANDROID_UPDATE_URL?: string;
  /** اختیاری: لینک به‌روزرسانی مخصوص هر فروشگاه (پیش‌فرض: صفحه‌ی اپ در کافه‌بازار / مایکت با ANDROID_PACKAGE) */
  ANDROID_UPDATE_URL_BAZAAR?: string;
  ANDROID_UPDATE_URL_MYKET?: string;
  BAZAAR_CLIENT_ID?: string;
  BAZAAR_CLIENT_SECRET?: string;
  BAZAAR_REFRESH_TOKEN?: string;
  /** پرداخت درون‌برنامه‌ای مایکت: کلید عمومی RSA پنل مایکت (اختیاری؛ پیش‌فرض داخل کد است) و MYKET_PAY=off برای خاموش‌کردن. شناسه‌ی محصول‌ها مثل بازار: plan_plus و plan_pro (مصرفی) */
  MYKET_PUBLIC_KEY?: string;
  MYKET_PAY?: string;
  /** توکن صحت‌سنجی مایکت (پنل توسعه‌دهندگان؛ اختیاری و محرمانه): اگر گذاشته شود، سرور وضعیت خرید را از API مایکت هم می‌پرسد تا خرید برگشت‌خورده فعال نشود. */
  MYKET_ACCESS_TOKEN?: string;
  /** ایمیل با Resend (اختیاری): بدون RESEND_API_KEY هیچ ایمیلی فرستاده نمی‌شود (نه خوش‌آمد، نه رسید خرید، نه کد ورود با ایمیل). کلید را به‌صورت secret بگذارید.
   *  EMAIL_FROM: فرستنده روی دامنه‌ی تاییدشده در Resend، مثل «پاورپوینت‌ساز فارسی <hello@pptsaz.ir>» (پیش‌فرض: hello@ دامنه‌ی SITE_URL)
   *  EMAIL_REPLY_TO: نشانی دریافت پاسخ کاربران (اختیاری) */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
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
  /** ورودی صوتی (ویس و فایل صوتی تلگرام ← متن) با Deepgram: کلید API (چند کلید: هر خط یا «;» یا «,»). بدون آن ورودی صوتی خاموش است. DEEPGRAM_MODEL پیش‌فرض nova-3؛ DEEPGRAM_LANGUAGE پیش‌فرض fa (auto = تشخیص خودکار زبان، multi = چندزبانه) */
  DEEPGRAM_API_KEY?: string;
  DEEPGRAM_MODEL?: string;
  DEEPGRAM_LANGUAGE?: string;
  /** تبدیل تصویر/PDF اسکن‌شده به متن (OCR) با ocr.space؛ کلید رایگان از ocr.space/ocrapi/freekey. بدون آن از کلید دموی عمومی (با سقف بسیار کم) استفاده می‌شود */
  OCR_SPACE_API_KEY?: string;
  /** اختیاری: مدل‌های vision کلودفلر برای OCR (با کاما، به ترتیب اولویت). پیش‌فرض: gemma-4-26b-a4b-it ← qwen3.8-27b ← mistral-small-3.1 */
  OCR_VISION_MODELS?: string;
  /** آدرس اصلی سایت برای canonical/sitemap/OG (پیش‌فرض https://pptsaz.ir) */
  SITE_URL?: string;
  /** اختیاری: آدرس Mini App تلگرام. پیش‌فرض آدرس مستقیم Worker (https://persian-ppt-bot.umz1.workers.dev)؛ برای برگشت به دامنه‌ی اصلی مقدار SITE_URL یا دامنه‌ی دلخواه را بگذارید */
  MINIAPP_URL?: string;
  /** رمز مشترک بین nginx سرور ایرانی و Worker (هدر X-Proxy-Secret). با آن، دامنه‌ی واقعی (X-Forwarded-Host) و IP واقعی کاربر (X-Client-IP) پذیرفته می‌شود؛ بدون آن رفتار قبلی است */
  PROXY_SECRET?: string;
  /** اختیاری: اپ اندروید (کافه بازار). ANDROID_PACKAGE: شناسه‌ی بسته (پیش‌فرض ir.pptsaz.app)؛ ANDROID_CERT_SHA256: اثر انگشت SHA-256 کلید امضای APK (چند مقدار با کاما)؛ برای /.well-known/assetlinks.json */
  ANDROID_PACKAGE?: string;
  ANDROID_CERT_SHA256?: string;
  /** اختیاری: اعلان اپ اندروید با FCM؛ کل JSON «حساب سرویس» فایربیس (Project settings ← Service accounts ← Generate new private key) به‌صورت secret */
  FCM_SERVICE_ACCOUNT?: string;
}
