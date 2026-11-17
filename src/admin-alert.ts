// خبر خطای ورک‌فلوها به مدیرها (ADMIN_IDS) در تلگرام. هرگز خطا پرتاب نمی‌کند.
// برای جلوگیری از سیل پیام (مثلاً کلید نادرست)، هر نوع ورک‌فلو هر ۵ دقیقه حداکثر یک پیام می‌فرستد.
import type { Env } from "./env";
import { adminIds } from "./settings";
import { esc, sendMessage } from "./telegram";

export async function alertAdmins(env: Env, label: string, opts: { user?: string | number; detail?: string; reason?: unknown } = {}): Promise<void> {
  try {
    const ids = adminIds(env);
    if (!ids.length) return;
    const key = `alert:wf:${label}`;
    if ((await env.KV.get(key)) !== null) return;
    await env.KV.put(key, "1", { expirationTtl: 300 });
    const reason = String(opts.reason instanceof Error ? opts.reason.message : opts.reason ?? "").slice(0, 300);
    const msg = `🚨 <b>خطا در ${esc(label)}</b>` +
      (opts.user !== undefined ? `\n👤 <code>${esc(String(opts.user))}</code>` : "") +
      (opts.detail ? `\n📝 ${esc(opts.detail.slice(0, 80))}` : "") +
      (reason ? `\n⚠️ <code>${esc(reason)}</code>` : "") +
      `\n\n<i>خطاهای بعدی همین بخش تا ۵ دقیقه اعلام نمی‌شوند.</i>`;
    for (const id of ids) await sendMessage(env, Number(id), msg).catch(() => {});
  } catch (e) {
    console.warn("alertAdmins", String(e).slice(0, 160));
  }
}
