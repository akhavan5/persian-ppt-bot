/**
 * اعلان وب (Web Push / PWA) برای مرورگرها و PWA نصب‌شده، بدون وابستگی بیرونی (فقط WebCrypto).
 *
 * - کلیدها: متغیرهای VAPID_PUBLIC_KEY (۶۵ بایت، base64url) و VAPID_PRIVATE_KEY (۳۲ بایت، base64url) و اختیاری VAPID_SUBJECT.
 *   ساخت کلید: `npx tsx scripts/vapid-keys.ts`. بدون این دو متغیر همه‌چیز بی‌اثر است (pushEnabled نادرست می‌ماند).
 * - ثبت: مرورگر اشتراک (endpoint + کلید p256dh + auth) را با POST /api/webpush/sub می‌فرستد ← wps:<حساب> = آرایه‌ی حداکثر ۵ دستگاه (۱۲۰ روز، با هر باز شدن سایت تمدید می‌شود).
 * - ارسال: بدنه با RFC 8291 (aes128gcm) رمز می‌شود و با هدر VAPID (RFC 8292، ES256) به سرویس اعلان مرورگر POST می‌شود؛ ۴۰۴/۴۱۰ یعنی اشتراک مرده و حذف می‌شود.
 * - امنیت: چون Worker به نشانی «اشتراک» درخواست می‌زند، فقط میزبان‌های شناخته‌شده‌ی سرویس اعلان پذیرفته می‌شوند (جلوگیری از SSRF).
 * هرگز خطا پرتاب نمی‌کند.
 */
import type { Env } from "./env";

const te = new TextEncoder();
const SUBS_TTL = 120 * 86_400; // ثانیه
const MAX_DEVICES = 5;
const MAX_PAYLOAD = 3000; // بایت؛ سقف یک رکورد aes128gcm با rs=4096 حدود ۴۰۷۸ بایت است

export const webPushEnabled = (env: Env) => !!(env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim());
export interface WebPushMsg { title: string; body: string; url?: string; tag?: string }
export interface Device { e: string; p: string; a: string; t: number }

// ---------- base64url و ابزارهای بایتی ----------
export const bytesToB64u = (b: Uint8Array): string => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const b64uToBytes = (s: string): Uint8Array => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const concat = (...a: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) { out.set(x, o); o += x.length; }
  return out;
};

// ---------- رمزنگاری بدنه (RFC 8291، aes128gcm) ----------
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, k, len * 8));
}
const ecJwk = (pub: Uint8Array, d?: Uint8Array): JsonWebKey => ({
  kty: "EC", crv: "P-256", x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33, 65)), ...(d ? { d: bytesToB64u(d) } : {}), ext: true,
});

/** fixed فقط برای آزمون با بردار نمونه‌ی RFC 8291 است؛ در استفاده‌ی واقعی salt و کلید موقت تصادفی ساخته می‌شود. */
export async function encryptWebPush(
  uaPublic: Uint8Array, authSecret: Uint8Array, plaintext: Uint8Array,
  fixed?: { salt: Uint8Array; asPublic: Uint8Array; asPrivate: Uint8Array },
): Promise<Uint8Array> {
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  let asPub: Uint8Array, asPriv: CryptoKey;
  if (fixed) {
    asPub = fixed.asPublic;
    asPriv = await crypto.subtle.importKey("jwk", ecJwk(fixed.asPublic, fixed.asPrivate), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    asPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    asPriv = kp.privateKey;
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPriv, 256));
  const ikm = await hkdf(authSecret, secret, concat(te.encode("WebPush: info\0"), uaPublic, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aes, concat(plaintext, new Uint8Array([2])) as BufferSource));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = 65;
  return concat(head, asPub, ct);
}

