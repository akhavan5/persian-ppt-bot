/**
 * جزوه‌ی Word (حدود ۳ صفحه، با یک تصویر) همراه ارائه.
 * مسیر: محتوای همان ارائه + یادداشت‌های پژوهش ← JSON ساختاریافته از مدل (makeHandout) ← فایل DOCX راست‌به‌چپ (buildDocx).
 * DOCX با JSZip (که پروژه از قبل دارد) و XML خام ساخته می‌شود؛ پس وابستگی تازه‌ای لازم نیست.
 */
import JSZip from "jszip";
import type { Env } from "./env";
import type { Deck } from "./types";
import { THEMES, TONES } from "./themes";
import { toFa } from "./util";
import { LlmError, askJson, hasKey } from "./llm";

export interface HandoutSection { heading: string; text: string; bullets: string[] }
export interface Handout { title: string; intro: string; sections: HandoutSection[]; keypoints: string[]; image_query: string }

// ---------- پاک‌سازی خروجی مدل ----------
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : [];

export function normalizeHandout(data: any, topic: string): Handout {
  const sections: HandoutSection[] = (Array.isArray(data?.sections) ? data.sections : []).slice(0, 5)
    .map((s: any): HandoutSection => ({
      heading: str(s?.heading ?? s?.title).slice(0, 90),
      text: str(s?.text ?? s?.paragraph).slice(0, 1300),
      bullets: strArr(s?.bullets).slice(0, 4).map((b) => b.slice(0, 200)),
    }))
    .filter((s: HandoutSection) => s.heading && (s.text || s.bullets.length));
  if (sections.length < 2) throw new Error("model returned no valid handout");
  return {
    title: str(data?.title).slice(0, 140) || topic,
    intro: str(data?.intro).slice(0, 800),
    sections,
    keypoints: strArr(data?.keypoints).slice(0, 7).map((k) => k.slice(0, 200)),
    image_query: str(data?.image_query).slice(0, 200),
  };
}

// ---------- تولید محتوا ----------
/** خلاصه‌ی ارائه برای مدل: عنوان اسلایدها و نکته‌های کوتاهشان (سقف حجم) */
function deckDigest(deck: Deck): string {
  const out: string[] = [];
  for (const s of deck.slides) {
    const parts = [s.title, ...(s.bullets ?? []).slice(0, 4), ...(s.columns ?? []).flatMap((c) => c.bullets ?? []).slice(0, 4)].filter(Boolean);
    if (parts.length) out.push("- " + parts.join(" | "));
  }
  return out.join("\n").slice(0, 5000);
}

export async function makeHandout(env: Env, topic: string, deck: Deck, o: { tone?: string; model?: string; research?: string }): Promise<Handout> {
  if (!hasKey(env)) throw new LlmError("کلید API تنظیم نشده است", true);
  const notes = o.research
    ? `\nBackground notes from a live web search (may be partial; more up to date than your memory; never copy sentences, never mention "search" or "notes"; ignore unrelated snippets):\n${o.research.slice(0, 4000)}\n`
    : "";
  const prompt = `Write a concise Persian STUDY HANDOUT (جزوه) of about THREE A4 pages (about 900 to 1000 Persian words in total, do not write less than 850) that a student could read before or after the presentation below.
Topic: ${topic}
Presentation title: ${deck.title}
Tone: ${TONES[o.tone ?? ""] ?? TONES.educational}
Presentation content (use it as the backbone, keep its order and facts):
${deckDigest(deck)}
${notes}
Rules:
- Natural, fluent Persian prose with correct half-spaces (نیم‌فاصله). Explain, connect ideas and give a short example where useful; do not just repeat the slide bullets.
- Exactly 5 sections. Each section: a short heading (max 7 words), one rich paragraph of 130 to 160 words, and 2 to 3 short bullets (max 14 words each) that add a concrete point or example.
- "intro": 3 sentences (60 to 80 words) saying what the reader will learn.
- "keypoints": 5 or 6 one-line takeaways (max 16 words each).
- Never invent statistics, quotes, names or sources. If unsure of a number, stay general.
- Output language is Persian; only "image_query" is English.
Return ONLY one JSON object with exactly this shape:
{"title":"short Persian title (max 12 words)","intro":"...","sections":[{"heading":"...","text":"...","bullets":["..."]}],"keypoints":["..."],"image_query":"English description of ONE concrete illustration that matches the topic (objects, setting; no text, no abstract words; max 14 words)"}`;
  const data = await askJson(env, prompt, 7000, o.model);
  return normalizeHandout(data, topic);
}

// ---------- ابعاد تصویر (بدون کتابخانه) ----------
export interface DocImage { data: Uint8Array; mime: "image/png" | "image/jpeg"; w: number; h: number }

