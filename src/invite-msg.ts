/** متن و دکمه‌ی «دعوت دوستان»؛ هم برای /invite در ربات و هم برای پیام همگانی (نشانه‌ی {invite}) استفاده می‌شود تا دقیقاً یکسان بمانند. */
import { REF_EVERY, REF_MAX } from "./settings";
import { toFa } from "./util";

/** اگر در متن پیام همگانی باشد، برای هر کاربر با بلوک /invite خودش (لینک اختصاصی + شمارنده) جایگزین می‌شود */
export const INVITE_TOKEN = "{invite}";

/** لینک اختصاصی دعوت (تلگرام) */
export const telegramInviteLink = (botUsername: string, userId: number) => `https://t.me/${botUsername}?start=ref_${userId}`;

/** متن HTML پیام دعوت؛ done = دعوت‌های موفق این کاربر تا الان */
export function inviteBody(link: string, doneRaw: number): string {
  const done = Math.min(REF_MAX, Math.max(0, Number(doneRaw) || 0));
  return `🎁 <b>دعوت دوستان</b>\nبه ازای هر <b>${toFa(String(REF_EVERY))} دوست</b> که با لینک تو وارد ربات شوند و اولین ارائه‌شان را بسازند، <b>۱ اعتبار پلن پلاس</b> می‌گیری (تا سقف ${toFa(String(REF_MAX))} دعوت = ${toFa(String(REF_MAX / REF_EVERY))} اعتبار پلاس).\n\n` +
    `📊 دعوت‌های موفق تو تا الان: <b>${toFa(String(done))}</b> از ${toFa(String(REF_MAX))}\n\n🔗 لینک اختصاصی تو:\n${link}`;
}

/** لینک اشتراک‌گذاری t.me برای دکمه‌ی «ارسال به دوستان» */
export const inviteShareUrl = (link: string) =>
  `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("ساخت پاورپوینت فارسی با هوش مصنوعی، مستقیم توی تلگرام 👇")}`;
