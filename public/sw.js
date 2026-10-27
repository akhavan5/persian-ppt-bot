/* Service Worker پاورپوینت‌ساز فارسی (PWA)
   - صفحه‌ها: اول شبکه، اگر آفلاین بود نسخه‌ی ذخیره‌شده، وگرنه /offline.html
   - فایل‌های استاتیک (فونت، آیکون، jszip): اول کش
   - دریافت فایل/متن/لینک از منوی «اشتراک‌گذاری» گوشی و سیستم (Share Target)
   - /api و تلگرام و درخواست‌های غیر GET (جز Share Target) هرگز کش نمی‌شوند */
const VERSION = "v2";
const STATIC = "pptsaz-static-" + VERSION;
const PAGES = "pptsaz-pages-" + VERSION;
const SHARE = "pptsaz-share";
const PRECACHE = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/fonts/Vazirmatn-Regular.woff2",
  "/fonts/Vazirmatn-Bold.woff2",
];
const MAX_PAGES = 30;
const URL_RE = /https?:\/\/[^\s]+/i;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(STATIC).then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u)))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keep = new Set([STATIC, PAGES, SHARE]);
      for (const k of await caches.keys()) if (k.startsWith("pptsaz-") && !keep.has(k)) await caches.delete(k);
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

// Share Target: فایل/متن/لینک اشتراک‌گذاری‌شده را نگه می‌دارد و کاربر را به صفحه‌ی ساخت می‌برد
async function handleShare(req) {
  const home = new URL("/", self.location.origin);
  try {
    const fd = await req.formData();
    const c = await caches.open(SHARE);
    await c.delete("/__shared_file__");
    const file = fd.get("file");
    let hasFile = false;
    if (file && typeof file === "object" && file.size) {
      await c.put("/__shared_file__", new Response(file, { headers: { "content-type": file.type || "application/octet-stream", "x-name": encodeURIComponent(file.name || "file") } }));
      hasFile = true;
    }
    const s = (k) => (typeof fd.get(k) === "string" ? fd.get(k).trim() : "");
    const title = s("title"), text = s("text"), urlField = s("url");
    const found = (urlField.match(URL_RE) || text.match(URL_RE) || title.match(URL_RE) || [])[0] || "";
    const topic = (text.replace(URL_RE, "").trim() || title.replace(URL_RE, "").trim()).slice(0, 600);
    home.searchParams.set("shared", "1");
    if (hasFile) home.searchParams.set("sf", "1");
    if (found) home.searchParams.set("su", found.slice(0, 2000));
    if (topic && !hasFile) home.searchParams.set("st", topic);
  } catch {
    /* بی‌اثر: فقط به صفحه‌ی اصلی می‌رود */
  }
  return Response.redirect(home.href, 303);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === "POST" && url.origin === self.location.origin && url.pathname === "/_share-target") {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith("/api/") || p === "/telegram" || p === "/setup" || p === "/open" || p === "/sw.js" || p.startsWith("/.well-known/")) return;
  if (req.headers.has("range")) return;

  // مسیرهای صفحه (HTML)
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const pre = e.preloadResponse ? await e.preloadResponse : null;
          const res = pre || (await fetch(req));
          const ct = res.headers.get("content-type") || "";
          if (res.ok && ct.includes("text/html") && p !== "/app" && p !== "/app.html") {
            const copy = res.clone();
            e.waitUntil(caches.open(PAGES).then((c) => c.put(req, copy)).then(() => trim(PAGES, MAX_PAGES)));
          }
          return res;
        } catch {
          const cached = (await caches.match(req)) || (await caches.match("/", { ignoreSearch: true }));
          return cached || (await caches.match("/offline.html")) || new Response("آفلاین هستید", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
        }
      })()
    );
    return;
  }

  // فایل‌های استاتیک: اول کش، پشتش به‌روزرسانی در پس‌زمینه
  if (/^\/(fonts\/|icon-|apple-touch-icon|favicon|og-image|jszip\.min\.js|pwa\.js|manifest\.webmanifest|digipay-banner)/.test(p)) {
    e.respondWith(
      (async () => {
        const c = await caches.open(STATIC);
        const hit = await c.match(req);
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) c.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        if (hit) {
          e.waitUntil(refresh);
          return hit;
        }
        return (await refresh) || new Response("", { status: 504 });
      })()
    );
  }
});
