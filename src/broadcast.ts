/** ارسال پیام همگانی با Workflow: دسته‌های ۲۰تایی تا از سقف درخواست‌های هر گام و سرعت تلگرام رد نشود. */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env";
import { esc, sendMessage } from "./telegram";
import { toFa } from "./util";
import { withStore } from "./store";
import { isAdmin } from "./settings";

/** مخاطبان: همه / دارندگان پلن فعال / بدون پلن فعال / بدون اعتبار (نه پلن و نه اعتبار هدیه‌ی باقی‌مانده) */
export type Audience = "all" | "plan" | "free" | "nocredit";
export const AUDIENCES: Record<Audience, string> = { all: "همه", plan: "👑 دارندگان پلن", free: "بدون پلن", nocredit: "بدون اعتبار" };
export const isAudience = (x: unknown): x is Audience => typeof x === "string" && x in AUDIENCES;

export interface BroadcastParams { adminChatId: number; text: string; audience?: Audience }

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

const MAXC = "\u{10FFFF}";
/** شناسه‌ی تلگرام کاربرانی که پروفایلشان (tg2w:) پلن فعال با اعتبار باقی‌مانده دارد.
 *  بازه‌ی کلید روی sub: لازم است تا json_extract فقط روی ردیف‌های اشتراک اجرا شود. */
async function planHolders(env: Env): Promise<Set<number>> {
  await env.KV.ready();
  const r = await env.DB.prepare(
    "SELECT substr(m.k, 6) AS id FROM kv m JOIN kv sb ON sb.k = 'sub:' || m.v " +
    "WHERE m.k >= ?1 AND m.k < ?2 AND sb.k >= ?3 AND sb.k < ?4 AND (sb.exp IS NULL OR sb.exp > ?5) " +
    "AND json_extract(sb.v,'$.exp') > ?6 AND json_extract(sb.v,'$.credits') > 0")
    .bind("tg2w:", "tg2w:" + MAXC, "sub:", "sub:" + MAXC, Math.floor(Date.now() / 1000), Date.now()).all<{ id: string }>();
  const set = new Set(((r.results ?? []) as { id: string }[]).map((x) => Number(x.id)));
  // کاربران قدیمی بدون پروفایل وب: اشتراک مستقیم روی شناسه‌ی عددی تلگرام
  const legacy = await env.DB.prepare(
    "SELECT substr(k, 5) AS id FROM kv WHERE k >= ?1 AND k < ?2 AND k GLOB 'sub:[0-9]*' AND (exp IS NULL OR exp > ?3) " +
    "AND json_extract(v,'$.exp') > ?4 AND json_extract(v,'$.credits') > 0")
    .bind("sub:", "sub:" + MAXC, Math.floor(Date.now() / 1000), Date.now()).all<{ id: string }>();
  for (const x of (legacy.results ?? []) as { id: string }[]) set.add(Number(x.id));
  return set;
}
/** شناسه‌ی تلگرام کاربرانی که اعتبار هدیه/شارژ باقی‌مانده دارند */
async function bonusHolders(env: Env): Promise<Set<number>> {
  await env.KV.ready();
  const r = await env.DB.prepare(
    "SELECT substr(m.k, 6) AS id FROM kv m JOIN kv b ON b.k = 'bonus:' || m.v " +
    "WHERE m.k >= ?1 AND m.k < ?2 AND b.k >= ?3 AND b.k < ?4 AND (b.exp IS NULL OR b.exp > ?5) AND CAST(b.v AS INTEGER) > 0")
    .bind("tg2w:", "tg2w:" + MAXC, "bonus:", "bonus:" + MAXC, Math.floor(Date.now() / 1000)).all<{ id: string }>();
  const set = new Set(((r.results ?? []) as { id: string }[]).map((x) => Number(x.id)));
  const legacy = await env.DB.prepare(
    "SELECT substr(k, 7) AS id FROM kv WHERE k >= ?1 AND k < ?2 AND k GLOB 'bonus:[0-9]*' AND (exp IS NULL OR exp > ?3) AND CAST(v AS INTEGER) > 0")
    .bind("bonus:", "bonus:" + MAXC, Math.floor(Date.now() / 1000)).all<{ id: string }>();
  for (const x of (legacy.results ?? []) as { id: string }[]) set.add(Number(x.id));
  return set;
}

/** فهرست گیرندگان (شناسه‌ی تلگرام) برای یک گروه مخاطب؛ مسدودها در زمان ارسال حذف می‌شوند */
export async function listAudience(env: Env, aud: Audience = "all"): Promise<number[]> {
  const ids = await listUserIds(env);
  if (aud === "all") return ids;
  const plan = await planHolders(env);
  if (aud === "plan") return ids.filter((id) => plan.has(id));
  if (aud === "free") return ids.filter((id) => !plan.has(id));
  const bonus = await bonusHolders(env);
  return ids.filter((id) => !plan.has(id) && !bonus.has(id) && !isAdmin(env, id)); // مدیرها اعتبار نامحدود دارند
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
    const { adminChatId, text, audience } = event.payload;
    const ids = await step.do("collect", () => listAudience(this.env, isAudience(audience) ? audience : "all"));

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
        `📣 <b>ارسال همگانی تمام شد</b> (${AUDIENCES[isAudience(audience) ? audience : "all"]})\n✅ موفق: ${toFa(String(ok))}\n❌ ناموفق: ${toFa(String(failed))} (معمولاً کاربرانی که ربات را بلاک کرده‌اند)` +
        (skipped ? `\n⛔️ مسدودشده (ارسال نشد): ${toFa(String(skipped))}` : ""));
    }).catch(() => {});
  }
}
