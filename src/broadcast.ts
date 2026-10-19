/** ارسال پیام همگانی با Workflow: دسته‌های ۲۰تایی تا از سقف درخواست‌های هر گام و سرعت تلگرام رد نشود. */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env";
import { esc, sendMessage } from "./telegram";
import { toFa } from "./util";
import { withStore } from "./store";
import { DAILY_FREE_MSG, claimDailyFreeMany, isAdmin } from "./settings";

/** مخاطبان: همه / دارندگان پلن فعال / بدون پلن فعال / بدون اعتبار (نه پلن و نه اعتبار هدیه‌ی باقی‌مانده) */
export type Audience = "all" | "plan" | "free" | "nocredit";
export const AUDIENCES: Record<Audience, string> = { all: "همه", plan: "👑 دارندگان پلن", free: "بدون پلن", nocredit: "بدون اعتبار" };
export const isAudience = (x: unknown): x is Audience => typeof x === "string" && x in AUDIENCES;

/** daily: اعتبار رایگان روزانه (از cron) — به هر کاربر تلگرامِ بدون اعتبار ۱ اعتبار اضافه می‌کند و فقط به همان‌ها DAILY_FREE_MSG می‌فرستد؛ text/adminChatId نادیده گرفته می‌شود */
export interface BroadcastParams { adminChatId: number; text: string; audience?: Audience; daily?: boolean }

const BATCH = 20;
const MAX_USERS = 20_000;
// حالت daily: هر دسته ۲۰ کاربر = ۱ پرس‌وجو + ۲ batch ثبت اعتبار + حداکثر ۲۰ ارسال تلگرام ≈ ۲۳ زیردرخواست (حتی با تلاش مجدد زیر سقف ۵۰ پلن رایگان).
// ۱۰هزار کاربر = ۵۰۰ گام (سقف ۱۰۲۴).
const DAILY_BATCH = 20;
const DAILY_MAX_USERS = 10_000;
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
    const { adminChatId, text, audience, daily } = event.payload;
    if (daily) return await this.runDaily(step);
    const ids = await step.do("collect", () => listAudience(this.env, isAudience(audience) ? audience : "all"));

    let ok = 0, failed = 0, skipped = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const r = await step.do(`send-${i / BATCH}`, { retries: { limit: 0, delay: "1 second" }, timeout: "3 minutes" }, async () => {
        const out = { ok: 0, failed: 0, skipped: 0 };
        const chunk = ids.slice(i, i + BATCH);
        await this.env.KV.ready();
        const keys = chunk.map((id) => `ban:${id}`); // یک پرس‌وجو برای کل دسته (به‌جای یکی برای هر کاربر) تا از سقف ۵۰ زیردرخواست رد نشود
        const rows = await this.env.DB.prepare(`SELECT k FROM kv WHERE (exp IS NULL OR exp > ${Math.floor(Date.now() / 1000)}) AND k IN (${keys.map((_, n) => `?${n + 1}`).join(",")})`).bind(...keys).all<{ k: string }>();
        const banned = new Set(((rows.results ?? []) as { k: string }[]).map((r) => r.k));
        for (const id of chunk) {
          if (banned.has(`ban:${id}`)) { out.skipped++; continue; } // مسدودها پیام نمی‌گیرند
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

  /** اعتبار رایگان روزانه برای کاربران تلگرامِ بدون اعتبار + پیام ربات (فقط به کسانی که امروز اعتبار گرفتند) */
  private async runDaily(step: WorkflowStep) {
    const ids = (await step.do("collect", () => listAudience(this.env, "nocredit"))).slice(0, DAILY_MAX_USERS);
    for (let i = 0; i < ids.length; i += DAILY_BATCH) {
      await step.do(`daily-${i / DAILY_BATCH}`, { retries: { limit: 0, delay: "1 second" }, timeout: "3 minutes" }, async () => {
        const chunk = ids.slice(i, i + DAILY_BATCH);
        try {
          await this.env.KV.ready();
          // ۱ زیردرخواست: پروفایل وب و مسدودی کل دسته (۴۰ پارامتر؛ سقف D1 برای هر پرس‌وجو ۱۰۰ است)
          const keys = chunk.flatMap((id) => [`tg2w:${id}`, `ban:${id}`]);
          const rows = await this.env.DB.prepare(`SELECT k, v FROM kv WHERE (exp IS NULL OR exp > ${Math.floor(Date.now() / 1000)}) AND k IN (${keys.map((_, n) => `?${n + 1}`).join(",")})`)
            .bind(...keys).all<{ k: string; v: string }>();
          const map = new Map(((rows.results ?? []) as { k: string; v: string }[]).map((r) => [r.k, r.v]));
          const byUid = new Map<string, number>(); // پروفایل وب (یا شناسه‌ی عددی کاربران قدیمی) → شناسه‌ی تلگرام
          for (const id of chunk) {
            if (map.has(`ban:${id}`)) continue;
            const w = map.get(`tg2w:${id}`);
            byUid.set(w && /^w_[0-9a-f]{16}$/.test(w) ? w : String(id), id);
          }
          // ۲ زیردرخواست: ثبت اعتبار کل دسته؛ سپس حداکثر ۲۰ ارسال تلگرام (جمعاً زیر سقف ۵۰)
          const won = await claimDailyFreeMany(this.env, [...byUid.keys()]);
          for (const u of won) await sendOne(this.env, byUid.get(String(u))!, DAILY_FREE_MSG);
        } catch (e) { console.error("daily free batch", i, String(e).slice(0, 160)); }
        await sleep(1000);
      });
    }
  }
}
