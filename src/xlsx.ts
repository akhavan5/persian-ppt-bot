/**
 * ساخت فایل Excel (.xlsx) ساده با JSZip: یک برگه‌ی راست‌به‌چپ با سطر عنوان رنگی و ثابت، فیلتر، عرض ستون‌ها و سلول‌های متنی/عددی.
 * چرا به‌جای CSV: اکسلِ ویندوزِ فارسی/عربی معمولاً جداکننده‌ی «،» یا «;» را می‌خواهد و CSV با ویرگول را در یک سلول می‌ریزد؛
 * شماره‌ی موبایل هم صفر اولش را از دست می‌دهد. در xlsx همه‌ی این‌ها درست می‌ماند.
 */
import JSZip from "jszip";

export type XCell = string | number | null | undefined;

const X = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => { let n = i + 1, s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

/** فایل‌های داخل بسته‌ی xlsx (مسیر ← متن)؛ جدا از فشرده‌سازی تا قابل آزمون باشد */
export function xlsxParts(sheetName: string, headers: string[], rows: XCell[][], widths: number[] = []): Record<string, string> {
  const nCols = headers.length, nRows = rows.length + 1;
  const cell = (v: XCell, r: number, c: number, style = 0): string => {
    const ref = `${colName(c)}${r}`;
    if (v === null || v === undefined || v === "") return style ? `<c r="${ref}" s="${style}"/>` : "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${v}</v></c>`;
    return `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${X(String(v))}</t></is></c>`;
  };
  const head = `<row r="1" ht="24" customHeight="1">${headers.map((h, c) => cell(h, 1, c, 1)).join("")}</row>`;
  const body = rows.map((row, i) => `<row r="${i + 2}">${row.map((v, c) => cell(v, i + 2, c)).join("")}</row>`).join("");
  const cols = `<cols>${headers.map((_, c) => `<col min="${c + 1}" max="${c + 1}" width="${widths[c] ?? 16}" customWidth="1"/>`).join("")}</cols>`;
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView rightToLeft="1" workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="18"/>${cols}<sheetData>${head}${body}</sheetData>` +
    `<autoFilter ref="A1:${colName(nCols - 1)}${nRows}"/></worksheet>`;
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const name = X(sheetName.replace(/[\\/?*\[\]:]/g, " ").slice(0, 31) || "Sheet1");
  return {
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": styles,
    "xl/worksheets/sheet1.xml": sheet,
  };
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function buildXlsx(sheetName: string, headers: string[], rows: XCell[][], widths: number[] = []): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(xlsxParts(sheetName, headers, rows, widths))) zip.file(path, text);
  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
