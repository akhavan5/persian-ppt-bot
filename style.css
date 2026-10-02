"use strict";

// ---------- ابزارها ----------
const $ = (s) => document.querySelector(s);
const fa = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);

/** ساخت المان بدون innerHTML (عنوان‌ها از مدل زبانی می‌آیند؛ فقط textContent) */
function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "bg") n.style.background = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* حالت خصوصی */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};

async function api(path, opts = {}) {
  const headers = { "x-ppt": "1" };
  if (opts.body) headers["content-type"] = "application/json";
  const r = await fetch(path, { credentials: "same-origin", ...opts, headers });
  let data = null;
  try { data = await r.json(); } catch { /* بدنه‌ی خالی */ }
  if (!r.ok) {
    const e = new Error(data?.error || "http_" + r.status);
    e.status = r.status; e.code = data?.error;
    throw e;
  }
  return data;
}

const ERR = {
  unauthorized: "نشست شما منقضی شده؛ دوباره وارد شو.",
  forbidden: "دسترسی شما به این سرویس مجاز نیست.",
  banned: "دسترسی شما به این سرویس مسدود شده است.",
  busy: "ارائه‌ی قبلی شما هنوز در حال ساخته شدن است؛ کمی صبر کن.",
  no_credit: "اعتبار شما تمام شده است.",
  topic_short: "موضوع خیلی کوتاه است؛ کمی کامل‌تر بنویس.",
  topic_long: "موضوع بیش از حد طولانی است (حداکثر ۶۰۰ کاراکتر).",
  start_failed: "شروع ساخت ارائه ممکن نشد؛ اعتبارت برگردانده شد. کمی بعد دوباره امتحان کن.",
};
const errText = (e) => ERR[e?.code] || "مشکلی پیش آمد؛ چند لحظه بعد دوباره امتحان کن.";

function ago(t) {
  const m = Math.max(1, Math.round((Date.now() - t) / 60000));
  return m < 60 ? `${fa(m)} دقیقه پیش` : `${fa(Math.round(m / 60))} ساعت پیش`;
}

// ---------- وضعیت ----------
let me = null;          // پاسخ /api/me
let S = null;           // تنظیمات در حال ویرایش
let extraFiles = [];    // فایل‌هایی که همین الان ساخته شده‌اند (تا فهرست سرور به‌روز شود)
let jobId = null, jobTimer = 0, tickTimer = 0, jobT0 = 0;

const VIEWS = ["boot", "login", "app"];
function show(view) {
  for (const v of VIEWS) $("#" + v).hidden = v !== view;
  $("#userbox").hidden = view !== "app";
}

// ---------- ورود با تلگرام ----------
let loginToken = null, loginTimer = 0, loginT0 = 0;

function loginMsg(t) { const n = $("#login-msg"); n.textContent = t || ""; n.hidden = !t; }
function stopLoginPoll() { clearTimeout(loginTimer); loginTimer = 0; }

async function prepareLogin() {
  stopLoginPoll();
  loginToken = null;
  $("#login-wait").hidden = true;
  const btn = $("#tg-btn");
  btn.setAttribute("aria-disabled", "true");
  btn.removeAttribute("href");
  try {
    const r = await api("/api/auth/start", { method: "POST" });
    loginToken = r.token;
    // لینک از قبل آماده است تا مرورگر کلیک را مسدود نکند
    btn.href = r.url; $("#tg-link").href = r.url;
    btn.removeAttribute("aria-disabled");
  } catch (e) { loginMsg(errText(e)); }
}

async function showLogin(msg) {
  show("login");
  loginMsg(msg || "");
  await prepareLogin();
}

$("#tg-btn").addEventListener("click", (ev) => {
  if (!loginToken) { ev.preventDefault(); return; }
  $("#login-wait").hidden = false;
  stopLoginPoll();
  loginT0 = Date.now();
  loginTimer = setTimeout(pollLogin, 1500);
});

