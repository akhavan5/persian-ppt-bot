/** متن، لینک و دکمه‌ی «دعوت دوستان» برای همه‌ی پلتفرم‌ها (تلگرام، بله، روبیکا، ایتا، سایت و اپ اندروید)؛ هم برای /invite در ربات، هم پیام همگانی (نشانه‌ی {invite})،
 *  هم یادآوری lifecycle و هم API سایت/اپ/Mini App استفاده می‌شود تا دقیقاً یکسان بمانند. */
import type { Env } from "./env";
import { REF_EVERY, REF_MAX, botPlatform, type RefId } from "./settings";
import { toFa } from "./util";
import { tg } from "./telegram";
import { eitaaLink, withBtn } from "./eitaa";

/** اگر در متن پیام همگانی باشد، برای هر کاربر با بلوک /invite خودش (لینک اختصاصی + شمارنده) جایگزین می‌شود */
export const INVITE_TOKEN = "{invite}";

/** پلتفرم دعوت‌کننده: پیام‌رسان از روی بازه‌ی شناسه، «web» برای حساب فقط‌وب/اپ (شناسه‌ی w_…) */
export type InvitePlatform = "tg" | "bale" | "rubika" | "eitaa" | "splus" | "web";
export const invitePlatform = (id: RefId): InvitePlatform => (typeof id === "string" ? "web" : (botPlatform(id) as InvitePlatform));

/** لینک اختصاصی دعوت (تلگرام) */
export const telegramInviteLink = (botUsername: string, userId: number) => `https://t.me/${botUsername}?start=ref_${userId}`;

const siteBase = (env: Env) => (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");
/** لینک دعوت سایت: صفحه‌ی اصلی با ?ref=<شناسه>؛ سایت و اپ اندروید هر دو همین را می‌فرستند (سایت کد را بعد از ورود ثبت می‌کند) */
export const webInviteLink = (env: Env, id: RefId) => `${siteBase(env)}/?ref=${encodeURIComponent(String(id))}`;
/** لینک دعوت برنامک ایتا: لینک مستقیم برنامک با startapp=ref_<شناسه> (Mini App آن را بعد از ورود ثبت می‌کند)؛ بدون EITAA_MINIAPP_LINK خالی */
export const eitaaInviteLink = (env: Env, id: RefId) => { const l = eitaaLink(env); return l ? withBtn(`${l}${l.includes("?") ? "&" : "?"}startapp=ref_${id}`, "ساخت ارائه") : ""; };

// نام کاربری هر ربات (getMe) در حافظه‌ی همین نمونه نگه داشته می‌شود؛ ربات‌ها عوض نمی‌شوند و getMe یک درخواست شبکه است
const botNames = new Map<string, string>();
const envOf = (env: Env, plat: "tg" | "bale" | "rubika" | "splus"): Env =>
  plat === "tg" ? (env.PLATFORM ? { ...env, PLATFORM: undefined } : env) : env.PLATFORM === plat ? env : { ...env, PLATFORM: plat };
/** نام کاربری ربات پلتفرم (بدون @)؛ ناموفق = "" */
export async function botUsername(env: Env, plat: "tg" | "bale" | "rubika" | "splus"): Promise<string> {
  const hit = botNames.get(plat);
  if (hit) return hit;
  const name = String((await tg<{ username?: string }>(envOf(env, plat), "getMe").catch(() => ({ username: "" }))).username ?? "");
  if (name) botNames.set(plat, name);
  return name;
}

/** لینک دعوت اختصاصی همین حساب در پلتفرم خودش؛ "" = ساخته نشد (ربات/برنامک تنظیم نیست یا getMe خطا داد).
 *  botName اگر از بیرون داده شود (مثلاً پیام همگانی که نام را یک‌بار می‌گیرد) getMe صدا زده نمی‌شود. */
export async function inviteLinkFor(env: Env, id: RefId, botName?: string): Promise<string> {
  const plat = invitePlatform(id);
  if (plat === "web") return webInviteLink(env, id);
  if (plat === "eitaa") return eitaaInviteLink(env, id);
  const name = botName || (await botUsername(env, plat));
  if (!name) return "";
  return plat === "splus" ? `https://splus.ir/${name}?start=ref_${id}` : plat === "rubika" ? `https://rubika.ir/${name}?start=ref_${id}` : plat === "bale" ? `https://ble.ir/${name}?start=ref_${id}` : telegramInviteLink(name, Number(id));
}

/** متن HTML پیام دعوت؛ done = دعوت‌های موفق این کاربر تا الان */
export function inviteBody(link: string, doneRaw: number): string {
  const done = Math.min(REF_MAX, Math.max(0, Number(doneRaw) || 0));
  return `🎁 <b>دعوت دوستان</b>\nبه ازای هر <b>${toFa(String(REF_EVERY))} دوست</b> که با لینک تو وارد پاورپوینت‌ساز شوند و اولین ارائه‌شان را بسازند، <b>۱ اعتبار پلن پلاس</b> می‌گیری (تا سقف ${toFa(String(REF_MAX))} دعوت = ${toFa(String(REF_MAX / REF_EVERY))} اعتبار پلاس).\n\n` +
    `📊 دعوت‌های موفق تو تا الان: <b>${toFa(String(done))}</b> از ${toFa(String(REF_MAX))}\n\n🔗 لینک اختصاصی تو:\n${link}`;
}

/** لینک اشتراک‌گذاری t.me برای دکمه‌ی «ارسال به دوستان» (فقط تلگرام؛ بقیه‌ی پلتفرم‌ها لینک اشتراک‌گذاری مشابهی ندارند) */
export const inviteShareUrl = (link: string) =>
  `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("ساخت پاورپوینت فارسی با هوش مصنوعی، مستقیم توی تلگرام 👇")}`;

/** دکمه‌ی «ارسال به دوستان» فقط برای کاربر تلگرام (لینک t.me/share برای بله، روبیکا و ایتا کار نمی‌کند)؛ بقیه فقط لینک داخل متن را دارند */
export const inviteMarkup = (id: RefId, link: string): Record<string, unknown> =>
  invitePlatform(id) === "tg" ? { reply_markup: { inline_keyboard: [[{ text: "📤 ارسال به دوستان", url: inviteShareUrl(link) }]] } } : {};
