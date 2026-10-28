import type { Env } from "./env";
import { handleUpdate } from "./bot";
import { ADMIN_COMMANDS, BOT_COMMANDS, tg } from "./telegram";
import { DAILY_FREE_CREDITS, adminIds, today } from "./settings";
import { withStore } from "./store";
import { handleWeb } from "./web";
import { miniappUrl } from "./deck-service";
import { findLanding, HTML_HEADERS, landingSitemapEntries, renderLanding } from "./landing";
import { blogFeed, blogSitemapEntries, findBlog, renderBlogIndex, renderPost } from "./blog";

export { DeckWorkflow } from "./workflow";
export { BroadcastWorkflow } from "./broadcast";
export { OcrWorkflow } from "./ocr-workflow";
export { WebOcrWorkflow } from "./web-ocr-workflow";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// سئو: پاسخ‌های API و مسیرهای مدیریتی هرگز نباید ایندکس شوند.
// نکته‌ی مهم: این مسیرها عمداً در robots.txt مسدود نیستند؛ اگر مسدود باشند گوگل هدر noindex را نمی‌بیند
// و آدرس را «Indexed, though blocked by robots.txt» ایندکس می‌کند. گوگل باید بتواند بخزد تا noindex را ببیند.
function noindex(res: Response): Response {
  const r = new Response(res.body, res);
  r.headers.set("x-robots-tag", "noindex, nofollow");
  return r;
}

// درخواست‌هایی که از nginx سرور ایرانی می‌رسند: nginx با Host=workers.dev به Worker وصل می‌شود، پس url.origin اشتباه می‌شد
// (بررسی CSRF، بازگشت از درگاه و ورود گوگل می‌شکست) و IP همه‌ی کاربران IP سرور بود (سقف‌ها مشترک می‌شد).
// فقط اگر هدر X-Proxy-Secret با PROXY_SECRET برابر باشد، دامنه‌ی سایت و IP کاربر از هدرهای nginx گرفته می‌شود.
function fromProxy(req: Request, env: Env): Request {
  const secret = env.PROXY_SECRET;
  const got = req.headers.get("x-proxy-secret") ?? "";
  const trusted = !!secret && !!got && safeEqual(got, secret);
  if (!trusted && !req.headers.has("x-trusted-ip") && !got) return req;
  const h = new Headers(req.headers);
  h.delete("x-trusted-ip"); // کاربر نباید بتواند IP جعلی بفرستد
  h.delete("x-proxy-secret");
  if (!trusted) return new Request(req, { headers: h });
  const ip = req.headers.get("x-client-ip") ?? "";
  if (/^[0-9a-fA-F:.]{3,45}$/.test(ip)) h.set("x-trusted-ip", ip);
  h.delete("x-client-ip"); h.delete("x-forwarded-host");
  const u = new URL(req.url);
  const site = new URL((env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "")).hostname;
  const host = (req.headers.get("x-forwarded-host") ?? "").toLowerCase();
  if (host === site || host === `www.${site}`) { u.protocol = "https:"; u.host = host; }
  return new Request(u.toString(), { method: req.method, headers: h, body: req.body, redirect: "manual" });
}

// تاریخ آخرین تغییر محتوای صفحه‌ی اصلی؛ با هر تغییر مهم محتوا به‌روز شود (YYYY-MM-DD)
const SITEMAP_LASTMOD = "2026-10-18";

