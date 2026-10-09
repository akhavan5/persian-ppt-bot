/**
 * جاسازی فونت Vazirmatn داخل فایل PPTX (قالب استاندارد PowerPoint: ppt/fonts/*.fntdata + embeddedFontLst).
 * فونت‌ها از قبل به قالب EOT (بدون فشرده‌سازی) تبدیل و در src/fonts ذخیره شده‌اند.
 * wrangler.jsonc: قانون Data برای *.fntdata ⇒ بایت‌ها بدون هزینه‌ی CPU در Worker در دسترس‌اند.
 */
import JSZip from "jszip";

export interface EmbeddedFont { typeface: string; regular: Uint8Array; bold?: Uint8Array }

const REL_FONT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";

export async function embedFonts(pptx: Uint8Array, fonts: EmbeddedFont[]): Promise<Uint8Array> {
  if (!fonts.length) return pptx;
  const zip = await JSZip.loadAsync(pptx);

  const relsPath = "ppt/_rels/presentation.xml.rels";
  let rels = await zip.file(relsPath)!.async("string");
  let pres = await zip.file("ppt/presentation.xml")!.async("string");
  let ct = await zip.file("[Content_Types].xml")!.async("string");

  let n = 0;
  const lst: string[] = [];
  const add = (data: Uint8Array) => {
    n++;
    const id = `rIdFont${n}`;
    zip.file(`ppt/fonts/font${n}.fntdata`, data, { compression: "STORE", createFolders: false });
    rels = rels.replace("</Relationships>", `<Relationship Id="${id}" Type="${REL_FONT}" Target="fonts/font${n}.fntdata"/></Relationships>`);
    return id;
  };
  for (const f of fonts) {
    const r = add(f.regular);
    const b = f.bold ? add(f.bold) : "";
    lst.push(`<p:embeddedFont><p:font typeface="${f.typeface}"/><p:regular r:id="${r}"/>${b ? `<p:bold r:id="${b}"/>` : ""}</p:embeddedFont>`);
  }
  const block = `<p:embeddedFontLst>${lst.join("")}</p:embeddedFontLst>`;

  // ترتیب طبق اسکیما: بعد از notesSz و پیش از defaultTextStyle
  if (/<p:notesSz[^>]*\/>/.test(pres)) pres = pres.replace(/(<p:notesSz[^>]*\/>)/, `$1${block}`);
  else if (pres.includes("<p:defaultTextStyle")) pres = pres.replace("<p:defaultTextStyle", `${block}<p:defaultTextStyle`);
  else pres = pres.replace("</p:presentation>", `${block}</p:presentation>`);
  if (!/embedTrueTypeFonts=/.test(pres)) pres = pres.replace("<p:presentation ", '<p:presentation embedTrueTypeFonts="1" ');

  if (!/Extension="fntdata"/i.test(ct)) ct = ct.replace(/(<Types[^>]*>)/, `$1<Default Extension="fntdata" ContentType="application/x-fontdata"/>`);

  zip.file(relsPath, rels);
  zip.file("ppt/presentation.xml", pres);
  zip.file("[Content_Types].xml", ct);
  // STORE: بدون فشرده‌سازی تا CPU پلن رایگان مصرف نشود
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}
