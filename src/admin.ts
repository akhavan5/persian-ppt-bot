import { BALE_ID_BASE, isBaleId } from "./bale-format";
import { RUBIKA_ID_BASE, isRubikaId } from "./rubika-format";
import { EITAA_ID_BASE, isEitaaId } from "./eitaa-format";
import { SPLUS_ID_BASE, isSplusId } from "./splus-format";
import type { Env } from "./env";
import { editMessage, esc, sendAudio, sendDocument, sendMessage, tg } from "./telegram";
import { audioSeconds, isAudioName } from "./wav";
import {
  PLAN_MAX_IMAGES, PLAN_MAX_SLIDES, FREE_MAX_IMAGES, FREE_MAX_SLIDES, getBonus, getCredit, adminIds, botPlatform, getStats, getSub, getUserSeen, isAdmin, isBanned, isLocked, releaseLock,
  setBanned, setBonus, REF_CREDITS, REF_MAX, REF_EVERY, ABS_MAX_SLIDES, ABS_MAX_IMAGES, PLATFORMS, isPlatform, statDay, type Platform, type Uid,
} from "./settings";
import { getUserById, googleEnabled, otpEnabled, type WebUser } from "./auth";
import { resolveUid } from "./link";
import { settleLegacyReferrals } from "./referral";
import { ADMIN_REPLY_MAX, DAILY_LIMIT, addAdminReply, loadSupportConv, notifyUserOfReply, supportOverview, supportUsers } from "./support-chat";
import { getDeckLog, listFiles, loadFile, type DeckLog } from "./files";
import { SAMPLE_BADGE, addSample, listSamples, removeSample, sampleLabel } from "./samples";
import { cachedPdf } from "./pdf";
import { hasKey, modelList } from "./llm";
import { PLANS, activatePlan, payEnabled, payGateways } from "./payment";
import { runningJob } from "./deck-service";
import { hasBrowser } from "./browser-api";
import { toEn, toFa } from "./util";
import { approveReview, listPublicReviews, rejectReview, removePublicReview } from "./reviews";
import { XLSX_MIME, buildXlsx, type XCell } from "./xlsx";
import { AUDIENCES, isAudience, listAudience, type Audience } from "./broadcast";
import {
  PUSH_BODY_MAX, PUSH_SEGMENTS, PUSH_TITLE_MAX, clearPushDraft, getPushDraft, getPushSegment, isPushSegment, launchAppPush, parsePushDraft, pushDeviceCounts,
  pushEnabled, pushPreviewText, savePushDraft, setPushSegment,
} from "./push";
import { webPushCounts, webPushEnabled, type WebPushMsg } from "./webpush";
import { STORE_LABEL, osTag } from "./app-ua";
import { APPVER_HELP, STORES, STORE_NAMES, appVerText, applyAppVer, getAppVersions, isStoreId, type StoreId } from "./app-version";
import { tavilyKeys } from "./tavily";

/** دستورهای متنی مدیر: ورود به پنل و لغو ورودی در انتظار؛ بقیه‌ی کارها (از جمله نسخه‌ی اپ و اعلان به اپ) با دکمه‌های پنل انجام می‌شود.
 *  دستورهای قدیمی /appver و /apppush هم هنوز کار می‌کنند ولی زیرشان دکمه‌ی «باز کردن در پنل» هست. */
export const ADMIN_CMDS = new Set(["/admin", "/panel", "/cancel", "/samples"]);

type Btn = { text: string; callback_data?: string; url?: string };
type Screen = { text: string; kb: Btn[][] };

const fa = (n: number | string) => toFa(String(n));

