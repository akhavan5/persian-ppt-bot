/**
 * اعلان یکپارچه: «یک اعلان» ← «همه‌ی کانال‌های ارتباطی کاربر»، مستقل از پلتفرم.
 *
 * فراخواننده فقط محتوای اعلان را می‌دهد (notifyUser)؛ اینکه کاربر از کجا آمده (تلگرام، بله، ایتا، روبیکا، سروش‌پلاس، سایت یا اپ)
 * و کدام کانال‌ها را دارد اینجا از روی خود حساب تشخیص داده می‌شود:
 *   messenger = همه‌ی پیام‌رسان‌های وصل‌شده‌ی حساب که ربات‌شان روی سرور فعال است (هر کدام جدا؛ مسیر و قالب هر پلتفرم را sendMessage می‌شناسد)
 *   app       = اپ اندروید (FCM)
 *   web       = اعلان مرورگر/PWA (Web Push)
 *   email     = ایمیل حساب (فقط اگر ایمیل ثبت شده و سرویس ایمیل تنظیم باشد)
 * هر کانالی که برای کاربر وجود ندارد یا روی سرور تنظیم نشده بی‌سروصدا کنار گذاشته می‌شود؛ کانال‌ها مستقل‌اند و خطای یکی بقیه را خراب نمی‌کند.
 * هرگز خطا پرتاب نمی‌کند (اعلان نباید کار اصلی مثل پرداخت یا ساخت ارائه را خراب کند).
 *
 * شناسه‌ی ورودی (uid) می‌تواند حساب وب («w_…»)، شناسه‌ی عددی هر پیام‌رسان (به حساب اصلی‌اش تبدیل می‌شود) یا شناسه‌ی عددی مدیر باشد.
 */
import type { Env } from "./env";
import { getUserById } from "./auth";
import { CHAN_LABEL, chanOf, chanReady, notifyIds, resolveUid, type Chan } from "./link";
import { isWebId, type Uid } from "./settings";
import { esc, sendMessage } from "./telegram";
import { BRAND, emailEnabled, sendEmail, siteOf } from "./email";
import { sendWebPush, webPushEnabled } from "./webpush";
import { fcmTokensOf, pushEnabled, sendPushToUser } from "./push";

export type NotifyKind = "messenger" | "app" | "web" | "email";
export const NOTIFY_KINDS: readonly NotifyKind[] = ["messenger", "app", "web", "email"];
export const NOTIFY_LABEL: Record<NotifyKind, string> = { messenger: "پیام‌رسان", app: "اپ اندروید", web: "اعلان مرورگر", email: "ایمیل" };

export interface EmailContent { subject: string; html: string; text: string }

export interface Notification {
  /** عنوان کوتاه (عنوان اعلان اپ/مرورگر، موضوع و تیتر ایمیل، خط اول پیام‌رسان) */
  title: string;
  /** متن ساده بدون HTML (اعلان اپ/مرورگر، متن ایمیل و پیام‌رسانی که html نداشته باشد) */
  body: string;
  /** مقصد داخل سایت (مثل "/?buy=1") یا آدرس https: برای اعلان مرورگر، دکمه‌ی ایمیل و خط لینک پیام‌رسان */
  url?: string;
  /** برچسب نوع پیام: اپ اندروید با آن اعلان تکراری را مهار می‌کند و مقصد (تب) را می‌فهمد؛ برچسب آمار ایمیل هم هست */
  tag?: string;
  /** متن پیام‌رسان‌ها (HTML تلگرامی). پیش‌فرض: عنوان پررنگ + متن + (اگر url هست) یک خط لینک */
  html?: string;
  /** پارامترهای اضافه‌ی هر پیام‌رسان (مثلاً reply_markup با دکمه‌ی اختصاصی همان پلتفرم)؛ id = شناسه‌ی همان گیرنده */
  extra?: (id: number) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
  /** ایمیل کامل (مثلاً خروجی render). نداشته باشد یک ایمیل برندشده‌ی ساده از title/body ساخته می‌شود */
  email?: EmailContent | ((who: { to: string; name: string }) => EmailContent | Promise<EmailContent>);
  /** آدرس https اختصاصی اپ اندروید. فقط وقتی بدهی با زدن اعلان مرورگر باز می‌شود؛ وگرنه اپ باز می‌شود (با tag تب مقصد انتخاب می‌شود) */
  appUrl?: string;
  /** تعداد دستگاه‌های اندرویدِ گیرنده (تازه‌ترین‌ها)؛ پیش‌فرض ۱ تا هزینه‌ی زیردرخواست کم بماند */
  appDevices?: number;
  /** برچسب آمار ایمیل در داشبورد (پیش‌فرض: همان tag) */
  emailTag?: string;
  /** کلید یکتای ایمیل: با همان کلید دوباره (مثلاً تلاش مجدد) فقط یک ایمیل می‌رود. شناسه‌ی کاربر را خودت در آن بگذار */
  key?: string;
  /** فقط همین کانال‌ها */
  only?: readonly NotifyKind[];
  /** همه‌ی کانال‌ها به‌جز این‌ها */
  except?: readonly NotifyKind[];
}

