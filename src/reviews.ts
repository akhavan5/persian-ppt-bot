/** نظرات کاربران روی صفحه‌ی اصلی — داخل دیتابیس (جدول kv) و کم‌هزینه.
 *
 *  - reviews:pub  ← یک ردیف JSON با نظرهای تاییدشده (حداکثر ۴۰). صفحه‌ی اصلی فقط همین یک ردیف را می‌خواند.
 *                   اگر ردیف نبود، یک بار از SEED ساخته می‌شود (نظرهای فروشگاه‌ها و ربات‌ها؛ امتیازِ ستاره فقط برای نظرهایی که با متنشان هم‌خوان است).
 *  - fbk:<شناسه>  ← نظر تازه‌ی کاربر (متن دست‌کم MIN_CHARS نویسه)؛ فقط نام کوچک و متن، بدون ایمیل/موبایل/شناسه‌ی کاربر. ۳۰ روز می‌ماند.
 *                   مدیر زیر پیام «نظر کاربر» دکمه‌ی «✅ نمایش در سایت» را می‌زند ⇒ approveReview آن را به ابتدای reviews:pub اضافه می‌کند.
 *  - HTML بخش نظرات در حافظه‌ی همان Worker یک ساعت نگه داشته می‌شود (و صفحه‌ی اصلی هم در لبه کش است)، پس تقریباً هیچ خواندنی از D1 ندارد. */
import type { Env } from "./env";

export interface Review { n: string; s: string; t: string; r: number; c: number }

const PUB_KEY = "reviews:pub";
const MAX_PUBLIC = 40;
const MIN_CHARS = 15;
const MAX_CHARS = 400;
const PENDING_TTL = 30 * 86_400;
const HTML_TTL_MS = 3_600_000;

/** میانگین امتیاز اپ اندروید (صفحه‌ی مایکت ۴٫۵۲ با ۲۱ امتیاز، کافه‌بازار ۴٫۵ با ۲۱ امتیاز) */
const STORE_RATING = { avg: "۴٫۵", count: "۴۲", myket: "۴٫۵۲", bazaar: "۴٫۵" };

const SEED: Review[] = [
  { n: "کاربر", s: "سایت", r: 5, c: 1, t: "اسلایدها بسیار زیبا بود و کار من رو راه انداخت. خوشحالم که با یه محصول ایرانی می‌تونم این کار رو بکنم … ممنونم از سازندگان این محصول که باعث سربلندی ایرانند" },
  { n: "ماهان", s: "کافه‌بازار", r: 5, c: 2, t: "عالیه، به‌راحتی می‌شه باهاش کار کرد" },
  { n: "علیرضا", s: "مایکت", r: 5, c: 3, t: "عالی بود، حتماً نصبش کنید!" },
  { n: "Aysa", s: "مینی‌اپ بله", r: 0, c: 4, t: "خوب بود، ولی اگه عکس بیشتر و حال‌وهوای هنری و تاریخی داشت خیلی خوب می‌شد" },
  { n: "Zeynab", s: "ربات تلگرام", r: 0, c: 5, t: "همه‌چیز عالی بود ولی تغییر دکوراسیون بده" },
  { n: "حسین", s: "مایکت", r: 5, c: 6, t: "عالی بود، حرف نداره!" },
  { n: "کاربر", s: "مایکت", r: 5, c: 7, t: "عالی و سریع" },
  { n: "sanal", s: "مایکت", r: 5, c: 8, t: "همه‌چیز عالی بود" },
  { n: "کاربر", s: "سایت", r: 0, c: 9, t: "ممنون، عالی بود" },
  { n: "رویا", s: "مینی‌اپ بله", r: 0, c: 10, t: "خیلی خوب است" },
  { n: "سادات", s: "مینی‌اپ بله", r: 0, c: 11, t: "عالی بود" },
  { n: "سیده", s: "مینی‌اپ تلگرام", r: 0, c: 12, t: "عالی بود" },
  { n: "Ava", s: "برنامک ایتا", r: 0, c: 13, t: "عالییییی هست" },
  { n: "هانیه", s: "مینی‌اپ بله", r: 0, c: 14, t: "خوب بود" },
  { n: "مهرداد", s: "مینی‌اپ بله", r: 0, c: 15, t: "عالیه" },
  { n: "مائده", s: "سایت", r: 0, c: 16, t: "عالیه" },
  { n: "زهرا", s: "کافه‌بازار", r: 5, c: 17, t: "عالی" },
  { n: "محمد", s: "کافه‌بازار", r: 0, c: 18, t: "عالی" },
  { n: "اتش", s: "کافه‌بازار", r: 0, c: 19, t: "عالی" },
  { n: "سوگند", s: "مایکت", r: 5, c: 20, t: "عالی" },
  { n: "علی", s: "مایکت", r: 5, c: 21, t: "عااالی" },
  { n: "atash", s: "مایکت", r: 5, c: 22, t: "عالی" },
  { n: "آتریسا", s: "مینی‌اپ بله", r: 0, c: 23, t: "عالی" },
  { n: "Aliasghar", s: "سایت", r: 0, c: 24, t: "عالی" },
  { n: "کاربر", s: "سایت", r: 0, c: 25, t: "عالی" },
  { n: "همین", s: "مایکت", r: 5, c: 26, t: "خوبه" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** فقط نام کوچک؛ ایمیل، شماره، «کاربر ۱۲۳۴» و نام‌های بلند به «کاربر» تبدیل می‌شود */
export function displayFirstName(raw: string): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!name || /[@\d]/.test(name) || /^کاربر/.test(name)) return "کاربر";
  const first = name.split(" ")[0].replace(/[^\p{L}\p{M}\u200c]/gu, "").slice(0, 20);
  return first.length >= 2 ? first : "کاربر";
}