async function pollLogin() {
  if (!loginToken) return;
  try {
    const r = await api("/api/auth/poll?token=" + encodeURIComponent(loginToken));
    if (r.s === "ok") { stopLoginPoll(); return await boot(); }
    if (r.s === "denied") { loginMsg("ورود در تلگرام لغو شد. اگر خودت بودی، دوباره امتحان کن."); return await prepareLogin(); }
    if (r.s === "expired") { loginMsg("لینک ورود منقضی شد؛ دوباره دکمه را بزن."); return await prepareLogin(); }
  } catch { /* قطعی لحظه‌ای شبکه؛ دوباره تلاش می‌شود */ }
  if (Date.now() - loginT0 > 10 * 60 * 1000) { loginMsg("زمان ورود تمام شد؛ دوباره دکمه را بزن."); return await prepareLogin(); }
  loginTimer = setTimeout(pollLogin, 2500);
}

document.addEventListener("visibilitychange", () => {
  // برگشتن از تلگرام (مخصوصاً موبایل): بلافاصله وضعیت را بپرس
  if (document.hidden) return;
  if (loginTimer) { clearTimeout(loginTimer); pollLogin(); }
  if (jobTimer) { clearTimeout(jobTimer); pollJob(); }
});

$("#logout").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* */ }
  store.del("ppt_job"); me = null; resetJobUi();
  await showLogin();
});

// ---------- راه‌اندازی ----------
async function boot() {
  show("boot");
  try {
    me = await api("/api/me");
    showApp();
  } catch (e) {
    if (e.status === 401) await showLogin();
    else await showLogin(errText(e));
  }
}

function showApp() {
  show("app");
  S = { ...me.settings };
  $("#uname").textContent = me.user.name || (me.user.username ? "@" + me.user.username : "");
  buildForm();
  renderMe();
  const saved = store.get("ppt_job");
  if (saved) trackJob(saved, Number(store.get("ppt_job_t")) || Date.now());
}

function renderMe() {
  const c = me.credit;
  $("#credit").textContent = c.unlimited ? "اعتبار: نامحدود" : `اعتبار: ${fa(c.total)} ارائه`;
  renderBuy(); renderHistory(); syncButton();
}

const noCredit = () => !me.credit.unlimited && me.credit.total <= 0;

function syncButton() {
  const btn = $("#go");
  const busy = !!jobId;
  btn.disabled = busy || noCredit();
  btn.textContent = busy ? "در حال ساخت…" : noCredit() ? "اعتبار تمام شده است" : "ساخت ارائه ✨";
}

function renderBuy() {
  const c = me.credit, box = $("#buy");
  box.hidden = c.unlimited || c.total > 1;
  if (box.hidden) return;
  $("#buy-note").textContent = c.total === 0 ? "اعتبارت تمام شده است. برای ادامه یکی از بسته‌ها را انتخاب کن:" : "فقط ۱ ارائه‌ی دیگر اعتبار داری. برای شارژ یکی از بسته‌ها را انتخاب کن:";
  const links = $("#buy-links");
  links.replaceChildren(
    ...me.buy.map((b) => h("a", { href: b.url, target: "_blank", rel: "noopener", text: b.text })),
    h("a", { href: me.support, target: "_blank", rel: "noopener", text: "💬 پیام به پشتیبانی" }),
  );
}

function renderHistory() {
  const seen = new Set(me.files.map((f) => f.id));
  const list = [...extraFiles.filter((f) => !seen.has(f.id)), ...me.files].sort((a, b) => b.t - a.t).slice(0, 3);
  const box = $("#history");
  box.hidden = list.length === 0;
  $("#files").replaceChildren(...list.map((f) => h("li", {},
    h("div", { class: "t" }, h("b", { text: f.title }), h("small", { text: `${fa(f.slides)} اسلاید · ${ago(f.t)}` })),
    h("a", { href: "/api/download?id=" + encodeURIComponent(f.id), download: true, text: "📥 دانلود" }),
  )));
}