export interface NotifyResult {
  /** دست‌کم در یک کانال تحویل شد */
  ok: boolean;
  delivered: NotifyKind[];
  /** مقصد وجود داشت ولی ارسال شکست خورد */
  failed: NotifyKind[];
  /** تعداد کانال‌هایی که مقصد داشتند (۰ = این کاربر هیچ راه رسیدنی ندارد؛ تلاش مجدد بی‌فایده است) */
  reachable: number;
  /** نتیجه‌ی هر پیام‌رسان جدا (مثلاً تلگرام رسید ولی بله نه) */
  messengers: { id: number; chan: Chan; label: string; ok: boolean }[];
}

/** مسیر نسبی سایت را به آدرس کامل تبدیل می‌کند؛ آدرس https همان می‌ماند؛ هر چیز دیگر (javascript: و …) نادیده گرفته می‌شود */
export function absoluteUrl(env: Env, url?: string): string | undefined {
  if (!url) return undefined;
  if (/^https:\/\//i.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return siteOf(env) + url;
  return undefined;
}

/** حساب اصلی و (اگر ورودی شناسه‌ی پیام‌رسان بود) همان شناسه */
async function accountOf(env: Env, uid: Uid): Promise<{ acct: Uid; botId: number | null }> {
  if (typeof uid === "string" && isWebId(uid)) return { acct: uid, botId: null };
  const n = Number(uid);
  if (!Number.isSafeInteger(n) || n <= 0) return { acct: String(uid), botId: null };
  return { acct: await resolveUid(env, n).catch(() => n as Uid), botId: n };
}

/** پیام‌رسان‌های گیرنده: همه‌ی هویت‌های وصل‌شده‌ی حساب + خودِ شناسه‌ی ورودی (اگر هنوز در فهرست نیست)، فقط با ربات فعال */
async function messengerIds(env: Env, acct: Uid, botId: number | null): Promise<number[]> {
  const ids = isWebId(acct) ? await notifyIds(env, String(acct)).catch(() => [] as number[]) : [];
  if (botId !== null && !ids.includes(botId) && chanReady(env, chanOf(botId))) ids.push(botId);
  return ids;
}

const defaultHtml = (env: Env, n: Notification): string => {
  const link = absoluteUrl(env, n.url);
  return `<b>${esc(n.title)}</b>\n\n${esc(n.body)}` + (link ? `\n\n🔗 ${esc(link)}` : "");
};

async function defaultEmail(env: Env, n: Notification, name: string): Promise<EmailContent> {
  // import پویا: plan-notify خودش از همین ماژول استفاده می‌کند و import ایستا حلقه می‌سازد
  const { render, firstName } = await import("./plan-notify");
  return render(env, `${n.title} — ${BRAND}`, {
    head: n.title, sub: `${firstName(name)}، یک پیام برایت داریم`,
    paras: n.body.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 6), rows: [],
    cta: "باز کردن ←", color: "#2563eb", href: absoluteUrl(env, n.url), campaign: n.emailTag || n.tag || "notify", promo: false,
    foot: "این پیام را به‌خاطر حساب‌ت در پاورپوینت‌ساز دریافت کرده‌ای.", preview: n.body.replace(/\s+/g, " ").slice(0, 120),
  });
}

/**
 * اعلان را به همه‌ی کانال‌های کاربر می‌فرستد. هرگز خطا پرتاب نمی‌کند.
 * `reachable === 0` یعنی کاربر هیچ کانال قابل‌رسیدنی ندارد (فراخواننده می‌تواند دیگر تلاش نکند)؛
 * `reachable > 0 && !ok` یعنی مقصد بود ولی ارسال نشد (خطای موقت؛ تلاش مجدد معنا دارد).
 */
