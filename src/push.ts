/**
 * اعلان (push) به اپ اندروید با FCM (HTTP v1).
 *
 * ثبت: اپ توکن دستگاه را با POST /api/app/push می‌فرستد. کلیدها در KV:
 *   pt1:<توکن> = دستگاهی که اعلان تبلیغاتی/خبری را روشن دارد   |   pt0:<توکن> = خاموش دارد (فقط برای ثبت وضعیت)
 * ارسال: متغیر رمز FCM_SERVICE_ACCOUNT (کل JSON حساب سرویس فایربیس) لازم است. پیام «data-only» است؛ خود اپ اعلان را می‌سازد
 * (و اگر کاربر اعلان تبلیغاتی را خاموش کرده باشد نشان نمی‌دهد).
 * ارسال همگانی: از پنل مدیر در ربات (/admin ← 📱 اپ اندروید ← 📲 اعلان) یا دستور /apppush (BroadcastWorkflow با appPush).
 * اعلان هدفمند: انتخاب گروه با دکمه در پنل، یا /apppush_send <گروه> (all | nocredit | expiring | inactive). مقدار هر کلید pt1:/pt0: به‌شکل JSON {u: شناسه‌ی کاربر, t: آخرین بار باز شدن اپ}
 * است؛ شرط هر گروه هنگام ارسال از داده‌ی زنده‌ی سرور (اعتبار، پلن) خوانده می‌شود، نه از چیزی که اپ گفته است.
 */
import type { Env } from "./env";
import { esc, sendMessage } from "./telegram";

const TOKEN_RE = /^[\w:.-]{60,400}$/;
const TOKEN_TTL = 120 * 86400; // هر بار که اپ باز می‌شود تمدید می‌شود
export const pushEnabled = (env: Env) => !!env.FCM_SERVICE_ACCOUNT;
export type PushMsg = { title: string; body: string; url?: string };

/** گروه‌های مخاطب اعلان اپ */
export type PushSegment = "all" | "nocredit" | "expiring" | "inactive";
export const PUSH_SEGMENTS: Record<PushSegment, string> = {
  all: "همه‌ی دستگاه‌های دارای اعلان تبلیغاتی",
  nocredit: "بدون اعتبار (نه پلن فعال، نه اعتبار هدیه)",
  expiring: "پلن در حال انقضا (کمتر از ۳ روز)",
  inactive: "برنگشته به اپ در ۷ روز اخیر",
};
export const isPushSegment = (x: unknown): x is PushSegment => typeof x === "string" && Object.prototype.hasOwnProperty.call(PUSH_SEGMENTS, x);
const EXPIRING_MS = 3 * 86_400_000;
const INACTIVE_MS = 7 * 86_400_000;

// ---------- ثبت توکن ----------
// مقدار: JSON با شناسه‌ی کاربر و زمان آخرین باز شدن اپ (اپ در هر اجرا ثبت را تمدید می‌کند). مقدار قدیمی «1» یعنی کاربر نامشخص.
export async function putPushToken(env: Env, token: unknown, promo: boolean, remove: boolean, userId?: string): Promise<string | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return "توکن نامعتبر است.";
  await Promise.all([env.KV.delete(`pt1:${token}`), env.KV.delete(`pt0:${token}`)]);
  if (!remove) await env.KV.put(`${promo ? "pt1" : "pt0"}:${token}`, JSON.stringify({ u: userId, t: Date.now() }), { expirationTtl: TOKEN_TTL });
  return null;
}

export type TokenRow = { token: string; u?: string; t?: number };

/** یک صفحه از توکن‌های اعلان تبلیغاتی همراه با مقدارشان (یک پرس‌وجو). next = کلید آخرین ردیف برای صفحه‌ی بعد. */
export async function pushTokenPage(env: Env, cursor: string | undefined, limit: number): Promise<{ rows: TokenRow[]; next: string | null }> {
  await env.KV.ready();
  const res = await env.DB.prepare("SELECT k, v FROM kv WHERE k > ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) ORDER BY k LIMIT ?4")
    .bind(cursor ?? "pt1:", "pt1:\u{10FFFF}", Math.floor(Date.now() / 1000), limit + 1).all<{ k: string; v: string }>();
  const all = (res.results ?? []) as { k: string; v: string }[];
  const page = all.slice(0, limit);
  const rows = page.map((r) => {
    const row: TokenRow = { token: r.k.slice(4) };
    try {
      const j = JSON.parse(r.v);
      if (j && typeof j === "object") {
        if (typeof j.u === "string") row.u = j.u;
        if (Number.isFinite(j.t)) row.t = Number(j.t);
      }
    } catch { /* مقدار قدیمی «1» */ }
    return row;
  });
  return { rows, next: all.length > limit ? page[page.length - 1].k : null };
}