/** لینک پروفایل: با نام کاربری → t.me/نام_کاربری، وگرنه لینک tg://user (برای کاربرانی که با ربات گفتگو داشته‌اند کار می‌کند) */
const userLink = (id: Uid, name?: string | null, username?: string | null) => {
  if (typeof id === "string") return `<b>${esc(name || id)}</b> 🌐`; // کاربر وب: پروفایل تلگرام ندارد
  if (isSplusId(id)) return `<b>${esc(name || (username ? "@" + username : String(id)))}</b> (سروش‌پلاس)`; // لینک t.me / tg:// ندارد
  if (isEitaaId(id)) return `<b>${esc(name || (username ? "@" + username : String(id)))}</b> (ایتا)`;
  if (isRubikaId(id)) return `<b>${esc(name || (username ? "@" + username : String(id)))}</b> (روبیکا)`; // کاربر روبیکا: لینک t.me / tg:// ندارد
  if (isBaleId(id)) return `<b>${esc(name || (username ? "@" + username : String(id)))}</b> (بله)`; // کاربر بله: لینک t.me / tg:// ندارد
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
const APP_BAZAAR = "json_extract(v,'$.store') = 'bazaar'";
const APP_MYKET = "json_extract(v,'$.store') = 'myket'";
/** کاربر وبِ «فقط سایت»: اپ اندروید را هرگز استفاده نکرده (تا هر نفر در گزارش پلتفرمی یک بار شمرده شود) */
const WEB_NOT_APP = "(COALESCE(json_extract(v,'$.app'),0) != 1 AND json_extract(v,'$.pwa') IS NULL)";
/** کاربر اپ اندروید (حساب‌های قدیمی os ندارند و همه اندرویدند) / کاربر اپ iOS / کاربر وب‌اپ نصب‌شده (PWA؛ کسی که اپ بومی ندارد) */
const APP_ANDROID = "(json_extract(v,'$.app') = 1 AND COALESCE(json_extract(v,'$.os'),'android') != 'ios')";
const APP_IOS = "(json_extract(v,'$.app') = 1 AND json_extract(v,'$.os') = 'ios')";
const PWA_USER = "(COALESCE(json_extract(v,'$.app'),0) != 1 AND json_extract(v,'$.pwa') IS NOT NULL)";
const PWA_IOS = "(COALESCE(json_extract(v,'$.app'),0) != 1 AND json_extract(v,'$.pwa') = 'ios')";
const PWA_OTHER = "(COALESCE(json_extract(v,'$.app'),0) != 1 AND json_extract(v,'$.pwa') = 'other')";
/** seen:<شناسه> — شناسه‌های بله از BALE_ID_BASE شروع می‌شوند (bale-format.ts)؛ تلگرام زیر آن است */
const SEEN_TG = `CAST(substr(k,6) AS INTEGER) < ${BALE_ID_BASE}`;
const SEEN_BALE = `CAST(substr(k,6) AS INTEGER) >= ${BALE_ID_BASE} AND CAST(substr(k,6) AS INTEGER) < ${RUBIKA_ID_BASE}`;
const SEEN_RUBIKA = `CAST(substr(k,6) AS INTEGER) >= ${RUBIKA_ID_BASE} AND CAST(substr(k,6) AS INTEGER) < ${EITAA_ID_BASE}`;
const SEEN_EITAA = `CAST(substr(k,6) AS INTEGER) >= ${EITAA_ID_BASE} AND CAST(substr(k,6) AS INTEGER) < ${SPLUS_ID_BASE}`;
const SEEN_SPLUS = `CAST(substr(k,6) AS INTEGER) >= ${SPLUS_ID_BASE}`;
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
type Pending = { k: "search" } | { k: "bc" } | { k: "cr"; id: Uid } | { k: "msg"; id: Uid } | { k: "ver"; s: StoreId | "all" } | { k: "pushw" } | { k: "wpushw" } | { k: "sr"; uid: string };
const inKey = (adminId: number) => `adm:in:${adminId}`;
const setInput = (env: Env, adminId: number, p: Pending) => env.KV.put(inKey(adminId), JSON.stringify(p), { expirationTtl: 600 });
const clearInput = (env: Env, adminId: number) => env.KV.delete(inKey(adminId));

// ---------- صفحه‌ها ----------
const backHome: Btn[] = [{ text: "🏠 پنل", callback_data: "ad:h" }];
const cb = (text: string, data: string): Btn => ({ text, callback_data: data });

// ---------- آمار به تفکیک پلتفرم (تلگرام / بله / وب / اپ اندروید) ----------
// شمارنده‌ها را bumpStat (settings.ts) در pst:<پلتفرم>:<نام>:<روز> می‌نویسد؛ جمع کل همچنان در stat:<نام>:<روز> است.
const PLAT_LABEL: Record<Platform, string> = { tg: "✈️ تلگرام", bale: "🟢 بله", rubika: "🟣 روبیکا", eitaa: "🟠 ایتا", splus: "🔵 سروش‌پلاس", web: "🌐 وب", bazaar: "📱 اپ بازار", myket: "📱 اپ مایکت", app: "📱 اپ قدیمی (فروشگاه نامشخص)",
  ios: "🍎 اپ iOS", pwa_ios: "🍏 وب‌اپ نصب‌شده (PWA) آیفون/آیپد", pwa: "📲 وب‌اپ نصب‌شده (PWA) بقیه" } as Record<Platform, string>;
type PlatCounts = Record<string, number>;
/** هفته‌ی ایرانی از شنبه تا جمعه: چند روز از شنبه‌ی همین هفته گذشته (شنبه = ۱، جمعه = ۷؛ روز هفته به وقت ایران) */
const WEEKDAY_IDX: Record<string, number> = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 };
const daysIntoWeek = () => (WEEKDAY_IDX[new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Tehran" })] ?? 0) + 1;
const dayStr = (agoDays: number) => statDay(Date.now() - agoDays * 86_400_000); // روز آمار به وقت ایران (هم‌راستا با daysIntoWeek)

/** جمع شمارنده‌های هر پلتفرم برای بازه‌ی [from تا to روز پیش] (from ≥ to؛ ۰ = امروز، روز آمار به وقت ایران) */
async function platStats(env: Env, from: number, to: number): Promise<Record<Platform, PlatCounts>> {
  const out = Object.fromEntries(PLATFORMS.map((p) => [p, {} as PlatCounts])) as Record<Platform, PlatCounts>;
  const lo = dayStr(from), hi = dayStr(to); // from = قدیمی‌تر ⇒ lo ≤ روز ≤ hi
  for (const r of await rows(env,
    "SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND substr(k, -10) >= ?3 AND substr(k, -10) <= ?4 AND (exp IS NULL OR exp > ?5)",
    "pst:", "pst:" + MAXC, lo, hi, nowSec())) {
    const [, plat, name] = r.k.split(":");
    if (!PLATFORMS.includes(plat as Platform) || !name) continue;
    const c = out[plat as Platform]; c[name] = (c[name] ?? 0) + (Number(r.v) || 0);
  }
  return out;
}
const sumDaysOf = (st: Record<string, PlatCounts>, from: number, to: number): PlatCounts => {
  const t: PlatCounts = {};
  for (let i = from; i <= to; i++) for (const [n, v] of Object.entries(st[dayStr(i)] ?? {})) t[n] = (t[n] ?? 0) + v;
  return t;
};

/** یک خط آمار برای یک پلتفرم (یا جمع کل) در بازه‌ی انتخابی */
const platLine = (label: string, c: PlatCounts) =>
  `${label}: ▶️ ${fa(c.started ?? 0)} · ✅ <b>${fa(c.ok ?? 0)}</b> · ❌ ${fa(c.fail ?? 0)} · 🆕 ${fa(c.newusers ?? 0)}`;

/** بلوک گزارش پلتفرمی برای بازه‌ی days روز اخیر: هر پلتفرم یک خط + جمع کل؛ */
async function platformReport(env: Env, days: number, st: Record<string, Record<string, number>>): Promise<string> {
  const cur = await platStats(env, days - 1, 0);
  const total = sumDaysOf(st, 0, days - 1);
  const lines = PLATFORMS.map((p) => platLine(PLAT_LABEL[p], cur[p]));
  lines.push(platLine("📊 <b>جمع کل</b>", total));
  // سهمی از جمع کل که پلتفرمش ثبت نشده (قبل از اضافه شدن این گزارش)
  const attributed = (n: string) => PLATFORMS.reduce((a, p) => a + (cur[p][n] ?? 0), 0);
  const rest = ["started", "ok", "fail", "newusers"].reduce((a, n) => a + Math.max(0, (total[n] ?? 0) - attributed(n)), 0);
  return lines.join("\n") + (rest > 0 ? "\n<i>ℹ️ بخشی از این بازه مربوط به پیش از ثبت پلتفرم است و فقط در جمع کل می‌آید.</i>" : "");
}

/** تکمیل پروفایل: حساب‌هایی که «بعداً» موبایل یا ایمیل اضافه و با کد تایید کرده‌اند (قفل‌های هدیه‌ی pcr:u:<حساب>:mobile|email در settings.ts).
 *  فقط ثبت‌های بعد از فعال شدن هدیه شمرده می‌شود؛ شماره/ایمیلی که قبلاً برای حساب دیگری هدیه گرفته بود قفل ندارد و در شمار نمی‌آید. */
async function profileCompletion(env: Env): Promise<{ accounts: number; mobile: number; email: number; both: number }> {
  const d = await db(env);
  const r = await d.prepare(
    "SELECT COUNT(*) a, COALESCE(SUM(m),0) m, COALESCE(SUM(e),0) e, COALESCE(SUM(m*e),0) b FROM (" +
    "SELECT MAX(k LIKE '%:mobile') m, MAX(k LIKE '%:email') e FROM kv WHERE k >= ?1 AND k < ?2 GROUP BY substr(k, 7, length(k) - 6 - CASE WHEN k LIKE '%:mobile' THEN 7 ELSE 6 END))",
  ).bind("pcr:u:", "pcr:u:" + MAXC).first<{ a: number | null; m: number | null; e: number | null; b: number | null }>();
  return { accounts: Number(r?.a ?? 0), mobile: Number(r?.m ?? 0), email: Number(r?.e ?? 0), both: Number(r?.b ?? 0) };
}

/** کل کاربران هر پلتفرم: ۱۳ شمارش با json_extract روی همه‌ی ردیف‌های seen:/wu: (هر بار ~۲٫۵ هزار ردیف × ۱۳)؛ سنگین‌ترین بخش صفحه‌ی اصلی بود
 *  و به صفحه‌ی جدا (دکمه‌ی «👥 آمار کل کاربران») رفت تا فقط وقتی لازم است خوانده شود. */
async function totalsScreen(env: Env): Promise<Screen> {
  const [tgUsers, baleUsers, webUsers, appUsers, rubikaUsers, eitaaUsers, bazaarUsers, myketUsers, chatUsers, iosUsers, pwaIosUsers, pwaOtherUsers, splusUsers] = await Promise.all([
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${SEEN_TG}`, "seen:", "seen:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${SEEN_BALE}`, "seen:", "seen:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${WEB_ONLY} AND ${WEB_NOT_APP}`, "wu:", "wu:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${APP_ANDROID}`, "wu:", "wu:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${SEEN_RUBIKA}`, "seen:", "seen:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${SEEN_EITAA}`, "seen:", "seen:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${APP_BAZAAR}`, "wu:", "wu:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${APP_MYKET}`, "wu:", "wu:" + MAXC),
    supportOverview(env).then((o) => o.users).catch(() => 0),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${APP_IOS}`, "wu:", "wu:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${PWA_IOS}`, "wu:", "wu:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${PWA_OTHER}`, "wu:", "wu:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${SEEN_SPLUS}`, "seen:", "seen:" + MAXC),
  ]);
  const pc = await profileCompletion(env).catch(() => null);
  const wk = await platStats(env, daysIntoWeek() - 1, 0); // کاربران جدید از شنبه تا امروز
  const nu: Record<string, number> = Object.fromEntries(PLATFORMS.map((p) => [p, wk[p].newusers ?? 0]));
  return {
    text:
      "👥 <b>آمار کاربران</b>\n\n" +
      `🆕 <b>کاربران جدید این هفته:</b> ✈️ <b>${fa(nu.tg ?? 0)}</b> · 🟢 <b>${fa(nu.bale ?? 0)}</b> · 🟣 <b>${fa(nu.rubika ?? 0)}</b> · 🟠 <b>${fa(nu.eitaa ?? 0)}</b> · 🔵 <b>${fa(nu.splus ?? 0)}</b> · 🌐 <b>${fa(nu.web ?? 0)}</b> · 📱 بازار <b>${fa(nu.bazaar ?? 0)}</b> · 📱 مایکت <b>${fa(nu.myket ?? 0)}</b> · 📱 اپ قدیمی <b>${fa(nu.app ?? 0)}</b>  <i>(تلگرام · بله · روبیکا · ایتا · سروش‌پلاس · وب · اپ بازار · اپ مایکت · اپ قدیمی)</i>\n` +
      `🍎 <b>جدید این هفته (iOS و PWA):</b> اپ iOS <b>${fa(nu.ios ?? 0)}</b> · 🍏 PWA آیفون/آیپد <b>${fa(nu.pwa_ios ?? 0)}</b> · 📲 PWA بقیه <b>${fa(nu.pwa ?? 0)}</b>\n` +
      (pc ? `🎁 <b>تکمیل پروفایل</b> (بعداً موبایل/ایمیل افزوده‌اند): <b>${fa(pc.accounts)}</b> حساب · 📱 موبایل ${fa(pc.mobile)} · ✉️ ایمیل ${fa(pc.email)} · هر دو ${fa(pc.both)}\n` : "") +
      "\n" +
      `✈️ تلگرام ${fa(tgUsers)} · 🟢 بله ${fa(baleUsers)} · 🟣 روبیکا ${fa(rubikaUsers)} · 🟠 ایتا ${fa(eitaaUsers)} · 🔵 سروش‌پلاس ${fa(splusUsers)} · 🌐 وب ${fa(webUsers)}\n` +
      `📱 اندروید ${fa(appUsers)} (بازار ${fa(bazaarUsers)} · مایکت ${fa(myketUsers)}؛ بقیه از نسخه‌ی قدیمی)\n` +
      `🍎 اپ iOS ${fa(iosUsers)} · 🍏 PWA آیفون/آیپد ${fa(pwaIosUsers)} · 📲 PWA بقیه ${fa(pwaOtherUsers)}\n` +
      `💬 کاربرانِ دارای گفتگو: <b>${fa(chatUsers)}</b>`,
    kb: [[cb("🔄 تازه‌سازی", "ad:tt"), ...backHome]],
  };
}

async function homeScreen(env: Env): Promise<Screen> {
  const [subs, banned, st, payIssues] = await Promise.all([
    activeSubCount(env),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2", "ban:", "ban:" + MAXC),
    statsByDay(env),
    issueCount(env).catch(() => 0),
  ]);
  const n = daysIntoWeek(); // شنبه تا امروز
  const week = await platformReport(env, n, st);
  const range = `${fmtDay(Date.now() - (n - 1) * 86_400_000)} تا ${fmtDay(Date.now())}`;
  return {
    text:
      "🛠 <b>پنل مدیریت</b>\n\n" +
      `👑 پلن فعال: <b>${fa(subs)}</b> · ⛔️ مسدود: <b>${fa(banned)}</b>\n` +
      (payIssues ? `🚨 <b>${fa(payIssues)} پرداخت موفق از درگاه، تاییدنشده</b> ← «💰 پرداخت‌ها»\n` : "") +
      `\n📅 <b>گزارش هفتگی</b> (شنبه تا امروز، ${range})\n${week}\n` +
      "<i>▶️ شروع‌شده · ✅ موفق · ❌ ناموفق · 🆕 کاربر جدید. هفته از شنبه شروع می‌شود.</i>\n\n" +
      "<i>یک بخش را انتخاب کن. برای مدیریت یک کاربر، شناسه یا نامش را در «جستجو» بنویس.</i>",
    kb: [
      [cb("📊 آمار پلتفرم‌ها", "ad:st:7"), cb("👥 کاربران", "ad:us:t:0")],
      [cb("👥 آمار کاربران", "ad:tt")],
      [cb("🔎 جستجوی کاربر", "ad:se"), cb("🗂 ارائه‌های اخیر", "ad:dk")],
      [cb("📣 پیام همگانی", "ad:bc"), cb("👑 پلن‌های فعال", "ad:sb:0")],
      [cb("⛔️ مسدودها", "ad:bn"), cb("⚙️ سیستم", "ad:sy")],
      [cb("💬 پشتیبانی سایت", "ad:sc:r:0"), cb("⭐ نظرات سایت", "ad:rv:0")],
      [cb(`💰 پرداخت‌ها${payIssues ? ` 🚨${fa(payIssues)}` : ""}`, "ad:pm:s:0"), cb("🔻 قیف کاربران", "ad:fn:30"), cb("🎁 دعوت‌ها", "ad:iv:t:0")],
      [cb("📱 اپ اندروید/iOS (نسخه و اعلان)", "ad:ap"), cb("📤 خروجی‌ها", "ad:xo")],
      [cb("🔄 تازه‌سازی", "ad:h"), cb("✖️ بستن", "ad:x")],
    ],
  };
}

/** نظرهای منتشرشده‌ی صفحه‌ی اصلی؛ هر صفحه ۸ نظر با دکمه‌ی حذف (حذف با تایید) */
const RV_PAGE = 8;
async function reviewsScreen(env: Env, page: number, note = ""): Promise<Screen> {
  const list = await listPublicReviews(env);
  const pages = Math.max(1, Math.ceil(list.length / RV_PAGE));
  const p = Math.max(0, Math.min(pages - 1, page));
  const slice = list.slice(p * RV_PAGE, p * RV_PAGE + RV_PAGE);
  const lines = slice.map((v, i) => `<b>${fa(p * RV_PAGE + i + 1)}.</b> ${esc(v.n)} · ${esc(v.s)}${v.r ? ` · ${"★".repeat(v.r)}` : ""}\n<i>«${esc(v.t.slice(0, 90))}${v.t.length > 90 ? "…" : ""}»</i>`);
  const kb: Btn[][] = slice.map((v, i) => [cb(`🗑 ${fa(p * RV_PAGE + i + 1)}. ${v.n.slice(0, 14)} — ${v.t.slice(0, 22)}`, `ad:rc:${v.c}:${p}`)]);
  const nav: Btn[] = [];
  if (p > 0) nav.push(cb("➡️ قبلی", `ad:rv:${p - 1}`));
  if (p < pages - 1) nav.push(cb("بعدی ⬅️", `ad:rv:${p + 1}`));
  if (nav.length) kb.push(nav);
  kb.push(backHome);
  return {
    text: `⭐ <b>نظرات سایت</b> (${fa(list.length)} نظر · صفحه‌ی ${fa(p + 1)} از ${fa(pages)})\n` + (note ? `\n${note}\n` : "") +
      (lines.length ? `\n${lines.join("\n\n")}\n\n<i>برای حذف، دکمه‌ی 🗑 نظر را بزن. تغییر حداکثر تا ۱–۲ ساعت در سایت دیده می‌شود.</i>` : "\nنظری برای نمایش نیست."),
    kb,
  };
}

/** زیرمنوی همه‌ی خروجی‌های فایلی (CSV) پنل */
function exportsScreen(): Screen {
  return {
    text:
      "📤 <b>خروجی‌ها</b>\nهر دکمه یک فایل فایل (Excel یا CSV) به همین چت می‌فرستد.\n\n" +
      "👑 <b>پلن‌داران فعال</b>: همه‌ی کاربرانی که همین حالا پلن فعال دارند، با مشخصات کامل (نام، ایمیل، موبایل، پلتفرم، پلن، اعتبار، انقضا و …)\n" +
      "💳 <b>خریداران پلن</b>: هر کسی که دست‌کم یک‌بار پلن خریده\n" +
      "📧 <b>ایمیل/موبایل</b>: مخاطبان برای کمپین ایمیلی (Resend) و پیامک\n" +
      "📵 <b>فقط‌شماره‌ها</b>: حساب‌هایی که تنها راه ارتباطشان موبایل است",
    kb: [
      [cb("👑 پلن‌داران فعال (مشخصات کامل)", "ad:ea")],
      [cb("💳 خریداران پلن", "ad:eb"), cb("📧 ایمیل/موبایل", "ad:ex")],
      [cb("📵 فقط‌شماره‌ها", "ad:eo")],
      backHome,
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
  const [st, tgUsers, baleUsers, webUsers, subs, bonusSum, bonusUsers, appUsers, rubikaUsers, eitaaUsers, iosUsers, pwaUsers, splusUsers] = await Promise.all([
    statsByDay(env),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${SEEN_TG}`, "seen:", "seen:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${SEEN_BALE}`, "seen:", "seen:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${WEB_ONLY} AND ${WEB_NOT_APP}`, "wu:", "wu:" + MAXC),
    activeSubCount(env),
    count(env, "SELECT SUM(CAST(v AS INTEGER)) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3)", "bonus:", "bonus:" + MAXC, nowSec()),
    count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND CAST(v AS INTEGER) > 0", "bonus:", "bonus:" + MAXC, nowSec()),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${APP_ANDROID}`, "wu:", "wu:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${SEEN_RUBIKA}`, "seen:", "seen:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${SEEN_EITAA}`, "seen:", "seen:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${APP_IOS}`, "wu:", "wu:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${PWA_USER}`, "wu:", "wu:" + MAXC),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${SEEN_SPLUS}`, "seen:", "seen:" + MAXC),
  ]);
  const dates = Array.from({ length: days }, (_, i) => dayStr(i));
  const sum = (n: string) => dates.reduce((a, d) => a + (st[d]?.[n] ?? 0), 0);
  const ok = sum("ok"), fail = sum("fail");
  const rate = ok + fail > 0 ? Math.round((ok / (ok + fail)) * 100) : null;
  const label = days === 1 ? "امروز" : `${fa(days)} روز اخیر`;
  const byPlat = await platformReport(env, days, st);

  // ریز روزانه‌ی ۷ روز اخیر (همیشه)، به همراه نمودار متنی تعداد ارائه‌های موفق
  const last7 = Array.from({ length: 7 }, (_, i) => dayStr(i));
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
      `🆕 کاربر جدید: ${fa(sum("newusers"))} (📱 از اپ اندروید/iOS: ${fa(sum("newapp"))})\n▶️ شروع‌شده: ${fa(sum("started"))}\n✅ موفق: ${fa(ok)}\n❌ ناموفق: ${fa(fail)}` +
      (rate === null ? "" : `\n📈 نرخ موفقیت: ${fa(rate)}٪`) +
      `\n\n<b>به تفکیک پلتفرم — ${label}</b>\n${byPlat}` +
      "\n\n<b>کل</b>\n" +
      `👥 کاربران: ✈️ تلگرام ${fa(tgUsers)} · 🟢 بله ${fa(baleUsers)} · 🟣 روبیکا ${fa(rubikaUsers)} · 🟠 ایتا ${fa(eitaaUsers)} · 🔵 سروش‌پلاس ${fa(splusUsers)} · 🌐 وب ${fa(webUsers)} · 📱 اندروید ${fa(appUsers)} · 🍎 iOS ${fa(iosUsers)} · 📲 PWA ${fa(pwaUsers)}\n` +
      `👑 پلن‌های فعال: ${fa(subs)}\n` +
      `🎁 اعتبار هدیه/شارژِ مصرف‌نشده: ${fa(bonusSum)} (نزد ${fa(bonusUsers)} کاربر)\n\n` +
      "<b>ریز ۷ روز اخیر</b>\n" + daily.join("\n") +
      "\n\n<i>«کاربر جدید» از زمان فعال شدن این قابلیت شمرده می‌شود؛ تفکیک پلتفرم از زمان به‌روزرسانی این قابلیت ثبت می‌شود. آمار روزانه ۴۰۰ روز نگه داشته می‌شود.</i>",
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

type UsersKind = "t" | "b" | "r" | "e" | "s" | "w" | "a" | "i" | "p";
async function usersScreen(env: Env, kind: UsersKind, page: number): Promise<Screen> {
  // دو ردیف سه‌تایی: شش دکمه در یک ردیف روی گوشی‌های باریک (به‌خصوص اندروید/iOS) بریده می‌شود
  const tabBtns: Btn[] = ([["t", "✈️ تلگرام"], ["b", "🟢 بله"], ["r", "🟣 روبیکا"], ["e", "🟠 ایتا"], ["s", "🔵 سروش‌پلاس"], ["w", "🌐 وب"], ["a", "📱 اندروید"], ["i", "🍎 iOS"], ["p", "📲 PWA"]] as const).map(([k, l]) => cb(kind === k ? `• ${l}` : l, `ad:us:${k}:0`));
  const tabs: Btn[][] = [tabBtns.slice(0, 3), tabBtns.slice(3, 6), tabBtns.slice(6, 9)];
  const items: { id: Uid; label: string; line: string }[] = [];
  let total = 0;
  if (kind === "t" || kind === "b" || kind === "r" || kind === "e" || kind === "s") {
    const only = kind === "t" ? SEEN_TG : kind === "r" ? SEEN_RUBIKA : kind === "e" ? SEEN_EITAA : kind === "s" ? SEEN_SPLUS : SEEN_BALE; // شناسه‌های بله از شناسه‌های تلگرام جدا هستند
    total = await count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${only}`, "seen:", "seen:" + MAXC);
    const rs = await rows(env, `SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND ${only} ORDER BY json_extract(v,'$.t') DESC LIMIT ?3 OFFSET ?4`, "seen:", "seen:" + MAXC, PAGE, page * PAGE);
    for (const r of rs) {
      const id = Number(r.k.slice(5)); const v = json<{ t: string; u: string | null; n?: string }>(r.v);
      if (!Number.isSafeInteger(id) || !v) continue;
      items.push({ id, label: v.n || (v.u ? "@" + v.u : String(id)), line: `${userLink(id, v.n, v.u)}${v.u ? ` (@${esc(v.u)})` : ""}\n    🆔 <code>${id}</code> · 🕒 ${fmtTime(v.t)}` });
    }
  } else {
    const only = kind === "a" ? APP_ANDROID : kind === "i" ? APP_IOS : kind === "p" ? PWA_USER : `${WEB_ONLY} AND ${WEB_NOT_APP}`; // «اندروید/iOS» = هر کسی که از اپ بومی استفاده کرده؛ «PWA» = وب‌اپ نصب‌شده؛ «وب» = فقط سایت
    total = await count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${only}`, "wu:", "wu:" + MAXC);
    const rs = await rows(env,
      `SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND ${only} ORDER BY json_extract(v,'$.created') DESC LIMIT ?3 OFFSET ?4`,
      "wu:", "wu:" + MAXC, PAGE, page * PAGE);
    for (const r of rs) {
      const wid = r.k.slice(3); const v = json<{ name?: string; email?: string; mobile?: string; created?: number; app?: boolean; store?: keyof typeof STORE_LABEL; appv?: string; andv?: string; os?: "android" | "ios"; pwa?: string }>(r.v);
      if (!WEB_ID.test(wid) || !v) continue;
      const t = Number(await env.KV.get(`w2tg:${wid}`).catch(() => null));
      const linked = Number.isSafeInteger(t) && t > 0;
      const id: Uid = linked ? t : wid; // وصل‌شده به تلگرام: کارت با شناسه‌ی تلگرام باز می‌شود
      items.push({ id, label: (linked ? "🔗 " : "") + (v.name || v.email || v.mobile || wid), line: `<b>${esc(v.name || "—")}</b> ${v.app ? "📱" : ""}${linked ? "🔗" : "🌐"}\n    ${v.email ? esc(v.email) : v.mobile ? esc(v.mobile) : "—"} · 🕒 ${v.created ? fmtTime(v.created) : "—"}` +
          (kind === "a" || kind === "i" ? `\n    🏬 ${kind === "i" ? "iOS" : v.store ? STORE_LABEL[v.store] ?? esc(String(v.store)) : "فروشگاه نامشخص"}${v.appv ? ` · <code>${esc(v.appv)}</code>` : ""}${v.andv ? ` · <code>${esc(osTag(kind === "i" ? "ios" : "android", v.andv))}</code>` : ""}` : kind === "p" ? `\n    📲 ${v.pwa === "ios" ? "آیفون/آیپد" : "اندروید/دسکتاپ"}` : "") });
    }
  }
  const head = kind === "t" ? "✈️ <b>کاربران تلگرام</b> (جدیدترین اول، به وقت ایران)"
    : kind === "b" ? "🟢 <b>کاربران بله</b> (جدیدترین اول، به وقت ایران)"
    : kind === "r" ? "🟣 <b>کاربران روبیکا</b> (جدیدترین اول، به وقت ایران)"
    : kind === "e" ? "🟠 <b>کاربران ایتا</b> (جدیدترین اول، به وقت ایران)"
    : kind === "s" ? "🔵 <b>کاربران سروش‌پلاس</b> (جدیدترین اول، به وقت ایران)"
    : kind === "a" ? "📱 <b>کاربران اپ اندروید</b> (🔗 = تلگرام هم وصل کرده)"
    : kind === "i" ? "🍎 <b>کاربران اپ iOS</b> (نسخه‌ی اپ و iOS زیر هر نفر؛ 🔗 = تلگرام هم وصل کرده)"
    : kind === "p" ? "📲 <b>کاربران وب‌اپ نصب‌شده (PWA)</b> — Add to Home Screen؛ کسی که اپ بومی هم دارد در تب اپ می‌آید"
    : "🌐 <b>کاربران وب</b> (فقط سایت؛ کاربران اپ در تب 📱 هستند — 🔗 = تلگرام هم وصل کرده)";
  return {
    text: `${head}\nکل: ${fa(total)}\n\n` + (items.length ? items.map((x, i) => `${fa(page * PAGE + i + 1)}. ${x.line}`).join("\n") : "موردی نیست.") + "\n\n<i>برای مدیریت، روی نام کاربر بزن.</i>",
    kb: [
      ...tabs,
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
    (tgId ?? webId) ? env.KV.get(`ref:${tgId ?? webId}`).catch(() => null) : Promise.resolve(null), // حساب فقط‌وب/اپ با شناسه‌ی وبش شمرده می‌شود (referral.ts ← refIdOf)
    (tgId ?? webId) ? env.KV.get(`refc:${tgId ?? webId}`).catch(() => null) : Promise.resolve(null),
  ]);
  const banned = bannedTg || bannedWeb;
  const admin = tgId ? isAdmin(env, tgId) : false;
  const name = seen?.n || web?.name || "";
  const planName = sub ? (PLANS.find((p) => p.id === sub.plan)?.name ?? sub.plan) : null;
  const subActive = !!sub && sub.credits > 0;
  const creditLine = c.unlimited ? "نامحدود (مدیر)" : `${fa(c.total)} (پلن ${fa(c.plan)} + هدیه/شارژ ${fa(c.bonus)})`;
  const caps = admin ? `${fa(ABS_MAX_SLIDES)} اسلاید · ${fa(ABS_MAX_IMAGES)} تصویر` : subActive
    ? `${fa(PLAN_MAX_SLIDES[sub!.plan] ?? FREE_MAX_SLIDES)} اسلاید · ${fa(PLAN_MAX_IMAGES[sub!.plan] ?? FREE_MAX_IMAGES)} تصویر`
    : `${fa(FREE_MAX_SLIDES)} اسلاید · ${fa(FREE_MAX_IMAGES)} تصویر`;

  const lines = [
    `👤 <b>${tgId ? userLink(tgId, name || "باز کردن پروفایل", seen?.u) : esc(name || "—")}</b>${admin ? " 👮 مدیر" : ""}`,
    tgId ? `🆔 ${isSplusId(tgId) ? "سروش‌پلاس" : isEitaaId(tgId) ? "ایتا" : isRubikaId(tgId) ? "روبیکا" : isBaleId(tgId) ? "بله" : "تلگرام"}: <code>${tgId}</code>${seen?.u ? ` · @${esc(seen.u)}` : ""}` : "🆔 تلگرام: وصل نشده",
    webId ? `🌐 پروفایل وب: <code>${webId}</code>` : "",
    web?.email ? `✉️ ایمیل: ${esc(web.email)}` : "",
    web?.mobile ? `📞 موبایل: ${esc(web.mobile)}` : "",
    web?.app ? `📱 منبع: اپ ${web.os === "ios" ? "iOS" : "اندروید"}${web.store ? ` ${STORE_LABEL[web.store]}` : ""}${web.via === "app" ? " (ثبت‌نام از اپ)" : " (ثبت‌نام از وب، از اپ هم وارد شده)"}` : web?.pwa ? `📲 منبع: وب‌اپ نصب‌شده (PWA ${web.pwa === "ios" ? "آیفون/آیپد" : "اندروید/دسکتاپ"})` : "",
    web?.app && (web.appv || web.andv) ? `📲 نسخه‌ی اپ: <code>${esc(web.appv ?? "—")}</code> · ${web.os === "ios" ? "iOS" : "اندروید"}: <code>${esc(web.andv ?? "—")}</code>` : "",
    seen ? `🕒 اولین پیام: ${fmtTime(seen.t)}` : web ? `🕒 ثبت‌نام: ${fmtTime(web.created)}` : "",
    "",
    `💳 اعتبار: <b>${creditLine}</b>`,
    sub ? `👑 پلن ${esc(planName ?? "")}: ${subActive ? "فعال" : "بدون اعتبار"} تا ${fmtDay(sub.exp)}${sub.credits ? ` · ${fa(sub.credits)} اعتبار` : ""}` : "👑 پلن: رایگان",
    `📄 سقف هر ارائه: ${caps}`,
    `📁 فایل‌های ۲۴ ساعت اخیر: ${fa(files.length)}`,
    (tgId ?? webId) && (refBy || refCount) ? `🎁 دعوت: ${refCount ? `${fa(refCount)} نفر را دعوت کرده` : ""}${refBy && refCount ? " · " : ""}${refBy ? `دعوت‌شده‌ی ${refBy}` : ""}` : "",
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
  if (webId) row3.push(cb("💬 گفتگوی پشتیبانی", `ad:sv:${webId}:999`));
  if (job.busy) row3.push(cb("🔓 آزاد کردن قفل", `ad:ul:${key}`));
  kb.push(row3);
  kb.push([cb("🔄 تازه‌سازی", `ad:u:${key}`), ...backHome]);
  return { text, kb };
}

// ---------- پشتیبانی سایت (چت هوشمند): آمار به ازای کاربر + نمایش کل گفتگو ----------
async function supportScreen(env: Env, mode: "r" | "n", page: number): Promise<Screen> {
  const [ov, list] = await Promise.all([supportOverview(env), supportUsers(env, mode, page, PAGE)]);
  const lines: string[] = [];
  const btns: Btn[][] = [];
  for (let i = 0; i < list.items.length; i++) {
    const { uid, st } = list.items[i];
    const u = await getUserById(env, uid).catch(() => null);
    const label = u?.name || u?.email || u?.mobile || uid;
    const num = fa(page * PAGE + i + 1);
    lines.push(`${num}. <b>${esc(label)}</b>${u?.email && u.name ? ` · ${esc(u.email)}` : ""}\n    💬 <b>${fa(st.n)}</b> پیام${st.f ? ` · 📨 ${fa(st.f)} ارجاع` : ""} · 🕒 ${fmtTime(st.t)}`);
    btns.push([cb(`${num}. ${label.slice(0, 28)} (${fa(st.n)})`, `ad:sv:${uid}:999`)]);
  }
  return {
    text:
      "💬 <b>پشتیبانی سایت (چت هوشمند)</b>\n\n" +
      `👥 کاربرانِ دارای گفتگو: <b>${fa(ov.users)}</b>\n` +
      `✉️ کل پیام‌های کاربران: <b>${fa(ov.msgs)}</b> · 📨 ارجاع به مدیر: <b>${fa(ov.refs)}</b>\n` +
      `📅 پیام‌های امروز: <b>${fa(ov.today)}</b> <i>(سقف هر کاربر در روز: ${fa(DAILY_LIMIT)})</i>\n\n` +
      `<b>${mode === "n" ? "بیشترین پیام" : "آخرین فعالیت"}</b>\n` +
      (lines.length ? lines.join("\n") : "هنوز گفتگویی ثبت نشده است.") +
      "\n\n<i>روی نام هر کاربر بزن تا کل گفتگویش را ببینی.</i>",
    kb: [
      [cb(mode === "r" ? "• 🕒 آخرین فعالیت" : "🕒 آخرین فعالیت", "ad:sc:r:0"), cb(mode === "n" ? "• 🔢 بیشترین پیام" : "🔢 بیشترین پیام", "ad:sc:n:0")],
      ...btns,
      pager(`ad:sc:${mode}`, page, (page + 1) * PAGE < list.total),
      [cb("🔄 تازه‌سازی", `ad:sc:${mode}:${page}`), ...backHome],
    ].filter((r) => r.length),
  };
}

/** کل گفتگوی یک کاربر؛ چون پیام تلگرام محدود است صفحه‌صفحه (قدیمی ← جدید) نمایش داده می‌شود. page بزرگ = آخرین صفحه */
async function supportConvScreen(env: Env, uid: string, page: number): Promise<Screen> {
  const [conv, u] = await Promise.all([loadSupportConv(env, uid), getUserById(env, uid).catch(() => null)]);
  const who = `${esc(u?.name || u?.email || u?.mobile || uid)}${u?.email && u.name ? ` · ${esc(u.email)}` : ""}${u?.mobile ? ` · ${esc(u.mobile)}` : ""}`;
  const back: Btn[] = [cb("🔙 فهرست پشتیبانی", "ad:sc:r:0"), cb("👤 کارت کاربر", `ad:u:${uid}`)];
  if (!conv || !conv.m.length) return { text: `💬 <b>گفتگوی پشتیبانی</b>\n👤 ${who}\n\nگفتگویی ثبت نشده یا منقضی شده است.`, kb: [back, backHome] };
  const blocks = conv.m.map((x) => {
    const head = x.r === "u" ? "👤 <b>کاربر</b>" : x.r === "m" ? "👨‍💼 <b>پشتیبان (ادمین)</b>" : x.f ? "🤖 <b>دستیار</b> 📨 <i>ارجاع‌شده</i>" : "🤖 <b>دستیار</b>";
    return `${head} · <i>${fmtTime(x.ts)}</i>\n${esc(x.t.slice(0, 1600))}`;
  });
  const pages: string[][] = [[]];
  let size = 0;
  for (const b of blocks) {
    if (size + b.length > 3200 && pages[pages.length - 1].length) { pages.push([]); size = 0; }
    pages[pages.length - 1].push(b); size += b.length + 2;
  }
  const p = Math.max(0, Math.min(pages.length - 1, page));
  const nav: Btn[] = [];
  if (p > 0) nav.push(cb("◀️ قدیمی‌تر", `ad:sv:${uid}:${p - 1}`));
  if (p < pages.length - 1) nav.push(cb("جدیدتر ▶️", `ad:sv:${uid}:${p + 1}`));
  return {
    text:
      `💬 <b>گفتگوی پشتیبانی</b>\n👤 ${who}\n🆔 <code>${esc(uid)}</code>\n` +
      `✉️ ${fa(conv.m.filter((x) => x.r === "u").length)} پیام کاربر · ${fa(conv.m.length)} پیام کل · صفحه ${fa(p + 1)} از ${fa(pages.length)}\n` +
      `──────────\n${pages[p].join("\n\n")}`,
    kb: [nav, [cb("✍️ پاسخ در چت", `ad:sr:${uid}`)], back, [cb("🔄 تازه‌سازی", `ad:sv:${uid}:${p}`), ...backHome]].filter((r) => r.length),
  };
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
    `✅ دعوت موفق: <b>${fa(total)}</b> (هر ${fa(REF_EVERY)} دعوت = ${fa(REF_CREDITS)} اعتبار معمولی برای دعوت‌کننده)\n` +
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
      kb: [tabs, ...list.map((x, i) => [cb(`${fa(page * PAGE + i + 1)}. ${x.label.slice(0, 40)}`, `ad:u:${x.id}`)]), pager("ad:iv:t", page, (page + 1) * PAGE < inviters), [cb("🔄 تازه‌سازی", `ad:iv:${tab}:${page}`), ...backHome],
      [cb("🔁 تسویه‌ی دعوت‌های قبلی", "ad:iv:m:0")]].filter((r) => r.length),
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
    kb: [tabs, ...list.map((x) => [cb(`👤 ${x.gl.slice(0, 18)}`, `ad:u:${x.guest}`), cb(`🎁 ${x.hl.slice(0, 18)}`, `ad:u:${x.host}`)]), pager("ad:iv:r", page, (page + 1) * PAGE < total), [cb("🔄 تازه‌سازی", `ad:iv:${tab}:${page}`), ...backHome],
      [cb("🔁 تسویه‌ی دعوت‌های قبلی", "ad:iv:m:0")]].filter((r) => r.length),
  };
}

// ---------- گزارش پرداخت و درآمد ----------
// رکوردهای pay:<سفارش> (payment.ts): pending ← paid | failed. پرداخت‌های تاییدشده ۸۴ روز، بقیه ۱۴ روز می‌مانند؛ برای تاریخچه‌ی بلندتر
// فروش هر روز (به وقت ایران) در rv:<روز> = {n, a} هم جمع می‌شود. issue = کاربر از درگاه «موفق» برگشته ولی تایید نشده (پول ممکن است کسر شده باشد).
interface PayRow { order: string; uid: string; plan: string | null; amount: number; toman: number; count: number; state: string; t: number; ref: string | null; issue: string | null }
const money = (n: number) => fa(Math.round(n).toLocaleString("en-US").replace(/,/g, "٬"));
const pct = (a: number, b: number) => (b > 0 ? `${fa(Math.round((a / b) * 100))}٪` : "—");
const tehranDay = (t: number) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Asia/Tehran" });
const planLabel = (id: string | null) => (id ? (PLANS.find((p) => p.id === id)?.name ?? id) : "بسته‌ی اعتباری");
/** مبلغ به تومان: همان مبلغی که هنگام خرید ثبت شده (toman؛ رکوردهای قدیمی‌تر: مبلغ ریالی/۱۰)، نه قیمتِ فعلیِ پلن که با تغییر قیمت عوض می‌شود.
 *  فقط اگر هیچ مبلغی ثبت نبود (amount=0) به قیمت فعلی پلن برمی‌گردد. */
const tomanOf = (r: PayRow) => (r.toman > 0 ? r.toman : r.amount > 0 ? Math.round(r.amount / 10) : (PLANS.find((x) => x.id === r.plan)?.price ?? 0) * 1000);
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
  : i.startsWith("verify:") ? `تایید پرداخت رد شد (کد ${esc(i.slice(7))})`
  : i.startsWith("bz:") ? `تایید خرید کافه‌بازار رد شد (${esc(i.slice(3))})` : i.startsWith("mk:") ? `تایید خرید مایکت رد شد (${esc(i.slice(3))})`
  : i.startsWith("app:") ? `خطای سمت اپ (${esc(i.slice(4))})` : esc(i);

async function issueCount(env: Env): Promise<number> {
  return count(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND json_extract(v,'$.state')='pending' AND json_extract(v,'$.issue') IS NOT NULL", "pay:", "pay:" + MAXC, nowSec());
}

async function loadPayments(env: Env): Promise<PayRow[]> {
  const d = await db(env);
  const rs = (await d.prepare(
    "SELECT k, json_extract(v,'$.uid') uid, json_extract(v,'$.plan') plan, json_extract(v,'$.amount') amount, json_extract(v,'$.toman') toman, json_extract(v,'$.count') cnt, json_extract(v,'$.state') state, json_extract(v,'$.t') t, json_extract(v,'$.ref') ref, json_extract(v,'$.issue') issue " +
    "FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) ORDER BY json_extract(v,'$.t') DESC LIMIT 3000")
    .bind("pay:", "pay:" + MAXC, nowSec()).all<{ k: string; uid: string; plan: string | null; amount: number; toman: number | null; cnt: number | null; state: string; t: number; ref: string | null; issue: string | null }>()).results ?? [];
  return rs.map((r) => ({ order: r.k.slice(4), uid: String(r.uid ?? ""), plan: r.plan ?? null, amount: Number(r.amount) || 0, toman: Number(r.toman) || 0, count: Number(r.cnt) || 0, state: String(r.state), t: Number(r.t) || 0, ref: r.ref ?? null, issue: r.issue ?? null }));
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
  // فقط به ترتیب زمان (جدیدترین اول)؛ نوع مشکل با آیکون هر ردیف و شمارنده‌ی «فوری» در خلاصه مشخص است
  return out.sort((a, b) => b.r.t - a.r.t);
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
        `    👤 ${esc(who.label)}${kind ? `\n    ↳ ${ATTN_TXT[kind]}${(kind === "issue" || (kind === "failed" && r.issue)) ? ` — ${ISSUE_TXT(r.issue)}` : ""}` : ""}\n` +
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
        `🔌 درگاه‌های پرداخت: ${payGateways(env).map((g) => g.name).join("، ") || "❌ غیرفعال (متغیرها تنظیم نشده)"}\n` +
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
    if (typeof uid === "number") return isSplusId(uid) ? "🔵 سروش‌پلاسی" : isEitaaId(uid) ? "🟠 ایتایی" : isRubikaId(uid) ? "🟣 روبیکایی" : isBaleId(uid) ? "🟢 بله‌ای" : "✈️ تلگرامی";
    const w = await getUserById(env, uid).catch(() => null);
    if (!w || !(w.email || w.mobile || w.google)) return "✈️ تلگرامی";
    const linked = Number(await env.KV.get(`w2tg:${uid}`).catch(() => null)) > 0;
    return (linked ? "🌐 وبی 🔗" : "🌐 وبی") + (w.app ? " 📱" : "");
  };
  const kinds = new Map<string, string>();
  // رکوردهای جدید پلتفرم خودِ ارائه را دارند (x.p)؛ فقط رکوردهای قدیمی از روی نوع حساب حدس زده می‌شوند
  for (const x of list) if (!x.p && !kinds.has(String(x.userId))) kinds.set(String(x.userId), await kindOf(x.userId));
  const platTag = (x: DeckLog, kind?: string) => {
    if (!x.p || !isPlatform(x.p)) return kind ?? "—";
    const dev = x.av || x.an ? ` <code>${esc(x.av ?? "")}${x.an ? `${x.av ? " · " : ""}${esc(osTag(x.p?.startsWith("ios") ? "ios" : "android", x.an))}` : ""}</code>` : "";
    return PLAT_LABEL[x.p] + dev;
  };
  const lines = list.map((x, i) =>
    `${fa(i + 1)}. <b>${esc(x.title.slice(0, 60))}</b> (${fa(x.slides)} اسلاید)\n` +
    `    👤 ${typeof x.userId === "number" ? userLink(x.userId, x.n, x.u) : `<b>${esc(x.n || String(x.userId))}</b>`}` +
    ` · ${platTag(x, kinds.get(String(x.userId)))} · <code>${x.userId}</code> · 🕒 ${fmtTime(x.t)}` +
    (x.o ? `\n    ✍️ <i>${esc(x.o.slice(0, 120))}</i>` : ""));
  // فایل‌ها فقط ۲۴ ساعت (و حداکثر ۹ فایل آخر هر کاربر؛ پلاس ۱۸ و پرو ۳۰) نگه داشته می‌شوند؛ برای قدیمی‌تر دکمه‌ی دریافت نمی‌گذاریم
  const fresh = Date.now() - 24 * 3600 * 1000;
  const kb: Btn[][] = list
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => x.t > fresh)
    .map(({ x, i }) => [cb(`📥 ${fa(i + 1)}. ${x.title.slice(0, 40)}`, `af:${x.userId}:${x.id}`)]);
  kb.push([cb("🔄 تازه‌سازی", "ad:dk"), ...backHome]);
  return { text: `🗂 <b>${fa(list.length)} ارائه‌ی اخیر</b> (به وقت ایران)\n\n${lines.join("\n")}\n\n<i>دکمه‌ی 📥 فقط برای فایل‌های ۲۴ ساعت اخیر است.</i>`, kb };
}

