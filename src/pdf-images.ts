/**
 * بیرون کشیدن تصویرهای داخل PDF برای OCR (بدون وابستگی؛ روی Workers و Node کار می‌کند).
 * - JPEG (فیلتر DCTDecode): همان بایت‌ها.
 * - Flate (RGB/Gray هشت‌بیتی؛ مثل اسکرین‌شات‌هایی که Word داخل PDF می‌گذارد): به PNG تبدیل می‌شود.
 * - هر تصویر تا جای ممکن به شماره‌ی صفحه‌اش وصل می‌شود (از /XObject شیء Page)؛ اگر PDF از Object Stream فشرده استفاده کند page=0 می‌ماند.
 * پشتیبانی نمی‌شود: Indexed/CMYK، ماسک‌ها، JBIG2/CCITT/JPX، Predictor نوع TIFF.
 */
export type PdfImage = { bytes: Uint8Array; mime: "image/jpeg" | "image/png"; page: number; w: number; h: number };
export type PdfImages = { images: PdfImage[]; pages: number };

const MIN_SIDE = 200; // آیکن/لوگوی ریز رد می‌شود
const MAX_PIXELS = 40_000_000;

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (u8: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function png(w: number, h: number, ch: number, idat: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = ch === 3 ? 2 : 0; // عمق ۸ بیت؛ RGB یا Gray
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function run(data: Uint8Array, t: any): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([data as any]).stream().pipeThrough(t)).arrayBuffer());
}

/** استریم Flate در PDF همان zlib است؛ برای PNG فقط باید هر سطر یک بایت فیلتر داشته باشد */
async function flateToPng(raw: Uint8Array, w: number, h: number, ch: number, predictor: number): Promise<Uint8Array | null> {
  if (predictor >= 10) return png(w, h, ch, raw); // سطرها از قبل بایت فیلتر PNG دارند ← همان استریم IDAT است
  if (predictor > 1) return null; // TIFF predictor
  const rowLen = w * ch;
  const pix = await run(raw, new DecompressionStream("deflate"));
  if (pix.length < rowLen * h) return null;
  const rows = new Uint8Array((rowLen + 1) * h);
  for (let y = 0; y < h; y++) rows.set(pix.subarray(y * rowLen, (y + 1) * rowLen), y * (rowLen + 1) + 1); // بایت فیلتر ۰ = None
  return png(w, h, ch, await run(rows, new CompressionStream("deflate")));
}

const latin1 = (u8: Uint8Array) => new TextDecoder("latin1").decode(u8); // هر بایت ← یک نویسه؛ فقط برای اندیس‌گذاری

export async function extractPdfImages(bytes: Uint8Array, minSide = MIN_SIDE): Promise<PdfImages> {
  const s = latin1(bytes);

  // نگاشت شماره‌ی شیء تصویر ← شماره‌ی صفحه (به ترتیب شیءهای Page در فایل)
  const pageOf = new Map<number, number>();
  let pages = 0;
  for (const m of s.matchAll(/\/Type\s*\/Page(?![A-Za-z])/g)) {
    const from = s.lastIndexOf("obj", m.index!);
    const to = s.indexOf("endobj", m.index!);
    const body = s.slice(from, to < 0 ? m.index! + 3000 : to);
    pages++;
    const xo = body.match(/\/XObject\s*<<([^>]*)>>/);
    if (xo) for (const r of xo[1].matchAll(/(\d+)\s+0\s+R/g)) pageOf.set(Number(r[1]), pages);
  }

  const channelsOf = (dict: string): number => {
    const d = dict.match(/\/ColorSpace\s*\/(Device|Cal)(RGB|Gray)\b/);
    if (d) return d[2] === "RGB" ? 3 : 1;
    const icc = dict.match(/\/ColorSpace\s*\[\s*\/ICCBased\s+(\d+)\s+0\s+R/);
    if (icc) {
      const o = new RegExp(`(?<![0-9])${icc[1]}\\s+0\\s+obj`).exec(s);
      const n = o && s.slice(o.index, o.index + 400).match(/\/N\s+(\d)/)?.[1];
      if (n === "3" || n === "1") return Number(n);
    }
    return 0;
  };

  const images: PdfImage[] = [];
  const re = /(?<!end)stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const dictFrom = Math.max(s.lastIndexOf("obj", m.index) - 16, m.index - 2000); // ۱۶ نویسه‌ی قبل از «obj» تا شماره‌ی شیء هم در برش بیاید
    const dict = s.slice(dictFrom, m.index);
    if (!/\/Subtype\s*\/Image/.test(dict) || /\/ImageMask\s+true/.test(dict)) continue;
    const w = Number(dict.match(/\/Width\s+(\d+)/)?.[1] ?? 0), h = Number(dict.match(/\/Height\s+(\d+)/)?.[1] ?? 0);
    if (w < minSide || h < minSide || w * h > MAX_PIXELS) continue;

    const end = s.indexOf("endstream", start);
    if (end < 0) break;
    re.lastIndex = end + 9;
    const len = Number(dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)?.[1] ?? 0);
    let stop = len > 0 && start + len <= end ? start + len : end;
    if (!(len > 0 && start + len <= end)) while (stop > start && (bytes[stop - 1] === 10 || bytes[stop - 1] === 13)) stop--;
    const data = bytes.subarray(start, stop);

    const objNum = Number([...dict.matchAll(/(\d+)\s+\d+\s+obj\b/g)].pop()?.[1] ?? 0);
    const page = pageOf.get(objNum) ?? 0;
    const filters = (dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/)?.[1] ?? "").match(/\/\w+/g) ?? [];

    if (filters.length === 1 && filters[0] === "/DCTDecode") {
      if (data.length > 1000 && data[0] === 0xff && data[1] === 0xd8) images.push({ bytes: data, mime: "image/jpeg", page, w, h });
    } else if (filters.length === 1 && filters[0] === "/FlateDecode") {
      const ch = channelsOf(dict);
      const bpc = Number(dict.match(/\/BitsPerComponent\s+(\d+)/)?.[1] ?? 0);
      if (!ch || bpc !== 8) continue;
      const pred = Number(dict.match(/\/Predictor\s+(\d+)/)?.[1] ?? 1);
      if (pred >= 10 && (Number(dict.match(/\/Columns\s+(\d+)/)?.[1] ?? 1) !== w || Number(dict.match(/\/Colors\s+(\d+)/)?.[1] ?? 1) !== ch)) continue;
      try {
        const p = await flateToPng(data, w, h, ch, pred);
        if (p) images.push({ bytes: p, mime: "image/png", page, w, h });
      } catch (e) {
        console.error("pdf flate image", e instanceof Error ? e.message : e);
      }
    }
  }
  return { images, pages };
}
