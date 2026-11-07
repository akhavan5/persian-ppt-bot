/** ابزار کوچک WAV (PCM): خواندن هدر، ساخت هدر، سکوت و چسباندن چند فایل؛ خروجی Gemini به‌صورت WAV با ۲۴ کیلوهرتز، تک‌کاناله، ۱۶ بیت است. */

export interface PcmFormat { sampleRate: number; channels: number; bits: number }
export const DEFAULT_FORMAT: PcmFormat = { sampleRate: 24000, channels: 1, bits: 16 };

const u32 = (v: DataView, o: number) => v.getUint32(o, true);
const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** WAV (یا PCM خام ۲۴ کیلوهرتز) ⇒ قالب و بایت‌های داده. اندازه‌ی ۰ یا ۰xFFFFFFFF در هدر (خروجی استریم) یعنی «تا آخر فایل». */
export function parseWav(buf: Uint8Array): { fmt: PcmFormat; data: Uint8Array } {
  if (buf.length < 12 || tag(buf, 0) !== "RIFF" || tag(buf, 8) !== "WAVE") return { fmt: DEFAULT_FORMAT, data: buf };
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let fmt = DEFAULT_FORMAT;
  let o = 12;
  while (o + 8 <= buf.length) {
    const id = tag(buf, o);
    let size = u32(v, o + 4);
    const body = o + 8;
    if (id === "fmt " && body + 16 <= buf.length) {
      fmt = { channels: u16(v, body + 2), sampleRate: u32(v, body + 4), bits: u16(v, body + 14) };
    } else if (id === "data") {
      if (size === 0 || size === 0xffffffff || body + size > buf.length) size = buf.length - body;
      return { fmt, data: buf.subarray(body, body + size) };
    }
    o = body + size + (size % 2);
  }
  return { fmt, data: new Uint8Array(0) };
}

export function wavHeader(dataLen: number, f: PcmFormat): Uint8Array {
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  const put = (o: number, s: string) => { for (let i = 0; i < 4; i++) h[o + i] = s.charCodeAt(i); };
  const blockAlign = (f.channels * f.bits) / 8;
  put(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); put(8, "WAVE"); put(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, f.channels, true);
  v.setUint32(24, f.sampleRate, true); v.setUint32(28, f.sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true); v.setUint16(34, f.bits, true); put(36, "data"); v.setUint32(40, dataLen, true);
  return h;
}

/** داده‌ی PCM خام را در هدر WAV می‌پیچد */
export const pcmToWav = (pcm: Uint8Array, f: PcmFormat = DEFAULT_FORMAT): Uint8Array => concat([wavHeader(pcm.length, f), pcm]);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** چند فایل WAV هم‌قالب را با فاصله‌ی سکوت (میلی‌ثانیه) به یک WAV تبدیل می‌کند */
export function mergeWav(files: Uint8Array[], gapMs = 350): Uint8Array {
  if (!files.length) throw new Error("no audio to merge");
  const parsed = files.map(parseWav);
  const f = parsed[0].fmt;
  const align = (f.channels * f.bits) / 8;
  const gap = new Uint8Array(Math.round((f.sampleRate * gapMs) / 1000) * align);
  const parts: Uint8Array[] = [];
  parsed.forEach((p, i) => {
    if (p.fmt.sampleRate !== f.sampleRate || p.fmt.channels !== f.channels || p.fmt.bits !== f.bits) throw new Error("WAV formats differ");
    if (i && gapMs > 0) parts.push(gap);
    parts.push(p.data);
  });
  const pcm = concat(parts);
  return concat([wavHeader(pcm.length, f), pcm]);
}

/** مدت فایل WAV به ثانیه (برای نمایش پخش‌کننده‌ی تلگرام) */
export function wavSeconds(wav: Uint8Array): number {
  const { fmt, data } = parseWav(wav);
  const bps = fmt.sampleRate * fmt.channels * (fmt.bits / 8);
  return bps ? Math.round(data.length / bps) : 0;
}

/** مدت فایل MP3 به ثانیه: از هدر اولین فریم (نرخ بیت ثابت CBR، همان خروجی mp3.ts)؛ اگر هدر خوانده نشد ۰ */
export function mp3Seconds(mp3: Uint8Array): number {
  let o = 0;
  if (mp3.length > 10 && tag(mp3, 0).startsWith("ID3")) o = 10 + (((mp3[6] & 0x7f) << 21) | ((mp3[7] & 0x7f) << 14) | ((mp3[8] & 0x7f) << 7) | (mp3[9] & 0x7f)); // برچسب ID3 را رد کن
  for (; o + 4 < mp3.length && o < 65536; o++) {
    if (mp3[o] !== 0xff || (mp3[o + 1] & 0xe0) !== 0xe0) continue;
    const ver = (mp3[o + 1] >> 3) & 3, layer = (mp3[o + 1] >> 1) & 3, br = mp3[o + 2] >> 4;
    if (ver === 1 || layer !== 1 || br === 0 || br === 15) continue; // فقط Layer III
    const table = ver === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    return Math.round(((mp3.length - o) * 8) / (table[br] * 1000));
  }
  return 0;
}

/** WAV یا MP3 (از روی محتوا، نه پسوند) ⇒ مدت به ثانیه؛ برای نمایش پخش‌کننده‌ی تلگرام */
export const audioSeconds = (b: Uint8Array): number => (b.length > 12 && tag(b, 0) === "RIFF" ? wavSeconds(b) : mp3Seconds(b));

/** پسوندهای فایل صوتی ساخته‌شده توسط پروژه (پادکست و صدای اسلاید) */
export const isAudioName = (name: string) => /\.(wav|mp3)$/i.test(name);
export const audioMime = (name: string) => (/\.mp3$/i.test(name) ? "audio/mpeg" : "audio/wav");