// ---------- اپ اندروید: نسخه و اعلان (جایگزین دستورهای /appver و /apppush) ----------
async function appScreen(env: Env, head = ""): Promise<Screen> {
  const [ver, dev, v, iosN, pwaI, pwaO] = await Promise.all([
    appVerText(env), pushDeviceCounts(env).catch(() => null), getAppVersions(env),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${APP_IOS}`, "wu:", "wu:" + MAXC).catch(() => 0),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${PWA_IOS}`, "wu:", "wu:" + MAXC).catch(() => 0),
    count(env, `SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND ${PWA_OTHER}`, "wu:", "wu:" + MAXC).catch(() => 0),
  ]);
  const iosInfo = `🍎 <b>اپ iOS</b>: ${fa(iosN)} کاربر\n📲 <b>PWA</b>: آیفون/آیپد ${fa(pwaI)} · بقیه ${fa(pwaO)}\n<i>نسخه‌ی اجباری/پیشنهادی و اعلان فعلاً فقط برای اندروید است؛ کاربران و نسخه‌ی iOS در تب «🍎 iOS» پنل کاربران و کارت هر کاربر دیده می‌شود.</i>`;
  const wpc = webPushEnabled(env) ? await webPushCounts(env).catch(() => null) : null;
  const push = pushEnabled(env)
    ? `✅ فعال${dev ? ` · دستگاه با اعلان روشن: <b>${fa(dev.on)}</b> · خاموش: ${fa(dev.off)}` : ""}`
    : "❌ غیرفعال (رمز <code>FCM_SERVICE_ACCOUNT</code> تنظیم نشده)";
  const kb: Btn[][] = [
    STORES.map((s) => cb(`✏️ نسخه‌ی ${STORE_NAMES[s]}`, `ad:av:e:${s}`)),
    [cb("✏️ نسخه‌ی هر دو فروشگاه", "ad:av:e:all")],
  ];
  const manual = STORES.filter((s) => v.stores[s].manual);
  if (manual.length) kb.push(manual.map((s) => cb(`🧹 ${STORE_NAMES[s]}: برگشت به متغیر محیطی`, `ad:av:c:${s}`)));
  kb.push([cb("📲 ارسال اعلان به اپ", "ad:pu"), cb("🔔 پوش وب", "ad:wq")]);
  kb.push([cb("🔄 تازه‌سازی", "ad:ap"), ...backHome]);
  const wpLine = webPushEnabled(env) ? `🔔 <b>پوش وب</b>: ✅ فعال${wpc ? ` · مشترک: <b>${fa(wpc.accounts)}</b> حساب · ${fa(wpc.devices)} دستگاه` : ""}` : "🔔 <b>پوش وب</b>: ❌ غیرفعال (کلیدهای VAPID تنظیم نشده)";
  return { text: `${head ? head + "\n\n" : ""}${ver}\n\n📲 <b>اعلان به اپ</b>: ${push}\n${wpLine}\n\n${iosInfo}`, kb };
}