export default {
  // پاکسازی روزانه‌ی ردیف‌های منقضی‌شده‌ی D1 (cron در wrangler.jsonc)
  async scheduled(c: ScheduledController, rawEnv: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(withStore(rawEnv).KV.purge().catch((e) => console.error("purge", e)));
    // اعتبار رایگان روزانه + پیام ربات برای کاربران تلگرامِ بدون اعتبار (شناسه‌ی روزانه: اگر cron دوباره اجرا شود کار تکراری ساخته نمی‌شود)
    if (DAILY_FREE_CREDITS > 0) {
      ctx.waitUntil(rawEnv.BROADCAST_WORKFLOW.create({ id: `df-${today()}`, params: { adminChatId: 0, text: "", daily: true } })
        .catch((e) => console.error("daily free workflow", String(e).slice(0, 200))));
    }
  },

  async fetch(rawReq: Request, rawEnv: Env, ctx: ExecutionContext): Promise<Response> {
    const env = withStore(rawEnv);
    const req = fromProxy(rawReq, rawEnv);
    const url = new URL(req.url);
    const SITE = (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");

    // سئو: www به دامنه‌ی اصلی هدایت دائمی می‌شود (جلوگیری از محتوای تکراری)
    if (url.hostname === `www.${new URL(SITE).hostname}`) {
      return Response.redirect(`${SITE}${url.pathname}${url.search}`, req.method === "GET" || req.method === "HEAD" ? 301 : 308);
    }

    // API نسخه‌ی وب (ثبت‌نام، ورود، ساخت ارائه، دانلود)
    if (url.pathname.startsWith("/api/")) return noindex(await handleWeb(req, env, url));

    // وبهوک تلگرام — تلگرام هدر محرمانه را روی هر درخواست می‌فرستد
    if (url.pathname === "/telegram" && req.method !== "POST") {
      return noindex(new Response("method not allowed", { status: 405, headers: { allow: "POST" } }));
    }
    if (url.pathname === "/telegram" && req.method === "POST") {
      const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
      if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(got, env.TELEGRAM_WEBHOOK_SECRET)) {
        return noindex(new Response("forbidden", { status: 403 }));
      }
      const update = await req.json();
      // فوراً ۲۰۰ برمی‌گردانیم تا تلگرام درخواست را تکرار نکند؛ کار اصلی در Workflow انجام می‌شود
      ctx.waitUntil(handleUpdate(env, update).catch(async (e) => {
        console.error("handleUpdate", e);
        // ربات بی‌صدا نماند؛ جزئیات خطا فقط در لاگ ثبت می‌شود
        const chatId = (update as any)?.message?.chat?.id ?? (update as any)?.callback_query?.message?.chat?.id;
        if (chatId) await tg(env, "sendMessage", { chat_id: chatId, text: "⚠️ مشکلی پیش آمد. چند لحظه بعد دوباره امتحان کن." }).catch(() => {});
      }));
      return noindex(new Response("ok"));
    }

    // ثبت وبهوک: یک بار در مرورگر باز کن → /setup?secret=<TELEGRAM_WEBHOOK_SECRET>
    if (url.pathname === "/setup") {
      const secret = url.searchParams.get("secret") ?? "";
      if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
        return noindex(new Response("forbidden", { status: 403 }));
      }
      await tg(env, "setWebhook", {
        url: `${url.origin}/telegram`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
      await tg(env, "setMyCommands", { commands: BOT_COMMANDS });
      // دکمه‌ی منوی ربات (کنار کادر پیام) Mini App را باز می‌کند؛ آدرس مستقیم Worker است (بدون واسطه)
      // \u200E (LRM) اول متن: در تلگرامِ اندروید با رابط انگلیسی، برچسب فارسی (راست‌به‌چپ) بیرون از دکمه و روی کادر پیام کشیده می‌شد؛ با LRM جهت پاراگراف چپ‌به‌راست می‌شود و متن داخل دکمه می‌ماند
      await tg(env, "setChatMenuButton", { menu_button: { type: "web_app", text: "\u200Eساخت ارائه", web_app: { url: `${miniappUrl(env)}/app` } } }).catch((e) => console.error("menu button", e));
      // منوی کامل‌تر فقط برای چت خود مدیرها
      for (const id of adminIds(env)) {
        await tg(env, "setMyCommands", { commands: ADMIN_COMMANDS, scope: { type: "chat", chat_id: Number(id) } }).catch((e) => console.error("admin commands", e));
      }
      const info = await tg(env, "getWebhookInfo");
      return noindex(Response.json({ ok: true, webhook: info.url, pending: info.pending_update_count }));
    }

    // اپ اندروید (TWA برای کافه بازار): تأیید پیوند دامنه و اپ با اثر انگشت SHA-256 کلید امضا (از متغیرهای ANDROID_* خوانده می‌شود)
    if (url.pathname === "/.well-known/assetlinks.json") {
      const prints = (env.ANDROID_CERT_SHA256 || "").split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
      const body = [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: env.ANDROID_PACKAGE || "ir.pptsaz.app", sha256_cert_fingerprints: prints } }];
      return new Response(JSON.stringify(body, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
    }
    // لینک اشتراک‌گذاری: اگر اپ اندروید نصب باشد (App Links) مستقیم در اپ باز می‌شود؛ وگرنه کاربر به صفحه‌ی ساخت وب می‌رود.
    // نمونه: /open?topic=هوش مصنوعی در آموزش  (پارامتر tab فقط برای اپ است)
    if (url.pathname === "/open" && (req.method === "GET" || req.method === "HEAD")) {
      const t = (url.searchParams.get("topic") || "").replace(/\s+/g, " ").trim().slice(0, 300);
      return noindex(Response.redirect(`${SITE}/${t.length >= 3 ? `?topic=${encodeURIComponent(t)}` : ""}`, 302));
    }
    // تأیید مالکیت در وب‌مستر یاندکس (مستقیم از Worker تا ریدایرکت .html کلودفلر مانعش نشود)
    if (url.pathname === "/yandex_85baee77d3c502ea.html") {
      return new Response(`<html>\n    <head>\n        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n    </head>\n    <body>Verification: 85baee77d3c502ea</body>\n</html>\n`, { headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "public, max-age=3600" } });
    }
    // سئو: robots و sitemap با دامنه‌ی واقعی سایت ساخته می‌شوند
    if (url.pathname === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\n# یاندکس: پارامتر topic (پیشنهاد موضوع روی صفحه‌ی اصلی) صفحه‌ی تکراری حساب نشود\nClean-param: topic /\n\nSitemap: ${SITE}/sitemap.xml\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    if (url.pathname === "/sitemap.xml") {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${SITE}/</loc>\n    <lastmod>${SITEMAP_LASTMOD}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n${landingSitemapEntries(SITE)}${blogSitemapEntries(SITE)}</urlset>\n`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    // فید RSS وبلاگ
    if (url.pathname === "/feed.xml" && (req.method === "GET" || req.method === "HEAD")) {
      return new Response(req.method === "HEAD" ? null : blogFeed(SITE), { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    // صفحه‌های سئو (دانشجویی، دفاع پایان‌نامه، معلمان، ...): HTML از landing.ts ساخته می‌شود
    const landing = findLanding(url.pathname);
    if (landing) {
      if (landing.trailingSlash) return Response.redirect(`${SITE}/${landing.page.slug}${url.search}`, 301);
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      const html = renderLanding(landing.page, SITE);
      return new Response(req.method === "HEAD" ? null : html, { headers: HTML_HEADERS });
    }
    // وبلاگ: فهرست /blog و مقاله‌ها /blog/<slug> (HTML از blog.ts ساخته می‌شود)
    const blog = findBlog(url.pathname);
    if (blog) {
      if (blog.kind === "trailing") return Response.redirect(`${SITE}${blog.to}${url.search}`, 301);
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      const html = blog.kind === "index" ? renderBlogIndex(SITE) : renderPost(blog.post, SITE);
      return new Response(req.method === "HEAD" ? null : html, { headers: HTML_HEADERS });
    }
    // صفحه‌ی اصلی: نشانه‌ی __ORIGIN__ (canonical، og:url، داده‌ی ساختاریافته) با دامنه‌ی واقعی جایگزین می‌شود
    if (url.pathname === "/" && (req.method === "GET" || req.method === "HEAD")) {
      const res = await env.ASSETS.fetch(req);
      if (!res.ok) return res;
      const h = new Headers(res.headers);
      h.delete("content-length"); h.set("cache-control", HTML_HEADERS["cache-control"]); h.set("content-type", "text/html; charset=utf-8"); h.set("content-language", "fa"); h.set("vary", "Accept-Encoding");
      return new Response((await res.text()).replaceAll("__ORIGIN__", SITE), { status: 200, headers: h });
    }

    // هر چیز دیگر: صفحه‌ی وب و فایل‌های استاتیک (پوشه‌ی public)
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