async function refreshMe() {
  try { me = await api("/api/me"); renderMe(); }
  catch (e) { if (e.status === 401) { me = null; await showLogin(errText(e)); } }
}

// ---------- فرم ----------
const SWITCHES = [
  { key: "mode", label: "🎓 حالت دانشجویی", desc: "فهرست، مقدمه، بدنه، نتیجه‌گیری و منابع (حداقل ۸ اسلاید)", on: (s) => s.mode === "student", set: (s, v) => { s.mode = v ? "student" : "normal"; } },
  { key: "images", label: "🖼 تصویر خودکار", desc: "برای اسلایدهای «تصویر و متن»", on: (s) => s.images, set: (s, v) => { s.images = v; } },
  { key: "digits", label: "🔢 ارقام فارسی", desc: "خاموش = ارقام انگلیسی", on: (s) => s.digits, set: (s, v) => { s.digits = v; } },
  { key: "sources", label: "📚 اسلاید منابع", desc: "در حالت دانشجویی همیشه روشن است", on: (s) => s.sources || s.mode === "student", set: (s, v) => { s.sources = v; }, locked: (s) => s.mode === "student" },
  { key: "questions", label: "❓ پرسش‌های پایانی", desc: "یک اسلاید پرسش در انتها", on: (s) => s.questions, set: (s, v) => { s.questions = v; } },
];

const SLIDE_CHIPS = [5, 8, 10, 12, 15];
const minSlides = () => (S.mode === "student" ? me.options.slides.studentMin : me.options.slides.min);

function setSlides(n) {
  S.slides = Math.min(me.options.slides.max, Math.max(minSlides(), n));
  $("#sl-val").textContent = fa(S.slides);
  $("#sl-minus").disabled = S.slides <= minSlides();
  $("#sl-plus").disabled = S.slides >= me.options.slides.max;
  for (const b of document.querySelectorAll(".chip-btn")) b.setAttribute("aria-pressed", String(Number(b.dataset.n) === S.slides));
}

function buildForm() {
  const o = me.options;
  $("#sl-chips").replaceChildren(...SLIDE_CHIPS.map((n) => h("button", { type: "button", class: "chip-btn", "data-n": n, text: fa(n), onclick: () => setSlides(n) })));
  setSlides(S.slides);

  const themes = $("#themes");
  const paint = () => { for (const b of themes.children) b.setAttribute("aria-pressed", String(b.dataset.id === S.theme)); };
  themes.replaceChildren(...o.themes.map((t) => h("button", { type: "button", class: "theme", "data-id": t.id, onclick: () => { S.theme = t.id; paint(); } },
    h("i", { bg: `linear-gradient(135deg, #${t.primary} 55%, #${t.accent} 55%)` }), h("span", { text: t.name }))));
  paint();

  const tone = $("#tone"), font = $("#font");
  tone.replaceChildren(...o.tones.map((t) => h("option", { value: t.id, text: t.name })));
  font.replaceChildren(...o.fonts.map((f) => h("option", { value: f, text: f })));
  tone.value = S.tone; font.value = S.font;
  tone.onchange = () => { S.tone = tone.value; };
  font.onchange = () => { S.font = font.value; };

  const renderSwitches = () => $("#switches").replaceChildren(...SWITCHES.map((d) => {
    const locked = d.locked?.(S);
    const input = h("input", { type: "checkbox", class: "sw-in", disabled: !!locked });
    input.checked = d.on(S);
    input.addEventListener("change", () => {
      d.set(S, input.checked);
      if (d.key === "mode") setSlides(S.slides);
      renderSwitches();
    });
    return h("label", { class: "switch" + (locked ? " dis" : "") }, input, h("span", { class: "sw" }),
      h("span", { class: "sw-t" }, d.label, h("small", { text: d.desc })));
  }));
  renderSwitches();

  $("#sl-minus").onclick = () => setSlides(S.slides - 1);
  $("#sl-plus").onclick = () => setSlides(S.slides + 1);
}