async function pushScreen(env: Env, chatId: number, head = ""): Promise<Screen> {
  const back = [cb("🔙 اپ اندروید", "ad:ap"), ...backHome];
  const top = head ? head + "\n\n" : "";
  if (!pushEnabled(env)) return { text: `${top}⚠️ اعلان اپ فعال نیست: رمز <code>FCM_SERVICE_ACCOUNT</code> تنظیم نشده است.`, kb: [back] };
  const draft = await getPushDraft(env, chatId);
  if (!draft) {
    return {
      text: `${top}📲 <b>اعلان به اپ اندروید</b>\n\nپیش‌نویسی نیست. با «✍️ نوشتن اعلان» متن را بنویس؛ بعد پیش‌نمایش را می‌بینی، گروه مخاطب را انتخاب می‌کنی و با دکمه تایید می‌کنی.`,
      kb: [[cb("✍️ نوشتن اعلان", "ad:pw")], back],
    };
  }
  const seg = await getPushSegment(env, chatId);
  const chip = (x: keyof typeof PUSH_SEGMENTS) => cb(`${x === seg ? "• " : ""}${PUSH_SEGMENTS[x]}`.slice(0, 60), `ad:pa:${x}`);
  return {
    text: `${top}📲 <b>پیش‌نمایش اعلان</b>\n\n${pushPreviewText(draft)}\n\n— — —\n🎯 مخاطبان: <b>${esc(PUSH_SEGMENTS[seg])}</b>\n<i>فقط دستگاه‌هایی که اعلان تبلیغاتی را روشن دارند.</i>`,
    kb: [[chip("all")], [chip("nocredit")], [chip("expiring")], [chip("inactive")], [cb("✅ ارسال", "ad:ps"), cb("✍️ نوشتن دوباره", "ad:pw")], [cb("🗑 حذف پیش‌نویس", "ad:pc")], back],
  };
}

