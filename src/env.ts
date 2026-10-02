import type { DeckParams } from "./types";
import type { BroadcastParams } from "./broadcast";
import type { WebState } from "./web";

export interface Env {
  KV: KVNamespace;
  DECK_WORKFLOW: Workflow<DeckParams>;
  BROADCAST_WORKFLOW: Workflow<BroadcastParams>;
  /** Durable Object کوچک برای ورود با تلگرام و وضعیت لحظه‌ای ساخت در نسخه‌ی وب */
  WEB_STATE: DurableObjectNamespace<WebState>;

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
}
