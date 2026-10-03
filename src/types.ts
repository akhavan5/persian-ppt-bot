export type Layout = "title" | "section" | "bullets" | "image_text" | "two_column" | "stats" | "table" | "chart" | "sources" | "questions" | "closing";

export interface Column { heading: string; bullets: string[] }
export interface Stat { value: string; label: string }
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
  /** کانال تحویل: پیش‌فرض تلگرام. در «web» به‌جای ارسال فایل، در KV ذخیره می‌شود و صفحه‌ی وب آن را دانلود می‌کند */
  channel?: "telegram" | "web";
  topic: string;
  settings: Settings;
  /** اعتبار از کجا کم شده؛ برای برگشت در صورت خطا */
  credit: "daily" | "bonus" | "none";
  /** روز (UTC) شمارنده‌ی روزانه‌ای که کم شده */
  day: string;
}
