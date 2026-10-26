import type { Env } from "./env";
import { editMessage, esc, sendDocument, sendMessage, tg } from "./telegram";
import {
  PLAN_MAX_IMAGES, PLAN_MAX_SLIDES, FREE_MAX_IMAGES, FREE_MAX_SLIDES, getBonus, getCredit, getStats, getSub, getUserSeen, isAdmin, isBanned, isLocked, releaseLock,
  setBanned, setBonus, REF_MAX, type Uid,
} from "./settings";
import { getUserById, googleEnabled, otpEnabled, type WebUser } from "./auth";
import { resolveUid } from "./link";
import { getDeckLog, listFiles, loadFile } from "./files";
import { hasKey, modelList } from "./llm";
import { PLANS, activatePlan, payEnabled } from "./payment";
import { runningJob } from "./deck-service";
import { hasBrowser } from "./browser-api";
import { toEn, toFa } from "./util";
import { AUDIENCES, isAudience, listAudience, type Audience } from "./broadcast";

/** دستورهای متنی مدیر: فقط ورود به پنل و لغو ورودی در انتظار؛ بقیه‌ی کارها با دکمه‌های پنل انجام می‌شود */
export const ADMIN_CMDS = new Set(["/admin", "/panel", "/cancel"]);

type Btn = { text: string; callback_data?: string; url?: string };
type Screen = { text: string; kb: Btn[][] };

const fa = (n: number | string) => toFa(String(n));

/** لینک پروفایل: با نام کاربری → t.me/نام_کاربری، وگرنه لینک tg://user (برای کاربرانی که با ربات گفتگو داشته‌اند کار می‌کند) */
const userLink = (id: Uid, name?: string | null, username?: string | null) => {
  if (typeof id === "string") return `<b>${esc(name || id)}</b> 🌐`; // کاربر وب: پروفایل تلگرام ندارد
  const uname = username && /^[A-Za-z0-9_]{3,64}$/.test(username) ? username : null;
  const label = esc(name || (uname ? "@" + uname : String(id)));
  return `<a href="${uname ? `https://t.me/${uname}` : `tg://user?id=${id}`}">${label}</a>`;
};

/** زمان به وقت ایران، مثلاً ۲۰۲۶-۱۰-۰۲ ۱۵:۳۰ */
const fmtTime = (t: number | string) =>
  toFa(new Date(t).toLocaleString("sv-SE", { timeZone: "Asia/Tehran" }).slice(0, 16));
const fmtDay = (t: number) => {
  try { return new Date(t).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tehran" }); }
  catch { return new Date(t).toISOString().slice(0, 10); }
};

/** شناسه‌ی تلگرام (عدد) یا شناسه‌ی کاربر وب (w_ + ۱۶ نویسه‌ی هگز) */
const WEB_ID = /^w_[0-9a-f]{16}$/;
const parseId = (s?: string): Uid | null => {
  const v = toEn(s ?? "").trim();
  if (WEB_ID.test(v)) return v;
  return /^\d{1,15}$/.test(v) ? Number(v) : null;
};
const idOf = (s?: string): Uid | null => (s && WEB_ID.test(s) ? s : s && /^\d{1,15}$/.test(s) ? Number(s) : null);

const json = <T>(s: string | null | undefined): T | null => { try { return s ? (JSON.parse(s) as T) : null; } catch { return null; } };

// ---------- دسترسی مستقیم به D1 (برای شمارش و فهرست‌های صفحه‌بندی‌شده) ----------
// فیلتر کلید همیشه با «بازه‌ی کلید» (k >= پیشوند AND k < پیشوند+حداکثر) انجام می‌شود، نه LIKE، تا فقط ردیف‌های همان پیشوند خوانده شوند
// و json_extract هرگز روی ردیف‌های غیر JSON (مثل bonus: یا ban:) اجرا نشود.
const MAXC = "\u{10FFFF}";
const nowSec = () => Math.floor(Date.now() / 1000);
async function db(env: Env): Promise<D1Database> { await env.KV.ready(); return env.DB; }
async function count(env: Env, sql: string, ...binds: unknown[]): Promise<number> {
  const d = await db(env);
  const r = await d.prepare(sql).bind(...binds).first<{ c: number | null }>();
  return Number(r?.c ?? 0);
}
async function rows(env: Env, sql: string, ...binds: unknown[]): Promise<{ k: string; v: string }[]> {
  const d = await db(env);
  return (await d.prepare(sql).bind(...binds).all<{ k: string; v: string }>()).results ?? [];
}
/** «کاربران وب»: پروفایلی که خود کاربر از وب ساخته (ایمیل، موبایل یا گوگل دارد)، چه تلگرام وصل کرده باشد چه نه.
 *  پروفایل‌های خودکارِ ربات (بدون ایمیل/موبایل/گوگل) شمرده نمی‌شوند. */
const WEB_ONLY =
  "(COALESCE(json_extract(v,'$.email'),'') != '' OR COALESCE(json_extract(v,'$.mobile'),'') != '' OR json_extract(v,'$.google') IS NOT NULL)";
const APP_USER = "json_extract(v,'$.app') = 1";
const likeArg = (s: string) => "%" + s.replace(/[\\%_]/g, "\\$&") + "%";

// ---------- گزارش اقدامات مدیر ----------
const LOG_KEY = "adm:log";
async function logAction(env: Env, adminId: number, text: string) {
  try {
    const cur = json<{ t: number; a: number; x: string }[]>(await env.KV.get(LOG_KEY)) ?? [];
    await env.KV.put(LOG_KEY, JSON.stringify([{ t: Date.now(), a: adminId, x: text.slice(0, 200) }, ...cur].slice(0, 30)));
  } catch (e) { console.error("admin log", e); }
}

// ---------- هویت کاربر: هر شناسه (تلگرام یا وب) به یک «کارت» یکسان می‌رسد ----------
interface Ident { tgId: number | null; webId: string | null; /** شناسه‌ی نگه‌دارنده‌ی اعتبار/پلن/فایل */ acct: Uid }
async function identify(env: Env, id: Uid): Promise<Ident> {
  if (typeof id === "number") {
    const acct = await resolveUid(env, id);
    return { tgId: id, webId: typeof acct === "string" ? acct : null, acct };
  }
  const t = Number(await env.KV.get(`w2tg:${id}`).catch(() => null));
  return { tgId: Number.isSafeInteger(t) && t > 0 ? t : null, webId: id, acct: id };
}
const cardId = (i: Ident): Uid => i.tgId ?? (i.webId as string);

// ---------- ورودی متنی منتظر (جستجو، اعتبار دلخواه، پیام به کاربر، پیام همگانی) ----------
type Pending = { k: "search" } | { k: "bc" } | { k: "cr"; id: Uid } | { k: "msg"; id: Uid };
const inKey = (adminId: number) => `adm:in:${adminId}`;
const setInput = (env: Env, adminId: number, p: Pending) => env.KV.put(inKey(adminId), JSON.stringify(p), { expirationTtl: 600 });
const clearInput = (env: Env, adminId: number) => env.KV.delete(inKey(adminId));

// ---------- صفحه‌ها ----------
const backHome: Btn[] = [{ text: "🏠 پنل", callback_data: "ad:h" }];
const cb = (text: string, data: string): Btn => ({ text, callback_data: data });

async function homeScreen(env: Env): Promise<Screen> {
  const day = new Date().toISOString().slice(0, 10);
  const [tgUsers, webOnly, appUsers, subs, banned, st, payIssues] = await Promise.all([
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2", "seen:", "seen:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${WEB_ONLY}`, "wu:", "wu:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${APP_USER}`, "wu:", "wu:" + MAXC),
    activeSubCount(env),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2", "ban:", "ban:" + MAXC),
    statsByDay(env),
    issueCount(env).catch(() => 0),
  ]);
  const t = st[day] ?? {};
  return {
    text:
      "🛠 <b>پنل مدیریت</b>\n\n" +
      `👥 کاربران تلگرام: <b>${fa(tgUsers)}</b> · 🌐 وب: <b>${fa(webOnly)}</b> · 📱 اپ: <b>${fa(appUsers)}</b>\n` +
      `👑 پلن فعال: <b>${fa(subs)}</b> · ⛔️ مسدود: <b>${fa(banned)}</b>\n` +
      `📅 امروز: ▶️ ${fa(t.started ?? 0)} · ✅ ${fa(t.ok ?? 0)} · ❌ ${fa(t.fail ?? 0)} · 🆕 ${fa(t.newusers ?? 0)} (📱 ${fa(t.newapp ?? 0)})\n` +
      (payIssues ? `🚨 <b>${fa(payIssues)} پرداخت موفق از درگاه، تاییدنشده</b> ← «💰 پرداخت‌ها»\n` : "") + "\n" +
      "<i>یک بخش را انتخاب کن. برای مدیریت یک کاربر، شناسه یا نامش را در «جستجو» بنویس.</i>",
    kb: [
      [cb("📊 آمار", "ad:st:7"), cb("👥 کاربران", "ad:us:t:0")],
      [cb("🔎 جستجوی کاربر", "ad:se"), cb("🗂 ارائه‌های اخیر", "ad:dk")],
      [cb("📣 پیام همگانی", "ad:bc"), cb("👑 پلن‌های فعال", "ad:sb:0")],
      [cb("⛔️ مسدودها", "ad:bn"), cb("⚙️ سیستم", "ad:sy")],
      [cb(`💰 پرداخت‌ها${payIssues ? ` 🚨${fa(payIssues)}` : ""}`, "ad:pm:s:0"), cb("🔻 قیف کاربران", "ad:fn:30"), cb("🎁 دعوت‌ها", "ad:iv:t:0")],
      [cb("🔄 تازه‌سازی", "ad:h"), cb("✖️ بستن", "ad:x")],
    ],
  };
}

async function activeSubCount(env: Env): Promise<number> {
  return count(env,
    "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND json_extract(v,'$.exp') > ?4 AND json_extract(v,'$.credits') > 0",
    "sub:", "sub:" + MAXC, nowSec(), Date.now());
}

/** همه‌ی شمارنده‌های آمار روزانه (stat:نام:تاریخ) با یک پرس‌وجو */
async function statsByDay(env: Env): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of await rows(env, "SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3)", "stat:", "stat:" + MAXC, nowSec())) {
    const [, name, date] = r.k.split(":");
    if (!name || !date) continue;
    (out[date] ??= {})[name] = Number(r.v) || 0;
  }
  return out;
}

