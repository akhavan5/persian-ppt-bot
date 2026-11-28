/**
 * جاسازی صدا «داخل خود اسلایدها» در یک فایل PPTX که قبلاً با PptxGenJS ساخته شده (ارائه از نو ساخته نمی‌شود).
 * برای هر اسلاید:
 *  • فایل صوتی (MP3 یا WAV) در ppt/media گذاشته می‌شود و یک آیکن بلندگو (p:pic با a:audioFile) پایین‌راست اسلاید می‌آید؛
 *  • با گزینه‌ی autoPlay، صدا به‌محض نمایش اسلاید خودکار پخش می‌شود (مثل Start: Automatically در پاورپوینت) و آیکن در نمایش مخفی است؛
 *  • با گزینه‌ی autoAdvance، اسلاید بعد از پایان صدا (+ کمی مکث) خودکار عوض می‌شود تا ارائه مثل یک ویدیوی روایت‌شده پیش برود.
 * خروجی بدون فشرده‌سازی (STORE) ساخته می‌شود تا CPU کمی مصرف شود؛ همان کاری که pptx.ts هم می‌کند.
 */
import type { OutLang } from "./lang";
import JSZip from "jszip";
import { AUDIO_ICON_B64 } from "./audio-icon";
import { audioSeconds } from "./wav";

export interface SlideAudio {
  /** شماره‌ی فایل اسلاید در PPTX (slideN.xml، از ۱)؛ برای اسلاید i از ارائه: pptxSlideNo(template, i) */
  slide: number;
  /** صدا: MP3 (پیش‌فرض خروجی mp3.ts؛ حجم حدود یک‌دهم) یا WAV؛ نوع از روی همین فیلد معلوم می‌شود. اگر هر دو بود MP3 */
  mp3?: Uint8Array;
  wav?: Uint8Array;
}
export interface EmbedOptions {
  /** پخش خودکار با نمایش اسلاید (پیش‌فرض بله) */
  autoPlay?: boolean;
  /** رفتن خودکار به اسلاید بعد پس از پایان صدا (پیش‌فرض بله) */
  autoAdvance?: boolean;
  /** ارائه‌ی انگلیسی (چپ‌به‌راست): شماره‌ی اسلاید پایین‌راست است، پس آیکن صدا پایین‌چپ می‌رود */
  ltr?: boolean;
}

/** شماره‌ی slideN.xml برای اسلاید i (از صفر) ارائه؛ در قالب آکادمیک اسلاید «بسم‌الله» پیش از همه در PPTX هست (مثل pptxImageName در files.ts) */
export const pptxSlideNo = (template: string | undefined, i: number, lang?: OutLang) => i + 1 + (template === "academic" && lang !== "en" ? 1 : 0); // انگلیسی: اسلاید «بسم‌الله» ساخته نمی‌شود

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_MEDIA = "http://schemas.microsoft.com/office/2007/relationships/media"; // همان نوعی که خود پاورپوینت برای p14:media می‌نویسد
const EMU = 914400;
const SLIDE_W = 13.333;
const ICON = { x: SLIDE_W - 0.95, y: 6.9, size: 0.4 }; // اینچ؛ پایین‌راست (شماره‌ی اسلاید چپ و واترمارک وسط است، نوار پیشرفت قالب آکادمیک بالاتر تمام می‌شود)
const ADVANCE_PAD_MS = 1200;

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function timingXml(spid: number): string {
  // ساختار همان چیزی است که پاورپوینت برای «Start: Automatically» روی یک فایل صوتی می‌نویسد
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>` +
    `<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>` +
    `<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
    `<p:par><p:cTn id="5" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
    `<p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="6" dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:cmd>` +
    `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>` +
    `<p:audio><p:cMediaNode vol="80000"><p:cTn id="7" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst>` +
    `<p:endCondLst><p:cond evt="onStopAudio" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cMediaNode></p:audio>` +
    `</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
}

