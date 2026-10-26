/**
 * Telegram Mini App (public/app.html، آدرس /app).
 *
 * ورود: تلگرام هنگام باز شدن Mini App رشته‌ی initData را (با امضای HMAC به کلید توکن ربات) به صفحه می‌دهد.
 * اینجا امضا و تازگی آن بررسی می‌شود؛ تلگرام کاربر همان پروفایل وب خودکار ربات (ensureUid) را می‌گیرد، پس اعتبار، پلن،
 * تنظیمات و فایل‌ها با ربات و سایت یکی است. نشست به‌صورت توکن Bearer برمی‌گردد (نه کوکی)، چون Telegram Web صفحه را در iframe
 * باز می‌کند و کوکی‌های SameSite در iframe فرستاده نمی‌شوند. سایر API ها (generate، jobs، files، settings) همان API نسخه‌ی وب‌اند.
 */
import type { Env } from "./env";
import { createSession, getUserById, hitLimit, publicUser, type WebUser } from "./auth";
import { displayName, isAdmin, isAllowed, isBanned, noteActive, touchUser } from "./settings";
import { ensureUid, getLinkedTg } from "./link";
import { loadFileDirect } from "./files";
import { esc, sendDocument } from "./telegram";
import { siteLoginUrl } from "./deck-service";

const enc = new TextEncoder();
const INIT_MAX_AGE = 86_400; // ثانیه؛ initData قدیمی‌تر از یک روز پذیرفته نمی‌شود

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const err = (message: string, status = 400) => json({ error: message }, status);

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function hmac(key: BufferSource, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}

export interface TgUser { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }

/** بررسی امضای initData طبق مستندات تلگرام؛ کاربر تلگرام یا null (امضا نادرست/منقضی) */
export async function verifyInitData(botToken: string, initData: string, now = Date.now()): Promise<TgUser | null> {
  if (!botToken) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  p.delete("hash");
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  if (!safeEqual(hex(await hmac(secret, check)), hash)) return null;
  const age = now / 1000 - Number(p.get("auth_date"));
  if (!Number.isFinite(age) || age > INIT_MAX_AGE || age < -300) return null;
  try {
    const u = JSON.parse(p.get("user") ?? "null") as TgUser | null;
    return u && Number.isSafeInteger(u.id) && u.id > 0 ? u : null;
  } catch { return null; }
}

/** POST /api/auth/miniapp {initData} ← {token, user}؛ توکن را کلاینت در هدر Authorization: Bearer می‌فرستد */
export async function miniappLogin(req: Request, env: Env, ip: string): Promise<Response> {
  if (await hitLimit(env, `mal:${ip}`, 40, 600)) return err("تعداد درخواست زیاد بود؛ چند دقیقه بعد دوباره امتحان کن.", 429);
  if (Number(req.headers.get("content-length") ?? 0) > 8_000) return err("درخواست نامعتبر", 413);
  const b = (await req.json().catch(() => null)) as { initData?: unknown } | null;
  const initData = typeof b?.initData === "string" ? b.initData : "";
  if (initData.length < 20 || initData.length > 4_096) return err("اطلاعات ورود از تلگرام نیامد؛ Mini App را از داخل ربات باز کن.", 400);
  const u = await verifyInitData(env.TELEGRAM_BOT_TOKEN, initData);
  if (!u || u.is_bot) return err("ورود از تلگرام تایید نشد؛ Mini App را بسته و دوباره از داخل ربات باز کن.", 401);

  if (await isBanned(env, u.id)) return err("دسترسی شما مسدود شده است.", 403);
  if (!isAllowed(env, u.id)) return err("این سرویس خصوصی است و دسترسی نداری.", 403);
  if (isAdmin(env, u.id)) return err("مدیرها حساب وب ندارند؛ برای کار با ربات از خود چت تلگرام استفاده کن.", 403); // مثل ورود خودکار به سایت

  const name = displayName(u);
  const uid = await ensureUid(env, u.id, name); // پروفایل وب خودکار (همان پروفایل ربات)
  if (typeof uid !== "string") return err("حساب شما پیدا نشد؛ ابتدا ربات را Start کن.", 403);
  if (await isBanned(env, uid)) return err("دسترسی شما مسدود شده است.", 403);
  await touchUser(env, u.id, u.username, name).catch((e) => console.error("touchUser", e));
  await noteActive(env, u.id, u.username, name).catch((e) => console.error("noteActive", e));
  await env.KV.put(`w2tg:${uid}`, String(u.id)).catch(() => {});

  const user = await getUserById(env, uid);
  if (!user) return err("حساب شما پیدا نشد؛ دوباره امتحان کن.", 500);
  return json({ token: await createSession(env, uid), user: publicUser(user) });
}

const MIME: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
};

/** POST /api/miniapp/send {id} — فایل (pptx، جزوه، پوستر) را ربات به چت تلگرام خود کاربر می‌فرستد.
 *  دانلود مستقیم blob داخل WebView تلگرام (به‌خصوص iOS) قابل‌اتکا نیست؛ ارسال به چت همه‌جا کار می‌کند. */
export async function miniappSend(env: Env, user: WebUser, body: Record<string, unknown> | null, ip: string): Promise<Response> {
  const id = typeof body?.id === "string" ? body.id : "";
  if (!/^[\w-]{1,100}$/.test(id)) return err("فایل نامعتبر است.", 400);
  const tgId = await getLinkedTg(env, user.id);
  if (!tgId) return err("حساب تلگرام شما پیدا نشد؛ Mini App را از داخل ربات باز کن.", 409);
  if (await hitLimit(env, `mas:${user.id}`, 30, 3600) || await hitLimit(env, `mas:ip:${ip}`, 90, 3600)) return err("تعداد ارسال‌ها زیاد بود؛ کمی بعد دوباره امتحان کن.", 429);
  const f = await loadFileDirect(env, user.id, id);
  if (!f) return err("فایل پیدا نشد یا منقضی شده است (فایل‌ها ۲۴ ساعت نگه داشته می‌شوند).", 404);
  const ext = (f.entry.name.split(".").pop() ?? "").toLowerCase();
  const label = ext === "docx" ? "📝 جزوه" : ext === "png" || ext === "jpg" || ext === "jpeg" ? "🖼 پوستر" : "📥 ارائه";
  try {
    await sendDocument(env, tgId, new Uint8Array(f.data), f.entry.name, `${label}: ${esc(f.entry.title.slice(0, 120))}`, { mime: MIME[ext] ?? "application/octet-stream" });
  } catch (e) {
    console.error("miniapp send", String(e).slice(0, 200));
    return err("ارسال فایل به چت ناموفق بود؛ مطمئن شو ربات را مسدود نکرده‌ای و دوباره امتحان کن.", 502);
  }
  return json({ ok: true });
}

/** POST /api/miniapp/buy — لینک ورود یک‌بارمصرف به صفحه‌ی خرید پلن در سایت (برای باز شدن در مرورگر بیرونی) */
export async function miniappBuy(env: Env, user: WebUser): Promise<Response> {
  const tgId = await getLinkedTg(env, user.id);
  return json({ url: await siteLoginUrl(env, tgId ?? undefined, "buy") });
}