async function statsScreen(env: Env, days: number): Promise<Screen> {
  const [st, tgUsers, webUsers, subs, bonusSum, bonusUsers, appUsers] = await Promise.all([
    statsByDay(env),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2", "seen:", "seen:" + MAXC),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2", "wu:", "wu:" + MAXC),
    activeSubCount(env),
    count(env, "SELECT SUM(CAST(v AS INTEGER)) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3)", "bonus:", "bonus:" + MAXC, nowSec()),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND CAST(v AS INTEGER) > 0", "bonus:", "bonus:" + MAXC, nowSec()),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${APP_USER}`, "wu:", "wu:" + MAXC),
  ]);
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  const sum = (n: string) => dates.reduce((a, d) => a + (st[d]?.[n] ?? 0), 0);
  const ok = sum("ok"), fail = sum("fail");
  const rate = ok + fail > 0 ? Math.round((ok / (ok + fail)) * 100) : null;
  const label = days === 1 ? "امروز (UTC)" : `${fa(days)} روز اخیر`;

  // ریز روزانه‌ی ۷ روز اخیر (همیشه)، به همراه نمودار متنی تعداد ارائه‌های موفق
  const last7 = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  const peak = Math.max(1, ...last7.map((d) => st[d]?.ok ?? 0));
  const bar = (n: number) => "▰".repeat(Math.round((n / peak) * 8)) + "▱".repeat(8 - Math.round((n / peak) * 8));
  const daily = last7.map((d) => {
    const x = st[d] ?? {};
    const md = new Date(d + "T00:00:00Z").toLocaleDateString("fa-IR", { month: "2-digit", day: "2-digit", timeZone: "UTC" });
    return `${md} ${bar(x.ok ?? 0)} ✅${fa(x.ok ?? 0)} ❌${fa(x.fail ?? 0)} 🆕${fa(x.newusers ?? 0)} 📱${fa(x.newapp ?? 0)}`;
  });

  return {
    text:
      `📊 <b>آمار — ${label}</b>\n` +
      `🆕 کاربر جدید: ${fa(sum("newusers"))} (📱 از اپ اندروید: ${fa(sum("newapp"))})\n▶️ شروع‌شده: ${fa(sum("started"))}\n✅ موفق: ${fa(ok)}\n❌ ناموفق: ${fa(fail)}` +
      (rate === null ? "" : `\n📈 نرخ موفقیت: ${fa(rate)}٪`) +
      "\n\n<b>کل</b>\n" +
      `👥 کاربران تلگرام: ${fa(tgUsers)} · 🌐 پروفایل وب: ${fa(webUsers)}\n` +
      `📱 کاربران اپ اندروید: ${fa(appUsers)}\n` +
      `👑 پلن‌های فعال: ${fa(subs)}\n` +
      `🎁 اعتبار هدیه/شارژِ مصرف‌نشده: ${fa(bonusSum)} (نزد ${fa(bonusUsers)} کاربر)\n\n` +
      "<b>ریز ۷ روز اخیر</b>\n" + daily.join("\n") +
      "\n\n<i>«کاربر جدید» از زمان فعال شدن این قابلیت شمرده می‌شود؛ آمار روزانه ۴۰۰ روز نگه داشته می‌شود.</i>",
    kb: [
      [cb(days === 1 ? "• امروز" : "امروز", "ad:st:1"), cb(days === 7 ? "• ۷ روز" : "۷ روز", "ad:st:7"), cb(days === 30 ? "• ۳۰ روز" : "۳۰ روز", "ad:st:30")],
      [cb("🔄 تازه‌سازی", `ad:st:${days}`), cb("📅 ماهانه", "ad:mo"), ...backHome],
    ],
  };
}

const PAGE = 8;
const pager = (base: string, page: number, more: boolean): Btn[] => {
  const r: Btn[] = [];
  if (page > 0) r.push(cb("◀️ قبلی", `${base}:${page - 1}`));
  if (more) r.push(cb("بعدی ▶️", `${base}:${page + 1}`));
  return r;
};