export async function notifyUser(env: Env, uid: Uid, n: Notification): Promise<NotifyResult> {
  const out: NotifyResult = { ok: false, delivered: [], failed: [], reachable: 0, messengers: [] };
  try {
    const want = (k: NotifyKind) => (!n.only || n.only.includes(k)) && !n.except?.includes(k);
    const { acct, botId } = await accountOf(env, uid);
    const aid = String(acct);
    const web = isWebId(acct);
    const record = (k: NotifyKind, reached: boolean, ok: boolean) => { if (!reached) return; out.reachable++; (ok ? out.delivered : out.failed).push(k); };

    const jobs: Promise<void>[] = [];

    // ۱) همه‌ی پیام‌رسان‌ها (هر کدام جدا)
    if (want("messenger")) jobs.push((async () => {
      const ids = await messengerIds(env, acct, botId);
      if (!ids.length) return;
      const html = n.html ?? defaultHtml(env, n);
      const res = await Promise.all(ids.map(async (id) => {
        const chan = chanOf(id);
        try {
          await sendMessage(env, id, html, (await n.extra?.(id)) ?? {});
          return { id, chan, label: CHAN_LABEL[chan], ok: true };
        } catch (e) {
          console.error("notify messenger", chan, String(e).slice(0, 160));
          return { id, chan, label: CHAN_LABEL[chan], ok: false };
        }
      }));
      out.messengers.push(...res);
      record("messenger", true, res.some((r) => r.ok));
    })());

    // ۲) اپ اندروید (FCM)
    if (want("app")) jobs.push((async () => {
      const tokens = await fcmTokensOf(env, aid);
      if (!tokens.length) return;
      const r = await sendPushToUser(env, aid, { title: n.title, body: n.body, tag: n.tag, url: n.appUrl }, tokens, n.appDevices ?? 1);
      record("app", true, r.ok > 0);
    })());

    // ۳) اعلان مرورگر/PWA (فقط حساب وب)
    if (want("web") && web && webPushEnabled(env)) jobs.push((async () => {
      const r = await sendWebPush(env, aid, { title: n.title, body: n.body, url: n.url ?? "/", tag: n.tag });
      record("web", r.tried > 0, r.ok > 0);
    })());

    // ۴) ایمیل (فقط حساب وب با ایمیل ثبت‌شده)
    if (want("email") && web && emailEnabled(env)) jobs.push((async () => {
      const u = await getUserById(env, aid);
      if (!u?.email) return;
      const mail = typeof n.email === "function" ? await n.email({ to: u.email, name: u.name }) : n.email ?? await defaultEmail(env, n, u.name);
      const ok = await sendEmail(env, { to: u.email, ...mail, tag: n.emailTag ?? n.tag, idempotencyKey: n.key?.slice(0, 256) });
      record("email", true, ok);
    })());

    // هر کانال مستقل است: خطای غیرمنتظره‌ی یکی (مثلاً KV) کانال‌های دیگر را نمی‌اندازد
    (await Promise.allSettled(jobs)).forEach((r) => { if (r.status === "rejected") console.error("notify channel", String(r.reason).slice(0, 200)); });
    out.ok = out.delivered.length > 0;
  } catch (e) {
    console.error("notifyUser", String(e).slice(0, 300));
  }
  return out;
}

// =====================================================================================================================
// ارسال همگانی به «همه‌ی کانال‌ها» (فقط مدیر): /notifyall عنوان | متن | لینک ← /notifyall_send [all|nocredit]
// =====================================================================================================================
// هر کانال همان ورک‌فلوی همگانیِ خودش را دارد (سقف زیردرخواست هر کانال جداست)؛ این دستور فقط هر سه را با «یک متن» راه می‌اندازد:
//   پیام‌رسان‌ها (BroadcastWorkflow متنی) + اپ اندروید (FCM) + اعلان مرورگر. هر کدام گزارش پایانی خودش را برای مدیر می‌فرستد.
// ایمیل عمداً در ارسال همگانی نیست (سهمیه و قوانین ایمیل تبلیغاتی جداست)؛ ایمیل فقط در اعلان‌های تکی کاربر (notifyUser) می‌رود.
const ALL_AUDIENCES = ["all", "nocredit"] as const;
type AllAudience = (typeof ALL_AUDIENCES)[number];
const draftKey = (chatId: number) => `notifyall:draft:${chatId}`;
const TITLE_MAX = 80, BODY_MAX = 300; // سقف اعلان اپ/مرورگر (push.ts)
type Draft = { title: string; body: string; url?: string };

function parseDraft(raw: string): Draft | null {
  const [title, body, url] = raw.split("|").map((x) => x.trim());
  if (!title || !body || title.length > TITLE_MAX || body.length > BODY_MAX) return null;
  if (url && !/^https:\/\/[^\s]+$/.test(url)) return null;
  return { title, body, url: url || undefined };
}

