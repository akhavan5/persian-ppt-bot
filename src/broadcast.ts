/** ارسال پیام همگانی با Workflow: دسته‌های ۲۰تایی تا از سقف درخواست‌های هر گام و سرعت تلگرام رد نشود. */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env";
import { esc, sendMessage } from "./telegram";
import { toFa } from "./util";
import { withStore } from "./store";

export interface BroadcastParams { adminChatId: number; text: string }

const BATCH = 20;
const MAX_USERS = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function listUserIds(env: Env): Promise<number[]> {
  const ids: number[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 40 && ids.length < MAX_USERS; i++) {
    const r = await env.KV.list({ prefix: "seen:", cursor });
    for (const k of r.keys) {
      const n = Number(k.name.slice(5));
      if (Number.isSafeInteger(n) && n > 0) ids.push(n);
    }
    if (r.list_complete) break;
    cursor = (r as any).cursor;
  }
  return ids.slice(0, MAX_USERS);
}

async function sendOne(env: Env, id: number, text: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sendMessage(env, id, esc(text));
      return true;
    } catch (e) {
      const wait = String(e).match(/retry after (\d+)/i);
      if (wait && attempt === 0) { await sleep(Math.min(Number(wait[1]), 20) * 1000 + 200); continue; }
      return false; // مثلاً کاربر ربات را بلاک کرده است
    }
  }
  return false;
}

export class BroadcastWorkflow extends WorkflowEntrypoint<Env, BroadcastParams> {
  constructor(ctx: ExecutionContext, env: Env) { super(ctx, withStore(env)); }

  async run(event: WorkflowEvent<BroadcastParams>, step: WorkflowStep) {
    const { adminChatId, text } = event.payload;
    const ids = await step.do("collect", () => listUserIds(this.env));

    let ok = 0, failed = 0, skipped = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const r = await step.do(`send-${i / BATCH}`, { retries: { limit: 0, delay: "1 second" }, timeout: "3 minutes" }, async () => {
        const out = { ok: 0, failed: 0, skipped: 0 };
        for (const id of ids.slice(i, i + BATCH)) {
          if ((await this.env.KV.get(`ban:${id}`)) !== null) { out.skipped++; continue; } // مسدودها پیام نمی‌گیرند
          if (await sendOne(this.env, id, text)) out.ok++; else out.failed++;
        }
        await sleep(1000);
        return out;
      });
      ok += r.ok; failed += r.failed; skipped += r.skipped;
    }

    await step.do("report", async () => {
      await sendMessage(this.env, adminChatId,
        `📣 <b>ارسال همگانی تمام شد</b>\n✅ موفق: ${toFa(String(ok))}\n❌ ناموفق: ${toFa(String(failed))} (معمولاً کاربرانی که ربات را بلاک کرده‌اند)` +
        (skipped ? `\n⛔️ مسدودشده (ارسال نشد): ${toFa(String(skipped))}` : ""));
    }).catch(() => {});
  }
}