/** نظر تازه را برای تایید مدیر ذخیره می‌کند؛ شناسه‌ی نظر یا null (متن کوتاه) */
export async function savePendingReview(env: Env, o: { name: string; text: string; rating?: number; src: string }): Promise<string | null> {
  const text = o.text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (text.length < MIN_CHARS) return null;
  const id = Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, "0");
  const r = Number.isInteger(o.rating) && (o.rating as number) >= 1 && (o.rating as number) <= 5 ? (o.rating as number) : 0;
  const rec: Review = { n: displayFirstName(o.name), s: o.src.slice(0, 24), t: text, r, c: Date.now() };
  await env.KV.put(`fbk:${id}`, JSON.stringify(rec), { expirationTtl: PENDING_TTL });
  return id;
}

async function loadPublic(env: Env): Promise<Review[]> {
  const cur = (await env.KV.get(PUB_KEY, "json")) as Review[] | null;
  if (Array.isArray(cur)) return cur;
  await env.KV.put(PUB_KEY, JSON.stringify(SEED)); // اولین بار: نظرهای اولیه در دیتابیس
  return SEED;
}

let htmlCache: { t: number; html: string } | null = null;

/** تایید مدیر: نظر به ابتدای فهرست عمومی می‌رود. true = اضافه شد، false = نظر پیدا نشد یا قبلاً بررسی شده */
export async function approveReview(env: Env, id: string): Promise<boolean> {
  if (!/^[a-z0-9]{6,16}$/.test(id)) return false;
  const rec = (await env.KV.get(`fbk:${id}`, "json")) as Review | null;
  if (!rec || !rec.t) return false;
  const list = await loadPublic(env);
  await env.KV.put(PUB_KEY, JSON.stringify([rec, ...list].slice(0, MAX_PUBLIC)));
  await env.KV.delete(`fbk:${id}`);
  htmlCache = null;
  return true;
}

export async function rejectReview(env: Env, id: string): Promise<boolean> {
  if (!/^[a-z0-9]{6,16}$/.test(id)) return false;
  const had = (await env.KV.get(`fbk:${id}`)) !== null;
  await env.KV.delete(`fbk:${id}`);
  return had;
}

