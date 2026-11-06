/* ویجت چت پشتیبانی پاورپوینت‌ساز: فقط دستیار هوشمند (بدون پشتیبان انسانی). فقط برای کاربر واردشده (سقف روزانه را سرور اعمال می‌کند).
   موضوع‌های خاص را دستیار خودش «ارجاع» می‌دهد و همین‌جا اعلام می‌کند. بدون وابستگی؛ متن کاربر/مدل فقط با textContent درج می‌شود. */
(function () {
  "use strict";
  if (window.__ppSupport || !window.fetch) return;
  window.__ppSupport = 1;

  var msgs = [], remaining = 10, limit = 10, open = false, busy = false, guest = false, loaded = false;
  var GREETING = "سلام 👋 من دستیار هوشمند پاورپوینت‌ساز هستم. درباره‌ی قیمت و اعتبار، ساخت ارائه، مشکل‌های فنی یا حتی نکته‌های طراحی و ارائه‌ی سخنرانی بپرس.";
  var CHIPS = ["قیمت پلن‌ها چقدره؟", "اعتبار رایگان چطور می‌گیرم؟", "برای ارائه‌ی ۱۰ دقیقه‌ای چند اسلاید بسازم؟", "خروجی ارائه چه فرمت‌هایی دارد؟"];
  var GUEST_TEXT = "گفتگو با دستیار هوشمند فقط برای کاربران ثبت‌نام‌شده است. وارد حسابت شو یا ثبت‌نام کن (ثبت‌نام رایگان است و ۳ ارائه‌ی هدیه می‌گیری)؛ بعد می‌توانی هر سؤالی داشتی بپرسی.";

  var css = document.createElement("style");
  css.textContent =
    "#ppsc,#ppsc *{box-sizing:border-box;margin:0}" +
    "#ppsc [hidden]{display:none!important}" +
    "#ppsc{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:950;direction:rtl;text-align:right;font:14px/1.8 var(--font,Vazirmatn,Tahoma,sans-serif);color:var(--text,#0f1b33)}" +
    "#ppsc button{font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}" +
    "#ppsc .pps-fab{position:relative;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 20px;color:#fff;font-weight:700;background:linear-gradient(135deg,var(--primary,#2563eb),var(--primary-2,#06b6d4));box-shadow:0 8px 24px rgba(37,99,235,.35);transition:transform .15s,box-shadow .15s}" +
    "#ppsc .pps-fab:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(37,99,235,.42)}" +
    "#ppsc .pps-fab:focus-visible,#ppsc .pps-x:focus-visible,#ppsc .pps-send:focus-visible,#ppsc .pps-chip:focus-visible,#ppsc .pps-go:focus-visible{outline:2px solid var(--primary,#2563eb);outline-offset:2px}" +
    "#ppsc .pps-panel{position:absolute;left:0;bottom:62px;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100dvh - 110px));display:flex;flex-direction:column;background:var(--card,#fff);border:1px solid var(--line,#e3e9f5);border-radius:20px;box-shadow:0 20px 60px rgba(15,27,51,.28);overflow:hidden}" +
    "#ppsc .pps-hd{position:relative;display:flex;align-items:center;gap:12px;padding:14px 16px;color:#fff;background:linear-gradient(135deg,var(--primary,#2563eb),var(--primary-2,#06b6d4));flex:none}" +
    "#ppsc .pps-av{position:relative;flex:none;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-size:20px}" +
    "#ppsc .pps-av::after{content:'';position:absolute;bottom:0;inset-inline-end:0;width:10px;height:10px;border-radius:50%;background:#34d399;border:2px solid #fff}" +
    "#ppsc .pps-ht{flex:1;min-width:0}" +
    "#ppsc .pps-ht b{display:block;font-size:15px;line-height:1.5}" +
    "#ppsc .pps-ht span{display:block;font-size:12px;opacity:.92}" +
    "#ppsc .pps-x{position:static;flex:none;display:flex;align-items:center;justify-content:center;border:0;background:rgba(255,255,255,.2);color:#fff;width:32px;height:32px;padding:0;border-radius:50%;font-size:15px;line-height:1;transition:background .15s}" +
    "#ppsc .pps-x:hover{background:rgba(255,255,255,.34)}" +
    "#ppsc .pps-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:14px 12px;display:flex;flex-direction:column;gap:10px;background:var(--bg,#f8faff);scrollbar-width:thin;scrollbar-color:rgba(100,116,139,.35) transparent}" +
    "#ppsc .pps-list::-webkit-scrollbar{width:6px}#ppsc .pps-list::-webkit-scrollbar-thumb{background:rgba(100,116,139,.35);border-radius:6px}" +
    "#ppsc .pps-m{max-width:86%;padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}" +
    "#ppsc .pps-m.pps-u{align-self:flex-start;background:linear-gradient(135deg,var(--primary,#2563eb),var(--primary-2,#0891b2));color:#fff;border-end-start-radius:4px;box-shadow:0 2px 8px rgba(37,99,235,.22)}" +
    "#ppsc .pps-m.pps-a{align-self:flex-end;background:var(--card,#fff);border:1px solid var(--line,#e3e9f5);border-end-end-radius:4px;box-shadow:0 1px 4px rgba(15,27,51,.06)}" +
    "#ppsc .pps-m.pps-err{align-self:center;max-width:94%;background:#fdecea;color:#a32a1f;border:0;font-size:13px;text-align:center;box-shadow:none}" +
    "#ppsc .pps-badge{display:block;margin-top:8px;padding-top:7px;border-top:1px dashed var(--line,#e3e9f5);color:var(--ok,#12915b);font-weight:700;font-size:12px}" +
    "#ppsc .pps-typing{align-self:flex-end;display:flex;gap:4px;align-items:center;padding:10px 14px;background:var(--card,#fff);border:1px solid var(--line,#e3e9f5);border-radius:16px;border-end-end-radius:4px}" +
    "#ppsc .pps-typing i{width:6px;height:6px;border-radius:50%;background:var(--muted,#5b6b86);opacity:.5}" +
    "#ppsc .pps-load{align-self:center;color:var(--muted,#5b6b86);font-size:13px}" +
    "#ppsc .pps-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}" +
    "#ppsc .pps-chip{display:inline-flex;width:auto;min-height:0;border:1px solid var(--line,#e3e9f5);background:var(--card,#fff);color:var(--primary,#2563eb);border-radius:999px;padding:6px 12px;font-size:13px;font-weight:600;line-height:1.5;text-align:right;transition:background .15s,border-color .15s}" +
    "#ppsc .pps-chip:hover{border-color:var(--primary,#2563eb);background:rgba(37,99,235,.06)}" +
    "#ppsc .pps-go{align-self:center;border:0;border-radius:12px;padding:10px 22px;color:#fff;font-weight:700;background:var(--primary,#2563eb);box-shadow:0 4px 12px rgba(37,99,235,.25)}" +
    "#ppsc .pps-ft{flex:none;display:block;border-top:1px solid var(--line,#e3e9f5);padding:10px 12px;background:var(--card,#fff)}" +
    "#ppsc .pps-row{display:flex;gap:8px;align-items:flex-end;justify-content:flex-start;flex-wrap:nowrap}" +
    "#ppsc .pps-ta{flex:1;min-width:0;width:auto;height:40px;min-height:40px;max-height:96px;font:inherit;font-size:16px;line-height:1.6;color:inherit;border:1px solid var(--line,#e3e9f5);border-radius:14px;padding:8px 12px;background:var(--bg,#f8faff);resize:none;box-shadow:none;transition:border-color .15s,box-shadow .15s}" +
    "#ppsc .pps-ta:focus{outline:0;border-color:var(--primary,#2563eb);box-shadow:0 0 0 3px rgba(37,99,235,.15);background:var(--card,#fff)}#ppsc .pps-ta:disabled{opacity:.6}" +
    "#ppsc .pps-send{flex:none;display:flex;align-items:center;justify-content:center;width:auto;height:40px;min-height:0;border:0;border-radius:14px;padding:0 18px;color:#fff;font-weight:700;background:var(--primary,#2563eb);transition:opacity .15s,transform .15s}" +
    "#ppsc .pps-send:hover:not(:disabled){transform:translateY(-1px)}#ppsc .pps-send:disabled{opacity:.5;cursor:default}" +
    "@media (prefers-reduced-motion:no-preference){#ppsc .pps-panel{animation:ppscIn .2s ease-out}@keyframes ppscIn{from{opacity:0;transform:translateY(10px) scale(.98)}}#ppsc .pps-typing i{animation:ppscDot 1.1s infinite ease-in-out}#ppsc .pps-typing i:nth-child(2){animation-delay:.15s}#ppsc .pps-typing i:nth-child(3){animation-delay:.3s}@keyframes ppscDot{0%,80%,100%{transform:translateY(0);opacity:.35}40%{transform:translateY(-4px);opacity:1}}}" +
    "@media (max-width:480px){#ppsc{left:12px}#ppsc .pps-fab span{display:none}#ppsc .pps-fab{padding:14px}#ppsc .pps-panel{width:calc(100vw - 24px);bottom:64px;border-radius:18px}}";
  document.head.appendChild(css);

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var root = el("div"); root.id = "ppsc";
  var fab = el("button", "pps-fab"); fab.type = "button"; fab.setAttribute("aria-label", "گفتگو با دستیار هوشمند"); fab.setAttribute("aria-expanded", "false");
  fab.append(el("b", "", "💬"), el("span", "", "پشتیبانی"));
  var panel = el("div", "pps-panel"); panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "گفتگو با دستیار هوشمند");
  var hd = el("div", "pps-hd"), av = el("div", "pps-av", "👨‍💼"), ht = el("div", "pps-ht"); av.setAttribute("aria-hidden", "true"); ht.append(el("b", "", "پشتیبانی پاورپوینت‌ساز"), el("span", "", "دستیار هوشمند · پاسخ فوری"));
  var xb = el("button", "pps-x", "✕"); xb.type = "button"; xb.setAttribute("aria-label", "بستن");
  hd.append(av, ht, xb);
  var list = el("div", "pps-list"); list.setAttribute("aria-live", "polite");
  var ft = el("div", "pps-ft");
  var row = el("div", "pps-row"), ta = el("textarea", "pps-ta"); ta.rows = 1; ta.maxLength = 600; ta.placeholder = "پیامت را بنویس…"; ta.setAttribute("aria-label", "پیام");
  var send = el("button", "pps-send", "ارسال"); send.type = "button";
  row.append(ta, send);
  ft.append(row);
  panel.append(hd, list, ft);
  root.append(panel, fab);

  function goLogin() {
    setOpen(false);
    try { if (typeof window.openAuth === "function") { window.openAuth("register", "برای گفتگو با دستیار هوشمند وارد شو یا ثبت‌نام کن؛ ۳ ارائه‌ی رایگان هم هدیه می‌گیری."); return; } } catch (e) {}
    location.href = "/?login=chat";
  }

  function render() {
    list.textContent = "";
    if (!loaded) { ft.hidden = true; list.append(el("div", "pps-load", "در حال بارگذاری…")); return; }
    ft.hidden = guest;
    if (guest) {
      list.append(el("div", "pps-m pps-a", GUEST_TEXT));
      var b = el("button", "pps-go", "ورود / ثبت‌نام"); b.type = "button"; b.addEventListener("click", goLogin);
      list.append(b);
      return;
    }
    list.append(el("div", "pps-m pps-a", GREETING));
    if (!msgs.length) {
      var chips = el("div", "pps-chips");
      CHIPS.forEach(function (c) { var bt = el("button", "pps-chip", c); bt.type = "button"; bt.addEventListener("click", function () { post(c); }); chips.append(bt); });
      list.append(chips);
    }
    msgs.forEach(function (m) {
      var d = el("div", "pps-m " + (m.r === "u" ? "pps-u" : "pps-a"));
      d.append(document.createTextNode(m.t));
      if (m.f) d.append(el("span", "pps-badge", "✅ ارجاع شد؛ تیم پشتیبانی بررسی می‌کند"));
      list.append(d);
    });
    if (busy) { var ty = el("div", "pps-typing"); ty.setAttribute("aria-label", "در حال نوشتن"); ty.append(el("i"), el("i"), el("i")); list.append(ty); }
    list.scrollTop = list.scrollHeight;
    var out = remaining <= 0;
    ta.disabled = out; send.disabled = busy || out;
    ta.placeholder = out ? "سقف پیام امروز تمام شد؛ فردا دوباره بپرس" : "پیامت را بنویس…";
  }

  function apply(d) {
    if (!d) return;
    if (Array.isArray(d.msgs)) msgs = d.msgs;
    if (typeof d.remaining === "number") remaining = d.remaining;
    if (typeof d.limit === "number") limit = d.limit;
  }
  function err(t) { var e = el("div", "pps-m pps-err", t); list.append(e); list.scrollTop = list.scrollHeight; }

  function req(url, opt) {
    opt = opt || {}; opt.credentials = "same-origin";
    return fetch(url, opt).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
  }

  function loadHistory() {
    req("/api/support/history").then(function (x) {
      loaded = true;
      if (x.status === 401) { guest = true; msgs = []; } else if (x.ok) { guest = false; apply(x.d); }
      if (open) render();
    }).catch(function () { loaded = true; if (open) render(); });
  }

  function post(text) {
    text = (text || "").trim();
    if (!text || busy || guest || remaining <= 0) return;
    busy = true;
    msgs.push({ r: "u", t: text }); ta.value = ""; ta.style.height = "40px"; render();
    req("/api/support/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: text }) })
      .then(function (x) {
        busy = false;
        if (x.status === 401) { guest = true; msgs = []; render(); return; }
        if (!x.ok) {
          msgs.pop();
          if (typeof x.d.remaining === "number") remaining = x.d.remaining;
          render(); err((x.d && x.d.error) || "ارسال نشد؛ دوباره امتحان کن."); return;
        }
        apply(x.d); render();
      })
      .catch(function () { busy = false; msgs.pop(); render(); err("اتصال برقرار نشد؛ دوباره امتحان کن."); });
  }

  function setOpen(o) {
    open = o; panel.hidden = !o; fab.setAttribute("aria-expanded", String(o));
    if (o) { render(); loadHistory(); setTimeout(function () { if (!guest && !ta.disabled) ta.focus(); }, 50); }
    else fab.focus();
  }

  fab.addEventListener("click", function () { setOpen(!open); });
  xb.addEventListener("click", function () { setOpen(false); });
  send.addEventListener("click", function () { post(ta.value); });
  ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); post(ta.value); } });
  root.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) setOpen(false); });
  ta.addEventListener("input", function () { ta.style.height = "40px"; ta.style.height = Math.min(Math.max(ta.scrollHeight, 40), 96) + "px"; });

  function boot() { document.body.appendChild(root); }
  var go = function () { (window.requestIdleCallback || function (f) { setTimeout(f, 1500); })(boot); };
  if (document.readyState === "complete") go(); else window.addEventListener("load", go);
})();