function picXml(id: number, n: number, rAudio: string, rMedia: string, rImg: string, ltr = false): string {
  const e = (v: number) => Math.round(v * EMU);
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Audio ${n}" descr="صدای اسلاید"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr>` +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr><a:audioFile r:link="${rAudio}"/>` +
    `<p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="${rMedia}"/></p:ext></p:extLst></p:nvPr></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rImg}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${e(ltr ? 0.55 : ICON.x)}" y="${e(ICON.y)}"/><a:ext cx="${e(ICON.size)}" cy="${e(ICON.size)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/** pptx: فایل PPTX ساخته‌شده توسط buildPptx. خروجی: PPTX جدید + شماره‌ی اسلایدهایی که صدا گرفتند. */
export async function embedAudio(pptx: Uint8Array | ArrayBuffer, items: SlideAudio[], o: EmbedOptions = {}): Promise<{ bytes: Uint8Array; embedded: number[] }> {
  const autoPlay = o.autoPlay !== false, autoAdvance = o.autoAdvance !== false;
  const zip = await JSZip.loadAsync(pptx);

  // نوع محتوای wav و mp3 (و png برای آیکن) باید در [Content_Types].xml باشد
  const ctFile = zip.file("[Content_Types].xml");
  if (!ctFile) throw new Error("invalid pptx: [Content_Types].xml missing");
  let ct = await ctFile.async("string");
  const addDefault = (ext: string, type: string) => {
    if (!new RegExp(`Extension="${ext}"`, "i").test(ct)) ct = ct.replace(/(<Types[^>]*>)/, `$1<Default Extension="${ext}" ContentType="${type}"/>`);
  };
  addDefault("wav", "audio/wav");
  addDefault("mp3", "audio/mpeg");
  addDefault("png", "image/png");
  zip.file("[Content_Types].xml", ct);
  zip.file("ppt/media/audio-icon.png", b64ToBytes(AUDIO_ICON_B64));

  const embedded: number[] = [];
  for (const it of [...items].sort((a, b) => a.slide - b.slide)) {
    const slidePath = `ppt/slides/slide${it.slide}.xml`;
    const relsPath = `ppt/slides/_rels/slide${it.slide}.xml.rels`;
    const sf = zip.file(slidePath), rf = zip.file(relsPath);
    if (!sf || !rf) continue; // شماره‌ی اسلاید با فایل نمی‌خواند؛ این اسلاید بدون صدا می‌ماند
    let xml = await sf.async("string");
    let rels = await rf.async("string");
    if (!xml.includes("</p:spTree>") || !rels.includes("</Relationships>")) continue;

    const nextR = Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1;
    const [rAudio, rMedia, rImg] = [`rId${nextR}`, `rId${nextR + 1}`, `rId${nextR + 2}`];
    const audio = it.mp3 ?? it.wav;
    if (!audio) continue;
    const mediaName = `audio-slide${it.slide}.${it.mp3 ? "mp3" : "wav"}`;
    zip.file(`ppt/media/${mediaName}`, audio);
    rels = rels.replace("</Relationships>",
      `<Relationship Id="${rAudio}" Type="${REL}/audio" Target="../media/${mediaName}"/>` +
      `<Relationship Id="${rMedia}" Type="${REL_MEDIA}" Target="../media/${mediaName}"/>` +
      `<Relationship Id="${rImg}" Type="${REL}/image" Target="../media/audio-icon.png"/></Relationships>`);

    const spid = Math.max(1, ...[...xml.matchAll(/<p:cNvPr[^>]*\sid="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
    xml = xml.replace("</p:spTree>", `${picXml(spid, it.slide, rAudio, rMedia, rImg, o.ltr === true)}</p:spTree>`);
    let tail = "";
    if (autoAdvance && !xml.includes("<p:transition")) tail += `<p:transition spd="slow" advTm="${Math.ceil(audioSeconds(audio) * 1000) + ADVANCE_PAD_MS}"/>`;
    if (autoPlay && !xml.includes("<p:timing")) tail += timingXml(spid);
    if (tail) xml = xml.replace(/<\/p:sld>\s*$/, `${tail}</p:sld>`);

    zip.file(slidePath, xml);
    zip.file(relsPath, rels);
    embedded.push(it.slide);
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  return { bytes, embedded };
}
