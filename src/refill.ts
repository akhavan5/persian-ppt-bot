/**
 * اعلان شارژ روزانه: هر روز، فقط به کاربرانی که قبلاً با «اعتبار تمام شد» روبه‌رو شده‌اند پیام می‌رود که سهمیه‌شان دوباره پر شده است
 * (نه به همه‌ی کاربران؛ پیام ناخواسته به همه باعث بلاک و گزارش می‌شود). کاربر با /remind می‌تواند آن را خاموش/روشن کند.
 * cron: ساعت ۰۹:۰۰ به وقت ایران (۰۵:۳۰ UTC)، بعد از شارژ ساعت ۰۳:۳۰.
 */
import type { Env } from "./env";
import { getCredit, today, type Uid } from "./settings";
import { sendMessage } from "./telegram";
import { toFa } from "./util";

export const REFILL_CRON = "30 5 * * *";
const key = (chatId: number) => `refill:${chatId}`;
const offKey = (chatId: number) => `norefill:${chatId}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BATCH = 20; // زیر سقف ≈۳۰ پیام در ثانیه‌ی تلگرام

/** کاربر با «اعتبار تمام شده» روبه‌رو شد؛ فردا پس از شارژ خبرش می‌کنیم (مگر اعلان را خاموش کرده باشد) */
export async function markRefill(env: Env, chatId: number, uid: Uid): Promise<void> {
  try {
    if ((await env.KV.get(offKey(chatId))) !== null) return;
    await env.KV.put(key(chatId), JSON.stringify({ uid, day: today() }), { expirationTtl: 3 * 86_400 });
  } catch (e) { console.error("markRefill", e); }
}

/** /remind: روشن/خاموش کردن اعلان شارژ روزانه؛ متن پاسخ را برمی‌گرداند */
export async function toggleRefill(env: Env, chatId: number): Promise<string> {
  if ((await env.KV.get(offKey(chatId))) !== null) {
    await env.KV.delete(offKey(chatId));
    return "🔔 یادآوری شارژ روزانه <b>روشن</b> شد؛ وقتی اعتبارت تمام شده باشد، بعد از شارژ دوباره خبرت می‌کنم.";
  }
  await env.KV.put(offKey(chatId), "1");
  await env.KV.delete(key(chatId));
  return "🔕 یادآوری شارژ روزانه <b>خاموش</b> شد. هر وقت خواستی با /remind دوباره روشنش کن.";
}

export async function runRefillNotices(env: Env): Promise<void> {
  const ids: number[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 40 && ids.length < 20_000; i++) {
    const r = await env.KV.list({ prefix: "refill:", cursor });
    for (const k of r.keys) { const n = Number(k.name.slice(7)); if (Number.isSafeInteger(n)) ids.push(n); }
    if (r.list_complete) break;
    cursor = (r as any).cursor;
  }
  let sent = 0, kept = 0, dropped = 0, n = 0;
  for (const chatId of ids) {
    try {
      const raw = await env.KV.get(key(chatId));
      if (raw === null) continue;
      const m = JSON.parse(raw) as { uid: Uid; day: string };
      if ((await env.KV.get(`ban:${chatId}`)) !== null || (await env.KV.get(offKey(chatId))) !== null) { await env.KV.delete(key(chatId)); dropped++; continue; }
      // هنوز شارژ ساعت ۰۳:۳۰ برای او اعمال نشده (روز UTC همان است): نگه می‌داریم برای روز بعد
      if (m.day === today()) { kept++; continue; }
      const c = await getCredit(env, m.uid);
      await env.KV.delete(key(chatId)); // هر حال فقط یک بار
      if (c.unlimited || c.dailyLeft <= 0) { dropped++; continue; } // پلن فعال دارد یا امروز دوباره مصرف کرده
      await sendMessage(env, chatId,
        `🎉 سهمیه‌ی رایگان امروزت شارژ شد! <b>${toFa(String(c.dailyLeft))}</b> ارائه‌ی جدید می‌توانی بسازی.\nفقط موضوع ارائه را بفرست.\n\n<i>برای قطع این یادآوری: /remind</i>`).then(() => sent++);
    } catch (e) {
      dropped++; // معمولاً کاربر ربات را بلاک کرده است
    }
    if (++n % BATCH === 0) await sleep(1000);
  }
  console.log("refill-notices", JSON.stringify({ sent, kept, dropped }));
}