// ---------- VAPID (RFC 8292) ----------
let vapidCache: { id: string; key: CryptoKey } | null = null;
async function vapidKey(env: Env): Promise<CryptoKey> {
  const pub = env.VAPID_PUBLIC_KEY!.trim(), priv = env.VAPID_PRIVATE_KEY!.trim();
  const id = pub + priv.slice(-6);
  if (vapidCache?.id === id) return vapidCache.key;
  const key = await crypto.subtle.importKey("jwk", ecJwk(b64uToBytes(pub), b64uToBytes(priv)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  vapidCache = { id, key };
  return key;
}
export async function vapidHeader(env: Env, endpoint: string, now = Date.now()): Promise<string> {
  const site = (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");
  const head = bytesToB64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT?.trim() || site })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidKey(env), te.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${bytesToB64u(sig)}, k=${env.VAPID_PUBLIC_KEY!.trim()}`;
}

// ---------- ثبت اشتراک ----------
const HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function validEndpoint(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 700) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && HOSTS.some((r) => r.test(u.hostname));
  } catch { return false; }
}
const subsKey = (uid: string) => `wps:${uid}`;

async function readDevices(env: Env, uid: string): Promise<Device[]> {
  const raw = (await env.KV.get(subsKey(uid), "json").catch(() => null)) as Device[] | null;
  return Array.isArray(raw) ? raw.filter((d) => d && typeof d.e === "string" && typeof d.p === "string" && typeof d.a === "string") : [];
}
async function writeDevices(env: Env, uid: string, list: Device[]) {
  if (!list.length) await env.KV.delete(subsKey(uid));
  else await env.KV.put(subsKey(uid), JSON.stringify(list.slice(0, MAX_DEVICES)), { expirationTtl: SUBS_TTL });
}

/** sub = PushSubscription.toJSON() مرورگر. خطا = متن فارسی؛ موفق = null */
export async function saveWebSub(env: Env, uid: string, sub: unknown): Promise<string | null> {
  const s = sub as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!s || !validEndpoint(s.endpoint)) return "اشتراک اعلان نامعتبر است.";
  const p = typeof s.keys?.p256dh === "string" ? s.keys.p256dh : "", a = typeof s.keys?.auth === "string" ? s.keys.auth : "";
  try {
    if (b64uToBytes(p).length !== 65 || b64uToBytes(p)[0] !== 4 || b64uToBytes(a).length !== 16) return "کلیدهای اشتراک نامعتبر است.";
  } catch { return "کلیدهای اشتراک نامعتبر است."; }
  const rest = (await readDevices(env, uid)).filter((d) => d.e !== s.endpoint);
  await writeDevices(env, uid, [{ e: s.endpoint, p, a, t: Date.now() }, ...rest]);
  return null;
}
export async function removeWebSub(env: Env, uid: string, endpoint: unknown): Promise<void> {
  if (typeof endpoint !== "string") return;
  await writeDevices(env, uid, (await readDevices(env, uid)).filter((d) => d.e !== endpoint));
}

// ---------- ارسال ----------
type One = "ok" | "gone" | "fail";
async function sendOne(env: Env, d: Device, body: Uint8Array): Promise<One> {
  try {
    const enc = await encryptWebPush(b64uToBytes(d.p), b64uToBytes(d.a), body);
    const r = await fetch(d.e, {
      method: "POST",
      headers: { authorization: await vapidHeader(env, d.e), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "normal" },
      body: enc as BodyInit,
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) return "ok";
    if (r.status === 404 || r.status === 410) return "gone";
    console.error("webpush status", r.status, (await r.text().catch(() => "")).slice(0, 120));
    return "fail";
  } catch (e) {
    console.error("webpush send", String(e).slice(0, 200));
    return "fail";
  }
}

/** به همه‌ی دستگاه‌های ثبت‌شده‌ی حساب (حداکثر ۳ دستگاه تازه‌تر) اعلان می‌فرستد؛ اشتراک‌های مرده حذف می‌شوند. ok = تعداد دستگاه‌هایی که پذیرفتند. */
export async function sendWebPush(env: Env, uid: string, msg: WebPushMsg): Promise<{ ok: number; tried: number }> {
  if (!webPushEnabled(env)) return { ok: 0, tried: 0 };
  try {
    const all = await readDevices(env, uid);
    const targets = all.slice(0, 3);
    if (!targets.length) return { ok: 0, tried: 0 };
    const body = te.encode(JSON.stringify({ title: msg.title.slice(0, 80), body: msg.body.slice(0, 300), url: msg.url ?? "/", tag: msg.tag ?? "ppt" }));
    if (body.length > MAX_PAYLOAD) return { ok: 0, tried: 0 };
    const res = await Promise.all(targets.map((d) => sendOne(env, d, body)));
    const gone = new Set(targets.filter((_, i) => res[i] === "gone").map((d) => d.e));
    if (gone.size) await writeDevices(env, uid, all.filter((d) => !gone.has(d.e))).catch(() => {});
    return { ok: res.filter((r) => r === "ok").length, tried: targets.length };
  } catch (e) {
    console.error("sendWebPush", String(e).slice(0, 200));
    return { ok: 0, tried: 0 };
  }
}

// ---------- ارسال همگانی از پنل مدیر (BroadcastWorkflow با webPush) ----------
export const WP_PREFIX = "wps:";
/** تعداد حساب‌ها و دستگاه‌های دارای اشتراک فعال */
export async function webPushCounts(env: Env): Promise<{ accounts: number; devices: number }> {
  await env.KV.ready();
  const r = await env.DB.prepare(
    "SELECT COUNT(*) a, COALESCE(SUM(CASE WHEN json_valid(v) AND json_type(v)='array' THEN json_array_length(v) ELSE 0 END),0) d FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3)",
  ).bind(WP_PREFIX, WP_PREFIX + "\u{10FFFF}", Math.floor(Date.now() / 1000)).first<{ a: number | null; d: number | null }>();
  return { accounts: Number(r?.a ?? 0), devices: Number(r?.d ?? 0) };
}
/** یک صفحه از اشتراک‌ها همراه با دستگاه‌هایشان (یک پرس‌وجو). next = کلید آخرین ردیف صفحه (برای ادامه) */
export async function webPushPage(env: Env, cursor: string | undefined, limit: number): Promise<{ rows: { key: string; uid: string; devices: Device[] }[]; next: string | null }> {
  await env.KV.ready();
  const res = await env.DB.prepare("SELECT k, v FROM kv WHERE k > ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) ORDER BY k LIMIT ?4")
    .bind(cursor ?? WP_PREFIX, WP_PREFIX + "\u{10FFFF}", Math.floor(Date.now() / 1000), limit + 1).all<{ k: string; v: string }>();
  const all = (res.results ?? []) as { k: string; v: string }[];
  const page = all.slice(0, limit);
  const rows = page.map((r) => {
    let devices: Device[] = [];
    try { const j = JSON.parse(r.v); if (Array.isArray(j)) devices = j.filter((d) => d && typeof d.e === "string" && typeof d.p === "string" && typeof d.a === "string"); } catch { /* نامعتبر */ }
    return { key: r.k, uid: r.k.slice(WP_PREFIX.length), devices };
  });
  return { rows, next: all.length > limit ? page[page.length - 1].k : null };
}
/** به دستگاه‌های از‌پیش‌خوانده‌شده‌ی یک حساب می‌فرستد (حداکثر ۳ تازه‌ترین)؛ اشتراک مرده حذف می‌شود. cost = تعداد درخواست‌های بیرونی/نوشتن برای بودجه‌ی Workflow */
export async function sendWebPushDevices(env: Env, uid: string, all: Device[], msg: WebPushMsg): Promise<{ ok: number; tried: number; cost: number }> {
  const targets = all.slice(0, 3);
  if (!targets.length) return { ok: 0, tried: 0, cost: 0 };
  const body = te.encode(JSON.stringify({ title: msg.title.slice(0, 80), body: msg.body.slice(0, 300), url: msg.url ?? "/", tag: msg.tag ?? "ppt" }));
  if (body.length > MAX_PAYLOAD) return { ok: 0, tried: 0, cost: 0 };
  const res = await Promise.all(targets.map((d) => sendOne(env, d, body)));
  const gone = new Set(targets.filter((_, i) => res[i] === "gone").map((d) => d.e));
  if (gone.size) await writeDevices(env, uid, all.filter((d) => !gone.has(d.e))).catch(() => {});
  return { ok: res.filter((r) => r === "ok").length, tried: targets.length, cost: targets.length + (gone.size ? 1 : 0) };
}