/** فقط ردیف‌هایی را نگه می‌دارد که در گروه مخاطب‌اند. nocredit و expiring با یک پرس‌وجو برای کل صفحه (حداکثر ۲۰ کاربر ⇒ ۴۱ پارامتر) از D1 خوانده می‌شوند. */
export async function filterSegment(env: Env, rows: TokenRow[], seg: PushSegment): Promise<TokenRow[]> {
  if (seg === "all") return rows;
  const now = Date.now();
  if (seg === "inactive") return rows.filter((r) => r.t !== undefined && now - r.t >= INACTIVE_MS);
  const known = rows.filter((r) => r.u);
  if (!known.length) return [];
  const keys = [...new Set(known.map((r) => r.u!))].flatMap((u) => [`sub:${u}`, `bonus:${u}`]);
  await env.KV.ready();
  const q = await env.DB.prepare(`SELECT k, v FROM kv WHERE (exp IS NULL OR exp > ?1) AND k IN (${keys.map((_, n) => `?${n + 2}`).join(",")})`)
    .bind(Math.floor(now / 1000), ...keys).all<{ k: string; v: string }>();
  const map = new Map(((q.results ?? []) as { k: string; v: string }[]).map((r) => [r.k, r.v]));
  return known.filter((r) => {
    let exp = 0, credits = 0;
    try { const sb = JSON.parse(map.get(`sub:${r.u}`) ?? "null"); exp = Number(sb?.exp) || 0; credits = Number(sb?.credits) || 0; } catch { /* بدون پلن */ }
    const planOn = exp > now;
    if (seg === "expiring") return planOn && exp - now <= EXPIRING_MS;
    const bonus = Math.floor(Number(map.get(`bonus:${r.u}`)) || 0);
    return !(planOn && credits > 0) && bonus <= 0; // nocredit؛ همان تعریف getActiveSub + getBonus
  });
}

