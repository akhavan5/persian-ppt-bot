/* ویجت چت پشتیبانی پاورپوینت‌ساز: دستیار هوشمند + ارجاع به پشتیبان انسانی. بدون وابستگی؛ متن کاربر/مدل فقط با textContent درج می‌شود. */
(function () {
  "use strict";
  if (window.__ppSupport || !window.fetch) return;
  window.__ppSupport = 1;

  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  var cid = ls.get("pp_sc_id");
  if (!/^[a-f0-9]{24}$/.test(cid || "")) {
    var a = new Uint8Array(12); crypto.getRandomValues(a);
    cid = Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    ls.set("pp_sc_id", cid);
  }

  var msgs = [], handoff = false, open = false, busy = false, timer = 0, count = -1;
  var GREETING = "سلام 👋 من دستیار هوشمند پاورپوینت‌ساز هستم. درباره‌ی قیمت پلن‌ها، اعتبار رایگان، ساخت ارائه یا هر مشکلی بپرس.";
  var CHIPS = ["قیمت پلن‌ها چقدره؟", "اعتبار رایگان چطور می‌گیرم؟", "پرداخت کردم ولی اعتبار نیومد", "از چه فایل‌هایی ارائه می‌سازید؟"];

  var css = document.createElement("style");
  css.textContent =
    "#ppsc,#ppsc *{box-sizing:border-box}" +
    "#ppsc [hidden]{display:none!important}" +
    "#ppsc{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:950;direction:rtl;font:14px/1.7 var(--font,Vazirmatn,Tahoma,sans-serif);color:var(--text,#0f1b33)}" +
    "#ppsc button{font:inherit;cursor:pointer}" +
    "#ppsc .fab{position:relative;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 18px;color:#fff;font-weight:700;background:linear-gradient(135deg,var(--primary,#2563eb),var(--primary-2,#06b6d4));box-shadow:0 8px 24px rgba(37,99,235,.35)}" +
    "#ppsc .fab:focus-visible,#ppsc .x:focus-visible,#ppsc .send:focus-visible,#ppsc .chip:focus-visible,#ppsc .human:focus-visible{outline:2px solid var(--primary,#2563eb);outline-offset:2px}" +
    "#ppsc .dot{position:absolute;top:-2px;inset-inline-end:-2px;width:14px;height:14px;border-radius:50%;background:var(--danger,#d93a2b);border:2px solid #fff}" +
    "#ppsc .panel{position:absolute;left:0;bottom:60px;width:min(360px,calc(100vw - 32px));height:min(540px,calc(100dvh - 110px));display:flex;flex-direction:column;background:var(--card,#fff);border:1px solid var(--line,#e3e9f5);border-radius:18px;box-shadow:0 18px 50px rgba(15,27,51,.25);overflow:hidden}" +
    "#ppsc .hd{display:flex;align-items:center;gap:10px;padding:12px 14px;color:#fff;background:linear-gradient(135deg,var(--primary,#2563eb),var(--primary-2,#06b6d4))}" +
    "#ppsc .hd b{display:block;font-size:15px}#ppsc .hd span{font-size:12px;opacity:.9}#ppsc .hd div{flex:1}" +
    "#ppsc .x{border:0;background:rgba(255,255,255,.2);color:#fff;width:30px;height:30px;border-radius:50%;font-size:16px;line-height:1}" +
    "#ppsc .list{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--bg,#f8faff)}" +
    "#ppsc .m{max-width:86%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}" +
    "#ppsc .m.u{align-self:flex-start;background:var(--primary,#2563eb);color:#fff;border-end-start-radius:4px}" +
    "#ppsc .m.a,#ppsc .m.s{align-self:flex-end;background:var(--card,#fff);border:1px solid var(--line,#e3e9f5);border-end-end-radius:4px}" +
    "#ppsc .m.s{border-color:var(--ok,#12915b)}#ppsc .m small{display:block;color:var(--ok,#12915b);font-weight:700;font-size:11px}" +
    "#ppsc .m.err{align-self:center;background:#fdecea;color:#a32a1f;border:0;font-size:13px}" +
    "#ppsc .typing{align-self:flex-end;color:var(--muted,#5b6b86);font-size:13px}" +
    "#ppsc .chips{display:flex;flex-wrap:wrap;gap:6px}" +
    "#ppsc .chip{border:1px solid var(--line,#e3e9f5);background:var(--card,#fff);color:var(--primary,#2563eb);border-radius:999px;padding:5px 11px;font-size:13px}" +
    "#ppsc .chip:hover{border-color:var(--primary,#2563eb)}" +
    "#ppsc .ft{border-top:1px solid var(--line,#e3e9f5);padding:8px 10px;background:var(--card,#fff)}" +
    "#ppsc .row{display:flex;gap:8px;align-items:flex-end}" +
    "#ppsc textarea,#ppsc input{flex:1;font:inherit;color:inherit;border:1px solid var(--line,#e3e9f5);border-radius:12px;padding:8px 10px;background:var(--bg,#f8faff);resize:none;max-height:90px}" +
    "#ppsc input{width:100%;margin-bottom:8px;font-size:13px}" +
    "#ppsc textarea:focus,#ppsc input:focus{outline:2px solid var(--primary,#2563eb);outline-offset:-1px}" +
    "#ppsc .send{border:0;border-radius:12px;padding:9px 14px;color:#fff;font-weight:700;background:var(--primary,#2563eb)}#ppsc .send:disabled{opacity:.5;cursor:default}" +
    "#ppsc .human{display:block;margin:6px auto 0;border:0;background:none;color:var(--muted,#5b6b86);font-size:12px;text-decoration:underline}" +
    "@media (prefers-reduced-motion:no-preference){#ppsc .panel{animation:ppscIn .18s ease-out}@keyframes ppscIn{from{opacity:0;transform:translateY(8px)}}}" +
    "@media (max-width:480px){#ppsc{left:12px}#ppsc .fab span{display:none}#ppsc .fab{padding:14px}}";
  document.head.appendChild(css);

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var root = el("div"); root.id = "ppsc";
  var fab = el("button", "fab"); fab.type = "button"; fab.setAttribute("aria-label", "گفتگو با پشتیبانی"); fab.setAttribute("aria-expanded", "false");
  fab.append(el("b", "", "💬"), el("span", "", "پشتیبانی"));
  var dot = el("i", "dot"); dot.hidden = true; fab.append(dot);
  var panel = el("div", "panel"); panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "گفتگو با پشتیبانی");
  var hd = el("div", "hd"), ht = el("div"); ht.append(el("b", "", "پشتیبانی پاورپوینت‌ساز"), el("span", "", "دستیار هوشمند · پاسخ فوری"));
  var xb = el("button", "x", "✕"); xb.type = "button"; xb.setAttribute("aria-label", "بستن");
  hd.append(ht, xb);
  var list = el("div", "list"); list.setAttribute("aria-live", "polite");
  var ft = el("div", "ft");
  var contact = el("input"); contact.type = "text"; contact.maxLength = 80; contact.autocomplete = "off"; contact.hidden = true;
  contact.placeholder = "ایمیل یا موبایل (اختیاری)"; contact.setAttribute("aria-label", "ایمیل یا موبایل");
  var row = el("div", "row"), ta = el("textarea"); ta.rows = 1; ta.maxLength = 600; ta.placeholder = "پیامت را بنویس…"; ta.setAttribute("aria-label", "پیام");
  var send = el("button", "send", "ارسال"); send.type = "button";
  row.append(ta, send);
  var human = el("button", "human", "صحبت با پشتیبان انسانی"); human.type = "button"; human.hidden = true;
  ft.append(contact, row, human);
  panel.append(hd, list, ft);
  root.append(panel, fab);

  function render() {
    list.textContent = "";
    list.append(el("div", "m a", GREETING));
    if (!msgs.length) {
      var chips = el("div", "chips");
      CHIPS.forEach(function (c) { var b = el("button", "chip", c); b.type = "button"; b.addEventListener("click", function () { post(c, false); }); chips.append(b); });
      list.append(chips);
    }
    msgs.forEach(function (m) {
      var d = el("div", "m " + m.r);
      if (m.r === "s") d.append(el("small", "", "پشتیبان"));
      d.append(document.createTextNode(m.t));
      list.append(d);
    });
    if (busy) list.append(el("div", "typing", "در حال نوشتن…"));
    list.scrollTop = list.scrollHeight;
    human.hidden = handoff || !msgs.length;
    contact.hidden = !handoff;
  }
  function apply(d) {
    if (!d || d.same) { if (d && d.handoff != null) handoff = !!d.handoff; return; }
    msgs = d.msgs || []; handoff = !!d.handoff; count = msgs.length;
    ls.set("pp_sc_h", handoff ? "1" : "");
    if (open) { ls.set("pp_sc_n", String(count)); render(); }
    else { dot.hidden = !(msgs.length && msgs[msgs.length - 1].r === "s" && count > Number(ls.get("pp_sc_n") || 0)); }
  }
  function err(t) { var e = el("div", "m err", t); list.append(e); list.scrollTop = list.scrollHeight; }

  function post(text, isHuman) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true; send.disabled = true;
    msgs.push({ r: "u", t: text }); ta.value = ""; render();
    var body = { cid: cid, text: text };
    if (isHuman) body.human = true;
    if (contact.value.trim()) body.contact = contact.value.trim();
    fetch("/api/support/send", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        busy = false; send.disabled = false;
        if (!x.ok) { msgs.pop(); render(); err((x.d && x.d.error) || "ارسال نشد؛ دوباره امتحان کن."); return; }
        apply(x.d); render(); schedule();
      })
      .catch(function () { busy = false; send.disabled = false; msgs.pop(); render(); err("اتصال برقرار نشد؛ دوباره امتحان کن."); });
  }

  function poll() {
    fetch("/api/support/poll?cid=" + cid + "&n=" + count, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { apply(d); }).catch(function () {});
  }
  function schedule() {
    clearInterval(timer);
    if (open && handoff) timer = setInterval(function () { if (document.visibilityState === "visible" && !busy) poll(); }, 7000);
  }

  function setOpen(o) {
    open = o; panel.hidden = !o; fab.setAttribute("aria-expanded", String(o));
    if (o) { dot.hidden = true; ls.set("pp_sc_n", String(count < 0 ? 0 : count)); render(); poll(); schedule(); setTimeout(function () { ta.focus(); }, 50); }
    else { clearInterval(timer); fab.focus(); }
  }

  fab.addEventListener("click", function () { setOpen(!open); });
  xb.addEventListener("click", function () { setOpen(false); });
  send.addEventListener("click", function () { post(ta.value, false); });
  human.addEventListener("click", function () { post("می‌خواهم با پشتیبان انسانی صحبت کنم.", true); });
  ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); post(ta.value, false); } });
  contact.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.isComposing && contact.value.trim()) { e.preventDefault(); post("راه تماس من: " + contact.value.trim(), false); } });
  root.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) setOpen(false); });
  ta.addEventListener("input", function () { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 90) + "px"; });

  function boot() {
    document.body.appendChild(root);
    if (ls.get("pp_sc_h")) poll(true); // گفتگوی قبلیِ در انتظار پشتیبان: اگر جواب آمده باشد نقطه‌ی قرمز نشان بده
  }
  var go = function () { (window.requestIdleCallback || function (f) { setTimeout(f, 1500); })(boot); };
  if (document.readyState === "complete") go(); else window.addEventListener("load", go);
})();
