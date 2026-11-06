/* ویجت چت پشتیبانی پاورپوینت‌ساز: فقط دستیار هوشمند (بدون پشتیبان انسانی). فقط برای کاربر واردشده؛ روزی حداکثر ۱۰ پیام.
   موضوع‌های خاص را دستیار خودش «ارجاع» می‌دهد و همین‌جا اعلام می‌کند. بدون وابستگی؛ متن کاربر/مدل فقط با textContent درج می‌شود. */
(function () {
  "use strict";
  if (window.__ppSupport || !window.fetch) return;
  window.__ppSupport = 1;

  var msgs = [], remaining = 10, limit = 10, open = false, busy = false, guest = false, loaded = false;
  var GREETING = "سلام 👋 من دستیار هوشمند پاورپوینت‌ساز هستم. درباره‌ی قیمت و اعتبار، ساخت ارائه، مشکل‌های فنی یا حتی نکته‌های طراحی و ارائه‌ی سخنرانی بپرس. اگر موضوعی نیاز به تیم پشتیبانی داشته باشد خودم برایشان ارجاع می‌دهم.";
  var CHIPS = ["قیمت پلن‌ها چقدره؟", "اعتبار رایگان چطور می‌گیرم؟", "برای ارائه‌ی ۱۰ دقیقه‌ای چند اسلاید بسازم؟", "پرداخت کردم ولی اعتبار نیومد"];
  var GUEST_TEXT = "گفتگو با دستیار هوشمند فقط برای کاربران ثبت‌نام‌شده است. وارد حسابت شو یا ثبت‌نام کن (ثبت‌نام رایگان است و ۳ ارائه‌ی هدیه می‌گیری)؛ بعد روزی تا ۱۰ پیام می‌توانی بپرسی.";

  var css = document.createElement("style");
  css.textContent =
    "#ppsc,#ppsc *{box-sizing:border-box}" +
    "#ppsc [hidden]{display:none!important}" +
    "#ppsc{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:950;direction:rtl;font:14px/1.7 var(--font,Vazirmatn,Tahoma,sans-serif);color:var(--text,#0f1b33)}" +
    "#ppsc button{font:inherit;cursor:pointer}" +
    "#ppsc .fab{position:relative;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 18px;color:#fff;font-weight:700;background:linear-gradient(135deg,var(--primary,#2563eb),var(--primary-2,#06b6d4));box-shadow:0 8px 24px rgba(37,99,235,.35)}" +
    "#ppsc .fab:focus-visible,#ppsc .x:focus-visible,#ppsc .send:focus-visible,#ppsc .chip:focus-visible,#ppsc .go:focus-visible{outline:2px solid var(--primary,#2563eb);outline-offset:2px}" +
    "#ppsc .panel{position:absolute;left:0;bottom:60px;width:min(360px,calc(100vw - 32px));height:min(540px,calc(100dvh - 110px));display:flex;flex-direction:column;background:var(--card,#fff);border:1px solid var(--line,#e3e9f5);border-radius:18px;box-shadow:0 18px 50px rgba(15,27,51,.25);overflow:hidden}" +
    "#ppsc .hd{display:flex;align-items:center;gap:10px;padding:12px 14px;color:#fff;background:linear-gradient(135deg,var(--primary,#2563eb),var(--primary-2,#06b6d4))}" +
    "#ppsc .hd b{display:block;font-size:15px}#ppsc .hd span{font-size:12px;opacity:.9}#ppsc .hd div{flex:1}" +
    "#ppsc .x{border:0;background:rgba(255,255,255,.2);color:#fff;width:30px;height:30px;border-radius:50%;font-size:16px;line-height:1}" +
    "#ppsc .list{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--bg,#f8faff)}" +
    "#ppsc .m{max-width:88%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}" +
    "#ppsc .m.u{align-self:flex-start;background:var(--primary,#2563eb);color:#fff;border-end-start-radius:4px}" +
    "#ppsc .m.a{align-self:flex-end;background:var(--card,#fff);border:1px solid var(--line,#e3e9f5);border-end-end-radius:4px}" +
    "#ppsc .m.err{align-self:center;background:#fdecea;color:#a32a1f;border:0;font-size:13px}" +
    "#ppsc .badge{display:block;margin-top:6px;padding-top:6px;border-top:1px dashed var(--line,#e3e9f5);color:var(--ok,#12915b);font-weight:700;font-size:12px}" +
    "#ppsc .typing{align-self:flex-end;color:var(--muted,#5b6b86);font-size:13px}" +
    "#ppsc .chips{display:flex;flex-wrap:wrap;gap:6px}" +
    "#ppsc .chip{border:1px solid var(--line,#e3e9f5);background:var(--card,#fff);color:var(--primary,#2563eb);border-radius:999px;padding:5px 11px;font-size:13px}" +
    "#ppsc .chip:hover{border-color:var(--primary,#2563eb)}" +
    "#ppsc .go{align-self:center;border:0;border-radius:12px;padding:9px 18px;color:#fff;font-weight:700;background:var(--primary,#2563eb)}" +
    "#ppsc .ft{border-top:1px solid var(--line,#e3e9f5);padding:8px 10px;background:var(--card,#fff)}" +
    "#ppsc .row{display:flex;gap:8px;align-items:flex-end}" +
    "#ppsc textarea{flex:1;font:inherit;color:inherit;border:1px solid var(--line,#e3e9f5);border-radius:12px;padding:8px 10px;background:var(--bg,#f8faff);resize:none;max-height:90px}" +
    "#ppsc textarea:focus{outline:2px solid var(--primary,#2563eb);outline-offset:-1px}#ppsc textarea:disabled{opacity:.6}" +
    "#ppsc .send{border:0;border-radius:12px;padding:9px 14px;color:#fff;font-weight:700;background:var(--primary,#2563eb)}#ppsc .send:disabled{opacity:.5;cursor:default}" +
    "@media (prefers-reduced-motion:no-preference){#ppsc .panel{animation:ppscIn .18s ease-out}@keyframes ppscIn{from{opacity:0;transform:translateY(8px)}}}" +
    "@media (max-width:480px){#ppsc{left:12px}#ppsc .fab span{display:none}#ppsc .fab{padding:14px}}";
  document.head.appendChild(css);

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var root = el("div"); root.id = "ppsc";
  var fab = el("button", "fab"); fab.type = "button"; fab.setAttribute("aria-label", "گفتگو با دستیار هوشمند"); fab.setAttribute("aria-expanded", "false");
  fab.append(el("b", "", "💬"), el("span", "", "پشتیبانی"));
  var panel = el("div", "panel"); panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "گفتگو با دستیار هوشمند");
  var hd = el("div", "hd"), ht = el("div"); ht.append(el("b", "", "پشتیبانی پاورپوینت‌ساز"), el("span", "", "دستیار هوشمند · پاسخ فوری"));
  var xb = el("button", "x", "✕"); xb.type = "button"; xb.setAttribute("aria-label", "بستن");
  hd.append(ht, xb);
  var list = el("div", "list"); list.setAttribute("aria-live", "polite");
  var ft = el("div", "ft");
  var row = el("div", "row"), ta = el("textarea"); ta.rows = 1; ta.maxLength = 600; ta.placeholder = "پیامت را بنویس…"; ta.setAttribute("aria-label", "پیام");
  var send = el("button", "send", "ارسال"); send.type = "button";
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
    if (!loaded) { ft.hidden = true; list.append(el("div", "typing", "در حال بارگذاری…")); return; }
    ft.hidden = guest;
    if (guest) {
      list.append(el("div", "m a", GUEST_TEXT));
      var b = el("button", "go", "ورود / ثبت‌نام"); b.type = "button"; b.addEventListener("click", goLogin);
      list.append(b);
      return;
    }
    list.append(el("div", "m a", GREETING));
    if (!msgs.length) {
      var chips = el("div", "chips");
      CHIPS.forEach(function (c) { var bt = el("button", "chip", c); bt.type = "button"; bt.addEventListener("click", function () { post(c); }); chips.append(bt); });
      list.append(chips);
    }
    msgs.forEach(function (m) {
      var d = el("div", "m " + (m.r === "u" ? "u" : "a"));
      d.append(document.createTextNode(m.t));
      if (m.f) d.append(el("span", "badge", "✅ ارجاع شد؛ تیم پشتیبانی بررسی می‌کند"));
      list.append(d);
    });
    if (busy) list.append(el("div", "typing", "در حال نوشتن…"));
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
  function err(t) { var e = el("div", "m err", t); list.append(e); list.scrollTop = list.scrollHeight; }

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
    msgs.push({ r: "u", t: text }); ta.value = ""; ta.style.height = "auto"; render();
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
  ta.addEventListener("input", function () { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 90) + "px"; });

  function boot() { document.body.appendChild(root); }
  var go = function () { (window.requestIdleCallback || function (f) { setTimeout(f, 1500); })(boot); };
  if (document.readyState === "complete") go(); else window.addEventListener("load", go);
})();