const topic = $("#topic");
topic.addEventListener("input", () => { $("#tcount").textContent = fa(topic.value.length); });

function formErr(t) { const n = $("#form-err"); n.textContent = t || ""; n.hidden = !t; }

$("#form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (jobId || !me || noCredit()) return;
  const t = topic.value.trim();
  if (t.length < 3) return formErr(ERR.topic_short);
  formErr(""); $("#result").hidden = true;
  $("#go").disabled = true;
  try {
    const r = await api("/api/generate", { method: "POST", body: JSON.stringify({ topic: t, settings: S }) });
    store.set("ppt_job", r.id); store.set("ppt_job_t", String(Date.now()));
    trackJob(r.id, Date.now());
  } catch (e) {
    formErr(errText(e));
    if (e.status === 401) { me = null; return await showLogin(errText(e)); }
    await refreshMe();
    syncButton();
  }
});

// ---------- پیگیری ساخت ----------
const PHASES = ["outline", "content", "build"];
const PHASE_LABELS = ["طراحی سرفصل‌ها", "نوشتن محتوای اسلایدها", "ساخت فایل پاورپوینت"];

function showProgress(phase) {
  $("#progress").hidden = false;
  const cur = Math.max(0, PHASES.indexOf(phase)); // queued → مرحله‌ی اول
  $("#steps").replaceChildren(...PHASE_LABELS.map((label, i) => h("li", { class: i < cur ? "done" : i === cur ? "active" : "" },
    h("span", { class: "dot", text: i < cur ? "✓" : "" }), h("span", { text: label }))));
}

function renderElapsed() {
  const s = Math.floor((Date.now() - jobT0) / 1000);
  $("#elapsed").textContent = s > 3 ? `(${fa(s)} ثانیه)` : "";
}

function resetJobUi() {
  clearTimeout(jobTimer); clearInterval(tickTimer);
  jobTimer = 0; tickTimer = 0; jobId = null;
  $("#progress").hidden = true;
}

function trackJob(id, t0) {
  resetJobUi();
  jobId = id; jobT0 = t0;
  $("#result").hidden = true;
  showProgress("queued"); syncButton();
  tickTimer = setInterval(renderElapsed, 1000);
  pollJob();
}

async function pollJob() {
  clearTimeout(jobTimer); jobTimer = 0;
  const id = jobId;
  if (!id) return;
  try {
    const j = await api("/api/job?id=" + encodeURIComponent(id));
    if (id !== jobId) return;
    if (j.s === "done") return await jobDone(id, j);
    if (j.s === "error") return await jobFailed(j.msg);
    showProgress(j.s);
  } catch (e) {
    if (id !== jobId) return;
    if (e.status === 401) { resetJobUi(); me = null; return await showLogin(errText(e)); }
    if (e.status === 404 || e.status === 400) { // نمونه‌ی قدیمی/منقضی
      store.del("ppt_job"); resetJobUi(); await refreshMe(); return;
    }
    // خطای موقت شبکه/سرور: دوباره تلاش می‌کنیم
  }
  jobTimer = setTimeout(pollJob, 2000);
}

async function jobDone(id, j) {
  store.del("ppt_job"); resetJobUi();
  extraFiles.unshift({ id, title: j.title, slides: j.slides, t: Date.now() });
  $("#r-title").textContent = j.title;
  $("#r-meta").textContent = `${fa(j.slides)} اسلاید`;
  $("#r-dl").href = "/api/download?id=" + encodeURIComponent(id);
  $("#result").hidden = false;
  await refreshMe();
}

async function jobFailed(msg) {
  store.del("ppt_job"); resetJobUi();
  formErr(msg || "ساخت ارائه با خطا مواجه شد. چند دقیقه بعد دوباره امتحان کن.");
  await refreshMe();
}

boot();