async function usersScreen(env: Env, kind: "t" | "w", page: number): Promise<Screen> {
  const tabs: Btn[] = [cb(kind === "t" ? "• کاربران تلگرام" : "کاربران تلگرام", "ad:us:t:0"), cb(kind === "w" ? "• کاربران وب" : "کاربران وب", "ad:us:w:0")];
  const items: { id: Uid; label: string; line: string }[] = [];
  let total = 0;
  if (kind === "t") {
    total = await count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2", "seen:", "seen:" + MAXC);
    const rs = await rows(env, "SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 ORDER BY json_extract(v,'$.t') DESC LIMIT ?3 OFFSET ?4", "seen:", "seen:" + MAXC, PAGE, page * PAGE);
    for (const r of rs) {
      const id = Number(r.k.slice(5)); const v = json<{ t: string; u: string | null; n?: string }>(r.v);
      if (!Number.isSafeInteger(id) || !v) continue;
      items.push({ id, label: v.n || (v.u ? "@" + v.u : String(id)), line: `${userLink(id, v.n, v.u)}${v.u ? ` (@${esc(v.u)})` : ""}\n    🆔 <code>${id}</code> · 🕒 ${fmtTime(v.t)}` });
    }
  } else {
    total = await count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${WEB_ONLY}`, "wu:", "wu:" + MAXC);
    const rs = await rows(env,
      `SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND ${WEB_ONLY} ORDER BY json_extract(v,'$.created') DESC LIMIT ?3 OFFSET ?4`,
      "wu:", "wu:" + MAXC, PAGE, page * PAGE);
    for (const r of rs) {
      const wid = r.k.slice(3); const v = json<{ name?: string; email?: string; mobile?: string; created?: number; app?: boolean }>(r.v);
      if (!WEB_ID.test(wid) || !v) continue;
      const t = Number(await env.KV.get(`w2tg:${wid}`).catch(() => null));
      const linked = Number.isSafeInteger(t) && t > 0;
      const id: Uid = linked ? t : wid; // وصل‌شده به تلگرام: کارت با شناسه‌ی تلگرام باز می‌شود
      items.push({ id, label: (linked ? "🔗 " : "") + (v.name || v.email || v.mobile || wid), line: `<b>${esc(v.name || "—")}</b> ${v.app ? "📱" : ""}${linked ? "🔗" : "🌐"}\n    ${v.email ? esc(v.email) : v.mobile ? esc(v.mobile) : "—"} · 🕒 ${v.created ? fmtTime(v.created) : "—"}` });
    }
  }
  const head = kind === "t" ? "👥 <b>کاربران تلگرام</b> (جدیدترین اول، به وقت ایران)" : "🌐 <b>کاربران وب</b> (ثبت‌نام‌شده از سایت یا اپ؛ 📱 = از اپ اندروید، 🔗 = تلگرام هم وصل کرده)";
  return {
    text: `${head}\nکل: ${fa(total)}\n\n` + (items.length ? items.map((x, i) => `${fa(page * PAGE + i + 1)}. ${x.line}`).join("\n") : "موردی نیست.") + "\n\n<i>برای مدیریت، روی نام کاربر بزن.</i>",
    kb: [
      tabs,
      ...items.map((x, i) => [cb(`${fa(page * PAGE + i + 1)}. ${x.label.slice(0, 40)}`, `ad:u:${x.id}`)]),
      pager(`ad:us:${kind}`, page, (page + 1) * PAGE < total),
      backHome,
    ].filter((r) => r.length),
  };
}

async function userCard(env: Env, id: Uid): Promise<Screen> {
  const who = await identify(env, id);
  const { tgId, webId, acct } = who;
  const [seen, web, c, sub, files, bannedTg, bannedWeb, job, refBy, refCount] = await Promise.all([
    tgId ? getUserSeen(env, tgId) : Promise.resolve(null),
    webId ? getUserById(env, webId) : Promise.resolve(null),
    getCredit(env, acct),
    typeof acct === "string" ? getSub(env, acct) : Promise.resolve(null),
    listFiles(env, acct).catch(() => []),
    tgId ? isBanned(env, tgId) : Promise.resolve(false),
    webId ? isBanned(env, webId) : Promise.resolve(false),
    runningJob(env, acct).catch(() => ({ busy: false, jobId: null })),
    tgId ? env.KV.get(`ref:${tgId}`).catch(() => null) : Promise.resolve(null),
    tgId ? env.KV.get(`refc:${tgId}`).catch(() => null) : Promise.resolve(null),
  ]);
  const banned = bannedTg || bannedWeb;
  const admin = tgId ? isAdmin(env, tgId) : false;
  const name = seen?.n || web?.name || "";
  const planName = sub ? (PLANS.find((p) => p.id === sub.plan)?.name ?? sub.plan) : null;
  const subActive = !!sub && sub.credits > 0;
  const creditLine = c.unlimited ? "نامحدود (مدیر)" : `${fa(c.total)} (پلن ${fa(c.plan)} + هدیه/شارژ ${fa(c.bonus)})`;
  const caps = admin ? "۳۵ اسلاید · ۶ تصویر" : subActive
    ? `${fa(PLAN_MAX_SLIDES[sub!.plan] ?? FREE_MAX_SLIDES)} اسلاید · ${fa(PLAN_MAX_IMAGES[sub!.plan] ?? FREE_MAX_IMAGES)} تصویر`
    : `${fa(FREE_MAX_SLIDES)} اسلاید · ${fa(FREE_MAX_IMAGES)} تصویر`;

  const lines = [
    `👤 <b>${tgId ? userLink(tgId, name || "باز کردن پروفایل", seen?.u) : esc(name || "—")}</b>${admin ? " 👮 مدیر" : ""}`,
    tgId ? `🆔 تلگرام: <code>${tgId}</code>${seen?.u ? ` · @${esc(seen.u)}` : ""}` : "🆔 تلگرام: وصل نشده",
    webId ? `🌐 پروفایل وب: <code>${webId}</code>` : "",
    web?.email ? `✉️ ایمیل: ${esc(web.email)}` : "",
    web?.mobile ? `📞 موبایل: ${esc(web.mobile)}` : "",
    web?.app ? `📱 منبع: اپ اندروید${web.via === "app" ? " (ثبت‌نام از اپ)" : " (ثبت‌نام از وب، از اپ هم وارد شده)"}` : "",
    seen ? `🕒 اولین پیام: ${fmtTime(seen.t)}` : web ? `🕒 ثبت‌نام: ${fmtTime(web.created)}` : "",
    "",
    `💳 اعتبار: <b>${creditLine}</b>`,
    sub ? `👑 پلن ${esc(planName ?? "")}: ${subActive ? "فعال" : "بدون اعتبار"} تا ${fmtDay(sub.exp)}${sub.credits ? ` · ${fa(sub.credits)} اعتبار` : ""}` : "👑 پلن: رایگان",
    `📄 سقف هر ارائه: ${caps}`,
    `📁 فایل‌های ۲۴ ساعت اخیر: ${fa(files.length)}`,
    tgId && (refBy || refCount) ? `🎁 دعوت: ${refCount ? `${fa(refCount)} نفر را دعوت کرده` : ""}${refBy && refCount ? " · " : ""}${refBy ? `دعوت‌شده‌ی ${refBy}` : ""}` : "",
    job.busy ? "⏳ <b>الان در حال ساخت ارائه است</b>" : "",
    `وضعیت: ${banned ? "⛔️ مسدود" : "✅ فعال"}`,
  ].filter((x) => x !== "" || true);
  // خط‌های خالی پشت‌سرهم فشرده می‌شوند
  const text = lines.filter((x, i) => x !== "" || (i > 0 && lines[i - 1] !== "")).join("\n");

  const key = String(cardId(who));
  const kb: Btn[][] = [
    [cb("➕۱", `ad:g:${key}:1`), cb("➕۵", `ad:g:${key}:5`), cb("➕۱۰", `ad:g:${key}:10`), cb("➖۱", `ad:g:${key}:-1`), cb("✏️ دلخواه", `ad:cr:${key}`)],
  ];
  if (typeof acct === "string") {
    kb.push([cb("⭐ پلاس (+۳۰ روز)", `ad:pl:${key}:plus`), cb("👑 پرو (+۳۰ روز)", `ad:pl:${key}:pro`)]);
    if (sub) kb.push([cb("🚫 لغو پلن", `ad:pl:${key}:none`)]);
  }
  const row2: Btn[] = [];
  if (!admin) row2.push(banned ? cb("✅ رفع انسداد", `ad:b:${key}:0`) : cb("⛔️ مسدود کردن", `ad:b:${key}:1`));
  if (tgId) row2.push(cb("✉️ پیام به کاربر", `ad:m:${key}`));
  if (row2.length) kb.push(row2);
  const row3: Btn[] = [cb("🗂 فایل‌ها", `ad:ud:${key}`)];
  if (job.busy) row3.push(cb("🔓 آزاد کردن قفل", `ad:ul:${key}`));
  kb.push(row3);
  kb.push([cb("🔄 تازه‌سازی", `ad:u:${key}`), ...backHome]);
  return { text, kb };
}

// ---------- گزارش دعوت دوستان ----------
// هر دعوت موفق یک ردیف ref:<دعوت‌شده> = <دعوت‌کننده> است و شمارنده‌ی هر دعوت‌کننده در refc:<دعوت‌کننده> (settings.ts ← rewardReferral).
// زمانِ خودِ دعوت ذخیره نشده؛ به‌جایش «اولین پیام» دعوت‌شده (seen:) می‌آید که همان لحظه‌ی ورود با لینک است.
const REF_FROM = "FROM kv r LEFT JOIN kv s ON s.k = 'seen:' || substr(r.k, 5) WHERE r.k >= ?1 AND r.k < ?2 AND (r.exp IS NULL OR r.exp > ?3)";

async function referralScreen(env: Env, tab: "t" | "r", page: number): Promise<Screen> {
  const now = nowSec();
  const iso = (ms: number) => new Date(Date.now() - ms).toISOString();
  const [total, inviters, capped, last24, last7] = await Promise.all([
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3)", "ref:", "ref:" + MAXC, now),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND CAST(v AS INTEGER) > 0", "refc:", "refc:" + MAXC, now),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND CAST(v AS INTEGER) >= ?4", "refc:", "refc:" + MAXC, now, REF_MAX),
    count(env, `SELECT COUNT(*) c ${REF_FROM} AND json_extract(s.v,'$.t') >= ?4`, "ref:", "ref:" + MAXC, now, iso(86_400_000)),
    count(env, `SELECT COUNT(*) c ${REF_FROM} AND json_extract(s.v,'$.t') >= ?4`, "ref:", "ref:" + MAXC, now, iso(7 * 86_400_000)),
  ]);
  const avg = inviters ? Math.round((total / inviters) * 10) / 10 : 0;
  const summary =
    "🎁 <b>گزارش دعوت دوستان</b>\n\n" +
    `✅ دعوت موفق: <b>${fa(total)}</b> (هر دعوت = ۱ ارائه‌ی رایگان برای دعوت‌کننده)\n` +
    `🙋 دعوت‌کننده: <b>${fa(inviters)}</b> نفر · میانگین ${fa(avg)} دعوت برای هر نفر\n` +
    `🚧 رسیده به سقف (${fa(REF_MAX)} دعوت): ${fa(capped)} نفر\n` +
    `🕒 ۲۴ ساعت اخیر: ${fa(last24)} · ۷ روز اخیر: ${fa(last7)}\n\n`;
  const tabs: Btn[] = [cb(tab === "t" ? "• برترین‌ها" : "برترین‌ها", "ad:iv:t:0"), cb(tab === "r" ? "• آخرین دعوت‌ها" : "آخرین دعوت‌ها", "ad:iv:r:0")];
  const d = await db(env);

  if (tab === "t") {
    const rs = (await d.prepare("SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND CAST(v AS INTEGER) > 0 ORDER BY CAST(v AS INTEGER) DESC, k LIMIT ?4 OFFSET ?5")
      .bind("refc:", "refc:" + MAXC, now, PAGE, page * PAGE).all<{ k: string; v: string }>()).results ?? [];
    const items = await Promise.all(rs.map(async (r) => {
      const id = Number(r.k.slice(5)); const n = Number(r.v) || 0;
      if (!Number.isSafeInteger(id)) return null;
      const seen = await getUserSeen(env, id).catch(() => null);
      return { id, label: seen?.n || (seen?.u ? "@" + seen.u : String(id)), line: `${userLink(id, seen?.n, seen?.u)} — <b>${fa(n)}</b> دعوت${n >= REF_MAX ? " 🚧" : ""}\n    🆔 <code>${id}</code>` };
    }));
    const list = items.filter((x): x is NonNullable<typeof x> => x !== null);
    return {
      text: summary + "🏆 <b>برترین دعوت‌کننده‌ها</b>\n\n" + (list.length ? list.map((x, i) => `${fa(page * PAGE + i + 1)}. ${x.line}`).join("\n") : "هنوز دعوتی ثبت نشده است.") + "\n\n<i>برای مدیریت، روی نام بزن.</i>",
      kb: [tabs, ...list.map((x, i) => [cb(`${fa(page * PAGE + i + 1)}. ${x.label.slice(0, 40)}`, `ad:u:${x.id}`)]), pager("ad:iv:t", page, (page + 1) * PAGE < inviters), [cb("🔄 تازه‌سازی", `ad:iv:${tab}:${page}`), ...backHome]].filter((r) => r.length),
    };
  }

  const rs = (await d.prepare(
    `SELECT r.k k, r.v v, json_extract(s.v,'$.t') t, json_extract(s.v,'$.n') n, json_extract(s.v,'$.u') u ${REF_FROM} ORDER BY json_extract(s.v,'$.t') DESC, r.k LIMIT ?4 OFFSET ?5`)
    .bind("ref:", "ref:" + MAXC, now, PAGE, page * PAGE).all<{ k: string; v: string; t: string | null; n: string | null; u: string | null }>()).results ?? [];
  const items = await Promise.all(rs.map(async (r) => {
    const guest = Number(r.k.slice(4)), host = Number(r.v);
    if (!Number.isSafeInteger(guest) || !Number.isSafeInteger(host)) return null;
    const hs = await getUserSeen(env, host).catch(() => null);
    return {
      guest, host, gl: r.n || (r.u ? "@" + r.u : String(guest)), hl: hs?.n || (hs?.u ? "@" + hs.u : String(host)),
      line: `${userLink(guest, r.n, r.u)} ⬅️ دعوت از ${userLink(host, hs?.n, hs?.u)}\n    🕒 ${r.t ? fmtTime(r.t) : "—"} · 🆔 <code>${guest}</code>`,
    };
  }));
  const list = items.filter((x): x is NonNullable<typeof x> => x !== null);
  return {
    text: summary + "🕒 <b>آخرین دعوت‌شده‌ها</b> (به وقت ایران)\n\n" + (list.length ? list.map((x, i) => `${fa(page * PAGE + i + 1)}. ${x.line}`).join("\n") : "هنوز دعوتی ثبت نشده است.") + "\n\n<i>دکمه‌ها: 👤 دعوت‌شده · 🎁 دعوت‌کننده</i>",
    kb: [tabs, ...list.map((x) => [cb(`👤 ${x.gl.slice(0, 18)}`, `ad:u:${x.guest}`), cb(`🎁 ${x.hl.slice(0, 18)}`, `ad:u:${x.host}`)]), pager("ad:iv:r", page, (page + 1) * PAGE < total), [cb("🔄 تازه‌سازی", `ad:iv:${tab}:${page}`), ...backHome]].filter((r) => r.length),
  };
}

// ---------- گزارش پرداخت و درآمد ----------
// رکوردهای pay:<سفارش> (payment.ts): pending ← paid | failed. پرداخت‌های تاییدشده ۸۴ روز، بقیه ۱۴ روز می‌مانند؛ برای تاریخچه‌ی بلندتر
// فروش هر روز (به وقت ایران) در rv:<روز> = {n, a} هم جمع می‌شود. issue = کاربر از درگاه «موفق» برگشته ولی تایید نشده (پول ممکن است کسر شده باشد).
interface PayRow { order: string; uid: string; plan: string | null; amount: number; state: string; t: number; ref: string | null; issue: string | null }
const money = (n: number) => fa(Math.round(n).toLocaleString("en-US").replace(/,/g, "٬"));
const pct = (a: number, b: number) => (b > 0 ? `${fa(Math.round((a / b) * 100))}٪` : "—");
const tehranDay = (t: number) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Asia/Tehran" });
const planLabel = (id: string | null) => (id ? (PLANS.find((p) => p.id === id)?.name ?? id) : "بسته‌ی اعتباری");
/** مبلغ به تومان: از قیمت پلن (هزار تومان)؛ رکورد قدیمیِ بدون پلن از مبلغ ریالی */
const tomanOf = (r: PayRow) => { const p = PLANS.find((x) => x.id === r.plan); return p ? p.price * 1000 : Math.round(r.amount / 10); };
/** ماه شمسی یک روز (YYYY-MM-DD): کلید مرتب‌شدنی + برچسب فارسی */
function pmonth(day: string): { key: string; label: string } {
  const d = new Date(day + "T12:00:00Z");
  const parts = new Intl.DateTimeFormat("fa-IR-u-nu-latn", { year: "numeric", month: "2-digit", timeZone: "UTC" }).formatToParts(d);
  const year = parts.find((x) => x.type === "year")?.value ?? "";
  const key = `${year}-${parts.find((x) => x.type === "month")?.value}`;
  return { key, label: `${d.toLocaleDateString("fa-IR", { month: "long", timeZone: "UTC" })} ${fa(year)}` }; // مثلاً «آبان ۱۴۰۵»
}
const ISSUE_TXT = (i: string | null) =>
  !i ? "" : i === "amount" ? "مبلغ برگشتی از درگاه با سفارش نمی‌خواند" : i === "vamount" ? "مبلغ تاییدشده با سفارش نمی‌خواند" : i === "net" ? "خطای شبکه هنگام تایید"
  : i.startsWith("verify:") ? `تایید پرداخت رد شد (کد ${esc(i.slice(7))})` : esc(i);

async function issueCount(env: Env): Promise<number> {
  return count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND json_extract(v,'$.state')='pending' AND json_extract(v,'$.issue') IS NOT NULL", "pay:", "pay:" + MAXC, nowSec());
}

async function loadPayments(env: Env): Promise<PayRow[]> {
  const d = await db(env);
  const rs = (await d.prepare(
    "SELECT k, json_extract(v,'$.uid') uid, json_extract(v,'$.plan') plan, json_extract(v,'$.amount') amount, json_extract(v,'$.state') state, json_extract(v,'$.t') t, json_extract(v,'$.ref') ref, json_extract(v,'$.issue') issue " +
    "FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) ORDER BY json_extract(v,'$.t') DESC LIMIT 3000")
    .bind("pay:", "pay:" + MAXC, nowSec()).all<{ k: string; uid: string; plan: string | null; amount: number; state: string; t: number; ref: string | null; issue: string | null }>()).results ?? [];
  return rs.map((r) => ({ order: r.k.slice(4), uid: String(r.uid ?? ""), plan: r.plan ?? null, amount: Number(r.amount) || 0, state: String(r.state), t: Number(r.t) || 0, ref: r.ref ?? null, issue: r.issue ?? null }));
}

/** فروش هر روز (وقت ایران): از رکوردهای pay: و، برای روزهای قدیمی‌تر از ماندگاری آن‌ها، از شمارنده‌ی دائمی rv: */
async function revenueByDay(env: Env, pays: PayRow[]): Promise<Map<string, { n: number; a: number }>> {
  const m = new Map<string, { n: number; a: number }>();
  for (const r of pays) {
    if (r.state !== "paid") continue;
    const day = tehranDay(r.t); const x = m.get(day) ?? { n: 0, a: 0 };
    x.n++; x.a += tomanOf(r); m.set(day, x);
  }
  for (const r of await rows(env, "SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2", "rv:", "rv:" + MAXC)) {
    const day = r.k.slice(3); const v = json<{ n?: number; a?: number }>(r.v);
    if (!v || (m.get(day)?.a ?? 0) >= (Number(v.a) || 0)) continue;
    m.set(day, { n: Number(v.n) || 0, a: Number(v.a) || 0 });
  }
  return m;
}

type AttnKind = "issue" | "nosub" | "failed" | "stale";
const ATTN_ICON: Record<AttnKind, string> = { issue: "🚨", nosub: "⚠️", failed: "❌", stale: "⏳" };
const ATTN_TXT: Record<AttnKind, string> = {
  issue: "از درگاه موفق برگشته ولی تایید نشد", nosub: "پرداخت تاییدشده، اما اشتراکی ثبت نیست (یا دستی لغو شده)",
  failed: "ناموفق/لغو شده", stale: "به درگاه رفته و برنگشته (احتمالاً منصرف شده)",
};
/** پرداخت‌هایی که نیاز به نگاه مدیر دارند، مهم‌ترین اول */
async function paymentAttention(env: Env, pays: PayRow[]): Promise<{ kind: AttnKind; r: PayRow }[]> {
  const now = Date.now(), d14 = now - 14 * 86_400_000, d25 = now - 25 * 86_400_000;
  const out: { kind: AttnKind; r: PayRow }[] = [];
  for (const r of pays) {
    if (r.state === "pending" && r.issue) out.push({ kind: "issue", r });
    else if (r.state === "failed" && r.t > d14) out.push({ kind: "failed", r });
    else if (r.state === "pending" && r.t < now - 30 * 60_000 && r.t > d14) out.push({ kind: "stale", r });
  }
  // پرداخت تاییدشده‌ی اخیر که ردیف اشتراکش نیست
  const recent = pays.filter((r) => r.state === "paid" && r.plan && r.t > d25).slice(0, 30);
  const subs = await Promise.all(recent.map((r) => env.KV.get(`sub:${r.uid}`).catch(() => "?")));
  recent.forEach((r, i) => { if (subs[i] === null) out.push({ kind: "nosub", r }); });
  const w: Record<AttnKind, number> = { issue: 0, nosub: 1, failed: 2, stale: 3 };
  return out.sort((a, b) => w[a.kind] - w[b.kind] || b.r.t - a.r.t);
}

async function paymentScreen(env: Env, tab: "s" | "l" | "p", page: number): Promise<Screen> {
  const pays = await loadPayments(env);
  const [rev, attn] = await Promise.all([revenueByDay(env, pays), paymentAttention(env, pays)]);
  const urgent = attn.filter((x) => x.kind === "issue" || x.kind === "nosub").length;
  const tabs: Btn[] = [
    cb(tab === "s" ? "• خلاصه" : "خلاصه", "ad:pm:s:0"),
    cb(tab === "l" ? "• پرداخت‌ها" : "پرداخت‌ها", "ad:pm:l:0"),
    cb(`${tab === "p" ? "• " : ""}⚠️ مشکل‌دار${attn.length ? ` (${fa(attn.length)})` : ""}`, "ad:pm:p:0"),
  ];
  const refresh = [cb("🔄 تازه‌سازی", `ad:pm:${tab}:${page}`), ...backHome];
  const nameOf = async (uid: string): Promise<{ label: string; user: WebUser | null }> => {
    const u = WEB_ID.test(uid) ? await getUserById(env, uid).catch(() => null) : null;
    return { label: u?.name || u?.email || u?.mobile || uid, user: u };
  };
  const line = async (r: PayRow, kind?: AttnKind) => {
    const who = await nameOf(r.uid);
    return {
      uid: r.uid, label: who.label,
      text: `${kind ? ATTN_ICON[kind] + " " : "✅ "}<b>${esc(planLabel(r.plan))}</b> · ${money(tomanOf(r))} تومان · ${fmtTime(r.t)}\n` +
        `    👤 ${esc(who.label)}${kind ? `\n    ↳ ${ATTN_TXT[kind]}${kind === "issue" ? ` — ${ISSUE_TXT(r.issue)}` : ""}` : ""}\n` +
        `    🧾 سفارش <code>${esc(r.order)}</code>${r.ref ? ` · رهگیری <code>${esc(r.ref)}</code>` : ""}`,
    };
  };

  if (tab === "s") {
    const now = Date.now();
    const sumDays = (k: number) => {
      let n = 0, a = 0;
      for (let i = 0; i < k; i++) { const x = rev.get(tehranDay(now - i * 86_400_000)); if (x) { n += x.n; a += x.a; } }
      return { n, a };
    };
    const [t1, t7, t30] = [sumDays(1), sumDays(7), sumDays(30)];
    const d30 = now - 30 * 86_400_000, d14 = now - 14 * 86_400_000;
    const paid30 = pays.filter((r) => r.state === "paid" && r.t > d30);
    const byPlan = PLANS.map((p) => `${p.name} ${fa(paid30.filter((r) => r.plan === p.id).length)}`).join(" · ");
    const last14 = pays.filter((r) => r.t > d14);
    const ok14 = last14.filter((r) => r.state === "paid").length;
    const dead14 = last14.filter((r) => r.state === "failed" || (r.state === "pending" && r.t < now - 30 * 60_000)).length;
    const months = new Map<string, { label: string; n: number; a: number }>();
    for (const [day, v] of [...rev.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
      const m = pmonth(day); const x = months.get(m.key) ?? { label: m.label, n: 0, a: 0 };
      x.n += v.n; x.a += v.a; months.set(m.key, x);
    }
    const monthLines = [...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 6).map(([, m]) => `${m.label}: ${fa(m.n)} فروش · ${money(m.a)} تومان`);
    return {
      text:
        "💰 <b>گزارش پرداخت و درآمد</b>\n\n" +
        `🔌 درگاه دیجی‌پی: ${payEnabled(env) ? "✅ فعال" : "❌ غیرفعال (متغیرها تنظیم نشده)"}\n` +
        (urgent ? `🚨 <b>${fa(urgent)} مورد نیازمند بررسی فوری</b> ← تب ⚠️ مشکل‌دار\n` : "✅ مورد فوری ندارد\n") +
        `\n<b>فروش</b> (به وقت ایران)\n` +
        `امروز: ${fa(t1.n)} فروش · ${money(t1.a)} تومان\n` +
        `۷ روز اخیر: ${fa(t7.n)} · ${money(t7.a)} تومان\n` +
        `۳۰ روز اخیر: ${fa(t30.n)} · ${money(t30.a)} تومان\n` +
        `پلن‌های ۳۰ روز اخیر: ${byPlan}\n\n` +
        `📈 تکمیل پرداخت (۱۴ روز اخیر): ${pct(ok14, ok14 + dead14)} — ${fa(ok14)} موفق از ${fa(ok14 + dead14)} ورود به درگاه\n` +
        (monthLines.length ? `\n<b>ماهانه</b>\n${monthLines.join("\n")}\n` : "") +
        "\n<i>جزئیات هر پرداخت ۸۴ روز نگه داشته می‌شود؛ جمع روزانه‌ی فروش از به‌روزرسانی این قابلیت به بعد دائمی است.</i>",
      kb: [tabs, refresh],
    };
  }

  if (tab === "l") {
    const paid = pays.filter((r) => r.state === "paid");
    const slice = paid.slice(page * PAGE, page * PAGE + PAGE);
    const ls = await Promise.all(slice.map((r) => line(r)));
    return {
      text: `✅ <b>پرداخت‌های موفق</b> (جدیدترین اول، ۸۴ روز اخیر)\nکل: ${fa(paid.length)}\n\n` + (ls.length ? ls.map((x, i) => `${fa(page * PAGE + i + 1)}. ${x.text}`).join("\n\n") : "هنوز پرداختی ثبت نشده است."),
      kb: [tabs, ...ls.map((x, i) => [cb(`${fa(page * PAGE + i + 1)}. ${x.label.slice(0, 40)}`, `ad:u:${x.uid}`)]), pager("ad:pm:l", page, (page + 1) * PAGE < paid.length), refresh].filter((r) => r.length),
    };
  }

  const slice = attn.slice(page * PAGE, page * PAGE + PAGE);
  const ls = await Promise.all(slice.map((x) => line(x.r, x.kind)));
  return {
    text:
      `⚠️ <b>پرداخت‌های مشکل‌دار</b> (۱۴ روز اخیر)\nکل: ${fa(attn.length)}\n\n` +
      (ls.length ? ls.map((x, i) => `${fa(page * PAGE + i + 1)}. ${x.text}`).join("\n\n") : "✅ مورد مشکوکی نیست.") +
      "\n\n<i>🚨 و ⚠️ را با پنل دیجی‌پی (شماره‌ی رهگیری) مقایسه کن؛ اگر پول کسر شده، از کارت کاربر پلن را دستی فعال کن. ❌ و ⏳ معمولاً انصراف کاربر است.</i>",
    kb: [tabs, ...ls.map((x, i) => [cb(`${fa(page * PAGE + i + 1)}. ${x.label.slice(0, 40)}`, `ad:u:${x.uid}`)]), pager("ad:pm:p", page, (page + 1) * PAGE < attn.length), refresh].filter((r) => r.length),
  };
}

// ---------- قیف کاربران ----------
// گروه = حساب‌های ساخته‌شده در بازه (هر کاربر ربات هم یک حساب وب wu: دارد). act:<حساب> را noteDeckDone (settings.ts) با هر ارائه‌ی موفق می‌نویسد.
async function funnelScreen(env: Env, days: number): Promise<Screen> {
  const d = await db(env);
  const now = Date.now(), DAY = 86_400_000;
  const label = days ? `${fa(days)} روز اخیر` : "از ابتدای ثبت";
  const tabs: Btn[] = [7, 30, 90, 0].map((n) => cb(`${n === days ? "• " : ""}${n ? fa(n) + " روز" : "همه"}`, `ad:fn:${n}`));
  const kb = (): Btn[][] => [tabs, [cb("🔄 تازه‌سازی", `ad:fn:${days}`), cb("📅 ماهانه", "ad:mo"), ...backHome]];
  const since = Number((await d.prepare("SELECT MIN(json_extract(v,'$.f')) m FROM kv WHERE k >= ?1 AND k < ?2").bind("act:", "act:" + MAXC).first<{ m: number | null }>())?.m) || 0;
  if (!since) return { text: "🔻 <b>قیف کاربران</b>\n\nهنوز داده‌ای ثبت نشده؛ ثبت از اولین ارائه‌ی موفق بعد از به‌روزرسانی شروع می‌شود و ارائه‌های قبلی در آن نیست.", kb: [backHome] };
  const from = Math.max(since, days ? now - days * DAY : 0);
  const r = await d.prepare(
    "SELECT COUNT(*) total, SUM(a.k IS NOT NULL) made, SUM(json_extract(a.v,'$.n') >= 2) twice, " +
    "SUM(json_extract(a.v,'$.f') - json_extract(u.v,'$.created') <= ?3) day1, " +
    "SUM(json_extract(a.v,'$.f') <= ?4) m1, SUM(json_extract(a.v,'$.f') <= ?4 AND json_extract(a.v,'$.l') - json_extract(a.v,'$.f') >= ?3) r1, " +
    "SUM(json_extract(a.v,'$.f') <= ?5) m7, SUM(json_extract(a.v,'$.f') <= ?5 AND json_extract(a.v,'$.l') - json_extract(a.v,'$.f') >= ?6) r7 " +
    "FROM kv u LEFT JOIN kv a ON a.k = 'act:' || substr(u.k, 4) WHERE u.k >= ?1 AND u.k < ?2 AND json_extract(u.v,'$.created') >= ?7")
    .bind("wu:", "wu:" + MAXC, DAY, now - DAY, now - 7 * DAY, 7 * DAY, from)
    .first<Record<string, number | null>>();
  const g = (k: string) => Number(r?.[k] ?? 0);
  const total = g("total"), made = g("made");
  // خریداران همین گروه (پرداخت‌های ۸۴ روز اخیر)
  const payers = [...new Set((await loadPayments(env)).filter((p) => p.state === "paid" && WEB_ID.test(p.uid)).map((p) => p.uid))].slice(0, 300);
  const created = await Promise.all(payers.map((u) => getUserById(env, u).then((x) => x?.created ?? 0).catch(() => 0)));
  const bought = created.filter((c) => c >= from).length;
  return {
    text:
      `🔻 <b>قیف کاربران — ${label}</b>\n` +
      `<i>گروه: حساب‌های ساخته‌شده از ${fmtDay(from)} (ثبت فعالیت از ${fmtDay(since)} شروع شده)</i>\n\n` +
      `👤 حساب جدید: <b>${fa(total)}</b>\n` +
      `🎬 اولین ارائه را ساخته‌اند: <b>${fa(made)}</b> (${pct(made, total)})\n` +
      `      ⚡ در ۲۴ ساعت اول: ${fa(g("day1"))} (${pct(g("day1"), total)})\n` +
      `      🚪 هیچ ارائه‌ای نساخته‌اند: ${fa(Math.max(0, total - made))} (${pct(total - made, total)})\n` +
      `🔁 دو ارائه یا بیشتر: <b>${fa(g("twice"))}</b> (${pct(g("twice"), total)})\n` +
      `📆 برگشت حداقل ۱ روز بعد: <b>${fa(g("r1"))}</b> از ${fa(g("m1"))} (${pct(g("r1"), g("m1"))})\n` +
      `📆 برگشت حداقل ۷ روز بعد: <b>${fa(g("r7"))}</b> از ${fa(g("m7"))} (${pct(g("r7"), g("m7"))})\n` +
      `💳 خرید پلن: <b>${fa(bought)}</b> (${pct(bought, total)})\n\n` +
      "<i>«برگشت» یعنی آخرین ارائه‌اش دست‌کم ۱ یا ۷ روز بعد از اولین ارائه بوده؛ درصدش فقط از کسانی است که اولین ارائه‌شان آن‌قدر قدیمی شده. خریدها فقط از ۸۴ روز اخیر شمرده می‌شود.</i>",
    kb: kb(),
  };
}

// ---------- نمای ماهانه (ماه شمسی) ----------
async function monthlyScreen(env: Env): Promise<Screen> {
  const [st, pays] = await Promise.all([statsByDay(env), loadPayments(env)]);
  const rev = await revenueByDay(env, pays);
  const ms = new Map<string, { label: string; started: number; ok: number; fail: number; nu: number; sales: number; money: number }>();
  const get = (day: string) => {
    const m = pmonth(day); let x = ms.get(m.key);
    if (!x) ms.set(m.key, (x = { label: m.label, started: 0, ok: 0, fail: 0, nu: 0, sales: 0, money: 0 }));
    return x;
  };
  for (const [day, v] of Object.entries(st)) { const x = get(day); x.started += v.started ?? 0; x.ok += v.ok ?? 0; x.fail += v.fail ?? 0; x.nu += v.newusers ?? 0; }
  for (const [day, v] of rev) { const x = get(day); x.sales += v.n; x.money += v.a; }
  const list = [...ms.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12);
  const body = list.map(([, m], i) => {
    const rate = m.ok + m.fail > 0 ? pct(m.ok, m.ok + m.fail) : "—";
    return `<b>${m.label}</b>${i === 0 ? " (جاری)" : ""}\n    🆕 ${fa(m.nu)} · ▶️ ${fa(m.started)} · ✅ ${fa(m.ok)} · ❌ ${fa(m.fail)} · 📈 ${rate}\n    💳 ${fa(m.sales)} فروش · ${money(m.money)} تومان`;
  });
  return {
    text: "📅 <b>آمار ماهانه</b> (ماه شمسی)\n\n" + (body.length ? body.join("\n\n") : "هنوز آماری نیست.") +
      "\n\n<i>آمار ارائه تا پیش از این به‌روزرسانی فقط ۶۰ روز نگه داشته می‌شد؛ ماه‌های قدیمی‌تر ناقص‌اند. از این به بعد ۴۰۰ روز نگه داشته می‌شود.</i>",
    kb: [[cb("📊 آمار", "ad:st:7"), cb("💰 پرداخت‌ها", "ad:pm:s:0"), cb("🔻 قیف", "ad:fn:30")], [cb("🔄 تازه‌سازی", "ad:mo"), ...backHome]],
  };
}

async function decksScreen(env: Env): Promise<Screen> {
  const list = await getDeckLog(env);
  if (!list.length) return { text: "🗂 هنوز ارائه‌ای ثبت نشده است؛ از این به بعد هر ارائه‌ی ساخته‌شده در این فهرست ثبت می‌شود.", kb: [backHome] };
  // نوع کاربر از روی خودِ حساب تشخیص داده می‌شود (نه از ثبت منبع هر ارائه):
  // وبی = از سایت ثبت‌نام کرده (ایمیل/موبایل/گوگل دارد)؛ تلگرامی = شناسه‌ی عددی یا پروفایل خودکار ربات. 🔗 = وبی که تلگرام هم وصل کرده
  const kindOf = async (uid: Uid): Promise<string> => {
    if (typeof uid === "number") return "✈️ تلگرامی";
    const w = await getUserById(env, uid).catch(() => null);
    if (!w || !(w.email || w.mobile || w.google)) return "✈️ تلگرامی";
    const linked = Number(await env.KV.get(`w2tg:${uid}`).catch(() => null)) > 0;
    return (linked ? "🌐 وبی 🔗" : "🌐 وبی") + (w.app ? " 📱" : "");
  };
  const kinds = new Map<string, string>();
  for (const x of list) if (!kinds.has(String(x.userId))) kinds.set(String(x.userId), await kindOf(x.userId));
  const lines = list.map((x, i) =>
    `${fa(i + 1)}. <b>${esc(x.title.slice(0, 60))}</b> (${fa(x.slides)} اسلاید)\n` +
    `    👤 ${typeof x.userId === "number" ? userLink(x.userId, x.n, x.u) : `<b>${esc(x.n || String(x.userId))}</b>`}` +
    ` · ${kinds.get(String(x.userId))} · <code>${x.userId}</code> · 🕒 ${fmtTime(x.t)}` +
    (x.o ? `\n    ✍️ <i>${esc(x.o.slice(0, 200))}</i>` : ""));
  // فایل‌ها فقط ۲۴ ساعت (و حداکثر ۹ فایل آخر هر کاربر؛ پلاس ۱۸ و پرو ۳۰) نگه داشته می‌شوند؛ برای قدیمی‌تر دکمه‌ی دریافت نمی‌گذاریم
  const fresh = Date.now() - 24 * 3600 * 1000;
  const kb: Btn[][] = list
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => x.t > fresh)
    .map(({ x, i }) => [cb(`📥 ${fa(i + 1)}. ${x.title.slice(0, 40)}`, `af:${x.userId}:${x.id}`)]);
  kb.push([cb("🔄 تازه‌سازی", "ad:dk"), ...backHome]);
  return { text: `🗂 <b>${fa(list.length)} ارائه‌ی اخیر</b> (به وقت ایران)\n\n${lines.join("\n")}\n\n<i>دکمه‌ی 📥 فقط برای فایل‌های ۲۴ ساعت اخیر است.</i>`, kb };
}

async function userFilesScreen(env: Env, id: Uid): Promise<Screen> {
  const { acct } = await identify(env, id);
  const files = await listFiles(env, acct).catch(() => []);
  const key = String((await identify(env, id).then(cardId)));
  return {
    text: files.length
      ? `🗂 <b>فایل‌های ۲۴ ساعت اخیرِ</b> <code>${acct}</code>\n\n` + files.map((f, i) => `${fa(i + 1)}. ${esc(f.title.slice(0, 60))} (${fa(f.slides)} اسلاید) · ${fmtTime(f.t)}`).join("\n")
      : `🗂 این کاربر فایلی برای ۲۴ ساعت اخیر ندارد.`,
    kb: [
      ...files.map((f, i) => [cb(`📥 ${fa(i + 1)}. ${f.title.slice(0, 32)}`, `af:${acct}:${f.id}`)]),
      [cb("🔙 کارت کاربر", `ad:u:${key}`), ...backHome],
    ],
  };
}

async function subsScreen(env: Env, page: number): Promise<Screen> {
  const total = await activeSubCount(env);
  const rs = await rows(env,
    "SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND json_extract(v,'$.exp') > ?4 AND json_extract(v,'$.credits') > 0 ORDER BY json_extract(v,'$.exp') ASC LIMIT ?5 OFFSET ?6",
    "sub:", "sub:" + MAXC, nowSec(), Date.now(), PAGE, page * PAGE);
  const items: { id: Uid; line: string; label: string }[] = [];
  for (const r of rs) {
    const uid = r.k.slice(4); const s = json<{ plan: string; exp: number; credits: number }>(r.v);
    const id = idOf(uid); if (id === null || !s) continue;
    const w = typeof id === "string" ? await getUserById(env, id).catch(() => null) : null;
    const tgLinked = typeof id === "string" ? Number(await env.KV.get(`w2tg:${id}`).catch(() => null)) : id;
    const open: Uid = Number.isSafeInteger(tgLinked) && tgLinked > 0 ? tgLinked : id;
    const nm = w?.name || String(id);
    const pn = PLANS.find((p) => p.id === s.plan)?.name ?? s.plan;
    items.push({ id: open, label: `${nm.slice(0, 24)} · ${pn}`, line: `<b>${esc(nm)}</b> — ${esc(pn)} · ${fa(s.credits)} اعتبار · تا ${fmtDay(s.exp)}` });
  }
  return {
    text: `👑 <b>پلن‌های فعال</b> (نزدیک‌ترین انقضا اول)\nکل: ${fa(total)}\n\n` + (items.length ? items.map((x, i) => `${fa(page * PAGE + i + 1)}. ${x.line}`).join("\n") : "پلن فعالی نیست."),
    kb: [...items.map((x, i) => [cb(`${fa(page * PAGE + i + 1)}. ${x.label}`, `ad:u:${x.id}`)]), pager("ad:sb", page, (page + 1) * PAGE < total), backHome].filter((r) => r.length),
  };
}

async function bannedScreen(env: Env): Promise<Screen> {
  const rs = await rows(env, "SELECT k FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) ORDER BY k LIMIT 20", "ban:", "ban:" + MAXC, nowSec());
  const items: { id: Uid; label: string }[] = [];
  const seenIds = new Set<string>();
  for (const r of rs) {
    const id = idOf(r.k.slice(4)); if (id === null) continue;
    const w = await identify(env, id);
    const open = cardId(w);
    if (seenIds.has(String(open))) continue; // تلگرام و پروفایل وبِ یک نفر یک بار نشان داده می‌شود
    seenIds.add(String(open));
    const seen = w.tgId ? await getUserSeen(env, w.tgId) : null;
    const web = w.webId ? await getUserById(env, w.webId).catch(() => null) : null;
    items.push({ id: open, label: (seen?.n || web?.name || (seen?.u ? "@" + seen.u : "") || String(open)).slice(0, 40) });
  }
  return {
    text: items.length ? `⛔️ <b>کاربران مسدود</b> (${fa(items.length)})\nبرای رفع انسداد یا مشاهده، روی نام بزن.` : "⛔️ کاربر مسدودی وجود ندارد.",
    kb: [...items.map((x) => [cb(`⛔️ ${x.label}`, `ad:u:${x.id}`)]), backHome],
  };
}

async function systemScreen(env: Env): Promise<Screen> {
  const ok = (b: unknown) => (b ? "✅" : "▫️");
  const models = modelList(env);
  const [info, rowsN, filesN] = await Promise.all([
    tg<any>(env, "getWebhookInfo").catch(() => null),
    count(env, "SELECT COUNT(*) c FROM kv"),
    Promise.resolve(0),
  ]);
  void filesN;
  const hookErr = info?.last_error_message
    ? `\n⚠️ آخرین خطای وب‌هوک: <code>${esc(String(info.last_error_message).slice(0, 120))}</code>${info.last_error_date ? ` (${fmtTime(info.last_error_date * 1000)})` : ""}`
    : "";
  const admins = (env.ADMIN_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean).length;
  const restricted = (env.ALLOWED_USER_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean).length;
  return {
    text:
      "⚙️ <b>وضعیت سیستم</b>\n\n" +
      `🤖 مدل‌ها (${fa(models.length)}): ${models.slice(0, 6).map((m) => esc(m.name) + (m.extra ? "⭐" : "")).join("، ")}${models.length > 6 ? "…" : ""}\n` +
      `${ok(hasKey(env))} کلید مدل زبانی · ${ok(env.EXTRA_LLM_API_KEY && env.EXTRA_LLM_BASE_URL)} ارائه‌دهنده‌ی دوم\n` +
      `${ok(env.AI)} تولید تصویر (Workers AI) · ${ok(env.PEXELS_API_KEY)} Pexels\n` +
      `${ok((env.WEB_SEARCH ?? "").toLowerCase() !== "off")} جستجوی وب · ${ok(env.TAVILY_API_KEY)} Tavily\n` +
      `${ok(env.OCR_SPACE_API_KEY)} OCR.space · ${ok(env.OCR_WORKFLOW)} OCR تلگرام · ${ok(env.WEB_OCR_WORKFLOW)} OCR وب\n` +
      `${ok(hasBrowser(env))} ساخت PDF · ${ok(payEnabled(env))} درگاه پرداخت · ${ok(otpEnabled(env))} پیامک · ${ok(googleEnabled(env))} ورود گوگل\n\n` +
      `👮 مدیرها: ${fa(admins)} · 🔒 فهرست مجاز: ${restricted ? fa(restricted) + " نفر" : "همه آزادند"}\n` +
      `🗄 ردیف‌های پایگاه‌داده: ${fa(rowsN)}\n` +
      `🔗 وب‌هوک: ${info?.url ? "✅ فعال" : "❌ تنظیم نشده"} · در صف: ${fa(info?.pending_update_count ?? 0)}${hookErr}`,
    kb: [
      [cb("📜 گزارش اقدامات مدیر", "ad:lg"), cb("🧹 پاکسازی منقضی‌ها", "ad:pg")],
      [cb("🔄 تازه‌سازی", "ad:sy"), ...backHome],
    ],
  };
}

async function logScreen(env: Env): Promise<Screen> {
  const log = json<{ t: number; a: number; x: string }[]>(await env.KV.get(LOG_KEY)) ?? [];
  return {
    text: log.length ? `📜 <b>آخرین اقدامات مدیر</b>\n\n` + log.slice(0, 20).map((l) => `🕒 ${fmtTime(l.t)} · <code>${l.a}</code>\n    ${esc(l.x)}`).join("\n") : "📜 هنوز اقدامی ثبت نشده است.",
    kb: [[cb("🔙 سیستم", "ad:sy"), ...backHome]],
  };
}

// ---------- اقدام‌ها (مشترک بین دستور متنی و دکمه) ----------
async function applyGrant(env: Env, adminId: number, id: Uid, n: number): Promise<{ before: number; after: number; note: string; who: Ident }> {
  const who = await identify(env, id);
  const before = await getBonus(env, who.acct);
  const after = Math.max(0, before + n);
  await setBonus(env, who.acct, after);
  let note = who.tgId && isAdmin(env, who.tgId) ? "\nℹ️ این کاربر مدیر است و اعتبارش نامحدود؛ اعتبار اضافه برایش مصرف نمی‌شود." : "";
  if (n > 0 && who.tgId) { // کاربر فقط‌وب پیام تلگرام نمی‌گیرد؛ اعتبارش را در صفحه می‌بیند
    try { await sendMessage(env, who.tgId, `🎁 ${fa(n)} ارائه به اعتبار شما اضافه شد. برای دیدن اعتبار: /credit`); }
    catch { note += "\n⚠️ پیام اطلاع‌رسانی به کاربر نرسید (احتمالاً هنوز ربات را شروع نکرده)."; }
  }
  await logAction(env, adminId, `اعتبار ${id}: ${fa(before)} ← ${fa(after)} (${n > 0 ? "+" : ""}${n})`);
  return { before, after, note, who };
}

async function applyBan(env: Env, adminId: number, id: Uid, on: boolean): Promise<boolean> {
  const who = await identify(env, id);
  if (who.tgId && isAdmin(env, who.tgId)) return false;
  // هم شناسه‌ی تلگرام و هم پروفایل وب (ربات هر دو را بررسی می‌کند؛ وب فقط پروفایل را)
  for (const x of [who.tgId, who.webId]) if (x !== null) await setBanned(env, x, on);
  await logAction(env, adminId, `${on ? "مسدود" : "رفع انسداد"} ${cardId(who)}`);
  return true;
}

async function applyPlan(env: Env, adminId: number, id: Uid, planId: string): Promise<string> {
  const who = await identify(env, id);
  if (typeof who.acct !== "string") return "این کاربر هنوز پروفایل وب ندارد (باید یک بار به ربات پیام بدهد).";
  if (planId === "none") {
    await env.KV.delete(`sub:${who.acct}`); // همان کلید subKey در settings.ts
    await logAction(env, adminId, `لغو پلن ${cardId(who)}`);
    return "🚫 پلن لغو شد.";
  }
  const p = PLANS.find((x) => x.id === planId);
  if (!p) return "پلن نامعتبر است.";
  await activatePlan(env, who.acct, p); // مثل خرید: تمدید ۳۰ روزه و افزودن اعتبار ماهانه
  const sub = await getSub(env, who.acct);
  if (who.tgId) await sendMessage(env, who.tgId, `🎉 پلن <b>${esc(p.name)}</b> برای شما فعال شد. برای دیدن جزئیات: /credit`).catch(() => {});
  await logAction(env, adminId, `پلن ${p.name} برای ${cardId(who)}`);
  return `✅ پلن ${p.name} فعال شد${sub ? ` تا ${fmtDay(sub.exp)} با ${fa(sub.credits)} اعتبار` : ""}.`;
}

const audKey = (chatId: number) => `bca:${chatId}`;
/** پیش‌نمایش پیام همگانی با انتخاب مخاطبان (دکمه‌ی انتخاب‌شده با • مشخص است) */
async function broadcastView(env: Env, chatId: number, body: string): Promise<Screen> {
  const raw = await env.KV.get(audKey(chatId));
  const aud: Audience = isAudience(raw) ? raw : "all";
  const n = (await listAudience(env, aud)).length;
  const chip = (a: Audience) => cb(`${a === aud ? "• " : ""}${AUDIENCES[a]}`, `ad:ba:${a}`);
  return {
    text: `📣 <b>پیش‌نمایش پیام همگانی</b>\n\n${esc(body)}\n\n— — —\n🎯 مخاطبان: <b>${AUDIENCES[aud]}</b> — حدود ${fa(n)} کاربر تلگرام (مسدودها حذف می‌شوند)`,
    kb: [[chip("all"), chip("plan")], [chip("free"), chip("nocredit")], [cb("✅ ارسال", "bc:y"), cb("❌ لغو", "bc:n")]],
  };
}
async function previewBroadcast(env: Env, chatId: number, body: string) {
  if (!body) return sendMessage(env, chatId, "متن پیام خالی است؛ از /admin ← 📣 پیام همگانی دوباره شروع کن.");
  if (body.length > 3500) return sendMessage(env, chatId, "متن بیش از حد طولانی است (حداکثر ۳۵۰۰ کاراکتر).");
  await env.KV.put(`bc:${chatId}`, body, { expirationTtl: 600 });
  await env.KV.put(audKey(chatId), "all", { expirationTtl: 600 });
  return await sendScreen(env, chatId, await broadcastView(env, chatId, body));
}

const toMarkup = (s: Screen) => ({ reply_markup: { inline_keyboard: s.kb } });
const sendScreen = (env: Env, chatId: number, s: Screen) => sendMessage(env, chatId, s.text, toMarkup(s));

// ---------- دستورهای متنی ----------
export async function handleAdmin(env: Env, chatId: number, cmd: string, _args: string[], _raw = "", adminId = chatId) {
  await clearInput(env, adminId).catch(() => {});
  if (cmd === "/cancel") return sendMessage(env, chatId, "✅ لغو شد.");
  return sendScreen(env, chatId, await homeScreen(env)); // /admin و /panel
}

// ---------- ورودی متنی منتظر ----------
/** اگر مدیر قبلاً از پنل چیزی خواسته (جستجو، مقدار، متن)، این پیامش همان ورودی است. true = مصرف شد */
export async function handleAdminInput(env: Env, chatId: number, adminId: number, text: string): Promise<boolean> {
  const p = json<Pending>(await env.KV.get(inKey(adminId)));
  if (!p) return false;
  await clearInput(env, adminId);

  if (p.k === "bc") { await previewBroadcast(env, chatId, text.trim()); return true; }

  if (p.k === "msg") {
    const who = await identify(env, p.id);
    if (!who.tgId) { await sendMessage(env, chatId, "این کاربر تلگرام وصل‌شده ندارد."); return true; }
    if (text.length > 3500) { await sendMessage(env, chatId, "متن بیش از حد طولانی است (حداکثر ۳۵۰۰ کاراکتر)."); return true; }
    try {
      await sendMessage(env, who.tgId, `📩 <b>پیام از پشتیبانی</b>\n\n${esc(text)}`);
      await logAction(env, adminId, `پیام به ${who.tgId}`);
      await sendScreen(env, chatId, { text: "✅ پیام ارسال شد.", kb: [[cb("🔙 کارت کاربر", `ad:u:${cardId(who)}`), ...backHome]] });
    } catch {
      await sendMessage(env, chatId, "⚠️ پیام نرسید (کاربر ربات را بلاک کرده یا هنوز شروع نکرده).");
    }
    return true;
  }

  if (p.k === "cr") {
    const n = Math.trunc(Number(toEn(text).replace(/[+\s]/g, "")));
    if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1000) {
      await setInput(env, adminId, p); // دوباره منتظر بمان
      await sendMessage(env, chatId, "عدد صحیح غیر صفر و حداکثر ۱۰۰۰ بفرست (منفی = کم کردن)، یا /cancel.");
      return true;
    }
    const r = await applyGrant(env, adminId, p.id, n);
    await sendScreen(env, chatId, { text: `✅ اعتبار اضافه: ${fa(r.before)} ← ${fa(r.after)}${r.note}`, kb: [[cb("🔙 کارت کاربر", `ad:u:${cardId(r.who)}`), ...backHome]] });
    return true;
  }

  // جستجو: شناسه، @نام‌کاربری، بخشی از نام/ایمیل/موبایل
  const q = text.trim().replace(/^@/, "");
  if (q.length < 2) { await setInput(env, adminId, p); await sendMessage(env, chatId, "حداقل ۲ نویسه بنویس، یا /cancel."); return true; }
  const direct = parseId(q);
  if (direct !== null) { await sendScreen(env, chatId, await userCard(env, direct)); return true; }

  const like = likeArg(toEn(q));
  const likeRaw = likeArg(q);
  const d = await db(env);
  const [tgRows, webRows] = await Promise.all([
    d.prepare("SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND (json_extract(v,'$.n') LIKE ?3 ESCAPE '\\' OR json_extract(v,'$.u') LIKE ?3 ESCAPE '\\') LIMIT 10")
      .bind("seen:", "seen:" + MAXC, likeRaw).all<{ k: string; v: string }>(),
    d.prepare("SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND (json_extract(v,'$.name') LIKE ?3 ESCAPE '\\' OR json_extract(v,'$.email') LIKE ?3 ESCAPE '\\' OR json_extract(v,'$.mobile') LIKE ?4 ESCAPE '\\') LIMIT 10")
      .bind("wu:", "wu:" + MAXC, likeRaw, like).all<{ k: string; v: string }>(),
  ]);
  const found = new Map<string, string>();
  for (const r of tgRows.results ?? []) {
    const v = json<{ n?: string; u?: string | null }>(r.v); const id = r.k.slice(5);
    found.set(id, `${v?.n || (v?.u ? "@" + v.u : id)}${v?.u && v?.n ? ` (@${v.u})` : ""}`);
  }
  for (const r of webRows.results ?? []) {
    const wid = r.k.slice(3); const v = json<{ name?: string; email?: string; mobile?: string }>(r.v);
    const t = Number(await env.KV.get(`w2tg:${wid}`).catch(() => null));
    const open = Number.isSafeInteger(t) && t > 0 ? String(t) : wid;
    if (!found.has(open)) found.set(open, `${v?.name || v?.email || v?.mobile || wid}${t ? "" : " 🌐"}`);
  }
  const list = [...found.entries()].slice(0, 10);
  if (!list.length) { await sendScreen(env, chatId, { text: `🔎 «${esc(q)}» پیدا نشد.\nشناسه‌ی عددی، @نام‌کاربری، بخشی از نام، ایمیل یا موبایل را امتحان کن.`, kb: [[cb("🔎 جستجوی دوباره", "ad:se"), ...backHome]] }); return true; }
  if (list.length === 1) { await sendScreen(env, chatId, await userCard(env, idOf(list[0][0])!)); return true; }
  await sendScreen(env, chatId, { text: `🔎 <b>${fa(list.length)} نتیجه</b> برای «${esc(q)}»:`, kb: [...list.map(([id, label]) => [cb(label.slice(0, 48), `ad:u:${id}`)]), [cb("🔎 جستجوی دوباره", "ad:se"), ...backHome]] });
  return true;
}

// ---------- دکمه‌های پنل ----------
export async function handlePanelCallback(env: Env, cq: any) {
  const chatId: number = cq.message.chat.id, mid: number = cq.message.message_id, adminId: number = cq.from.id;
  const answer = (text?: string, alert = false) =>
    tg(env, "answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text: text.slice(0, 200), show_alert: alert } : {}) }).catch(() => {});
  if (!isAdmin(env, adminId)) return await answer();

  const [, a, b, c] = String(cq.data ?? "").split(":");
  const show = async (s: Screen) => { await answer(); await editMessage(env, chatId, mid, s.text, toMarkup(s)); };
  const prompt = async (p: Pending, text: string, back: string) => {
    await setInput(env, adminId, p);
    await show({ text: `${text}\n\n<i>همین حالا پیامت را بفرست (۱۰ دقیقه اعتبار دارد) یا /cancel.</i>`, kb: [[cb("❌ انصراف", back)]] });
  };
  const id = idOf(b);

  try {
    if (a !== "se" && a !== "bc" && a !== "cr" && a !== "m") await clearInput(env, adminId).catch(() => {}); // رفتن به صفحه‌ی دیگر = انصراف از ورودی در انتظار

    switch (a) {
      case "h": return await show(await homeScreen(env));
      case "x": await answer(); return await tg(env, "deleteMessage", { chat_id: chatId, message_id: mid }).catch(() => {});
      case "st": return await show(await statsScreen(env, [1, 7, 30].includes(Number(b)) ? Number(b) : 7));
      case "us": return await show(await usersScreen(env, b === "w" ? "w" : "t", Math.max(0, Math.min(2000, Number(c) || 0))));
      case "sb": return await show(await subsScreen(env, Math.max(0, Math.min(2000, Number(b) || 0))));
      case "bn": return await show(await bannedScreen(env));
      case "dk": return await show(await decksScreen(env));
      case "pm": return await show(await paymentScreen(env, b === "l" ? "l" : b === "p" ? "p" : "s", Math.max(0, Math.min(2000, Number(c) || 0))));
      case "fn": return await show(await funnelScreen(env, [7, 30, 90, 0].includes(Number(b)) ? Number(b) : 30));
      case "mo": return await show(await monthlyScreen(env));
      case "iv": return await show(await referralScreen(env, b === "r" ? "r" : "t", Math.max(0, Math.min(2000, Number(c) || 0))));
      case "sy": return await show(await systemScreen(env));
      case "lg": return await show(await logScreen(env));
      case "pg": {
        const n = await env.KV.purge();
        await logAction(env, adminId, `پاکسازی ${n} ردیف منقضی`);
        await answer(`🧹 ${n} ردیف منقضی پاک شد.`, true);
        return await editMessage(env, chatId, mid, (await systemScreen(env)).text, toMarkup(await systemScreen(env)));
      }
      case "ba": {
        const body = await env.KV.get(`bc:${chatId}`);
        if (body === null || !isAudience(b)) return await show({ text: "⌛️ این پیش‌نویس منقضی شده است؛ دوباره از 📣 پیام همگانی شروع کن.", kb: [backHome] });
        await env.KV.put(audKey(chatId), b, { expirationTtl: 600 });
        return await show(await broadcastView(env, chatId, body));
      }
      case "se": return await prompt({ k: "search" }, "🔎 <b>جستجوی کاربر</b>\nشناسه‌ی عددی، شناسه‌ی w_…، @نام‌کاربری، یا بخشی از نام/ایمیل/موبایل را بفرست.", "ad:h");
      case "bc": return await prompt({ k: "bc" }, "📣 <b>پیام همگانی</b>\nمتن پیام را بفرست؛ بعد پیش‌نمایش می‌بینی و با دکمه تایید می‌کنی.", "ad:h");
    }

    if (id === null) return await answer();
    switch (a) {
      case "u": return await show(await userCard(env, id));
      case "ud": return await show(await userFilesScreen(env, id));
      // از پیام «نظر کاربر»: کارت/فایل‌های کاربر به‌صورت پیام جدید می‌آید تا متن نظر سر جایش بماند
      case "nu": if (id === null) return await answer(); await answer(); return void (await sendScreen(env, chatId, await userCard(env, id)));
      case "nd": if (id === null) return await answer(); await answer(); return void (await sendScreen(env, chatId, await userFilesScreen(env, id)));
      case "cr": return await prompt({ k: "cr", id }, `✏️ <b>اعتبار دلخواه</b> برای <code>${id}</code>\nیک عدد بفرست؛ مثلاً <code>25</code> یا <code>-3</code>.`, `ad:u:${id}`);
      case "m": return await prompt({ k: "msg", id }, `✉️ <b>پیام به کاربر</b> <code>${id}</code>\nمتن پیام را بفرست.`, `ad:u:${id}`);
      case "g": {
        const n = Math.trunc(Number(c));
        if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1000) return await answer();
        const r = await applyGrant(env, adminId, id, n);
        await answer(`اعتبار: ${r.before} ← ${r.after}`);
        return await editMessage(env, chatId, mid, (await userCard(env, id)).text, toMarkup(await userCard(env, id)));
      }
      case "pl": {
        const msg = await applyPlan(env, adminId, id, String(c));
        await answer(msg, true);
        const s = await userCard(env, id);
        return await editMessage(env, chatId, mid, s.text, toMarkup(s));
      }
      case "b": {
        const done = await applyBan(env, adminId, id, c === "1");
        await answer(done ? (c === "1" ? "⛔️ مسدود شد" : "✅ رفع انسداد شد") : "مدیر را نمی‌شود مسدود کرد.", !done);
        const s = await userCard(env, id);
        return await editMessage(env, chatId, mid, s.text, toMarkup(s));
      }
      case "ul": {
        const who = await identify(env, id);
        await releaseLock(env, who.acct);
        await logAction(env, adminId, `آزاد کردن قفل ${cardId(who)}`);
        await answer("🔓 قفل آزاد شد");
        const s = await userCard(env, id);
        return await editMessage(env, chatId, mid, s.text, toMarkup(s));
      }
    }
    return await answer();
  } catch (e) {
    console.error("admin panel", e);
    await answer("⚠️ خطا در اجرای عملیات؛ دوباره امتحان کن.", true);
  }
}

/** دکمه‌های تایید/لغو پیام همگانی (فقط مدیر) */
export async function handleBroadcastCallback(env: Env, cq: any) {
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
  const chatId: number = cq.message.chat.id, mid: number = cq.message.message_id;
  if (!isAdmin(env, cq.from.id)) return;
  const key = `bc:${chatId}`;
  const act = String(cq.data ?? "").split(":")[1];
  const text = await env.KV.get(key);
  if (act === "n") {
    await env.KV.delete(key);
    await env.KV.delete(audKey(chatId));
    return await editMessage(env, chatId, mid, "❌ ارسال همگانی لغو شد.");
  }
  if (text === null) return await editMessage(env, chatId, mid, "⌛️ این پیش‌نویس منقضی شده است؛ دوباره از /admin ← 📣 پیام همگانی شروع کن.");
  const rawAud = await env.KV.get(audKey(chatId));
  const audience: Audience = isAudience(rawAud) ? rawAud : "all";
  await env.KV.delete(key); // جلوگیری از ارسال دوباره با دو بار زدن دکمه
  await env.KV.delete(audKey(chatId));
  try {
    await env.BROADCAST_WORKFLOW.create({ id: `bc-${Date.now()}`, params: { adminChatId: chatId, text, audience } });
  } catch (e) {
    console.error("broadcast create failed", e);
    return await editMessage(env, chatId, mid, "❌ شروع ارسال ممکن نشد. دوباره امتحان کن.");
  }
  await logAction(env, cq.from.id, `پیام همگانی به «${AUDIENCES[audience]}» (${text.length} نویسه)`);
  await editMessage(env, chatId, mid, "⏳ ارسال همگانی شروع شد. وقتی تمام شد، گزارش را همین‌جا می‌فرستم.");
}

/** دکمه‌ی «📥»: فایل ارائه‌ی هر کاربر را (اگر هنوز نگه داشته شده باشد) برای مدیر می‌فرستد */
export async function handleAdminFileCallback(env: Env, cq: any) {
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
  if (!isAdmin(env, cq.from.id)) return;
  const chatId: number = cq.message.chat.id;
  const [, uid, fid] = String(cq.data ?? "").split(":");
  const userId: Uid = WEB_ID.test(uid ?? "") ? uid : Number(uid);
  const f = (typeof userId === "string" || Number.isSafeInteger(userId)) && fid ? await loadFile(env, userId, fid) : null;
  if (!f) return await sendMessage(env, chatId, "⌛️ این فایل دیگر در دسترس نیست (فایل‌ها ۲۴ ساعت و حداکثر ۹ فایل آخر هر کاربر (پلاس ۱۸، پرو ۳۰) نگه داشته می‌شوند).");
  await sendDocument(env, chatId, new Uint8Array(f.data), f.entry.name, `✅ <b>${esc(f.entry.title)}</b>\n👤 <code>${userId}</code>`);
  // اگر برای همین ارائه پوستر یا جزوه هم ساخته شده (و هنوز نگه داشته می‌شود)، همراهش فرستاده می‌شود
  if (/-(poster|handout)$/.test(fid)) return;
  for (const [suffix, label] of [["poster", "🖼 پوستر"], ["handout", "📘 جزوه"]] as const) {
    const extra = await loadFile(env, userId, `${fid}-${suffix}`).catch(() => null);
    if (!extra) continue;
    await sendDocument(env, chatId, new Uint8Array(extra.data), extra.entry.name, `${label} · <b>${esc(extra.entry.title)}</b>\n👤 <code>${userId}</code>`)
      .catch((err) => console.error("admin send extra", suffix, err));
  }
}
