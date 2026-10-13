import type { Env } from "./env";
import { editMessage, esc, sendDocument, sendMessage, tg } from "./telegram";
import {
  PLAN_MAX_IMAGES, PLAN_MAX_SLIDES, FREE_MAX_IMAGES, FREE_MAX_SLIDES, getBonus, getCredit, getStats, getSub, getUserSeen, isAdmin, isBanned, isLocked, releaseLock,
  setBanned, setBonus, type Uid,
} from "./settings";
import { getUserById, googleEnabled, otpEnabled } from "./auth";
import { resolveUid } from "./link";
import { getDeckLog, listFiles, loadFile } from "./files";
import { hasKey, modelList } from "./llm";
import { PLANS, activatePlan, payEnabled } from "./payment";
import { runningJob } from "./deck-service";
import { toEn, toFa } from "./util";

/** دستورهای متنی مدیر (دستورهای قدیمی برای سازگاری حفظ شده‌اند؛ /admin و /panel پنل دکمه‌ای را باز می‌کنند) */
export const ADMIN_CMDS = new Set(["/admin", "/panel", "/cancel", "/stats", "/broadcast", "/grant", "/user", "/users", "/decks", "/ban", "/unban"]);

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
  const [tgUsers, webOnly, subs, banned, st] = await Promise.all([
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2", "seen:", "seen:" + MAXC),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND NOT EXISTS (SELECT 1 FROM kv t WHERE t.k = 'w2tg:' || substr(kv.k, 4))", "wu:", "wu:" + MAXC),
    activeSubCount(env),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2", "ban:", "ban:" + MAXC),
    statsByDay(env),
  ]);
  const t = st[day] ?? {};
  return {
    text:
      "🛠 <b>پنل مدیریت</b>\n\n" +
      `👥 کاربران تلگرام: <b>${fa(tgUsers)}</b> · 🌐 فقط وب: <b>${fa(webOnly)}</b>\n` +
      `👑 پلن فعال: <b>${fa(subs)}</b> · ⛔️ مسدود: <b>${fa(banned)}</b>\n` +
      `📅 امروز: ▶️ ${fa(t.started ?? 0)} · ✅ ${fa(t.ok ?? 0)} · ❌ ${fa(t.fail ?? 0)} · 🆕 ${fa(t.newusers ?? 0)}\n\n` +
      "<i>یک بخش را انتخاب کن. برای مدیریت یک کاربر، شناسه یا نامش را در «جستجو» بنویس.</i>",
    kb: [
      [cb("📊 آمار", "ad:st:7"), cb("👥 کاربران", "ad:us:t:0")],
      [cb("🔎 جستجوی کاربر", "ad:se"), cb("🗂 ارائه‌های اخیر", "ad:dk")],
      [cb("📣 پیام همگانی", "ad:bc"), cb("👑 پلن‌های فعال", "ad:sb:0")],
      [cb("⛔️ مسدودها", "ad:bn"), cb("⚙️ سیستم", "ad:sy")],
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
  const [st, tgUsers, webUsers, subs, bonusSum, bonusUsers] = await Promise.all([
    statsByDay(env),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2", "seen:", "seen:" + MAXC),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2", "wu:", "wu:" + MAXC),
    activeSubCount(env),
    count(env, "SELECT SUM(CAST(v AS INTEGER)) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3)", "bonus:", "bonus:" + MAXC, nowSec()),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND CAST(v AS INTEGER) > 0", "bonus:", "bonus:" + MAXC, nowSec()),
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
    return `${md} ${bar(x.ok ?? 0)} ✅${fa(x.ok ?? 0)} ❌${fa(x.fail ?? 0)} 🆕${fa(x.newusers ?? 0)}`;
  });

  return {
    text:
      `📊 <b>آمار — ${label}</b>\n` +
      `🆕 کاربر جدید: ${fa(sum("newusers"))}\n▶️ شروع‌شده: ${fa(sum("started"))}\n✅ موفق: ${fa(ok)}\n❌ ناموفق: ${fa(fail)}` +
      (rate === null ? "" : `\n📈 نرخ موفقیت: ${fa(rate)}٪`) +
      "\n\n<b>کل</b>\n" +
      `👥 کاربران تلگرام: ${fa(tgUsers)} · 🌐 پروفایل وب: ${fa(webUsers)}\n` +
      `👑 پلن‌های فعال: ${fa(subs)}\n` +
      `🎁 اعتبار هدیه/شارژِ مصرف‌نشده: ${fa(bonusSum)} (نزد ${fa(bonusUsers)} کاربر)\n\n` +
      "<b>ریز ۷ روز اخیر</b>\n" + daily.join("\n") +
      "\n\n<i>«کاربر جدید» از زمان فعال شدن این قابلیت شمرده می‌شود؛ آمار ۶۰ روز نگه داشته می‌شود.</i>",
    kb: [
      [cb(days === 1 ? "• امروز" : "امروز", "ad:st:1"), cb(days === 7 ? "• ۷ روز" : "۷ روز", "ad:st:7"), cb(days === 30 ? "• ۳۰ روز" : "۳۰ روز", "ad:st:30")],
      [cb("🔄 تازه‌سازی", `ad:st:${days}`), ...backHome],
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
  const tabs: Btn[] = [cb(kind === "t" ? "• کاربران تلگرام" : "کاربران تلگرام", "ad:us:t:0"), cb(kind === "w" ? "• فقط وب" : "فقط وب", "ad:us:w:0")];
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
    total = await count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND NOT EXISTS (SELECT 1 FROM kv t WHERE t.k = 'w2tg:' || substr(kv.k, 4))", "wu:", "wu:" + MAXC);
    const rs = await rows(env,
      "SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND NOT EXISTS (SELECT 1 FROM kv t WHERE t.k = 'w2tg:' || substr(kv.k, 4)) ORDER BY json_extract(v,'$.created') DESC LIMIT ?3 OFFSET ?4",
      "wu:", "wu:" + MAXC, PAGE, page * PAGE);
    for (const r of rs) {
      const id = r.k.slice(3); const v = json<{ name?: string; email?: string; mobile?: string; created?: number }>(r.v);
      if (!WEB_ID.test(id) || !v) continue;
      items.push({ id, label: v.name || v.email || v.mobile || id, line: `<b>${esc(v.name || "—")}</b> 🌐\n    ${v.email ? esc(v.email) : v.mobile ? esc(v.mobile) : "—"} · 🕒 ${v.created ? fmtTime(v.created) : "—"}` });
    }
  }
  const head = kind === "t" ? "👥 <b>کاربران تلگرام</b> (جدیدترین اول، به وقت ایران)" : "🌐 <b>کاربران فقط‌وب</b> (بدون تلگرام وصل‌شده)";
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
    web?.mobile ? `📱 موبایل: ${esc(web.mobile)}` : "",
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

async function decksScreen(env: Env): Promise<Screen> {
  const list = await getDeckLog(env);
  if (!list.length) return { text: "🗂 هنوز ارائه‌ای ثبت نشده است؛ از این به بعد هر ارائه‌ی ساخته‌شده در این فهرست ثبت می‌شود.", kb: [backHome] };
  const lines = list.map((x, i) =>
    `${fa(i + 1)}. <b>${esc(x.title.slice(0, 60))}</b> (${fa(x.slides)} اسلاید)\n` +
    `    👤 ${userLink(x.userId, x.n, x.u)} · <code>${x.userId}</code> · 🕒 ${fmtTime(x.t)}` +
    (x.o ? `\n    ✍️ <i>${esc(x.o.slice(0, 200))}</i>` : ""));
  // فایل‌ها فقط ۲۴ ساعت (و ۳ فایل آخر هر کاربر) نگه داشته می‌شوند؛ برای قدیمی‌تر دکمه‌ی دریافت نمی‌گذاریم
  const fresh = Date.now() - 24 * 3600 * 1000;
  const kb: Btn[][] = list.map((x, i) => {
    const r: Btn[] = [];
    if (x.t > fresh) r.push(cb(`📥 ${fa(i + 1)}. ${x.title.slice(0, 22)}`, `af:${x.userId}:${x.id}`));
    r.push(cb(`👤 ${fa(i + 1)}`, `ad:u:${x.userId}`));
    return r;
  });
  kb.push([cb("🔄 تازه‌سازی", "ad:dk"), ...backHome]);
  return { text: `🗂 <b>${fa(list.length)} ارائه‌ی اخیر</b> (به وقت ایران)\n\n${lines.join("\n")}\n\n<i>📥 فقط برای فایل‌های ۲۴ ساعت اخیر؛ 👤 کارت کاربر.</i>`, kb };
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
      `${ok(env.BROWSER)} ساخت PDF · ${ok(payEnabled(env))} درگاه پرداخت · ${ok(otpEnabled(env))} پیامک · ${ok(googleEnabled(env))} ورود گوگل\n\n` +
      `👮 مدیرها: ${fa(admins)} · 🔒 فهرست مجاز: ${restricted ? fa(restricted) + " نفر" : "همه آزادند"}\n` +
      `🗄 ردیف‌های پایگاه‌داده: ${fa(rowsN)}\n` +
      `🔗 وب‌هوک: ${info?.url ? "✅ فعال" : "❌ تنظیم نشده"} · در صف: ${fa(info?.pending_update_count ?? 0)}${hookErr}`,
    kb: [
      [cb("📜 گزارش اقدامات مدیر", "ad:lg"), cb("🧹 پاکسازی منقضی‌ها", "ad:pg")],
      [cb("📖 راهنمای دستورها", "ad:hp")],
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

const ADMIN_HELP =
  "🛠 <b>دستورهای مدیر</b>\n\n" +
  "/admin ← پنل دکمه‌ایِ کامل (پیشنهادی)\n" +
  "/stats ← آمار امروز و ۷ روز اخیر\n" +
  "/broadcast <code>متن</code> ← پیام همگانی به همه‌ی کاربران (با تایید)\n" +
  "/users ← ۱۰ کاربر اخیر (نام + لینک پروفایل)\n" +
  "/decks ← ۱۰ ارائه‌ی اخیر ساخته‌شده (با دکمه‌ی دریافت فایل)\n" +
  "/user <code>شناسه</code> ← کارت مدیریت یک کاربر\n" +
  "/grant <code>شناسه تعداد</code> ← افزودن اعتبار (عدد منفی = کم کردن)\n" +
  "<i>برای کاربر وب، شناسه‌ی w_… که در پیام خرید می‌آید را بنویس.</i>\n" +
  "/ban <code>شناسه</code> ← مسدود کردن کاربر\n" +
  "/unban <code>شناسه</code> ← رفع انسداد\n" +
  "/cancel ← لغو ورودی در انتظار (جستجو، پیام و…)\n\n" +
  "<i>شناسه‌ی عددی کاربر را خودش با /id می‌تواند ببیند.</i>";

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

async function previewBroadcast(env: Env, chatId: number, body: string) {
  if (!body) return sendMessage(env, chatId, "متن پیام را بعد از دستور بنویس؛ مثلاً:\n<code>/broadcast سلام! قابلیت جدید اضافه شد.</code>");
  if (body.length > 3500) return sendMessage(env, chatId, "متن بیش از حد طولانی است (حداکثر ۳۵۰۰ کاراکتر).");
  await env.KV.put(`bc:${chatId}`, body, { expirationTtl: 600 });
  const { users } = await getStats(env, 1);
  return await sendMessage(env, chatId,
    `📣 <b>پیش‌نمایش پیام همگانی</b>\n\n${esc(body)}\n\n— — —\nبه حدود ${fa(users)} کاربر ارسال می‌شود.`,
    { reply_markup: { inline_keyboard: [[cb("✅ ارسال برای همه", "bc:y"), cb("❌ لغو", "bc:n")]] } });
}

const toMarkup = (s: Screen) => ({ reply_markup: { inline_keyboard: s.kb } });
const sendScreen = (env: Env, chatId: number, s: Screen) => sendMessage(env, chatId, s.text, toMarkup(s));

// ---------- دستورهای متنی ----------
export async function handleAdmin(env: Env, chatId: number, cmd: string, args: string[], raw = "", adminId = chatId) {
  const reply = (t: string) => sendMessage(env, chatId, t);

  if (cmd === "/admin" || cmd === "/panel") { await clearInput(env, adminId).catch(() => {}); return sendScreen(env, chatId, await homeScreen(env)); }
  if (cmd === "/cancel") { await clearInput(env, adminId).catch(() => {}); return reply("✅ لغو شد."); }

  if (cmd === "/stats") return sendScreen(env, chatId, await statsScreen(env, 7));

  if (cmd === "/users") return sendScreen(env, chatId, await usersScreen(env, "t", 0));

  if (cmd === "/decks") return sendScreen(env, chatId, await decksScreen(env));

  if (cmd === "/broadcast") return await previewBroadcast(env, chatId, raw.replace(/^\S+\s*/, "").trim()); // متن خام با خط‌های جدید

  const id = parseId(args[0]);
  if (id === null) return reply("شناسه‌ی عددی کاربر را بعد از دستور بنویس؛ مثلاً: <code>" + cmd + " 123456789</code>");

  if (cmd === "/grant") {
    const n = Math.trunc(Number(toEn(args[1] ?? "")));
    if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1000) return reply("تعداد باید یک عدد صحیح غیر صفر و حداکثر ۱۰۰۰ باشد؛ مثلاً: <code>/grant " + id + " 10</code>");
    const r = await applyGrant(env, adminId, id, n);
    return reply(`✅ اعتبار اضافه‌ی <code>${id}</code>: ${fa(r.before)} ← ${fa(r.after)}${r.note}`);
  }
  if (cmd === "/ban") return reply((await applyBan(env, adminId, id, true)) ? `⛔️ کاربر <code>${id}</code> مسدود شد.` : "مدیر را نمی‌شود مسدود کرد.");
  if (cmd === "/unban") { await applyBan(env, adminId, id, false); return reply(`✅ انسداد کاربر <code>${id}</code> برداشته شد.`); }
  if (cmd === "/user") return sendScreen(env, chatId, await userCard(env, id));
  return reply("دستور ناشناخته است.");
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
      case "sy": return await show(await systemScreen(env));
      case "lg": return await show(await logScreen(env));
      case "hp": return await show({ text: ADMIN_HELP, kb: [[cb("🔙 سیستم", "ad:sy"), ...backHome]] });
      case "pg": {
        const n = await env.KV.purge();
        await logAction(env, adminId, `پاکسازی ${n} ردیف منقضی`);
        await answer(`🧹 ${n} ردیف منقضی پاک شد.`, true);
        return await editMessage(env, chatId, mid, (await systemScreen(env)).text, toMarkup(await systemScreen(env)));
      }
      case "se": return await prompt({ k: "search" }, "🔎 <b>جستجوی کاربر</b>\nشناسه‌ی عددی، شناسه‌ی w_…، @نام‌کاربری، یا بخشی از نام/ایمیل/موبایل را بفرست.", "ad:h");
      case "bc": return await prompt({ k: "bc" }, "📣 <b>پیام همگانی</b>\nمتن پیام را بفرست؛ بعد پیش‌نمایش می‌بینی و با دکمه تایید می‌کنی.", "ad:h");
    }

    if (id === null) return await answer();
    switch (a) {
      case "u": return await show(await userCard(env, id));
      case "ud": return await show(await userFilesScreen(env, id));
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
    return await editMessage(env, chatId, mid, "❌ ارسال همگانی لغو شد.");
  }
  if (text === null) return await editMessage(env, chatId, mid, "⌛️ این پیش‌نویس منقضی شده است؛ دوباره /broadcast بزن.");
  await env.KV.delete(key); // جلوگیری از ارسال دوباره با دو بار زدن دکمه
  try {
    await env.BROADCAST_WORKFLOW.create({ id: `bc-${Date.now()}`, params: { adminChatId: chatId, text } });
  } catch (e) {
    console.error("broadcast create failed", e);
    return await editMessage(env, chatId, mid, "❌ شروع ارسال ممکن نشد. دوباره امتحان کن.");
  }
  await logAction(env, cq.from.id, `پیام همگانی (${text.length} نویسه)`);
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
  if (!f) return await sendMessage(env, chatId, "⌛️ این فایل دیگر در دسترس نیست (فایل‌ها ۲۴ ساعت و حداکثر ۳ فایل آخر هر کاربر نگه داشته می‌شوند).");
  await sendDocument(env, chatId, new Uint8Array(f.data), f.entry.name, `✅ <b>${esc(f.entry.title)}</b>\n👤 <code>${userId}</code>`);
}
