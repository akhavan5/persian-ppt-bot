/* PWA پاورپوینت‌ساز فارسی: ثبت Service Worker، نصب، به‌روزرسانی، وضعیت آفلاین،
   دریافت فایل از «اشتراک‌گذاری» و «باز کردن با» (Windows/ChromeOS) */
(function () {
  "use strict";
  if (window.__pptPwa) return;
  window.__pptPwa = true;

  var inTelegram = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
  var standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  var KEY = "pwa_install_dismissed";

  function css() {
    if (document.getElementById("pwa-css")) return;
    var s = document.createElement("style");
    s.id = "pwa-css";
    s.textContent =
      ".pwa-box{position:fixed;z-index:9999;inset:auto 12px 12px 12px;max-width:460px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;color:#0f1b33;border:1px solid #e3e9f5;border-radius:16px;box-shadow:0 10px 30px rgba(15,27,51,.18);font:14px/1.6 Vazirmatn,Tahoma,system-ui,sans-serif;direction:rtl}" +
      ".pwa-box.top{inset:12px 12px auto 12px}" +
      ".pwa-box img{width:40px;height:40px;border-radius:10px;flex:none}" +
      ".pwa-box .t{flex:1;min-width:0}.pwa-box b{display:block;font-size:14px}.pwa-box span{color:#5b6b86;font-size:12.5px}" +
      ".pwa-box button{font:inherit;border:0;cursor:pointer}" +
      ".pwa-box .go{padding:8px 14px;border-radius:10px;font-weight:700;color:#fff;background:linear-gradient(135deg,#2563eb,#06b6d4)}" +
      ".pwa-box .x{background:none;color:#5b6b86;font-size:18px;padding:4px 6px}";
    document.head.appendChild(s);
  }
  // جعبه‌ی پیام شناور: opts = {id, title, msg, label, onAction, onClose, top, icon}
  function box(o) {
    var old = document.getElementById(o.id);
    if (old) old.remove();
    css();
    var d = document.createElement("div");
    d.id = o.id;
    d.className = "pwa-box" + (o.top ? " top" : "");
    d.setAttribute("role", "status");
    d.innerHTML = (o.icon === false ? "" : '<img src="/icon-192.png" alt="" width="40" height="40">') + '<div class="t"><b></b><span></span></div>' +
      (o.label ? '<button type="button" class="go"></button>' : "") + (o.noClose ? "" : '<button type="button" class="x" aria-label="بستن">✕</button>');
    d.querySelector("b").textContent = o.title;
    d.querySelector("span").textContent = o.msg;
    if (o.label) {
      var g = d.querySelector(".go");
      g.textContent = o.label;
      g.addEventListener("click", o.onAction);
    }
    var x = d.querySelector(".x");
    if (x) x.addEventListener("click", function () { if (o.onClose) o.onClose(); d.remove(); });
    document.body.appendChild(d);
    return d;
  }
  function drop(id) { var d = document.getElementById(id); if (d) d.remove(); }

  // ---------- سرویس‌ورکر و به‌روزرسانی ----------
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController) { hadController = true; return; }
      box({ id: "pwa-update", title: "نسخه‌ی جدید آماده است", msg: "برای دیدن تغییرات صفحه را دوباره بارگذاری کنید.", label: "بارگذاری", onAction: function () { location.reload(); } });
    });
    addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function (reg) {
        var check = function () { reg.update().catch(function () {}); };
        document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") check(); });
        setInterval(check, 60 * 60 * 1000);
      }).catch(function () {});
    });
  }

  // ---------- وضعیت آفلاین/آنلاین ----------
  function net() {
    if (navigator.onLine === false) box({ id: "pwa-net", title: "آفلاین هستید", msg: "ساخت پاورپوینت به اینترنت نیاز دارد؛ اتصال که برگشت خودکار ادامه می‌دهد.", top: true, icon: false, noClose: true });
    else drop("pwa-net");
  }
  addEventListener("online", net);
  addEventListener("offline", net);
  addEventListener("load", net);

  // ---------- دریافت فایل/متن/لینک (Share Target و «باز کردن با») ----------
  function whenReady(fn, tries) {
    tries = tries || 0;
    if (typeof window.onFile === "function" && document.getElementById("topic")) return fn();
    if (tries < 50) setTimeout(function () { whenReady(fn, tries + 1); }, 100);
  }
  function sharedIn() {
    var q = new URLSearchParams(location.search);
    if (q.get("shared") !== "1") return;
    history.replaceState(null, "", "/");
    var topic = q.get("st") || "", link = q.get("su") || "";
    whenReady(function () {
      var maker = document.querySelector(".maker");
      if (maker) maker.scrollIntoView({ block: "center" });
      if (q.get("sf") === "1" && window.caches) {
        caches.open("pptsaz-share").then(function (c) {
          return c.match("/__shared_file__").then(function (r) {
            if (!r) return;
            return r.blob().then(function (b) {
              var name = "file";
              try { name = decodeURIComponent(r.headers.get("x-name") || "file"); } catch (e) {}
              c.delete("/__shared_file__");
              window.onFile(new File([b], name, { type: b.type }));
            });
          });
        }).catch(function () {});
      }
      if (link) {
        var row = document.getElementById("linkRow"), inp = document.getElementById("linkUrl");
        if (row && inp) { row.hidden = false; inp.value = link; inp.focus({ preventScroll: true }); }
      }
      if (topic) {
        var el = document.getElementById("topic");
        el.value = topic;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.focus({ preventScroll: true });
      }
    });
  }
  if (document.readyState === "complete") setTimeout(sharedIn, 300);
  else addEventListener("load", function () { setTimeout(sharedIn, 300); });

  // «Open with»: فایل Word/PDF/PowerPoint و ... را در ویندوز با برنامه باز کنید
  if ("launchQueue" in window && window.LaunchParams) {
    window.launchQueue.setConsumer(function (params) {
      if (!params || !params.files || !params.files.length) return;
      params.files[0].getFile().then(function (f) {
        whenReady(function () { window.onFile(f); });
      }).catch(function () {});
    });
  }

  if (standalone || inTelegram) return;

  // ---------- پیشنهاد نصب ----------
  function dismissed() {
    try { var t = +localStorage.getItem(KEY) || 0; return Date.now() - t < 7 * 864e5; } catch (e) { return false; }
  }
  function remember() { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} }

  var deferred = null;
  function install() {
    if (!deferred) return;
    var d = deferred;
    deferred = null;
    drop("pwa-install");
    d.prompt();
    d.userChoice.then(function (r) { if (r.outcome !== "accepted") remember(); }).catch(function () {});
  }
  // دکمه‌ی «نصب اپ» در منوی بالای سایت
  function navBtn() {
    var n = document.getElementById("mainNav");
    if (!n || n.querySelector(".pwa-nav")) return;
    var a = document.createElement("a");
    a.href = "#";
    a.className = "pwa-nav";
    a.textContent = "⬇️ نصب اپ";
    a.addEventListener("click", function (e) { e.preventDefault(); install(); });
    n.appendChild(a);
  }
  addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    window.pptInstall = install;
    document.documentElement.setAttribute("data-pwa-installable", "1");
    navBtn();
    if (!dismissed()) setTimeout(function () {
      if (!deferred) return;
      box({ id: "pwa-install", title: "نصب پاورپوینت‌ساز", msg: "مثل یک اپ، سریع و تمام‌صفحه از منوی استارت یا صفحه‌ی اصلی گوشی باز کنید.", label: "نصب", onAction: install, onClose: remember });
    }, 4000);
  });
  addEventListener("appinstalled", function () {
    deferred = null;
    drop("pwa-install");
    document.documentElement.removeAttribute("data-pwa-installable");
    var b = document.querySelector(".pwa-nav");
    if (b) b.remove();
  });

  // آیفون/آیپد (سافاری): نصب فقط از منوی اشتراک‌گذاری
  var ua = navigator.userAgent;
  var ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var safari = /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
  if (ios && safari && !dismissed()) {
    addEventListener("load", function () {
      setTimeout(function () {
        box({ id: "pwa-install", title: "نصب پاورپوینت‌ساز", msg: "در سافاری دکمه‌ی اشتراک‌گذاری (⬆️) را بزنید و «Add to Home Screen» را انتخاب کنید.", onClose: remember });
      }, 5000);
    });
  }
})();