// ---------- پوش وب (PWA/مرورگر): شمارنده و ارسال همگانی ----------
const wpDraftKey = (chatId: number) => `webpush:draft:${chatId}`;
async function webPushScreen(env: Env, chatId: number, head = ""): Promise<Screen> {
  const top = head ? head + "\n\n" : "";
  const back = [cb("🔙 اپ اندروید/iOS", "ad:ap"), ...backHome];
  if (!webPushEnabled(env)) return { text: `${top}⚠️ پوش وب فعال نیست: <code>VAPID_PUBLIC_KEY</code> و <code>VAPID_PRIVATE_KEY</code> تنظیم نشده‌اند (ساخت: <code>npx tsx scripts/vapid-keys.ts</code>).`, kb: [back] };
  const c = await webPushCounts(env).catch(() => null);
  const stat = c ? `👥 مشترک: <b>${fa(c.accounts)}</b> حساب · ${fa(c.devices)} دستگاه` : "👥 شمارش مشترک‌ها ممکن نشد.";
  const raw = await env.KV.get(wpDraftKey(chatId)).catch(() => null);
  const draft = raw ? parsePushDraft(raw) : null;
  if (!draft) {
    return { text: `${top}🔔 <b>پوش وب</b>\n${stat}\n\nپیش‌نویسی نیست. با «✍️ نوشتن» متن را بنویس؛ پیش‌نمایش را می‌بینی و با دکمه تایید می‌کنی.\n<i>به همه‌ی حساب‌های دارای اشتراک (تا ۳ دستگاه‌ی تازه‌تر هر حساب) فرستاده می‌شود.</i>`, kb: [[cb("✍️ نوشتن پوش", "ad:ww")], [cb("🔄 تازه‌سازی", "ad:wq")], back] };
  }
  return { text: `${top}🔔 <b>پیش‌نمایش پوش وب</b>\n${stat}\n\n${pushPreviewText(draft)}\n\n— — —\n🎯 مخاطبان: همه‌ی مشترک‌ها`, kb: [[cb(`✅ ارسال به ${c ? fa(c.accounts) : ""} حساب`, "ad:ws"), cb("✍️ نوشتن دوباره", "ad:ww")], [cb("🗑 حذف پیش‌نویس", "ad:wc")], back] };
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
  const customN = models.filter((m) => m.custom).length;
  const [info, rowsN, filesN] = await Promise.all([
    tg<any>(env, "getWebhookInfo").catch(() => null),
    count(env, "SELECT COUNT(*) c FROM kv"),
    Promise.resolve(0),
  ]);
  void filesN;
  const hookErr = info?.last_error_message
    ? `\n⚠️ آخرین خطای وب‌هوک: <code>${esc(String(info.last_error_message).slice(0, 120))}</code>${info.last_error_date ? ` (${fmtTime(info.last_error_date * 1000)})` : ""}`
    : "";
  const admins = adminIds(env).length;
  const restricted = (env.ALLOWED_USER_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean).length;
  return {
    text:
      "⚙️ <b>وضعیت سیستم</b>\n\n" +
      `🤖 مدل‌ها (${fa(models.length)}): ${models.slice(0, 6).map((m) => esc(m.name) + (m.extra ? (m.free ? "🆓" : "⭐") : "")).join("، ") || "⚠️ هیچ مدلی تنظیم نشده"}${models.length > 6 ? "…" : ""}\n` +
      `${ok(hasKey(env))} کلید مدل زبانی · ${ok(env.EXTRA_LLM_API_KEY && env.EXTRA_LLM_BASE_URL)} ارائه‌دهنده‌ی دوم · ${ok(customN)} CUSTOM_LLM_MODELS (${fa(customN)} مدل${env.CUSTOM_LLM_MODELS && !customN ? "؛ ⚠️ JSON/مدل نامعتبر، لاگ را ببین" : ""})\n` +
      `${ok(env.AI)} تولید تصویر (Workers AI) · ${ok(env.PEXELS_API_KEY)} Pexels\n` +
      `${ok((env.WEB_SEARCH ?? "").toLowerCase() !== "off")} جستجوی وب · ${ok(tavilyKeys(env).length)} Tavily${tavilyKeys(env).length > 1 ? ` (${fa(tavilyKeys(env).length)} کلید)` : ""}\n` +
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
    text: `📣 <b>پیش‌نمایش پیام همگانی</b>\n\n${esc(body)}\n\n— — —\n🎯 مخاطبان: <b>${AUDIENCES[aud]}</b> — حدود ${fa(n)} کاربر از همه‌ی پیام‌رسان‌ها: تلگرام، بله، روبیکا و ایتا (مسدودها حذف می‌شوند)`,
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
/** در بله، baleWording هر «تلگرام» را «بله» می‌کند؛ در پنل مدیریت (برچسب تب‌ها و آمار پلتفرم‌ها) این واژه باید بماند ← یک نیم‌فاصله وسطش می‌گذاریم */
const keepTg = (t: string) => t.replace(/تلگرام/g, "تل\u200Cگرام");
const forChat = (chatId: number, s: Screen): Screen =>
  isBaleId(chatId) ? { text: keepTg(s.text), kb: s.kb.map((r) => r.map((b) => ({ ...b, text: keepTg(b.text) }))) } : s;
/** سقف پیام تلگرام ۴۰۹۶ نویسه است و متن بلندتر با «message is too long» رد می‌شود (دکمه‌ی پنل بی‌پاسخ می‌ماند).
 *  برش در مرز خط انجام می‌شود تا تگ HTML نیمه‌باز نماند (در همه‌ی صفحه‌ها هر خط تگ‌هایش را خودش می‌بندد). */
const fit = (t: string, max = 3900): string => {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const nl = cut.lastIndexOf("\n");
  return (nl > max / 2 ? cut.slice(0, nl) : cut.slice(0, cut.lastIndexOf(" "))) + "\n…";
};
const sendScreen = (env: Env, chatId: number, s0: Screen) => { const s = forChat(chatId, s0); return sendMessage(env, chatId, fit(s.text), toMarkup(s)); };

// ---------- دستورهای متنی ----------
export async function handleAdmin(env: Env, chatId: number, cmd: string, _args: string[], _raw = "", adminId = chatId) {
  if (isRubikaId(adminId) || isEitaaId(adminId) || isSplusId(adminId)) return; // پنل مدیریت فقط در تلگرام و بله است
  await clearInput(env, adminId).catch(() => {});
  if (cmd === "/cancel") return sendMessage(env, chatId, "✅ لغو شد.");
  if (cmd === "/samples") return sendSamples(env, chatId);
  return sendScreen(env, chatId, await homeScreen(env)); // /admin و /panel
}

// ---------- ورودی متنی منتظر ----------
/** اگر مدیر قبلاً از پنل چیزی خواسته (جستجو، مقدار، متن)، این پیامش همان ورودی است. true = مصرف شد */
export async function handleAdminInput(env: Env, chatId: number, adminId: number, text: string): Promise<boolean> {
  if (isRubikaId(adminId) || isEitaaId(adminId) || isSplusId(adminId)) return false; // پنل مدیریت فقط در تلگرام و بله است
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

  if (p.k === "sr") {
    if (text.length > ADMIN_REPLY_MAX) { await setInput(env, adminId, p); await sendMessage(env, chatId, `پاسخ بلند است (${fa(text.length)} نویسه؛ حداکثر ${fa(ADMIN_REPLY_MAX)}). کوتاه‌تر بفرست، یا /cancel.`); return true; }
    if (!(await addAdminReply(env, p.uid, text))) { await sendMessage(env, chatId, "⚠️ گفتگوی این کاربر پیدا نشد (ممکن است منقضی شده باشد)."); return true; }
    const pushed = await notifyUserOfReply(env, p.uid, text);
    await logAction(env, adminId, `پاسخ در چت پشتیبانی ${p.uid}`);
    await sendScreen(env, chatId, { text: `✅ پاسخ در چت کاربر ثبت شد و همان‌جا دیده می‌شود.${pushed ? "\n📩 در پیام‌رسانِ وصل‌شده‌ی کاربر هم فرستاده شد." : ""}`, kb: [[cb("💬 گفتگو", `ad:sv:${p.uid}:999`), ...backHome]] });
    return true;
  }

  if (p.k === "ver") {
    const r = await applyAppVer(env, p.s, toEn(text).trim().toLowerCase().split(/\s+/).filter(Boolean));
    if (!r.ok) { await setInput(env, adminId, p); await sendMessage(env, chatId, `${r.msg}\n\nدوباره بفرست، یا /cancel.`); return true; }
    await logAction(env, adminId, `نسخه‌ی اپ (${p.s === "all" ? "هر دو" : STORE_NAMES[p.s]}): ${text.trim().slice(0, 40)}`);
    await sendScreen(env, chatId, await appScreen(env, r.msg));
    return true;
  }

  if (p.k === "pushw") {
    const msg = parsePushDraft(text);
    const again = async (why: string) => { await setInput(env, adminId, p); await sendMessage(env, chatId, `${why}\n\nدوباره بفرست، یا /cancel.`); return true; };
    if (!msg) return await again("قالب درست نیست. به این شکل بفرست:\n<code>عنوان | متن | لینک https (اختیاری)</code>");
    if (msg.title.length > PUSH_TITLE_MAX) return await again(`عنوان بلند است (${fa(msg.title.length)} نویسه؛ حداکثر ${fa(PUSH_TITLE_MAX)}).`);
    if (msg.body.length > PUSH_BODY_MAX) return await again(`متن بلند است (${fa(msg.body.length)} نویسه؛ حداکثر ${fa(PUSH_BODY_MAX)}).`);
    await savePushDraft(env, chatId, msg);
    await setPushSegment(env, chatId, "all");
    await sendScreen(env, chatId, await pushScreen(env, chatId));
    return true;
  }

  if (p.k === "wpushw") {
    const msg = parsePushDraft(text);
    const again = async (why: string) => { await setInput(env, adminId, p); await sendMessage(env, chatId, `${why}\n\nدوباره بفرست، یا /cancel.`); return true; };
    if (!msg) return await again("قالب درست نیست. به این شکل بفرست:\n<code>عنوان | متن | لینک https (اختیاری)</code>");
    if (msg.title.length > PUSH_TITLE_MAX) return await again(`عنوان بلند است (${fa(msg.title.length)} نویسه؛ حداکثر ${fa(PUSH_TITLE_MAX)}).`);
    if (msg.body.length > PUSH_BODY_MAX) return await again(`متن بلند است (${fa(msg.body.length)} نویسه؛ حداکثر ${fa(PUSH_BODY_MAX)}).`);
    await env.KV.put(wpDraftKey(chatId), JSON.stringify(msg), { expirationTtl: 3600 });
    await sendScreen(env, chatId, await webPushScreen(env, chatId));
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
  if (!isAdmin(env, adminId) || isRubikaId(adminId) || isEitaaId(adminId) || isSplusId(adminId)) return await answer(); // پنل مدیریت فقط در تلگرام و بله است

  const [, a, b, c] = String(cq.data ?? "").split(":");
  const show = async (s0: Screen) => { const s = forChat(chatId, s0); await answer(); await editMessage(env, chatId, mid, fit(s.text), toMarkup(s)); };
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
      case "rv": return await show(await reviewsScreen(env, Math.max(0, Math.min(50, Number(b) || 0))));
      case "rc": {
        const rc = Number(b), pg = Math.max(0, Math.min(50, Number(c) || 0));
        const v = (await listPublicReviews(env)).find((x) => x.c === rc);
        if (!v) return await show(await reviewsScreen(env, pg, "این نظر دیگر نیست."));
        return await show({
          text: `🗑 <b>حذف این نظر از سایت؟</b>\n\n${esc(v.n)} · ${esc(v.s)}${v.r ? ` · ${"★".repeat(v.r)}` : ""}\n<i>«${esc(v.t)}»</i>`,
          kb: [[cb("✅ بله، حذف شود", `ad:rd:${rc}:${pg}`), cb("↩️ انصراف", `ad:rv:${pg}`)]],
        });
      }
      case "rd": {
        const rc = Number(b), pg = Math.max(0, Math.min(50, Number(c) || 0));
        const ok = await removePublicReview(env, rc);
        if (ok) await logAction(env, adminId, `حذف نظر سایت ${rc}`);
        return await show(await reviewsScreen(env, pg, ok ? "🗑 نظر از سایت حذف شد." : "این نظر پیدا نشد یا قبلاً حذف شده است."));
      }
      case "tt": return await show(await totalsScreen(env));
      case "st": return await show(await statsScreen(env, [1, 7, 30].includes(Number(b)) ? Number(b) : 7));
      case "us": return await show(await usersScreen(env, b === "w" || b === "b" || b === "r" || b === "e" || b === "s" || b === "a" || b === "i" || b === "p" ? b : "t", Math.max(0, Math.min(2000, Number(c) || 0))));
      case "sc": return await show(await supportScreen(env, b === "n" ? "n" : "r", Math.max(0, Math.min(2000, Number(c) || 0))));
      case "sb": return await show(await subsScreen(env, Math.max(0, Math.min(2000, Number(b) || 0))));
      case "bn": return await show(await bannedScreen(env));
      case "dk": return await show(await decksScreen(env));
      case "pm": return await show(await paymentScreen(env, b === "l" ? "l" : b === "p" ? "p" : "s", Math.max(0, Math.min(2000, Number(c) || 0))));
      case "fn": return await show(await funnelScreen(env, [7, 30, 90, 0].includes(Number(b)) ? Number(b) : 30));
      case "mo": return await show(await monthlyScreen(env));
      case "iv": {
        if (b === "m") return await show({
          text: `🔁 <b>تسویه‌ی دعوت‌های قبلی</b>\n\nقانون جدید: هر ${fa(REF_EVERY)} دعوت موفق = ${fa(REF_CREDITS)} اعتبار معمولی.\nپلاس‌هایی که با قانون قدیمی (هر ۵ دعوت) داده شده‌اند دست‌نخورده می‌مانند؛ فقط دعوت‌هایی که هنوز پاداشی نگرفته‌اند دسته‌دسته (دوتایی) اعتبار معمولی می‌شوند و به هر دعوت‌کننده‌ی مشمول پیام می‌رود.\nاجرای دوباره بی‌خطر است (چیزی دوباره داده نمی‌شود).`,
          kb: [[cb("✅ تسویه کن", "ad:iv:go:0"), cb("↩️ برگشت", "ad:iv:t:0")]],
        });
        if (b === "go") {
          let cursor = "", tot = { inviters: 0, granted: 0, credits: 0, errors: 0 }, done = false;
          for (let round = 0; round < 4 && !done; round++) {
            const r = await settleLegacyReferrals(env, cursor);
            cursor = r.cursor; done = r.done;
            tot = { inviters: tot.inviters + r.inviters, granted: tot.granted + r.granted, credits: tot.credits + r.credits, errors: tot.errors + r.errors };
          }
          await logAction(env, adminId, `تسویه‌ی دعوت‌های قبلی: ${tot.inviters} دعوت‌کننده، ${tot.granted} نفر اعتبار گرفتند (جمعاً ${tot.credits})، ${tot.errors} خطا`);
          return await show({
            text: `✅ <b>تسویه انجام شد</b>\n\n🙋 دعوت‌کننده‌ی بررسی‌شده: <b>${fa(tot.inviters)}</b>\n🎁 دریافت‌کننده‌ی اعتبار: <b>${fa(tot.granted)}</b> نفر · جمعاً <b>${fa(tot.credits)}</b> اعتبار\n` +
              (tot.errors ? `⚠️ خطا: ${fa(tot.errors)} (دوباره اجرا کن؛ فقط موارد باقی‌مانده پردازش می‌شوند)\n` : "") + (done ? "" : "⏳ هنوز دعوت‌کننده‌ی باقی‌مانده هست؛ دوباره اجرا کن.\n"),
            kb: [[cb("🔁 اجرای دوباره", "ad:iv:go:0"), cb("🎁 گزارش دعوت‌ها", "ad:iv:t:0")], backHome],
          });
        }
        return await show(await referralScreen(env, b === "r" ? "r" : "t", Math.max(0, Math.min(2000, Number(c) || 0))));
      }
      case "sy": return await show(await systemScreen(env));
      case "lg": return await show(await logScreen(env));
      case "pg": {
        const n = await env.KV.purge();
        await logAction(env, adminId, `پاکسازی ${n} ردیف منقضی`);
        await answer(`🧹 ${n} ردیف منقضی پاک شد.`, true);
        const sys = await systemScreen(env);
        return await editMessage(env, chatId, mid, fit(sys.text), toMarkup(sys));
      }
      case "ba": {
        const body = await env.KV.get(`bc:${chatId}`);
        if (body === null || !isAudience(b)) return await show({ text: "⌛️ این پیش‌نویس منقضی شده است؛ دوباره از 📣 پیام همگانی شروع کن.", kb: [backHome] });
        await env.KV.put(audKey(chatId), b, { expirationTtl: 600 });
        return await show(await broadcastView(env, chatId, body));
      }
      case "se": return await prompt({ k: "search" }, "🔎 <b>جستجوی کاربر</b>\nشناسه‌ی عددی، شناسه‌ی w_…، @نام‌کاربری، یا بخشی از نام/ایمیل/موبایل را بفرست.", "ad:h");
      case "bc": return await prompt({ k: "bc" }, "📣 <b>پیام همگانی</b>\nمتن پیام را بفرست؛ بعد پیش‌نمایش می‌بینی و با دکمه تایید می‌کنی.\n\n💡 اگر <code>{invite}</code> را در متن بنویسی، برای هر کاربر جای آن همان پیام /invite او (لینک اختصاصی، شمارنده‌ی دعوت و دکمه‌ی ارسال به دوستان) قرار می‌گیرد.", "ad:h");
      case "xo": return await show(exportsScreen());
      case "ea": await answer("⏳ در حال ساخت فایل…"); await exportActiveSubs(env, chatId).catch(async (e) => { console.error("exportActiveSubs", e); await sendMessage(env, chatId, "❌ ساخت خروجی ناموفق بود؛ دوباره امتحان کن."); }); return;
      case "ex": await answer("⏳ در حال ساخت فایل‌ها…"); await exportContacts(env, chatId).catch(async (e) => { console.error("exportContacts", e); await sendMessage(env, chatId, "❌ ساخت خروجی ناموفق بود؛ دوباره امتحان کن."); }); return;
      case "eb": await answer("⏳ در حال ساخت فایل…"); await exportBuyers(env, chatId).catch(async (e) => { console.error("exportBuyers", e); await sendMessage(env, chatId, "❌ ساخت خروجی ناموفق بود؛ دوباره امتحان کن."); }); return;
      case "eo": await answer("⏳ در حال ساخت فایل…"); await exportMobileOnly(env, chatId).catch(async (e) => { console.error("exportMobileOnly", e); await sendMessage(env, chatId, "❌ ساخت خروجی ناموفق بود؛ دوباره امتحان کن."); }); return;
      case "ap": return await show(await appScreen(env));
      case "av": {
        const t = c === "all" ? "all" : isStoreId(c) ? c : null;
        if (!t) return await answer();
        const name = t === "all" ? "هر دو فروشگاه" : STORE_NAMES[t];
        if (b === "c") {
          const r = await applyAppVer(env, t, ["clear"]);
          await logAction(env, adminId, `نسخه‌ی اپ (${name}): برگشت به متغیرهای محیطی`);
          return await show(await appScreen(env, r.msg));
        }
        return await prompt({ k: "ver", s: t }, `✏️ <b>تنظیم نسخه‌ی اپ — ${name}</b>\nشماره‌ی نسخه (versionCode) را بفرست:\n\n${APPVER_HELP}`, "ad:ap");
      }
      case "wq": return await show(await webPushScreen(env, chatId));
      case "ww": return await prompt({ k: "wpushw" },
        `✍️ <b>نوشتن پوش وب</b>\nدر یک پیام و به این شکل بفرست:\n<code>عنوان | متن | لینک https (اختیاری)</code>\n\nعنوان حداکثر ${fa(PUSH_TITLE_MAX)} و متن حداکثر ${fa(PUSH_BODY_MAX)} نویسه.`, "ad:wq");
      case "wc": await env.KV.delete(wpDraftKey(chatId)); return await show(await webPushScreen(env, chatId, "🗑 پیش‌نویس حذف شد."));
      case "ws": {
        if (!webPushEnabled(env)) return await show(await webPushScreen(env, chatId));
        const raw = await env.KV.get(wpDraftKey(chatId));
        const draft = raw ? parsePushDraft(raw) : null;
        if (!draft) return await show(await webPushScreen(env, chatId, "⌛️ پیش‌نویس منقضی شده است؛ دوباره بنویس."));
        await env.KV.delete(wpDraftKey(chatId)); // جلوگیری از ارسال دوباره با دو بار زدن دکمه
        const wmsg: WebPushMsg = { ...draft, tag: "promo" };
        try { await env.BROADCAST_WORKFLOW.create({ id: `wp-${Date.now()}`, params: { adminChatId: chatId, text: "", webPush: wmsg } }); }
        catch (e) {
          console.error("web push create failed", e);
          await env.KV.put(wpDraftKey(chatId), JSON.stringify(draft), { expirationTtl: 3600 });
          return await show(await webPushScreen(env, chatId, "❌ شروع ارسال ممکن نشد؛ دوباره امتحان کن."));
        }
        await logAction(env, adminId, `پوش وب: ${draft.title.slice(0, 40)}`);
        return await show({ text: "🔔 ارسال پوش وب شروع شد.\nوقتی تمام شد، گزارش را همین‌جا می‌فرستم.", kb: [[cb("🔙 پوش وب", "ad:wq"), ...backHome]] });
      }
      case "pu": return await show(await pushScreen(env, chatId));
      case "pw": return await prompt({ k: "pushw" },
        `✍️ <b>نوشتن اعلان به اپ</b>\nدر یک پیام و به این شکل بفرست:\n<code>عنوان | متن | لینک https (اختیاری)</code>\n\nعنوان حداکثر ${fa(PUSH_TITLE_MAX)} و متن حداکثر ${fa(PUSH_BODY_MAX)} نویسه.`, "ad:pu");
      case "pa": {
        if (!(await getPushDraft(env, chatId))) return await show(await pushScreen(env, chatId, "⌛️ پیش‌نویس منقضی شده است؛ دوباره بنویس."));
        if (isPushSegment(b)) await setPushSegment(env, chatId, b);
        return await show(await pushScreen(env, chatId));
      }
      case "pc": await clearPushDraft(env, chatId); return await show(await pushScreen(env, chatId, "🗑 پیش‌نویس حذف شد."));
      case "ps": {
        if (!pushEnabled(env)) return await show(await pushScreen(env, chatId));
        const draft = await getPushDraft(env, chatId);
        if (!draft) return await show(await pushScreen(env, chatId, "⌛️ پیش‌نویس منقضی شده است؛ دوباره بنویس."));
        const seg = await getPushSegment(env, chatId);
        await clearPushDraft(env, chatId); // جلوگیری از ارسال دوباره با دو بار زدن دکمه
        try { await launchAppPush(env, chatId, draft, seg); }
        catch (e) {
          console.error("app push create failed", e);
          await savePushDraft(env, chatId, draft); await setPushSegment(env, chatId, seg);
          return await show(await pushScreen(env, chatId, "❌ شروع ارسال ممکن نشد؛ دوباره امتحان کن."));
        }
        await logAction(env, adminId, `اعلان به اپ (${PUSH_SEGMENTS[seg]}): ${draft.title.slice(0, 40)}`);
        return await show({ text: `📲 ارسال اعلان به اپ شروع شد (${esc(PUSH_SEGMENTS[seg])}).\nوقتی تمام شد، گزارش را همین‌جا می‌فرستم.`, kb: [[cb("🔙 اپ اندروید", "ad:ap"), ...backHome]] });
      }
    }

    if (id === null) return await answer();
    switch (a) {
      case "u": return await show(await userCard(env, id));
      case "ud": return await show(await userFilesScreen(env, id));
      case "sv": case "sn": {
        // شناسه‌ی گفتگوی پشتیبانی همیشه شناسه‌ی پروفایل وب است؛ اگر شناسه‌ی تلگرام آمد به پروفایل وبِ وصل‌شده تبدیل می‌شود
        const wid = typeof id === "string" ? id : (await identify(env, id)).webId;
        if (!wid) { await answer("این کاربر پروفایل وب (چت پشتیبانی) ندارد.", true); return; }
        const scr = await supportConvScreen(env, wid, Math.max(0, Math.min(500, Number(c) || 0)));
        if (a === "sn") { await answer(); return void (await sendScreen(env, chatId, scr)); } // از اعلان ارجاع: پیام جدید، تا اعلان سر جایش بماند
        return await show(scr);
      }
      // از پیام «نظر کاربر»: کارت/فایل‌های کاربر به‌صورت پیام جدید می‌آید تا متن نظر سر جایش بماند
      case "nu": if (id === null) return await answer(); await answer(); return void (await sendScreen(env, chatId, await userCard(env, id)));
      // تایید/رد نظر کاربر برای نمایش در سایت (reviews.ts)؛ شناسه‌ی نظر در b است
      case "fa": return void (await answer((await approveReview(env, b ?? "")) ? "✅ به بخش نظرات سایت اضافه شد (حداکثر تا ۱–۲ ساعت دیده می‌شود)" : "این نظر پیدا نشد یا قبلاً بررسی شده است", true));
      case "fr": return void (await answer((await rejectReview(env, b ?? "")) ? "🚫 رد شد و در سایت نمایش داده نمی‌شود" : "این نظر پیدا نشد یا قبلاً بررسی شده است", true));
      case "nd": if (id === null) return await answer(); await answer(); return void (await sendScreen(env, chatId, await userFilesScreen(env, id)));
      case "cr": return await prompt({ k: "cr", id }, `✏️ <b>اعتبار دلخواه</b> برای <code>${id}</code>\nیک عدد بفرست؛ مثلاً <code>25</code> یا <code>-3</code>.`, `ad:u:${id}`);
      case "sr": {
        if (!b || !WEB_ID.test(b)) return await answer("شناسه‌ی کاربر نامعتبر است", true);
        return await prompt({ k: "sr", uid: b }, `✍️ <b>پاسخ در چت پشتیبانی</b> برای <code>${esc(b)}</code>\nمتنی که می‌فرستی مستقیم در چت خود کاربر نمایش داده می‌شود (حداکثر ${fa(ADMIN_REPLY_MAX)} نویسه).`, `ad:sv:${b}:999`);
      }
      case "m": return await prompt({ k: "msg", id }, `✉️ <b>پیام به کاربر</b> <code>${id}</code>\nمتن پیام را بفرست.`, `ad:u:${id}`);
      case "g": {
        const n = Math.trunc(Number(c));
        if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1000) return await answer();
        const r = await applyGrant(env, adminId, id, n);
        await answer(`اعتبار: ${r.before} ← ${r.after}`);
        const card = await userCard(env, id);
        return await editMessage(env, chatId, mid, fit(card.text), toMarkup(card));
      }
      case "pl": {
        const msg = await applyPlan(env, adminId, id, String(c));
        await answer(msg, true);
        const s = await userCard(env, id);
        return await editMessage(env, chatId, mid, fit(s.text), toMarkup(s));
      }
      case "b": {
        const done = await applyBan(env, adminId, id, c === "1");
        await answer(done ? (c === "1" ? "⛔️ مسدود شد" : "✅ رفع انسداد شد") : "مدیر را نمی‌شود مسدود کرد.", !done);
        const s = await userCard(env, id);
        return await editMessage(env, chatId, mid, fit(s.text), toMarkup(s));
      }
      case "ul": {
        const who = await identify(env, id);
        await releaseLock(env, who.acct);
        await logAction(env, adminId, `آزاد کردن قفل ${cardId(who)}`);
        await answer("🔓 قفل آزاد شد");
        const s = await userCard(env, id);
        return await editMessage(env, chatId, mid, fit(s.text), toMarkup(s));
      }
    }
    return await answer();
  } catch (e) {
    console.error("admin panel", e);
    await answer("⚠️ خطا در اجرای عملیات؛ دوباره امتحان کن.", true);
  }
}

