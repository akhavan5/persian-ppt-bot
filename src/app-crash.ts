import type { Env } from "./env";
import { hitLimit } from "./auth";
import { adminIds } from "./settings";
import { esc, sendMessage } from "./telegram";

/**
 * POST /api/app/crash — گزارش کرش اپ اندروید (بدون ورود هم پذیرفته می‌شود، چون ممکن است قبل از ورود رخ داده باشد).
 * فقط خلاصه‌ی فنی ذخیره می‌شود (نسخه، مدل گوشی، متن خطا)؛ هر نوع کرش (امضای ۴ خط اول خطا) ۱۴ روز نگه داشته می‌شود
 * و فقط بار اول و در تکرار ۱۰ و ۱۰۰ به مدیرها در تلگرام خبر می‌دهد تا پیام‌ها زیاد نشود.
 */
const TTL = 14 * 24 * 3600;
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const ok = () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json; charset=utf-8" } });

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function appCrash(req: Request, env: Env, ip: string): Promise<Response> {
  // خطاها عمداً ساکت‌اند: اپ نباید به‌خاطر گزارش کرش دوباره مشکل پیدا کند
  if (!/PptSazApp\//.test(req.headers.get("user-agent") ?? "")) return ok();
  if (Number(req.headers.get("content-length") ?? 0) > 12_000) return ok();
  if (await hitLimit(env, `crl:${ip}`, 10, 3600)) return ok();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const trace = str(b?.trace, 6000);
  if (!b || trace.length < 10) return ok();

  const sig = await sha(trace.split("\n").slice(0, 4).join("\n"));
  const key = `crash:${sig}`;
  const cur = (await env.KV.get(key, "json").catch(() => null)) as { n?: number } | null;
  const n = (cur?.n ?? 0) + 1;
  await env.KV.put(key, JSON.stringify({
    n, last: Date.now(), v: str(b.v, 20), c: Number(b.c) || 0, sdk: Number(b.sdk) || 0, model: str(b.model, 60), thread: str(b.thread, 40), trace,
  }), { expirationTtl: TTL }).catch(() => {});

  if (n === 1 || n === 10 || n === 100) {
    const text =
      `🐞 <b>کرش اپ اندروید</b>${n > 1 ? ` — تکرار ${n}` : " — جدید"}\n` +
      `نسخه ${esc(str(b.v, 20))} (${Number(b.c) || 0}) · Android API ${Number(b.sdk) || 0} · ${esc(str(b.model, 60))}\n` +
      `<pre>${esc(trace.slice(0, 1400))}</pre>`;
    for (const id of adminIds(env)) await sendMessage(env, Number(id), text, { parse_mode: "HTML" }).catch(() => {});
  }
  return ok();
}
