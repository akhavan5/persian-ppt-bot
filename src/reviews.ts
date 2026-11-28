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

/** نظرهایی که باید از سایت حذف شوند (حتی اگر قبلاً در ردیف reviews:pub ذخیره شده باشند) */
const HIDDEN = (v: Review) => (v.n === "Aysa" && v.c === 4) || (v.n === "Zeynab" && v.c === 5);

const SEED: Review[] = [
  { n: "کاربر", s: "سایت", r: 5, c: 1, t: "اسلایدها بسیار زیبا بود و کار من رو راه انداخت. خوشحالم که با یه محصول ایرانی می‌تونم این کار رو بکنم … ممنونم از سازندگان این محصول که باعث سربلندی ایرانند" },
  { n: "ماهان", s: "کافه‌بازار", r: 5, c: 2, t: "عالیه، به‌راحتی می‌شه باهاش کار کرد" },
  { n: "علیرضا", s: "مایکت", r: 5, c: 3, t: "عالی بود، حتماً نصبش کنید!" },
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
  if (Array.isArray(cur)) return cur.filter((v) => !HIDDEN(v));
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

/** فهرست نظرهای منتشرشده‌ی سایت برای پنل مدیر (به همان ترتیب نمایش در سایت) */
export async function listPublicReviews(env: Env): Promise<Review[]> {
  return await loadPublic(env);
}

/** حذف یک نظر منتشرشده با شناسه‌ی c؛ true = حذف شد، false = پیدا نشد */
export async function removePublicReview(env: Env, c: number): Promise<boolean> {
  if (!Number.isFinite(c)) return false;
  const list = await loadPublic(env);
  const next = list.filter((v) => v.c !== c);
  if (next.length === list.length) return false;
  await env.KV.put(PUB_KEY, JSON.stringify(next));
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
    <div class="rv-view" tabindex="0" aria-live="off">
    <div class="rv-track">
${list.map(card).join("")}    </div>
    </div>
    <div class="rv-nav"><button type="button" class="rv-prev" aria-label="نظر قبلی"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button><div class="rv-dots" aria-hidden="true"></div><button type="button" class="rv-next" aria-label="نظر بعدی"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button></div>
    </div>
    <script>
    (function(){
    var root=document.querySelector("#reviews .rv-slider");if(!root)return;
    var view=root.querySelector(".rv-view"),track=root.querySelector(".rv-track"),dotsBox=root.querySelector(".rv-dots");
    var cards=track.children,n=cards.length;if(!n)return;
    var idx=0,pv=1,step=1,max=0,sign=1,pages=1,timer=0,drag=null,moved=false;
    function measure(){
      var gap=parseFloat(getComputedStyle(track).columnGap)||16,w=cards[0].getBoundingClientRect().width;
      step=w+gap;pv=Math.max(1,Math.round((view.clientWidth+gap)/step));
      max=Math.max(0,n-pv);sign=getComputedStyle(view).direction==="rtl"?1:-1;
      if(idx>max)idx=max;
    }
    function clamp(i){return Math.max(0,Math.min(max,i))}
    function buildDots(){
      pages=Math.ceil(n/pv);dotsBox.innerHTML="";
      if(pages<2){dotsBox.style.display="none";return}
      dotsBox.style.display="";
      for(var i=0;i<pages;i++){(function(i){var b=document.createElement("button");b.type="button";b.setAttribute("aria-label","صفحه "+(i+1));
        b.addEventListener("click",function(){show(clamp(i*pv));restart()});dotsBox.appendChild(b)})(i)}
    }
    function paint(){
      track.style.transform="translate3d("+(sign*idx*step)+"px,0,0)";
      var cur=idx>=max?pages-1:Math.floor(idx/pv);
      for(var i=0;i<dotsBox.children.length;i++){
        if(i===cur)dotsBox.children[i].setAttribute("aria-current","true");else dotsBox.children[i].removeAttribute("aria-current");
      }
    }
    function show(i){idx=clamp(i);paint()}
    function next(){show(idx>=max?0:idx+pv)}
    function prev(){show(idx<=0?max:idx-pv)}
    root.querySelector(".rv-next").addEventListener("click",function(){next();restart()});
    root.querySelector(".rv-prev").addEventListener("click",function(){prev();restart()});
    /* کشیدن با لمس و ماوس */
    view.addEventListener("pointerdown",function(e){
      if(e.pointerType==="mouse"&&e.button!==0)return;
      drag={x:e.clientX,y:e.clientY,id:e.pointerId,on:false,t:Date.now()};moved=false;stop();
    });
    view.addEventListener("pointermove",function(e){
      if(!drag||e.pointerId!==drag.id)return;
      var dx=e.clientX-drag.x;
      if(!drag.on){
        if(Math.abs(dx)<6)return;
        if(Math.abs(e.clientY-drag.y)>Math.abs(dx)&&e.pointerType!=="mouse"){drag=null;return}
        drag.on=true;moved=true;view.classList.add("drag");
        try{view.setPointerCapture(e.pointerId)}catch(_){}
      }
      /* کمی مقاومت در دو سر اسلایدر */
      var pos=sign*idx*step+dx,lo=Math.min(0,sign*max*step),hi=Math.max(0,sign*max*step);
      if(pos>hi)pos=hi+(pos-hi)*.3;else if(pos<lo)pos=lo+(pos-lo)*.3;
      track.style.transform="translate3d("+pos+"px,0,0)";
    });
    function end(e){
      if(!drag||(e&&e.pointerId!==drag.id))return;
      var d=drag;drag=null;view.classList.remove("drag");
      if(!d.on){play();return}
      var dx=(e?e.clientX:d.x)-d.x,fast=Date.now()-d.t<280&&Math.abs(dx)>30;
      var t=Math.round(idx+sign*dx/step);
      if(t===idx&&(fast||Math.abs(dx)>step*.15))t=idx+(sign*dx>0?1:-1);
      show(clamp(t));play();
    }
    view.addEventListener("pointerup",end);view.addEventListener("pointercancel",end);
    view.addEventListener("click",function(e){if(moved){e.preventDefault();e.stopPropagation();moved=false}},true);
    view.addEventListener("dragstart",function(e){e.preventDefault()});
    /* کیبورد */
    view.addEventListener("keydown",function(e){
      var k=e.key;if(k!=="ArrowLeft"&&k!=="ArrowRight")return;
      e.preventDefault();var fwd=(k==="ArrowLeft")===(sign===1);fwd?next():prev();restart();
    });
    /* پخش خودکار */
    function stop(){clearInterval(timer);timer=0}
    function play(){stop();if(window.matchMedia&&matchMedia("(prefers-reduced-motion:reduce)").matches)return;timer=setInterval(function(){if(!document.hidden)next()},5000)}
    function restart(){play()}
    view.addEventListener("mouseenter",stop);view.addEventListener("mouseleave",function(){if(!drag)play()});
    view.addEventListener("focusin",stop);view.addEventListener("focusout",play);
    var rt=0;window.addEventListener("resize",function(){clearTimeout(rt);rt=setTimeout(function(){measure();buildDots();paint()},120)});
    measure();buildDots();paint();play();
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
