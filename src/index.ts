import type { Env } from "./env";
import { handleUpdate } from "./bot";
import { ADMIN_COMMANDS, BOT_COMMANDS, tg } from "./telegram";
import { adminIds } from "./settings";
import { WebState, handleWeb, handleWebLogin, isWebLoginUpdate } from "./web";

export { DeckWorkflow } from "./workflow";
export { BroadcastWorkflow } from "./broadcast";
export { WebState };

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // وبهوک تلگرام — تلگرام هدر محرمانه را روی هر درخواست می‌فرستد
    if (url.pathname === "/telegram" && req.method === "POST") {
      const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
      if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(got, env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await req.json();
      // ورود به نسخه‌ی وب (/start wl_… و دکمه‌های تأیید/لغو) جدا از منطق اصلی ربات اداره می‌شود
      if (isWebLoginUpdate(update)) {
        ctx.waitUntil(handleWebLogin(env, update).catch((e) => console.error("webLogin", e)));
        return new Response("ok");
      }
      // فوراً ۲۰۰ برمی‌گردانیم تا تلگرام درخواست را تکرار نکند؛ کار اصلی در Workflow انجام می‌شود
      ctx.waitUntil(handleUpdate(env, update).catch(async (e) => {
        console.error("handleUpdate", e);
        // ربات بی‌صدا نماند؛ جزئیات خطا فقط در لاگ ثبت می‌شود
        const chatId = (update as any)?.message?.chat?.id ?? (update as any)?.callback_query?.message?.chat?.id;
        if (chatId) await tg(env, "sendMessage", { chat_id: chatId, text: "⚠️ مشکلی پیش آمد. چند لحظه بعد دوباره امتحان کن." }).catch(() => {});
      }));
      return new Response("ok");
    }

    // ثبت وبهوک: یک بار در مرورگر باز کن → /setup?secret=<TELEGRAM_WEBHOOK_SECRET>
    if (url.pathname === "/setup") {
      const secret = url.searchParams.get("secret") ?? "";
      if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response("forbidden", { status: 403 });
      }
      await tg(env, "setWebhook", {
        url: `${url.origin}/telegram`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
      await tg(env, "setMyCommands", { commands: BOT_COMMANDS });
      // منوی کامل‌تر فقط برای چت خود مدیرها
      for (const id of adminIds(env)) {
        await tg(env, "setMyCommands", { commands: ADMIN_COMMANDS, scope: { type: "chat", chat_id: Number(id) } }).catch((e) => console.error("admin commands", e));
      }
      const info = await tg(env, "getWebhookInfo");
      return Response.json({ ok: true, webhook: info.url, pending: info.pending_update_count });
    }

    // API نسخه‌ی وب؛ خود صفحه‌ها (/, /app.js, ...) را Static Assets بدون صدا زدن Worker سرو می‌کند
    if (url.pathname.startsWith("/api/")) return await handleWeb(req, env, url);

    if (url.pathname === "/") return new Response("persian-ppt-bot is running");
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