function card(v: Review): string {
  const stars = v.r ? `<div class="stars" aria-label="امتیاز ${v.r} از ۵">${"★".repeat(v.r)}${"☆".repeat(5 - v.r)}</div>` : "";
  const ini = esc(Array.from(v.n)[0] ?? "ک");
  return `      <article class="card rv">${stars}<blockquote>«${esc(v.t)}»</blockquote><div class="by"><span class="av" aria-hidden="true">${ini}</span><strong>${esc(v.n)}</strong><span class="src">${esc(v.s)}</span></div></article>\n`;
}

/** HTML کامل بخش نظرات (جایگزین نشانه‌ی <!--REVIEWS--> در صفحه‌ی اصلی)؛ هر خطا ⇒ رشته‌ی خالی تا صفحه سالم بماند */
export async function renderReviewsSection(env: Env): Promise<string> {
  if (htmlCache && Date.now() - htmlCache.t < HTML_TTL_MS) return htmlCache.html;
  try {
    const list = await loadPublic(env);
    if (!list.length) return "";
    const html = `<section class="block" id="reviews" aria-labelledby="rvh">
    <div class="sec-head"><h2 id="rvh">کاربران چه می‌گویند؟</h2><p class="muted">نظرهای واقعی کاربران؛ بدون ویرایش معنا، فقط با نام کوچک.</p></div>
    <div class="card rv-top">
      <div class="rv-score"><b>${STORE_RATING.avg}</b><div class="stars" aria-label="میانگین امتیاز ${STORE_RATING.avg} از ۵">★★★★★</div></div>
      <div class="rv-meta"><strong>میانگین امتیاز اپ اندروید</strong><span class="muted">از ${STORE_RATING.count} امتیاز کاربران</span><div class="chips"><span class="chip2">مایکت ${STORE_RATING.myket}</span><span class="chip2">کافه‌بازار ${STORE_RATING.bazaar}</span></div></div>
    </div>
    <div class="rv-slider" role="region" aria-roledescription="اسلایدر" aria-label="نظرهای کاربران">
    <div class="rv-track" tabindex="0">
${list.map(card).join("")}    </div>
    <div class="rv-nav"><button type="button" class="rv-prev" aria-label="نظر قبلی">›</button><button type="button" class="rv-next" aria-label="نظر بعدی">‹</button></div>
    </div>
    <script>
    (function(){var s=document.getElementById("reviews");if(!s)return;var t=s.querySelector(".rv-track");if(!t)return;
    function dir(){return getComputedStyle(t).direction==="rtl"?-1:1}
    function step(){var c=t.firstElementChild;return c?c.getBoundingClientRect().width+16:t.clientWidth}
    function atEnd(){return Math.abs(t.scrollLeft)+t.clientWidth>=t.scrollWidth-4}
    function atStart(){return Math.abs(t.scrollLeft)<4}
    function go(n){
      if(n>0){if(atEnd())t.scrollTo({left:0,behavior:"smooth"});else t.scrollBy({left:dir()*step(),behavior:"smooth"});}
      else{if(atStart())t.scrollTo({left:dir()*(t.scrollWidth-t.clientWidth),behavior:"smooth"});else t.scrollBy({left:-dir()*step(),behavior:"smooth"});}
    }
    s.querySelector(".rv-next").addEventListener("click",function(){go(1)});
    s.querySelector(".rv-prev").addEventListener("click",function(){go(-1)});
    var tm=0;function stop(){clearInterval(tm)}
    function play(){stop();if(window.matchMedia&&matchMedia("(prefers-reduced-motion:reduce)").matches)return;tm=setInterval(function(){go(1)},5000)}
    ["mouseenter","touchstart","focusin"].forEach(function(e){t.addEventListener(e,stop,{passive:true})});
    ["mouseleave","touchend","focusout"].forEach(function(e){t.addEventListener(e,play,{passive:true})});
    play();
    })();
    </script>
  </section>

  `;
    htmlCache = { t: Date.now(), html };
    return html;
  } catch (e) {
    console.error("reviews", String(e).slice(0, 200));
    return "";
  }
}
