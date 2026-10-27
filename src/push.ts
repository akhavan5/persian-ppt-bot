/**
 * اعلان (push) به اپ اندروید با FCM (HTTP v1).
 *
 * ثبت: اپ توکن دستگاه را با POST /api/app/push می‌فرستد. کلیدها در KV:
 *   pt1:<توکن> = دستگاهی که اعلان تبلیغاتی/خبری را روشن دارد   |   pt0:<توکن> = خاموش دارد (فقط برای ثبت وضعیت)
 * ارسال: متغیر رمز FCM_SERVICE_ACCOUNT (کل JSON حساب سرویس فایربیس) لازم است. پیام «data-only» است؛ خود اپ اعلان را می‌سازد
 * (و اگر کاربر اعلان تبلیغاتی را خاموش کرده باشد نشان نمی‌دهد).
 * ارسال همگانی: از دستور مدیر /apppush در ربات تلگرام (BroadcastWorkflow با appPush).
 */
import type { Env } from "./env";
import { esc, sendMessage } from "./telegram";

const TOKEN_RE = /^[\w:.-]{60,400}$/;
const TOKEN_TTL = 120 * 86400; // هر بار که اپ باز می‌شود تمدید می‌شود
export const pushEnabled = (env: Env) => !!env.FCM_SERVICE_ACCOUNT;
export type PushMsg = { title: string; body: string; url?: string };

// ---------- ثبت توکن ----------
export async function putPushToken(env: Env, token: unknown, promo: boolean, remove: boolean): Promise<string | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return "توکن نامعتبر است.";
  await Promise.all([env.KV.delete(`pt1:${token}`), env.KV.delete(`pt0:${token}`)]);
  if (!remove) await env.KV.put(`${promo ? "pt1" : "pt0"}:${token}`, "1", { expirationTtl: TOKEN_TTL });
  return null;
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

// ---------- دستور مدیر در ربات: /apppush عنوان | متن | لینک(اختیاری) ← /apppush_send ----------
export const parsePushDraft = (raw: string): PushMsg | null => {
  const [title, body, url] = raw.split("|").map((x) => x.trim());
  if (!title || !body) return null;
  if (url && !/^https:\/\/[^\s]+$/.test(url)) return null;
  return { title, body, url: url || undefined };
};

export async function appPushCommand(env: Env, chatId: number, text: string): Promise<void> {
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  const key = `apppush:draft:${chatId}`;
  if (!pushEnabled(env)) return void (await sendMessage(env, chatId, "⚠️ اعلان اپ فعال نیست: رمز <code>FCM_SERVICE_ACCOUNT</code> تنظیم نشده است."));
  if (cmd === "/apppush_send") {
    const d = await env.KV.get(key);
    if (!d) return void (await sendMessage(env, chatId, "پیش‌نویسی نیست. اول /apppush عنوان | متن | لینک را بفرست."));
    await env.KV.delete(key);
    const msg = JSON.parse(d) as PushMsg;
    await env.BROADCAST_WORKFLOW.create({ id: `ap-${Date.now()}`, params: { adminChatId: chatId, text: "", appPush: msg } });
    return void (await sendMessage(env, chatId, "📲 ارسال اعلان به اپ شروع شد؛ گزارش پایانی را همین‌جا می‌فرستم."));
  }
  const msg = parsePushDraft(text.slice(text.search(/\s/) < 0 ? text.length : text.search(/\s/)));
  if (!msg) return void (await sendMessage(env, chatId, "قالب: <code>/apppush عنوان | متن | لینک https (اختیاری)</code>"));
  await env.KV.put(key, JSON.stringify(msg), { expirationTtl: 3600 });
  await sendMessage(env, chatId, `📲 <b>پیش‌نمایش اعلان</b>\n\n<b>${esc(msg.title)}</b>\n${esc(msg.body)}${msg.url ? `\n🔗 ${esc(msg.url)}` : ""}\n\nبرای ارسال به همه‌ی دستگاه‌هایی که اعلان تبلیغاتی را روشن دارند: /apppush_send`);
}
