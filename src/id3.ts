/**
 * برچسب ID3v2.3 برای MP3: عنوان، خواننده (آدرس سایت)، آلبوم و لینک سایت تا پخش‌کننده‌ها «Unknown artist» نشان ندهند.
 * هزینه‌ی پردازشی تقریباً صفر: فقط چند صد بایت به ابتدای فایل چسبانده می‌شود؛ صدا دوباره کدگذاری نمی‌شود.
 * اگر فایل از قبل ID3 داشت یا MP3 نبود، دست‌نخورده برمی‌گردد. متن‌ها UTF-16 هستند تا فارسی درست نمایش داده شود.
 */
import type { Env } from "./env";

export interface Id3Meta { title?: string; artist: string; album?: string; url?: string }

const enc = new TextEncoder();

/** میزبان سایت (بدون www)؛ نسخه‌ی مستقل تا وابستگی دوری با deck-service نداشته باشیم */
export function id3Site(env: Env): { host: string; url: string } {
  const url = (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");
  let host = "pptsaz.ir";
  try { host = new URL(url).hostname.replace(/^www\./, "") || host; } catch { /* پیش‌فرض */ }
  return { host, url };
}

function utf16(s: string): Uint8Array {
  const out = new Uint8Array(3 + s.length * 2); // 01 (UTF-16) + BOM FF FE + UTF-16LE
  out[0] = 1; out[1] = 0xff; out[2] = 0xfe;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[3 + i * 2] = c & 0xff; out[4 + i * 2] = c >> 8; }
  return out;
}
function frame(id: string, body: Uint8Array): Uint8Array {
  const f = new Uint8Array(10 + body.length);
  f.set(enc.encode(id), 0);
  new DataView(f.buffer).setUint32(4, body.length); // ID3v2.3: اندازه‌ی معمولی (نه syncsafe)
  f.set(body, 10);
  return f;
}
const text = (id: string, s: string) => frame(id, utf16(s.replace(/[\r\n]+/g, " ").trim().slice(0, 200)));

const isMp3 = (u: Uint8Array) => u.length > 4 && ((u[0] === 0xff && (u[1] & 0xe0) === 0xe0) || (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33));

/** MP3 را با برچسب ID3v2.3 برمی‌گرداند؛ اگر MP3 نبود یا برچسب داشت همان ورودی */
export function withId3(data: Uint8Array | ArrayBuffer, meta: Id3Meta): Uint8Array {
  const mp3 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isMp3(mp3) || (mp3[0] === 0x49 && mp3[1] === 0x44 && mp3[2] === 0x33)) return mp3;
  const frames: Uint8Array[] = [];
  if (meta.title) frames.push(text("TIT2", meta.title));
  frames.push(text("TPE1", meta.artist), text("TPE2", meta.artist));
  if (meta.album) frames.push(text("TALB", meta.album));
  if (meta.url) {
    const u = enc.encode(meta.url.replace(/[^\x20-\x7e]/g, "").slice(0, 200)); // WOAR: نشانی ASCII
    frames.push(frame("WOAR", u));
  }
  const size = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(10 + size + mp3.length);
  out.set([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f], 0); // سرآغاز؛ اندازه syncsafe
  let o = 10;
  for (const f of frames) { out.set(f, o); o += f.length; }
  out.set(mp3, o);
  return out;
}

/** میانبر: عنوان محتوا + خواننده/آلبوم/لینک سایت */
export function tagMp3(env: Env, data: Uint8Array | ArrayBuffer, title: string, album?: string): Uint8Array {
  const s = id3Site(env);
  return withId3(data, { title, artist: s.host, album: album || s.host, url: s.url });
}
