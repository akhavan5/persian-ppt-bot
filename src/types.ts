export type Layout = "title" | "section" | "bullets" | "image_text" | "two_column" | "stats" | "closing";

export interface Column { heading: string; bullets: string[] }
export interface Stat { value: string; label: string }

export interface Slide {
  layout: Layout;
  title: string;
  subtitle?: string;
  bullets: string[];
  columns: Column[];
  stats: Stat[];
  image_query?: string;
  notes?: string;
}

export interface Deck { title: string; slides: Slide[] }
export interface OutlineItem { title: string; summary: string }
export interface Outline { title: string; slides: OutlineItem[] }

export interface Settings {
  theme: string;
  font: string;
  slides: number;
  tone: string;
  digits: boolean;
  images: boolean;
}

export interface DeckParams {
  chatId: number;
  statusMessageId: number;
  userId: number;
  topic: string;
  settings: Settings;
  /** اعتبار از کجا کم شده؛ برای برگشت در صورت خطا */
  credit: "daily" | "bonus" | "none";
  /** روز (UTC) شمارنده‌ی روزانه‌ای که کم شده */
  day: string;
}
