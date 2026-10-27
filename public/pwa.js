/* ثبت Service Worker و پیشنهاد نصب برنامه (PWA) */
(function () {
  "use strict";
  if (window.__pptPwa) return;
  window.__pptPwa = true;

  var inTelegram = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
  var standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  var KEY = "pwa_install_dismissed";

  // ثبت سرویس‌ورکر + به‌روزرسانی خودکار
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function (reg) {
        reg.addEventListener("updatefound", function () {
          var w = reg.installing;
          if (!w) return;
          w.addEventListener("statechange", function () {
            if (w.state === "installed" && navigator.serviceWorker.controller) w.postMessage("SKIP_WAITING");
          });
        });
      }).catch(function () {});
    });
  }

  if (standalone || inTelegram) return;

  function dismissed() {
    try { var t = +localStorage.getItem(KEY) || 0; return Date.now() - t < 7 * 864e5; } catch (e) { return false; }
  }
  function remember() { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} }

  var bar;
  function css() {
    if (document.getElementById("pwa-css")) return;
    var s = document.createElement("style");
    s.id = "pwa-css";
    s.textContent =
      "#pwa-bar{position:fixed;z-index:9999;inset:auto 12px 12px 12px;max-width:460px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;color:#0f1b33;border:1px solid #e3e9f5;border-radius:16px;box-shadow:0 10px 30px rgba(15,27,51,.18);font:14px/1.6 Vazirmatn,Tahoma,system-ui,sans-serif;direction:rtl}" +
      "#pwa-bar img{width:40px;height:40px;border-radius:10px;flex:none}" +
      "#pwa-bar .t{flex:1;min-width:0}#pwa-bar b{display:block;font-size:14px}#pwa-bar span{color:#5b6b86;font-size:12.5px}" +
      "#pwa-bar button{font:inherit;border:0;cursor:pointer}" +
      "#pwa-bar .go{padding:8px 14px;border-radius:10px;font-weight:700;color:#fff;background:linear-gradient(135deg,#2563eb,#06b6d4)}" +
      "#pwa-bar .x{background:none;color:#5b6b86;font-size:18px;padding:4px 6px}";
    document.head.appendChild(s);
  }
  function show(msg, actionLabel, onAction) {
    if (bar || dismissed()) return;
    css();
    bar = document.createElement("div");
    bar.id = "pwa-bar";
    bar.setAttribute("role", "dialog");
    bar.innerHTML = '<img src="/icon-192.png" alt="" width="40" height="40"><div class="t"><b>نصب پاورپوینت‌ساز</b><span></span></div>' +
      (actionLabel ? '<button type="button" class="go"></button>' : "") + '<button type="button" class="x" aria-label="بستن">✕</button>';
    bar.querySelector("span").textContent = msg;
    if (actionLabel) {
      var g = bar.querySelector(".go");
      g.textContent = actionLabel;
      g.addEventListener("click", onAction);
    }
    bar.querySelector(".x").addEventListener("click", function () { remember(); hide(); });
    document.body.appendChild(bar);
  }
  function hide() { if (bar) { bar.remove(); bar = null; } }

  // اندروید/دسکتاپ (کروم، ادج، سامسونگ)
  var deferred = null;
  addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    window.pptInstall = install;
    document.documentElement.setAttribute("data-pwa-installable", "1");
    setTimeout(function () { show("مثل یک اپ، سریع و تمام‌صفحه از صفحه‌ی اصلی گوشی باز کنید.", "نصب", install); }, 4000);
  });
  function install() {
    if (!deferred) return;
    var d = deferred;
    deferred = null;
    hide();
    d.prompt();
    d.userChoice.then(function (r) { if (r.outcome !== "accepted") remember(); }).catch(function () {});
  }
  addEventListener("appinstalled", function () {
    hide();
    document.documentElement.removeAttribute("data-pwa-installable");
  });

  // آیفون/آیپد (سافاری): نصب فقط از منوی اشتراک‌گذاری
  var ua = navigator.userAgent;
  var ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var safari = /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
  if (ios && safari) {
    addEventListener("load", function () {
      setTimeout(function () { show("در سافاری دکمه‌ی اشتراک‌گذاری (⬆️) را بزنید و «Add to Home Screen» را انتخاب کنید.", "", null); }, 5000);
    });
  }
})();
