import type { Env } from "./env";
import { handleUpdate } from "./bot";
import { ADMIN_COMMANDS, BOT_COMMANDS, tg } from "./telegram";
import { adminIds } from "./settings";
import { handleWeb } from "./web";
import { findLanding, landingSitemapEntries, renderLanding } from "./landing";
import { blogSitemapEntries, findBlog, renderBlogIndex, renderPost } from "./blog";

export { DeckWorkflow } from "./workflow";
export { BroadcastWorkflow } from "./broadcast";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// سئو: پاسخ‌های API و مسیرهای مدیریتی هرگز نباید ایندکس شوند
function noindex(res: Response): Response {
  const r = new Response(res.body, res);
  r.headers.set("x-robots-tag", "noindex, nofollow");
  return r;
}

// تاریخ آخرین تغییر محتوای صفحه‌ی اصلی؛ با هر تغییر مهم محتوا به‌روز شود (YYYY-MM-DD)
const SITEMAP_LASTMOD = "2026-10-05";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const SITE = (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");

    // سئو: www به دامنه‌ی اصلی هدایت دائمی می‌شود (جلوگیری از محتوای تکراری)
    if (url.hostname === `www.${new URL(SITE).hostname}`) {
      return Response.redirect(`${SITE}${url.pathname}${url.search}`, req.method === "GET" || req.method === "HEAD" ? 301 : 308);
    }

    // API نسخه‌ی وب (ثبت‌نام، ورود، ساخت ارائه، دانلود)
    if (url.pathname.startsWith("/api/")) return noindex(await handleWeb(req, env, url));

    // وبهوک تلگرام — تلگرام هدر محرمانه را روی هر درخواست می‌فرستد
    if (url.pathname === "/telegram" && req.method === "POST") {
      const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
      if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(got, env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await req.json();
      // فوراً ۲۰۰ برمی‌گردانیم تا تلگرام درخواست را تکرار نکند؛ کار اصلی در Workflow انجام می‌شود
      ctx.waitUntil(handleUpdate(env, update).catch(async (e) => {
        console.error("handleUpdate", e);
        // ربات بی‌صدا نماند؛ جزئیات خطا فقط در لاگ ثبت می‌شود
        const chatId = (update as any)?.message?.chat?.id ?? (update as any)?.callback_query?.message?.chat?.id;
        if (chatId) await tg(env, "sendMessage", { chat_id: chatId, text: "⚠️ مشکلی پیش آمد. چند لحظه بعد دوباره امتحان کن." }).catch(() => {});
      }));
      return new Response("ok");
    }

    // ثبت وبهوک: یک بار در مرورگر باز کن → /setup?secret=<TELEGRAM_WEBHOOK_SECRET>
    if (url.pathname === "/setup") {
      const secret = url.searchParams.get("secret") ?? "";
      if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response("forbidden", { status: 403 });
      }
      await tg(env, "setWebhook", {
        url: `${url.origin}/telegram`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
      await tg(env, "setMyCommands", { commands: BOT_COMMANDS });
      // منوی کامل‌تر فقط برای چت خود مدیرها
      for (const id of adminIds(env)) {
        await tg(env, "setMyCommands", { commands: ADMIN_COMMANDS, scope: { type: "chat", chat_id: Number(id) } }).catch((e) => console.error("admin commands", e));
      }
      const info = await tg(env, "getWebhookInfo");
      return Response.json({ ok: true, webhook: info.url, pending: info.pending_update_count });
    }

    // تأیید مالکیت در وب‌مستر یاندکس (مستقیم از Worker تا ریدایرکت .html کلودفلر مانعش نشود)
    if (url.pathname === "/yandex_85baee77d3c502ea.html") {
      return new Response(`<html>\n    <head>\n        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n    </head>\n    <body>Verification: 85baee77d3c502ea</body>\n</html>\n`, { headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "public, max-age=3600" } });
    }
    // سئو: robots و sitemap با دامنه‌ی واقعی سایت ساخته می‌شوند
    if (url.pathname === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /setup\nDisallow: /telegram\n\nSitemap: ${SITE}/sitemap.xml\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    if (url.pathname === "/sitemap.xml") {
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${SITE}/</loc>\n    <lastmod>${SITEMAP_LASTMOD}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n${landingSitemapEntries(SITE)}${blogSitemapEntries(SITE)}</urlset>\n`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
    }
    // صفحه‌های سئو (دانشجویی، دفاع پایان‌نامه، معلمان، ...): HTML از landing.ts ساخته می‌شود
    const landing = findLanding(url.pathname);
    if (landing) {
      if (landing.trailingSlash) return Response.redirect(`${SITE}/${landing.page.slug}${url.search}`, 301);
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      const html = renderLanding(landing.page, SITE);
      return new Response(req.method === "HEAD" ? null : html, {
        headers: {
          "content-type": "text/html; charset=utf-8", "content-language": "fa", "cache-control": "public, max-age=300", vary: "Accept-Encoding",
          "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin",
        },
      });
    }
    // وبلاگ: فهرست /blog و مقاله‌ها /blog/<slug> (HTML از blog.ts ساخته می‌شود)
    const blog = findBlog(url.pathname);
    if (blog) {
      if (blog.kind === "trailing") return Response.redirect(`${SITE}${blog.to}${url.search}`, 301);
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      const html = blog.kind === "index" ? renderBlogIndex(SITE) : renderPost(blog.post, SITE);
      return new Response(req.method === "HEAD" ? null : html, {
        headers: {
          "content-type": "text/html; charset=utf-8", "content-language": "fa", "cache-control": "public, max-age=300", vary: "Accept-Encoding",
          "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin",
        },
      });
    }
    // صفحه‌ی اصلی: نشانه‌ی __ORIGIN__ (canonical، og:url، داده‌ی ساختاریافته) با دامنه‌ی واقعی جایگزین می‌شود
    if (url.pathname === "/" && (req.method === "GET" || req.method === "HEAD")) {
      const res = await env.ASSETS.fetch(req);
      if (!res.ok) return res;
      const h = new Headers(res.headers);
      h.delete("content-length"); h.set("cache-control", "public, max-age=300"); h.set("content-type", "text/html; charset=utf-8"); h.set("content-language", "fa"); h.set("vary", "Accept-Encoding");
      return new Response((await res.text()).replaceAll("__ORIGIN__", SITE), { status: 200, headers: h });
    }

    // هر چیز دیگر: صفحه‌ی وب و فایل‌های استاتیک (پوشه‌ی public)
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