export function imageInfo(b: Uint8Array): { mime: "image/png" | "image/jpeg"; w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) { // PNG: IHDR
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { mime: "image/png", w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) { // JPEG: اولین SOFn
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: "image/jpeg", h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

// ---------- ساخت DOCX ----------
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface DocxOpts { theme: string; font: string; digits: boolean; image?: DocImage }

export async function buildDocx(h: Handout, o: DocxOpts): Promise<Uint8Array> {
  const th = THEMES[o.theme] ?? THEMES.ocean;
  const font = esc(o.font || "Vazirmatn");
  const T = (t: string) => esc(o.digits ? toFa(t) : t);

  const rpr = (sz: number, extra = "") =>
    `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>${extra}<w:rtl/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="fa-IR" w:bidi="fa-IR"/></w:rPr>`;
  const run = (t: string, sz: number, extra = "") => `<w:r>${rpr(sz, extra)}<w:t xml:space="preserve">${T(t)}</w:t></w:r>`;
  const para = (inner: string, ppr = "") => `<w:p><w:pPr><w:bidi/>${ppr}</w:pPr>${inner}</w:p>`;
  const body = (t: string) => para(run(t, 22), `<w:spacing w:after="120" w:line="348" w:lineRule="auto"/><w:jc w:val="both"/>`);
  const bullet = (t: string) => para(run(t, 22), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="60" w:line="336" w:lineRule="auto"/>`);
  const heading = (t: string) => para(run(t, 28, `<w:b/><w:bCs/><w:color w:val="${th.primary}"/>`),
    `<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${th.accent}"/></w:pBdr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="0"/>`);

  const parts: string[] = [];
  parts.push(para(run(h.title, 40, `<w:b/><w:bCs/><w:color w:val="${th.dark}"/>`), `<w:spacing w:after="40"/>`));
  parts.push(para(run("جزوه‌ی مطالعه", 22, `<w:color w:val="${th.muted}"/>`), `<w:spacing w:after="140"/>`));

  // تصویر: عرض حداکثر ۱۵ سانتی‌متر و ارتفاع حداکثر ۶٫۲ سانتی‌متر (نسبت حفظ می‌شود)
  let relImage = "";
  if (o.image && o.image.w > 0 && o.image.h > 0) {
    const EMU = 360000, maxW = 15 * EMU, maxH = 6.2 * EMU;
    const k = Math.min(maxW / o.image.w, maxH / o.image.h);
    const cx = Math.round(o.image.w * k), cy = Math.round(o.image.h * k);
    relImage = `<Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.${o.image.mime === "image/png" ? "png" : "jpg"}"/>`;
    parts.push(para(
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="تصویر" descr="${esc(h.title)}"/>` +
      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="image1"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rIdImg1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
      `<w:jc w:val="center"/><w:spacing w:after="160"/>`));
  }

  if (h.intro) parts.push(body(h.intro));
  for (const s of h.sections) {
    parts.push(heading(s.heading));
    if (s.text) parts.push(body(s.text));
    for (const b of s.bullets) parts.push(bullet(b));
  }
  if (h.keypoints.length) {
    // کادر رنگی «نکات کلیدی»
    const cell = [
      para(run("نکات کلیدی", 26, `<w:b/><w:bCs/><w:color w:val="${th.primary}"/>`), `<w:spacing w:after="80"/>`),
      ...h.keypoints.map(bullet),
    ].join("");
    parts.push(para("", `<w:spacing w:before="60" w:after="0"/>`));
    parts.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:bidiVisual/>` +
      `<w:tblBorders><w:right w:val="single" w:sz="24" w:space="0" w:color="${th.primary}"/></w:tblBorders>` +
      `<w:tblCellMar><w:top w:w="140" w:type="dxa"/><w:left w:w="200" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="200" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="9638"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="pct"/><w:shd w:val="clear" w:color="auto" w:fill="${th.surface}"/></w:tcPr>${cell}</w:tc></w:tr></w:tbl>`);
  }
  parts.push(para("", "")); // پاراگراف پایانی (لازمه‌ی Word بعد از جدول)

  const NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${parts.join("")}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1134" w:bottom="1000" w:left="1134" w:header="500" w:footer="500" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fa-IR" w:bidi="fa-IR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="360" w:hanging="260"/></w:pPr><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:color w:val="${th.accent}"/></w:rPr></w:lvl></w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const ctypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${relImage}</Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(h.title)}</dc:title><dc:language>fa-IR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", ctypes);
  zip.file("_rels/.rels", rels);
  zip.file("docProps/core.xml", core);
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", stylesXml);
  zip.file("word/numbering.xml", numberingXml);
  zip.file("word/_rels/document.xml.rels", docRels);
  if (o.image && relImage) zip.file(`word/media/image1.${o.image.mime === "image/png" ? "png" : "jpg"}`, o.image.data);
  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