// ---------- خروجی مخاطبان: ایمیل‌ها برای کمپین Resend، موبایل‌ها برای پیامک ----------
/** سلول CSV؛ raw=false: نویسه‌های آغازگر فرمول (= + - @) از ابتدای متن آزاد برداشته می‌شود تا در اکسل اجرا نشود */
const csvCell = (s: unknown, raw = false) => {
  let v = String(s ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!raw) v = v.replace(/^[=+\-@\t]+/, "");
  return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
const EMAIL_RE = /^[^\s@,"]+@[^\s@,"]+\.[^\s@,"]{2,}$/;
/** دو فایل CSV می‌فرستد: ۱) resend-contacts.csv با ستون‌های email, first_name, last_name, unsubscribed (قالب واردکردن Resend)؛ ۲) mobiles.csv.
 *  فقط ایمیل‌های تاییدشده؛ مسدودها و تکراری‌ها حذف می‌شوند. */
async function exportContacts(env: Env, chatId: number) {
  const d = await db(env);
  const banned = new Set((await rows(env, "SELECT k FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) LIMIT 5000", "ban:", "ban:" + MAXC, nowSec())).map((r) => r.k.slice(4)));
  const emails = new Map<string, string>(); // ایمیل → نام
  const mobiles = new Map<string, string>(); // موبایل → نام
  let last = "wu:", pages = 0, total = 0, unverified = 0, skippedBan = 0, bad = 0;
  for (; pages < 40; pages++) {
    const r = (await d.prepare(
      "SELECT k, json_extract(v,'$.email') e, json_extract(v,'$.mobile') m, json_extract(v,'$.name') n, json_extract(v,'$.verified') ok FROM kv " +
      "WHERE k > ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND (COALESCE(json_extract(v,'$.email'),'') != '' OR COALESCE(json_extract(v,'$.mobile'),'') != '') ORDER BY k LIMIT 1000",
    ).bind(last, "wu:" + MAXC, nowSec()).all<{ k: string; e: string | null; m: string | null; n: string | null; ok: number | null }>()).results ?? [];
    for (const u of r) {
      total++;
      if (banned.has(u.k.slice(3))) { skippedBan++; continue; }
      const name = (u.n ?? "").trim();
      const email = String(u.e ?? "").trim().toLowerCase();
      if (email) {
        if (!EMAIL_RE.test(email)) bad++;
        else if (!u.ok) unverified++;
        else if (!emails.has(email)) emails.set(email, name);
      }
      const mob = String(u.m ?? "").trim();
      if (/^09\d{9}$/.test(mob) && !mobiles.has(mob)) mobiles.set(mob, name);
    }
    last = r.length ? r[r.length - 1].k : last;
    if (r.length < 1000) break;
  }
  const enc = new TextEncoder();
  const rc = ["email,first_name,last_name,unsubscribed"];
  for (const [e, n] of emails) { const [f, ...rest] = n.split(/\s+/).filter(Boolean); rc.push(`${csvCell(e, true)},${csvCell(f ?? "")},${csvCell(rest.join(" "))},false`); }
  const mc = ["mobile,phone_e164,name"];
  for (const [m, n] of mobiles) mc.push(`${m},+98${m.slice(1)},${csvCell(n)}`);
  await sendDocument(env, chatId, enc.encode(rc.join("\n") + "\n"), "resend-contacts.csv",
    `📧 <b>${fa(emails.size)}</b> ایمیل تاییدشده (قالب واردکردن Resend)\nResend ← Audiences ← Add contacts ← Import CSV؛ ستون‌ها خودکار تطبیق می‌خورند.\nبرای کمپین حتماً لینک لغو عضویت <code>{{{RESEND_UNSUBSCRIBE_URL}}}</code> را در متن ایمیل بگذار.`, { mime: "text/csv" });
  await sendDocument(env, chatId, enc.encode(mc.join("\n") + "\n"), "mobiles.csv",
    `📱 <b>${fa(mobiles.size)}</b> شماره‌ی موبایل (برای پیامک؛ Resend فقط ایمیل می‌فرستد)`, { mime: "text/csv" });
  await sendMessage(env, chatId,
    `✅ خروجی آماده شد.\n👥 حساب‌های بررسی‌شده: ${fa(total)}\n⛔️ مسدود (حذف شد): ${fa(skippedBan)}\n✉️ ایمیل تاییدنشده (حذف شد): ${fa(unverified)}` + (bad ? `\n⚠️ ایمیل نامعتبر (حذف شد): ${fa(bad)}` : "") +
    (pages >= 40 ? "\n⚠️ سقف ۴۰ هزار حساب رسید؛ ممکن است فهرست ناقص باشد." : ""));
}

/** خروجی «فقط‌شماره‌ها»: حساب‌هایی که تنها راه ارتباطشان شماره‌ی موبایل است.
 *  شرط: موبایل معتبر 09XXXXXXXXX دارد، ایمیل ندارد، گوگل وصل نیست و هیچ ربات/پیام‌رسانی (تلگرام، بله، روبیکا، ایتا، سروش‌پلاس: کلید w2tg) به حسابش وصل نیست.
 *  مسدودها و موبایل‌های تکراری حذف می‌شوند. فایل: mobile-only.csv (UTF-8 با BOM برای اکسل). */
async function exportMobileOnly(env: Env, chatId: number) {
  const d = await db(env);
  const banned = new Set((await rows(env, "SELECT k FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) LIMIT 5000", "ban:", "ban:" + MAXC, nowSec())).map((r) => r.k.slice(4)));
  const seen = new Map<string, { name: string; created: number; plat: string }>();
  let last = "wu:", pages = 0, total = 0, skippedBan = 0, bad = 0;
  for (; pages < 40; pages++) {
    const r = (await d.prepare(
      "SELECT k, json_extract(v,'$.mobile') m, json_extract(v,'$.name') n, json_extract(v,'$.created') c, json_extract(v,'$.store') s, json_extract(v,'$.os') o, json_extract(v,'$.app') a FROM kv " +
      "WHERE k > ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) " +
      "AND COALESCE(json_extract(v,'$.mobile'),'') != '' AND COALESCE(json_extract(v,'$.email'),'') = '' AND json_extract(v,'$.google') IS NULL " +
      "AND NOT EXISTS (SELECT 1 FROM kv t WHERE t.k = 'w2tg:' || substr(kv.k, 4) AND (t.exp IS NULL OR t.exp > ?3)) ORDER BY k LIMIT 1000",
    ).bind(last, "wu:" + MAXC, nowSec()).all<{ k: string; m: string | null; n: string | null; c: number | null; s: string | null; o: string | null; a: number | null }>()).results ?? [];
    for (const u of r) {
      total++;
      if (banned.has(u.k.slice(3))) { skippedBan++; continue; }
      const mob = String(u.m ?? "").trim();
      if (!/^09\d{9}$/.test(mob)) { bad++; continue; }
      if (seen.has(mob)) continue;
      const plat = u.a ? (u.s ? STORE_LABEL[u.s as keyof typeof STORE_LABEL] ?? u.s : u.o === "ios" ? "iOS" : "اپ اندروید") : "وب";
      seen.set(mob, { name: (u.n ?? "").trim(), created: Number(u.c) || 0, plat });
    }
    last = r.length ? r[r.length - 1].k : last;
    if (r.length < 1000) break;
  }
  const lines = ["mobile,phone_e164,name,signup_date,source"];
  for (const [m, x] of [...seen].sort((a, b) => a[1].created - b[1].created)) lines.push([m, `+98${m.slice(1)}`, csvCell(x.name), x.created ? tehranDay(x.created) : "", csvCell(x.plat)].join(","));
  await sendDocument(env, chatId, new TextEncoder().encode("\uFEFF" + lines.join("\n") + "\n"), "mobile-only.csv",
    `📵 <b>${fa(seen.size)}</b> شماره‌ی بدون ایمیل، گوگل و شبکه‌ی اجتماعی/ربات`, { mime: "text/csv" });
  await sendMessage(env, chatId,
    `✅ خروجی فقط‌شماره‌ها آماده شد.\n📱 شماره‌ی یکتا: <b>${fa(seen.size)}</b>\n⛔️ مسدود (حذف شد): ${fa(skippedBan)}` + (bad ? `\n⚠️ موبایل نامعتبر (حذف شد): ${fa(bad)}` : "") +
    (pages >= 40 ? "\n⚠️ سقف ۴۰ هزار حساب رسید؛ ممکن است فهرست ناقص باشد." : ""));
}

/** خروجی کاربرانی که دست‌کم یک‌بار پلن خریده‌اند: فایل plan-buyers.csv + شمارش کل.
 *  منابع (هر کاربر یک‌بار شمرده می‌شود): نشانه‌ی دائمی pbuy:<کاربر> (از زمان فعال شدن این قابلیت)، توکن‌های دائمی خرید فروشگاه‌ها (bzp:/mkp:/sbp:)،
 *  و رکوردهای پرداخت‌شده‌ی pay: (۸۴ روز اخیر؛ برای درگاه دیجی‌پی پیش از این قابلیت فقط همین‌قدر باقی مانده). */
async function exportBuyers(env: Env, chatId: number) {
  const d = await db(env);
  type B = { first: number; plans: Set<string> };
  const buyers = new Map<string, B>();
  const add = (uid: unknown, plan: unknown, t: unknown) => {
    const id = String(uid ?? "").trim(); if (!id) return;
    const b = buyers.get(id) ?? { first: 0, plans: new Set<string>() };
    const tt = Number(t) || 0; if (tt && (!b.first || tt < b.first)) b.first = tt;
    if (plan) b.plans.add(String(plan)); buyers.set(id, b);
  };
  type R = { uid: string | null; plan: string | null; t: number | null };
  const pays = (await d.prepare(
    "SELECT json_extract(v,'$.uid') uid, json_extract(v,'$.plan') plan, json_extract(v,'$.t') t FROM kv WHERE k >= ?1 AND k < ?2 AND json_extract(v,'$.state')='paid' LIMIT 50000",
  ).bind("pay:", "pay:" + MAXC).all<R>()).results ?? [];
  for (const r of pays) add(r.uid, r.plan, r.t);
  for (const pre of ["bzp:", "mkp:", "sbp:"]) {
    const rs = (await d.prepare(
      "SELECT json_extract(v,'$.uid') uid, json_extract(v,'$.plan') plan, json_extract(v,'$.t') t FROM kv WHERE k >= ?1 AND k < ?2 LIMIT 50000",
    ).bind(pre, pre + MAXC).all<R>()).results ?? [];
    for (const r of rs) add(r.uid, r.plan, r.t);
  }
  const marks = (await d.prepare("SELECT k, json_extract(v,'$.f') t FROM kv WHERE k >= ?1 AND k < ?2 LIMIT 50000").bind("pbuy:", "pbuy:" + MAXC).all<{ k: string; t: number | null }>()).results ?? [];
  for (const r of marks) add(r.k.slice(5), null, r.t);

  const ids = [...buyers.keys()];
  const users = new Map<string, WebUser | null>();
  for (let i = 0; i < ids.length; i += 50) {
    await Promise.all(ids.slice(i, i + 50).map(async (u) => { users.set(u, WEB_ID.test(u) ? await getUserById(env, u).catch(() => null) : null); }));
  }
  const lines = ["user_id,name,email,mobile,first_purchase,plans"];
  for (const [id, b] of [...buyers].sort((a, c) => (a[1].first || Infinity) - (c[1].first || Infinity))) {
    const u = users.get(id);
    lines.push([id, csvCell(u?.name), csvCell(u?.email, true), csvCell(u?.mobile, true), b.first ? tehranDay(b.first) : "", csvCell([...b.plans].map(planLabel).join(" / "))].join(","));
  }
  await sendDocument(env, chatId, new TextEncoder().encode("\uFEFF" + lines.join("\n") + "\n"), "plan-buyers.csv",
    `💳 <b>${fa(buyers.size)}</b> کاربر دست‌کم یک‌بار پلن خریده‌اند`, { mime: "text/csv" });
  await sendMessage(env, chatId,
    `✅ خروجی خریداران آماده شد.\n💳 کاربران یکتا: <b>${fa(buyers.size)}</b>\n` +
    "<i>خریدهای درگاه دیجی‌پی قبل از فعال شدن این قابلیت فقط از ۸۴ روز اخیر شناخته می‌شوند؛ خریدهای فروشگاه‌ها (بازار/مایکت/سیب‌اپ) و هر خرید از این به بعد دائمی ثبت می‌شود.</i>");
}

/** خروجی پلن‌داران فعال (پلنی که نه منقضی شده و نه اعتبارش تمام شده): فایل Excel (.xlsx) راست‌به‌چپ با مشخصات کامل هر کاربر.
 *  ستون‌ها: شناسه، نام، ایمیل، موبایل، پلتفرم، نام‌کاربری تلگرام، شناسه‌ی پیام‌رسانِ وصل‌شده، پلن، مبلغ خرید (تومان؛ مبلغ واقعیِ آخرین خرید)، اعتبار پلن، اعتبار هدیه، مجموع،
 *  تاریخ انقضا، روزهای باقی‌مانده، اولین خرید، تاریخ ثبت‌نام، وضعیت (مسدود یا نه). */
const PLAT_PLAIN: Record<string, string> = { tg: "تلگرام", bale: "بله", rubika: "روبیکا", eitaa: "ایتا", splus: "سروش‌پلاس" };
/** تاریخ شمسی با رقم لاتین (۱۴۰۵/۰۸/۰۲)؛ t = میلی‌ثانیه */
const jalaliDay = (t: number): string => {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tehran" })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return `${p.year}/${p.month}/${p.day}`;
  } catch { return tehranDay(t); }
};

async function exportActiveSubs(env: Env, chatId: number) {
  const subs = await rows(env,
    "SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) AND json_extract(v,'$.exp') > ?4 AND json_extract(v,'$.credits') > 0 ORDER BY json_extract(v,'$.exp') ASC LIMIT 5000",
    "sub:", "sub:" + MAXC, nowSec(), Date.now());
  // نگاشت‌های کل‌گیر با یک پرس‌وجو (به‌جای یک خواندن برای هر کاربر)
  const bonus = new Map((await rows(env, "SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) LIMIT 100000", "bonus:", "bonus:" + MAXC, nowSec())).map((r) => [r.k.slice(6), Math.max(0, Math.floor(Number(r.v) || 0))]));
  const banned = new Set((await rows(env, "SELECT k, v FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) LIMIT 100000", "ban:", "ban:" + MAXC, nowSec())).map((r) => r.k.slice(4)));
  const first = new Map<string, number>();
  for (const r of await rows(env, "SELECT k, json_extract(v,'$.f') v FROM kv WHERE k >= ?1 AND k < ?2 LIMIT 100000", "pbuy:", "pbuy:" + MAXC)) first.set(r.k.slice(5), Number(r.v) || 0);

  // مبلغ آخرین خرید: اول از خودِ اشتراک (sub.paid که هنگام خرید ثبت می‌شود)؛ برای اشتراک‌های قدیمی از آخرین پرداخت تاییدشده‌ی همان پلن (۸۴ روز اخیر)؛ هدیه/دستی = خالی
  const lastPaid = new Map<string, { toman: number; credits: number }>();
  for (const r of await loadPayments(env)) { // از جدید به قدیم
    if (r.state !== "paid" || !r.plan) continue;
    const k = `${r.uid}|${r.plan}`; if (!lastPaid.has(k)) lastPaid.set(k, { toman: tomanOf(r), credits: r.count });
  }

  const headers = ["ردیف", "نام", "موبایل", "ایمیل", "پلتفرم", "پلن", "مبلغ خرید (تومان)", "اعتبار خرید", "اعتبار پلن", "اعتبار هدیه", "مجموع اعتبار", "تاریخ انقضا", "روز مانده", "اولین خرید", "تاریخ ثبت‌نام", "نام‌کاربری تلگرام", "شناسه‌ی پیام‌رسان", "مسدود", "شناسه‌ی کاربر"];
  const widths = [6, 22, 15, 28, 13, 9, 16, 11, 10, 10, 11, 13, 9, 13, 13, 20, 16, 8, 24];
  const data: XCell[][] = [];
  for (let i = 0; i < subs.length; i += 25) {
    const out = await Promise.all(subs.slice(i, i + 25).map(async (r): Promise<XCell[] | null> => {
      const uid = r.k.slice(4); const sub = json<{ plan: string; exp: number; credits: number; paid?: number; bought?: number }>(r.v); if (!sub) return null;
      const num = /^\d{1,15}$/.test(uid);
      const w = !num && WEB_ID.test(uid) ? await getUserById(env, uid).catch(() => null) : null;
      const linked = w ? Number(await env.KV.get(`w2tg:${uid}`).catch(() => null)) || 0 : 0;
      const seen = num ? await getUserSeen(env, Number(uid)).catch(() => null) : linked ? await getUserSeen(env, linked).catch(() => null) : null;
      const plat = w
        ? (w.app ? (w.store ? STORE_LABEL[w.store as keyof typeof STORE_LABEL] ?? w.store : w.os === "ios" ? "iOS" : "اپ اندروید") : "وب")
        : PLAT_PLAIN[botPlatform(Number(uid))] ?? "تلگرام";
      const pc = sub.credits, bc = bonus.get(uid) ?? 0, f = first.get(uid) ?? 0;
      const seenT = seen?.t ? Date.parse(seen.t) : 0;
      const lp = lastPaid.get(`${uid}|${sub.plan}`);
      return [
        0, w?.name || seen?.n || "", w?.mobile || "", w?.email || "", plat, planLabel(sub.plan),
        Number(sub.paid) > 0 ? Math.round(Number(sub.paid)) : lp?.toman || "", Number(sub.bought) > 0 ? Math.round(Number(sub.bought)) : lp?.credits || "", pc, bc, pc + bc,
        jalaliDay(sub.exp), Math.max(0, Math.ceil((sub.exp - Date.now()) / 86_400_000)),
        f ? jalaliDay(f) : "", w?.created ? jalaliDay(w.created) : seenT ? jalaliDay(seenT) : "",
        seen?.u ? "@" + seen.u.replace(/^@/, "") : "", linked || (num ? uid : ""), banned.has(uid) ? "بله" : "", uid,
      ];
    }));
    for (const row of out) if (row) { row[0] = data.length + 1; data.push(row); }
  }
  const bytes = await buildXlsx("پلن‌داران فعال", headers, data, widths);
  await sendDocument(env, chatId, bytes, `active-plan-users-${tehranDay(Date.now())}.xlsx`,
    `👑 <b>${fa(data.length)}</b> کاربر با پلن فعال (نزدیک‌ترین انقضا اول؛ تاریخ‌ها شمسی)`, { mime: XLSX_MIME });
  await sendMessage(env, chatId, `✅ خروجی پلن‌داران فعال آماده شد.\n👑 تعداد: <b>${fa(data.length)}</b>` + (subs.length >= 5000 ? "\n⚠️ سقف ۵۰۰۰ ردیف اعمال شد." : ""),
    { reply_markup: { inline_keyboard: [[cb("📤 خروجی‌ها", "ad:xo"), ...backHome]] } });
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
  const isDeckFile = !/-(poster|handout|audio(-s\d+)?|podcast(-\d+)?)$/.test(fid);
  const pdfThere = isDeckFile && (await cachedPdf(env, userId, fid).catch(() => null)) != null; // دکمه‌ی نمونه‌ی PDF فقط اگر PDF این ارائه ساخته شده
  const head = `✅ <b>${esc(f.entry.title)}</b>\n👤 <code>${userId}</code>`;
  if (isAudioName(f.entry.name)) { // پادکست/صدا: با پخش‌کننده‌ی صوتی تلگرام (کنترل سرعت)
    const wav = new Uint8Array(f.data);
    await sendAudio(env, chatId, wav, f.entry.name, head, { title: f.entry.title, duration: audioSeconds(wav), reply_markup: sampleKb(userId, fid, false) });
  } else await sendDocument(env, chatId, new Uint8Array(f.data), f.entry.name, head, { reply_markup: sampleKb(userId, fid, pdfThere) });
  // اگر برای همین ارائه همراه‌ها هم ساخته شده (و هنوز نگه داشته می‌شوند)، همراهش فرستاده می‌شوند: پوستر، جزوه، اسلاید صوتی، صدای اسلایدهای جاماندنی و پادکست
  // (اسلاید صوتی و پادکست فقط برای کاربران وب ذخیره می‌شوند؛ در تلگرام مستقیم به چت خودِ کاربر رفته‌اند)
  if (/-(poster|handout|audio(-s\d+)?|podcast(-\d+)?)$/.test(fid)) return;
  const kinds: { re: RegExp; label: string }[] = [
    { re: /^poster$/, label: "🖼 پوستر" },
    { re: /^handout$/, label: "📘 جزوه" },
    { re: /^audio$/, label: "🔊 اسلاید صوتی" },
    { re: /^audio-s(\d+)$/, label: "🔊 صدای اسلاید" },
    { re: /^podcast(-\d+)?$/, label: "🎙 پادکست" },
  ];
  const num = (x: string) => Number(/(\d+)$/.exec(x)?.[1] ?? 0);
  const extras = (await listFiles(env, userId).catch(() => []))
    .filter((x) => x.id.startsWith(`${fid}-`))
    .map((x) => ({ x, k: kinds.findIndex((k) => k.re.test(x.id.slice(fid.length + 1))) }))
    .filter((e) => e.k >= 0)
    .sort((a, b) => a.k - b.k || num(a.x.id) - num(b.x.id));
  for (const { x, k } of extras) {
    const extra = await loadFile(env, userId, x.id).catch(() => null);
    if (!extra) continue;
    const cap = `${kinds[k].label} · <b>${esc(extra.entry.title)}</b>\n👤 <code>${userId}</code>`;
    await (isAudioName(extra.entry.name)
      ? (() => { const w = new Uint8Array(extra.data); return sendAudio(env, chatId, w, extra.entry.name, cap, { title: extra.entry.title, duration: audioSeconds(w), reply_markup: sampleKb(userId, x.id, false) }); })()
      : sendDocument(env, chatId, new Uint8Array(extra.data), extra.entry.name, cap, { reply_markup: sampleKb(userId, x.id, false) }))
      .catch((err) => console.error("admin send extra", x.id, err));
  }
}

// ---------- نمونه‌ها (فایل‌های دائمی که برای همه‌ی کاربران در بخش فایل‌ها با برچسب «نمونه» می‌آیند) ----------
const sampleKb = (userId: Uid, fid: string, pdf: boolean) => ({
  inline_keyboard: [[cb("⭐ نمونه کردن", `as:${userId}:${fid}`), ...(pdf ? [cb("⭐ PDF هم", `ap:${userId}:${fid}`)] : [])]],
});

/** /samples: فهرست نمونه‌های فعلی با دکمه‌ی حذف */
async function sendSamples(env: Env, chatId: number) {
  const list = await listSamples(env);
  if (!list.length) return await sendMessage(env, chatId, "🧪 هنوز نمونه‌ای نیست.\nفایل هر کاربر را از پنل (🗂 فایل‌ها) بگیر و زیرش «⭐ نمونه کردن» را بزن.");
  return await sendMessage(env, chatId, `🧪 <b>نمونه‌های دائمی</b> (${fa(list.length)})\nهمه‌ی کاربران این‌ها را در بخش فایل‌ها با برچسب «${SAMPLE_BADGE}» می‌بینند. برای حذف، دکمه‌ی 🗑 را بزن:`,
    { reply_markup: { inline_keyboard: list.map((s) => [cb(`🗑 ${sampleLabel(s)} · ${s.title.slice(0, 26)}`, `ar:${s.id}`)]) } });
}

/** as:<کاربر>:<فایل> نمونه کردن، ap:… نمونه کردن PDF همان ارائه، ar:<نمونه> حذف نمونه */
export async function handleAdminSampleCallback(env: Env, cq: any) {
  if (!isAdmin(env, cq.from.id)) return await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
  const chatId: number = cq.message.chat.id;
  const [act, a, b] = String(cq.data ?? "").split(":");
  const answer = (text: string, alert = false) => tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: text.slice(0, 200), show_alert: alert }).catch(() => {});
  if (act === "ar") {
    const ok = await removeSample(env, a ?? "");
    if (ok) await logAction(env, cq.from.id, `حذف نمونه ${a}`);
    await answer(ok ? "🗑 از نمونه‌ها حذف شد." : "این نمونه دیگر نیست.");
    return await tg(env, "deleteMessage", { chat_id: chatId, message_id: cq.message.message_id }).catch(() => {});
  }
  const userId: Uid = WEB_ID.test(a ?? "") ? (a as string) : Number(a);
  if (!((typeof userId === "string" && userId) || Number.isSafeInteger(userId)) || !b) return await answer("نامعتبر");
  const r = await addSample(env, userId, b, act === "ap");
  if (!r.ok) return await answer(`⚠️ ${r.error}`, true);
  await logAction(env, cq.from.id, `${r.replaced ? "به‌روزرسانی" : "افزودن"} نمونه ${r.entry.id}`);
  return await answer(`⭐ ${r.replaced ? "نمونه به‌روز شد" : "نمونه شد"}: ${sampleLabel(r.entry)}\nبرای همه‌ی کاربران دائمی است. حذف: /samples`, true);
}
