/**
 * پروفایل وب خودکار برای کاربران ربات تلگرام (تلگرام‌محور).
 *
 * هر کاربر ربات از اولین پیام یک پروفایل وب می‌گیرد (ensureUid)؛ شناسه‌ی پروفایل از شناسه‌ی تلگرام ساخته می‌شود
 * (ثابت و بی‌تکرار). ربات برای همه‌ی کارها (اعتبار، پلن، تنظیمات، قفل، فایل) از شناسه‌ی همین پروفایل استفاده می‌کند.
 * دکمه‌های خرید در ربات لینک ورود یک‌بارمصرف دارند (createLoginToken ← /api/auth/tg)؛ مالکیت تلگرام را خود تلگرام ثابت می‌کند
 * چون لینک فقط به چت خود کاربر فرستاده می‌شود. مدیرها (ADMIN_IDS) پروفایل خودکار ندارند و شناسه‌ی عددی می‌مانند.
 */
import type { Env } from "./env";
import { getUserById, hitLimit, randomToken, saveWebUser } from "./auth";
import { isAdmin, type Uid } from "./settings";

const LOGIN_TTL = 3600; // ثانیه؛ لینک ورود از دکمه‌های ربات (یک‌بارمصرف)
const WEB_ID = /^w_[0-9a-f]{16}$/;

/** شناسه‌ی اصلی کاربر: اگر پروفایل وبش ساخته شده شناسه‌ی آن؛ وگرنه (مدیر/پیش از اولین پیام) خود شناسه‌ی تلگرام */
export async function resolveUid(env: Env, tgId: number): Promise<Uid> {
  if (isAdmin(env, tgId)) return tgId;
  const w = await env.KV.get(`tg2w:${tgId}`).catch(() => null);
  return w && WEB_ID.test(w) ? w : tgId;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
/** شناسه‌ی ثابت پروفایل هر تلگرام؛ ثابت بودنش یعنی ساخت دوباره/هم‌زمان هرگز حساب تکراری نمی‌سازد */
async function profileId(tgId: number): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`tg:${tgId}`)));
  return "w_" + hex(d.slice(0, 8));
}

/** هر کاربر ربات یک پروفایل وب دارد؛ اگر نبود با نام تلگرام ساخته می‌شود. مدیرها شناسه‌ی عددی می‌مانند. */
export async function ensureUid(env: Env, tgId: number, name = ""): Promise<Uid> {
  const cur = await resolveUid(env, tgId);
  if (typeof cur === "string" || isAdmin(env, tgId)) return cur;
  const id = await profileId(tgId);
  if (!(await getUserById(env, id))) {
    await saveWebUser(env, { id, email: "", name: (name || "کاربر تلگرام").slice(0, 64), verified: false, created: Date.now() });
  }
  await env.KV.put(`tg2w:${tgId}`, id);
  return id;
}

/** لینک ورود یک‌بارمصرف به سایت برای این تلگرام (اعتبار ۱ ساعت)؛ null = محدودیت تعداد */
export async function createLoginToken(env: Env, tgId: number): Promise<string | null> {
  if (await hitLimit(env, `tglr:${tgId}`, 40, 3600)) return null;
  const t = randomToken(24);
  await env.KV.put(`tgl:${t}`, String(tgId), { expirationTtl: LOGIN_TTL });
  return t;
}
export async function consumeLoginToken(env: Env, token: string): Promise<number | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const v = await env.KV.get(`tgl:${token}`);
  if (!v) return null;
  await env.KV.delete(`tgl:${token}`).catch(() => {});
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
