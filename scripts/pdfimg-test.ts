import { countPdfPages, extractPdfImages } from "../src/pdf-images";
const mk = (s: string) => new TextEncoder().encode(s);
const pdf = mk("%PDF-1.4\n1 0 obj\n<< /Type /Pages >>\nendobj\n2 0 obj\n<< /Type /Page /Parent 1 0 R >>\nendobj\n3 0 obj\n<< /Type /Page >>\nendobj\n");
const n = countPdfPages(pdf);
const r = await extractPdfImages(pdf, undefined, { limit: 12, maxBytes: 4_000_000 });
console.log("pages", n, "extract pages", r.pages, "images", r.images.length);
if (n !== 2 || r.pages !== 2 || r.images.length !== 0) { console.log("FAIL"); process.exit(1); }
console.log("PASS");
