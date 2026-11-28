# تغییرات سئو (۶ آذر ۱۴۰۵)

## فایل‌های جدید
- `src/landing-data-kw.ts` — ۴ لندینگ: site-powerpoint-maker، powerpoint-maker-app، student-powerpoint-template، table-slide-maker (+ FAQ تازه برای ۲۰ صفحه‌ی موجود)
- `src/blog-data-kw.ts` — ۱۰ مقاله‌ی جدید (+ FAQ تازه برای ۶ مقاله‌ی موجود)
- `public/img/**` — تصویر hero/steps/og همه‌ی صفحه‌های جدید (با `scripts/gen-seo-images.py`)

## فایل‌های ویرایش‌شده
- `src/landing-data.ts`، `src/blog-data.ts` — ثبت فایل‌های جدید
- `src/landing.ts`، `src/blog.ts` — لینک‌دهی دوطرفه (KW_ARTICLES، KW_RELATED، KW_POST_RELATED)
- `wrangler.jsonc` — ۴ مسیر لندینگ جدید در `run_worker_first` (بدون این، روی Cloudflare ۴۰۴ می‌شوند)
- `public/index.html` — meta keywords
- `public/llms.txt` — صفحه‌ها و مقاله‌های جدید؛ اصلاح «رایگان تا ۸ اسلاید» به ۶ (طبق `FREE_MAX_SLIDES`)
- `src/index.ts` — SITEMAP_LASTMOD

sitemap، JSON-LD، breadcrumb و فهرست وبلاگ و فوتر خودکار از داده‌ها ساخته می‌شوند.

## اصلاح‌های سئوی موجود (دور دوم)
- کوتاه‌کردن ۴۵ عنوان (title) که بیش از ۶۶ کاراکتر بودند و در گوگل بریده می‌شدند؛ کلیدواژه‌ی اصلی هر عنوان حفظ شده.
- افزودن `kw` به ۲۶ مقاله که نداشتند (برای keywords داده‌ی ساختاریافته).
- به‌روزرسانی `updated` (lastmod در sitemap) برای صفحه‌های تغییرکرده.
