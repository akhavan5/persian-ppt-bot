/** فونت‌های جاسازی‌شده در PPTX (قالب EOT برای PowerPoint) */
import vazirRegular from "./fonts/Vazirmatn-Regular.fntdata";
import vazirBold from "./fonts/Vazirmatn-Bold.fntdata";
import type { EmbeddedFont } from "./embed-font";

export const VAZIR: EmbeddedFont = {
  typeface: "Vazirmatn",
  regular: new Uint8Array(vazirRegular),
  bold: new Uint8Array(vazirBold),
};
