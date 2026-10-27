/* Service Worker پاورپوینت‌ساز فارسی (PWA)
   - صفحه‌ها: اول شبکه، اگر آفلاین بود نسخه‌ی ذخیره‌شده، وگرنه /offline.html
   - فایل‌های استاتیک (فونت، آیکون، jszip): اول کش
   - /api و تلگرام و درخواست‌های غیر GET هرگز کش نمی‌شوند */
const VERSION = "v1";
const STATIC = "pptsaz-static-" + VERSION;
const PAGES = "pptsaz-pages-" + VERSION;
const PRECACHE = [
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

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(STATIC).then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u)))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keep = new Set([STATIC, PAGES]);
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

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
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
  if (/^\/(fonts\/|icon-|apple-touch-icon|favicon|og-image|jszip\.min\.js|manifest\.webmanifest|digipay-banner)/.test(p)) {
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