// ---------- احراز هویت FCM ----------
const b64url = (b: ArrayBuffer | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

type Sa = { client_email: string; private_key: string; project_id: string };
const account = (env: Env): Sa | null => {
  try {
    const j = JSON.parse(env.FCM_SERVICE_ACCOUNT || "");
    return j.client_email && j.private_key && j.project_id ? (j as Sa) : null;
  } catch {
    return null;
  }
};

async function accessToken(env: Env, sa: Sa): Promise<string | null> {
  const cached = await env.KV.get("fcm:at");
  if (cached) return cached;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----|\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${b64url(sig)}` }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) { console.error("fcm token", r.status, (await r.text()).slice(0, 200)); return null; }
  const t = ((await r.json()) as { access_token?: string }).access_token;
  if (t) await env.KV.put("fcm:at", t, { expirationTtl: 3000 });
  return t ?? null;
}

/** ok = رسید به FCM؛ dead = توکن دیگر معتبر نیست (حذف شود)؛ fail = خطای موقت */
export async function sendPush(env: Env, token: string, m: PushMsg): Promise<"ok" | "dead" | "fail"> {
  const sa = account(env);
  if (!sa) return "fail";
  try {
    const at = await accessToken(env, sa);
    if (!at) return "fail";
    const data: Record<string, string> = { kind: "promo", title: m.title.slice(0, 80), body: m.body.slice(0, 300) };
    if (m.url) data.url = m.url;
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { token, data, android: { priority: "HIGH", ttl: "86400s" } } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.ok) return "ok";
    const txt = await r.text();
    if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(txt)) return "dead";
    if (r.status === 401) await env.KV.delete("fcm:at").catch(() => {});
    console.error("fcm send", r.status, txt.slice(0, 160));
    return "fail";
  } catch (e) {
    console.error("fcm send", String(e).slice(0, 160));
    return "fail";
  }
}

// ---------- اعلان به اپ از پنل مدیر (/admin ← 📱 اپ اندروید ← 📲 اعلان) و دستورهای متنی /apppush و /apppush_send ----------
export const pushDraftKey = (chatId: number) => `apppush:draft:${chatId}`;
export const pushSegKey = (chatId: number) => `apppush:seg:${chatId}`;
export const PUSH_TITLE_MAX = 80; // همان سقفی که sendPush اعمال می‌کند
export const PUSH_BODY_MAX = 300;

export const parsePushDraft = (raw: string): PushMsg | null => {
  const [title, body, url] = raw.split("|").map((x) => x.trim());
  if (!title || !body) return null;
  if (url && !/^https:\/\/[^\s]+$/.test(url)) return null;
  return { title, body, url: url || undefined };
};

export async function getPushDraft(env: Env, chatId: number): Promise<PushMsg | null> {
  try { const d = await env.KV.get(pushDraftKey(chatId)); return d ? (JSON.parse(d) as PushMsg) : null; } catch { return null; }
}
export const savePushDraft = (env: Env, chatId: number, msg: PushMsg) => env.KV.put(pushDraftKey(chatId), JSON.stringify(msg), { expirationTtl: 3600 });
export async function getPushSegment(env: Env, chatId: number): Promise<PushSegment> {
  const raw = await env.KV.get(pushSegKey(chatId));
  return isPushSegment(raw) ? raw : "all";
}
export const setPushSegment = (env: Env, chatId: number, seg: PushSegment) => env.KV.put(pushSegKey(chatId), seg, { expirationTtl: 3600 });
export async function clearPushDraft(env: Env, chatId: number) {
  await Promise.all([env.KV.delete(pushDraftKey(chatId)), env.KV.delete(pushSegKey(chatId))]);
}

export const pushPreviewText = (msg: PushMsg) => `<b>${esc(msg.title)}</b>\n${esc(msg.body)}${msg.url ? `\n🔗 ${esc(msg.url)}` : ""}`;

/** شروع ارسال اعلان (BroadcastWorkflow)؛ گزارش پایانی را خود Workflow برای مدیر می‌فرستد */
export async function launchAppPush(env: Env, chatId: number, msg: PushMsg, seg: PushSegment): Promise<void> {
  await env.BROADCAST_WORKFLOW.create({ id: `ap-${Date.now()}`, params: { adminChatId: chatId, text: "", appPush: msg, appSegment: seg } });
}

/** تعداد دستگاه‌های ثبت‌شده: اعلان تبلیغاتی روشن / خاموش */
export async function pushDeviceCounts(env: Env): Promise<{ on: number; off: number }> {
  await env.KV.ready();
  const now = Math.floor(Date.now() / 1000);
  const c = async (pre: string) => Number((await env.DB.prepare("SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3)")
    .bind(pre, pre + "\u{10FFFF}", now).first<{ c: number | null }>())?.c ?? 0);
  const [on, off] = await Promise.all([c("pt1:"), c("pt0:")]);
  return { on, off };
}

// دستور متنی (قدیمی، هنوز کار می‌کند): /apppush عنوان | متن | لینک(اختیاری) ← /apppush_send [گروه]
export async function appPushCommand(env: Env, chatId: number, text: string): Promise<void> {
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  const panel = { reply_markup: { inline_keyboard: [[{ text: "📲 باز کردن در پنل (دکمه‌ای)", callback_data: "ad:pu" }]] } };
  if (!pushEnabled(env)) return void (await sendMessage(env, chatId, "⚠️ اعلان اپ فعال نیست: رمز <code>FCM_SERVICE_ACCOUNT</code> تنظیم نشده است."));
  if (cmd === "/apppush_send") {
    const seg = (text.trim().split(/\s+/)[1] ?? "all").toLowerCase();
    if (!isPushSegment(seg)) return void (await sendMessage(env, chatId, `گروه نامعتبر است. گروه‌ها:\n${Object.entries(PUSH_SEGMENTS).map(([k, v]) => `<code>${k}</code> — ${v}`).join("\n")}`, panel));
    const msg = await getPushDraft(env, chatId);
    if (!msg) return void (await sendMessage(env, chatId, "پیش‌نویسی نیست. اول /apppush عنوان | متن | لینک را بفرست، یا از پنل اقدام کن.", panel));
    await clearPushDraft(env, chatId);
    await launchAppPush(env, chatId, msg, seg);
    return void (await sendMessage(env, chatId, `📲 ارسال اعلان به اپ شروع شد (${PUSH_SEGMENTS[seg]})؛ گزارش پایانی را همین‌جا می‌فرستم.`));
  }
  const msg = parsePushDraft(text.slice(text.search(/\s/) < 0 ? text.length : text.search(/\s/)));
  if (!msg) return void (await sendMessage(env, chatId, "قالب: <code>/apppush عنوان | متن | لینک https (اختیاری)</code>\n\nیا از پنل با دکمه: /admin ← 📱 اپ اندروید ← 📲 اعلان", panel));
  await savePushDraft(env, chatId, msg);
  await sendMessage(env, chatId, `📲 <b>پیش‌نمایش اعلان</b>\n\n${pushPreviewText(msg)}\n\nگروه مخاطب را انتخاب کن و ارسال را بزن (دکمه‌ی زیر):`, panel);
}
