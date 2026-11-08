// خروجی JSON از صفحه‌ها و مقاله‌ها برای scripts/gen-seo-images.py (تولید تصویرهای سئو)
// اجرا: npx tsx scripts/dump-seo-data.ts out.json
import { writeFileSync } from "node:fs";
import { PAGES } from "../src/landing-data";
import { POSTS } from "../src/blog-data";

const stepsSec = (secs: { h2: string; steps?: { t: string; d: string }[] }[]) => secs.find((x) => x.steps && x.steps.length >= 3);
const out = {
  pages: PAGES.map((p) => ({ slug: p.slug, nav: p.nav, h1: p.h1.join(""), audience: p.audience ?? "", steps: stepsSec(p.sections)?.steps?.map((s) => s.t) ?? [], stepsH2: stepsSec(p.sections)?.h2 ?? "" })),
  posts: POSTS.map((p) => ({ slug: p.slug, nav: p.nav, h1: p.h1, category: p.category, steps: stepsSec(p.sections)?.steps?.map((s) => s.t) ?? [], stepsH2: stepsSec(p.sections)?.h2 ?? "" })),
};
writeFileSync(process.argv[2] || "seo-data.json", JSON.stringify(out));
console.log(`pages=${out.pages.length} posts=${out.posts.length}`);