/** راه‌اندازی هر سه ورک‌فلو؛ کانال‌هایی که روی سرور تنظیم نشده‌اند کنار گذاشته می‌شوند. برمی‌گرداند کدام کانال‌ها شروع شدند. */
export async function launchNotifyAll(env: Env, chatId: number, d: Draft, aud: AllAudience): Promise<NotifyKind[]> {
  const t = Date.now();
  const started: NotifyKind[] = [];
  const text = `${d.title}\n\n${d.body}${d.url ? `\n\n🔗 ${d.url}` : ""}`;
  const jobs: [NotifyKind, string, Record<string, unknown>][] = [
    ["messenger", `bc-${t}`, { adminChatId: chatId, text, audience: aud }],
  ];
  if (pushEnabled(env)) jobs.push(["app", `ap-${t}`, { adminChatId: chatId, text: "", appPush: { title: d.title, body: d.body, url: d.url, tag: "promo" }, appSegment: aud }]);
  // اعلان مرورگر گروه‌بندی ندارد: برای گروه محدود (nocredit) به همه‌ی حساب‌ها نمی‌رود
  if (webPushEnabled(env) && aud === "all") jobs.push(["web", `wp-${t}`, { adminChatId: chatId, text: "", webPush: { title: d.title, body: d.body, url: d.url, tag: "promo" } }]);
  for (const [kind, id, params] of jobs) {
    try { await env.BROADCAST_WORKFLOW.create({ id, params: params as never }); started.push(kind); }
    catch (e) { console.error("notifyall create", kind, String(e).slice(0, 200)); }
  }
  return started;
}

/** دستورهای مدیر: /notifyall عنوان | متن | لینک https (اختیاری)  ←  /notifyall_send [all|nocredit]  (یا /notifyall_cancel) */
export async function notifyAllCommand(env: Env, chatId: number, text: string): Promise<void> {
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  const say = (m: string) => sendMessage(env, chatId, m).then(() => undefined);
  if (cmd === "/notifyall_cancel") { await env.KV.delete(draftKey(chatId)); return say("🗑 پیش‌نویس حذف شد."); }
  if (cmd === "/notifyall_send") {
    const aud = (text.trim().split(/\s+/)[1] ?? "all").toLowerCase();
    if (!(ALL_AUDIENCES as readonly string[]).includes(aud)) return say(`گروه نامعتبر است. گروه‌ها: <code>all</code> (همه) یا <code>nocredit</code> (بدون پلن و بدون اعتبار).`);
    const raw = await env.KV.get(draftKey(chatId));
    const d = raw ? parseDraft(raw) : null;
    if (!d) return say("پیش‌نویسی نیست یا منقضی شده. اول /notifyall عنوان | متن | لینک را بفرست.");
    await env.KV.delete(draftKey(chatId)); // جلوگیری از ارسال دوباره
    const started = await launchNotifyAll(env, chatId, d, aud as AllAudience);
    if (!started.length) { await env.KV.put(draftKey(chatId), raw!, { expirationTtl: 3600 }); return say("❌ شروع ارسال ممکن نشد؛ دوباره امتحان کن."); }
    const missing = NOTIFY_KINDS.filter((k) => k !== "email" && !started.includes(k));
    return say(`📣 ارسال شروع شد: ${started.map((k) => NOTIFY_LABEL[k]).join("، ")}.\nگزارش پایانی هر کانال را جدا همین‌جا می‌فرستم.` + (missing.length ? `\n⏭ نرفت: ${missing.map((k) => NOTIFY_LABEL[k]).join("، ")} (کلید سرور تنظیم نیست، شروع نشد، یا اعلان مرورگر برای گروه محدود ارسال نمی‌شود)` : ""));
  }
  const d = parseDraft(text.slice(text.search(/\s/) < 0 ? text.length : text.search(/\s/)));
  if (!d) return say(`قالب: <code>/notifyall عنوان | متن | لینک https (اختیاری)</code>\nعنوان حداکثر ${TITLE_MAX} و متن حداکثر ${BODY_MAX} نویسه.\n\nیک پیام به همه‌ی کانال‌ها می‌رود: پیام‌رسان‌ها + اپ اندروید + اعلان مرورگر.`);
  await env.KV.put(draftKey(chatId), `${d.title} | ${d.body}${d.url ? ` | ${d.url}` : ""}`, { expirationTtl: 3600 });
  await say(`📣 <b>پیش‌نمایش</b>\n\n<b>${esc(d.title)}</b>\n${esc(d.body)}${d.url ? `\n🔗 ${esc(d.url)}` : ""}\n\nبرای ارسال به همه‌ی کانال‌ها: /notifyall_send\n(فقط بدون پلن و بدون اعتبار‌ها: <code>/notifyall_send nocredit</code>)\nبرای لغو: /notifyall_cancel`);
}
