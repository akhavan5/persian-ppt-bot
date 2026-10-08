export type Layout = "title" | "section" | "bullets" | "image_text" | "two_column" | "three_column" | "stats" | "table" | "chart" | "timeline" | "process" | "quote" | "icons" | "sources" | "questions" | "closing";

export interface Column { heading: string; bullets: string[] }
export interface Stat { value: string; label: string }
/** مرحله‌ی «خط زمان» و «فرایند»: label = تاریخ/نام مرحله، text = توضیح کوتاه */
export interface Step { label: string; text: string }
/** نقل‌قول یا پیام کلیدی؛ author خالی = پیام کلیدی (بدون علامت نقل‌قول) */
export interface Quote { text: string; author?: string }
/** کارت آیکن‌دار؛ icon نام یکی از کلیدهای ICONS در themes.ts است */
export interface IconItem { icon: string; heading: string; text: string }
export interface Table { headers: string[]; rows: string[][] }
export interface Chart { type: "bar" | "line" | "pie"; labels: string[]; series: { name: string; values: number[] }[] }

export interface Slide {
  layout: Layout;
  title: string;
  subtitle?: string;
  bullets: string[];
  columns: Column[];
  stats: Stat[];
  table?: Table;
  chart?: Chart;
  steps?: Step[];
  quote?: Quote;
  items?: IconItem[];
  image_query?: string;
  notes?: string;
}

export interface Deck { title: string; slides: Slide[] }
/** kind: اسلایدهای ویژه که چیدمان‌شان ثابت است */
export type SlideKind = "sources" | "questions";
export interface OutlineItem { title: string; summary: string; kind?: SlideKind }
export interface Outline { title: string; slides: OutlineItem[] }

export interface Settings {
  theme: string;
  font: string;
  slides: number;
  tone: string;
  digits: boolean;
  images: boolean;
  /** فقط وب: تعداد تصویر انتخابی هر ارائه (۰ = بدون تصویر)؛ خالی = ۱ اگر images روشن باشد */
  imageCount?: number;
  /** normal | student (ساختار دانشجویی: فهرست، مقدمه، بدنه، نتیجه‌گیری، منابع) */
  mode: "normal" | "student";
  /** افزودن اسلاید منابع / پرسش‌های پایانی */
  sources: boolean;
  questions: boolean;
  /** نام مدل انتخابی (از فهرست OPENAI_MODELS)؛ خالی = مدل اول */
  model?: string;
}

export interface DeckParams {
  /** تلگرام: شناسه‌ی چت؛ وب: ۰ */
  chatId: number;
  statusMessageId: number;
  /** تلگرام: عدد؛ وب: رشته‌ی «w_…» */
  userId: number | string;
  /** تلگرام: شناسه‌ی عددی تلگرام فرستنده؛ وقتی حساب به وب وصل است userId شناسه‌ی «w_…» است و این فیلد خود تلگرام را نگه می‌دارد */
  tgId?: number;
  /** کانال تحویل: پیش‌فرض تلگرام. در «web» به‌جای ارسال فایل، در KV ذخیره می‌شود و صفحه‌ی وب آن را دانلود می‌کند */
  channel?: "telegram" | "web";
  topic: string;
  /** متن استخراج‌شده از فایل آپلودی کاربر (فقط وب)؛ منبع اصلی محتوای ارائه. خالی = ارائه فقط از روی موضوع */
  source?: string;
  settings: Settings;
  /** سقف تعداد تصویر این ارائه (وب: طبق پلن؛ تلگرام: خالی = ۱) */
  maxImages?: number;
  /** اعتبار از کجا کم شده؛ برای برگشت در صورت خطا */
  credit: "daily" | "plan" | "bonus" | "none";
  /** روز (UTC) شمارنده‌ی روزانه‌ای که کم شده */
  day: string;
}
