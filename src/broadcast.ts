/** ارسال پیام همگانی با Workflow: دسته‌های ۲۰تایی تا از سقف درخواست‌های هر گام و سرعت تلگرام رد نشود. */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env";
import { esc, sendMessage } from "./telegram";
import { INVITE_TOKEN, botUsername, inviteBody, inviteLinkFor, inviteMarkup, invitePlatform } from "./invite-msg";
import { toFa } from "./util";
import { withStore } from "./store";
import { sendWebPushDevices, webPushPage, type WebPushMsg } from "./webpush";
import { PUSH_SEGMENTS, filterSegment, pushTokenPage, sendPush, type PushMsg, type PushSegment } from "./push";
import { DAILY_FREE_CREDITS, DAILY_FREE_MSG, adminIds, claimDailyFreeMany, isAdmin, today } from "./settings";

/** مخاطبان: همه / دارندگان پلن فعال / بدون پلن فعال / بدون اعتبار (نه پلن و نه اعتبار هدیه‌ی باقی‌مانده) */
export type Audience = "all" | "plan" | "free" | "nocredit";
export const AUDIENCES: Record<Audience, string> = { all: "همه", plan: "👑 دارندگان پلن", free: "بدون پلن", nocredit: "بدون اعتبار" };
export const isAudience = (x: unknown): x is Audience => typeof x === "string" && x in AUDIENCES;

/** daily: اعتبار رایگان روزانه (از cron) — به هر کاربر تلگرامِ بدون اعتبار ۱ اعتبار اضافه می‌کند و فقط به همان‌ها DAILY_FREE_MSG می‌فرستد؛ text/adminChatId نادیده گرفته می‌شود */
export interface BroadcastParams {
  adminChatId: number; text: string; audience?: Audience; daily?: boolean; appPush?: PushMsg; appSegment?: PushSegment; webPush?: WebPushMsg;
  /** ارسال زنجیره‌ای: هر نمونه (instance) فقط تا سقف زیردرخواست خودش می‌فرستد و بقیه را به نمونه‌ی بعدی می‌سپارد */
  ids?: number[]; offset?: number; acc?: { ok: number; failed: number; skipped: number }; rootId?: string;
  /** اعلان اپ (زنجیره‌ای): نشانگر صفحه‌ی بعد، شمارنده‌ی نمونه و جمع نتایج تا اینجا */
  pcursor?: string; seq?: number; pacc?: { ok: number; dead: number; failed: number; skipped: number };
  /** اعتبار رایگان روزانه: شمارنده‌ی تجمعی برای گزارش پایانی به مدیرها */
  dacc?: DailyAcc;
}
/** users: کاربران بدون اعتبار امروز؛ credited: اعتبار گرفتند؛ sent: پیام رسید؛ failed: پیام نرسید (معمولاً ربات را بلاک کرده‌اند)؛ err: خطای دسته (اعتبار ثبت نشد) */
export interface DailyAcc { users: number; credited: number; sent: number; failed: number; err: number }
/** سقف ۵۰ زیردرخواست (پلن رایگان) برای کل یک نمونه‌ی Workflow است، نه هر گام؛ پس هر نمونه با بودجه‌ی مشخص کار می‌کند */
const SUB_BUDGET = 38; // ۱۲ تا برای ready/پرس‌وجوی مسدودی/ساخت نمونه‌ی بعدی یا گزارش و تلاش‌های اضافه
const CHUNK = 45;      // حداکثر کاندیدای هر نمونه (پارامترهای پرس‌وجوی D1 زیر ۱۰۰)

const BATCH = 20;
const MAX_USERS = 20_000;
// حالت daily: هر دسته ۲۰ کاربر = ۱ پرس‌وجو + ۲ batch ثبت اعتبار + حداکثر ۲۰ ارسال تلگرام ≈ ۲۳ زیردرخواست (حتی با تلاش مجدد زیر سقف ۵۰ پلن رایگان).
// ۱۰هزار کاربر = ۵۰۰ گام (سقف ۱۰۲۴).
const DAILY_CHUNK = 25; // هر نمونه: ۵ زیردرخواست ثابت + حداکثر ۲۵ ارسال
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
  const dead = await blockedIds(env);
  return ids.filter((id) => !dead.has(id)).slice(0, MAX_USERS); // کسانی که ربات را بلاک کرده‌اند از فهرست گیرندگان حذف می‌شوند
}

/** «blk:<شناسه>»: کاربری که ربات را بلاک کرده یا حسابش حذف شده؛ ۹۰ روز اعتبار دارد و با /start دوباره‌ی کاربر پاک می‌شود (نگاه کنید به bot.ts) */
const BLK_TTL = 90 * 86_400;
async function blockedIds(env: Env): Promise<Set<number>> {
  const out = new Set<number>();
  let cursor: string | undefined;
  for (let i = 0; i < 40; i++) {
    const r = await env.KV.list({ prefix: "blk:", cursor });
    for (const k of r.keys) { const n = Number(k.name.slice(4)); if (Number.isSafeInteger(n) && n > 0) out.add(n); }
    if (r.list_complete) break;
    cursor = (r as any).cursor;
  }
  return out;
}
/** خطای تلگرام یعنی گیرنده دیگر قابل دسترس نیست (ربات را بلاک کرده، حسابش حذف شده یا گفتگو وجود ندارد) */
const isGone = (e: unknown) => /bot was blocked by the user|user is deactivated|chat not found|bot can't initiate/i.test(String(e));

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

/** ارسال به یک کاربر؛ تعداد درخواست‌های واقعی (برای بودجه‌ی زیردرخواست) هم برمی‌گردد */
/** html: اگر داده شود به‌جای esc(text) فرستاده می‌شود (پیام شخصی‌سازی‌شده)؛ extra: مثلاً دکمه‌ی اشتراک‌گذاری */
async function sendOneCounted(env: Env, id: number, text: string, html?: string, extra?: Record<string, unknown>): Promise<{ ok: boolean; calls: number }> {
  let calls = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      calls++;
      await sendMessage(env, id, html ?? esc(text), extra);
      return { ok: true, calls };
    } catch (e) {
      const wait = String(e).match(/retry after (\d+)/i);
      if (wait && attempt === 0) { await sleep(Math.min(Number(wait[1]), 20) * 1000 + 200); continue; }
      if (isGone(e)) { calls++; await env.KV.put(`blk:${id}`, "1", { expirationTtl: BLK_TTL }).catch(() => {}); } // از ارسال‌های بعدی حذف می‌شود
      return { ok: false, calls }; // مثلاً کاربر ربات را بلاک کرده است
    }
  }
  return { ok: false, calls };
}
async function sendOne(env: Env, id: number, text: string): Promise<boolean> {
  return (await sendOneCounted(env, id, text)).ok;
}

export class BroadcastWorkflow extends WorkflowEntrypoint<Env, BroadcastParams> {
  constructor(ctx: ExecutionContext, env: Env) { super(ctx, withStore(env)); }

  async run(event: WorkflowEvent<BroadcastParams>, step: WorkflowStep) {
    const { adminChatId, text, audience, daily, appPush, appSegment, webPush } = event.payload;
    const root = event.payload.rootId ?? event.instanceId;
    const P = event.payload;
    if (daily) return await this.runDaily(step, root, P);
    if (webPush) return await this.runWebPush(step, root, P, adminChatId, webPush);
    if (appPush) return await this.runAppPush(step, root, P, adminChatId, appPush, appSegment ?? "all");
    const aud: Audience = isAudience(audience) ? audience : "all";

    // نمونه‌ی اول: فقط فهرست گیرندگان را می‌سازد و کار را به نمونه‌ی بعدی می‌سپارد
    if (!P.ids) {
      const all = await step.do("collect", () => listAudience(this.env, aud));
      if (!all.length) return await this.report(step, adminChatId, aud, { ok: 0, failed: 0, skipped: 0 });
      return await this.handoff(step, root, { adminChatId, text, audience: aud, rootId: root, ids: all, offset: 0, acc: { ok: 0, failed: 0, skipped: 0 } });
    }

    const ids = P.ids, offset = P.offset ?? 0, acc = P.acc ?? { ok: 0, failed: 0, skipped: 0 };
    const r = await step.do("send", { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" }, async () => {
      const out = { ok: 0, failed: 0, skipped: 0, next: offset };
      const chunk = ids.slice(offset, offset + CHUNK);
      let used = 0;
      await this.env.KV.ready(); used += 2;
      // نشانه‌ی {invite}: هر کاربر بلوک /invite خودش (لینک اختصاصی + شمارنده‌ی دعوت) را می‌گیرد؛ شمارنده‌ها در همان پرس‌وجوی مسدودی خوانده می‌شوند (۹۰ پارامتر، زیر سقف ۱۰۰ D1)
      const personal = text.includes(INVITE_TOKEN);
      // نام کاربری ربات هر پلتفرم (تلگرام/بله/روبیکا) فقط یک‌بار در همین نمونه گرفته می‌شود؛ ایتا لینک برنامک دارد و getMe ندارد
      const botNames = new Map<string, string>();
      const keys = chunk.flatMap((id) => (personal ? [`ban:${id}`, `refc:${id}`] : [`ban:${id}`]));
      const rows = await this.env.DB.prepare(`SELECT k, v FROM kv WHERE (exp IS NULL OR exp > ${Math.floor(Date.now() / 1000)}) AND k IN (${keys.map((_, n) => `?${n + 1}`).join(",")})`).bind(...keys).all<{ k: string; v: string }>();
      used += 1;
      const kvRows = (rows.results ?? []) as { k: string; v: string }[];
      const banned = new Set(kvRows.map((x) => x.k));
      const refc = new Map(kvRows.filter((x) => x.k.startsWith("refc:")).map((x): [string, number] => [x.k, Number(x.v) || 0]));
      let i = 0;
      for (; i < chunk.length; i++) {
        const id = chunk[i];
        if (banned.has(`ban:${id}`)) { out.skipped++; continue; } // مسدودها پیام نمی‌گیرند
        if (used >= SUB_BUDGET) break; // بودجه‌ی این نمونه تمام شد؛ ادامه در نمونه‌ی بعدی
        let res: { ok: boolean; calls: number };
        if (personal) {
          // لینک اختصاصی دقیقاً برای پلتفرم همین کاربر (قبلاً همه لینک تلگرام می‌گرفتند و برای کاربران بله/روبیکا/ایتا خراب بود)
          const plat = invitePlatform(id);
          let name = botNames.get(plat);
          if (name === undefined && (plat === "tg" || plat === "bale" || plat === "rubika" || plat === "splus")) {
            name = await botUsername(this.env, plat); used += 1; botNames.set(plat, name);
          }
          const link = await inviteLinkFor(this.env, id, name || undefined).catch(() => "");
          if (link) {
            const html = text.split(INVITE_TOKEN).map(esc).join(inviteBody(link, refc.get(`refc:${id}`) ?? 0));
            res = await sendOneCounted(this.env, id, text, html, inviteMarkup(id, link));
          } else res = await sendOneCounted(this.env, id, text.split(INVITE_TOKEN).join(""));
        } else res = await sendOneCounted(this.env, id, text);
        used += res.calls;
        if (res.ok) out.ok++; else out.failed++;
      }
      out.next = offset + i;
      return out;
    });
    const total = { ok: acc.ok + r.ok, failed: acc.failed + r.failed, skipped: acc.skipped + r.skipped };
    if (r.next >= ids.length) return await this.report(step, adminChatId, aud, total);
    return await this.handoff(step, root, { adminChatId, text, audience: aud, rootId: root, ids, offset: r.next, acc: total });
  }

  /** ساخت نمونه‌ی بعدیِ زنجیره (شناسه‌ی ثابت ⇒ تلاش مجدد نمونه‌ی تکراری نمی‌سازد) */
  private async handoff(step: WorkflowStep, root: string, params: BroadcastParams, suffix: string | number = params.offset ?? 0) {
    await step.do("next", { retries: { limit: 3, delay: "5 seconds" } }, async () => {
      try { await this.env.BROADCAST_WORKFLOW.create({ id: `${root}-${suffix}`, params }); }
      catch (e) { if (!/already|exist|duplicate/i.test(String(e))) throw e; }
    }).catch(async (e) => {
      console.error("broadcast handoff failed", params.offset, String(e).slice(0, 200));
      if (params.daily) {
        const d = params.dacc;
        await this.toAdmins(`⚠️ <b>اعتبار رایگان روزانه</b> در کاربر شماره‌ی ${toFa(String(params.offset ?? 0))} متوقف شد.` + (d ? `\n🎁 تا اینجا اعتبار گرفتند: ${toFa(String(d.credited))} از ${toFa(String(d.users))}` : ""));
      } else {
        await sendMessage(this.env, params.adminChatId, `⚠️ ارسال همگانی در کاربر شماره‌ی ${toFa(String(params.offset ?? 0))} متوقف شد. ✅ تا اینجا موفق: ${toFa(String(params.acc?.ok ?? 0))}`).catch(() => {});
      }
    });
  }

  private async report(step: WorkflowStep, adminChatId: number, aud: Audience, t: { ok: number; failed: number; skipped: number }) {
    await step.do("report", async () => {
      await sendMessage(this.env, adminChatId,
        `📣 <b>ارسال همگانی تمام شد</b> (${AUDIENCES[aud]})\n✅ موفق: ${toFa(String(t.ok))}\n❌ ناموفق: ${toFa(String(t.failed))} (کاربرانی که ربات را بلاک کرده‌اند از فهرست گیرندگان حذف شدند و دیگر پیام نمی‌گیرند)` +
        (t.skipped ? `\n⛔️ مسدودشده (ارسال نشد): ${toFa(String(t.skipped))}` : ""));
    }).catch(() => {});
  }

  /** پوش وب به همه‌ی حساب‌های دارای اشتراک (زنجیره‌ای): هر نمونه با بودجه‌ی زیردرخواست خودش چند حساب را می‌زند و ادامه را به نمونه‌ی بعدی می‌سپارد.
   *  هزینه: هر صفحه ۲، هر حساب = تعداد دستگاه‌های ارسال‌شده (+۱ اگر اشتراک مرده حذف شد) */
  private async runWebPush(step: WorkflowStep, root: string, P: BroadcastParams, adminChatId: number, msg: WebPushMsg) {
    const acc0 = P.pacc ?? { ok: 0, dead: 0, failed: 0, skipped: 0 };
    const seq = P.seq ?? 0;
    const r = await step.do("wpush", { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" }, async () => {
      const out = { ok: 0, dead: 0, failed: 0, skipped: 0, next: null as string | null };
      let used = 2;
      let cursor: string | undefined = P.pcursor;
      for (;;) {
        const page = await webPushPage(this.env, cursor, 15); used += 1;
        let last: string | undefined, stopped = false;
        for (const row of page.rows) {
          if (used > SUB_BUDGET - 5) { stopped = true; break; } // بودجه‌ی این نمونه تمام شد (هر حساب حداکثر ۴)
          if (!row.devices.length) { out.skipped++; last = row.key; continue; }
          const res = await sendWebPushDevices(this.env, row.uid, row.devices, msg); used += res.cost;
          if (res.ok > 0) out.ok++; else out.failed++;
          last = row.key;
        }
        if (stopped) { out.next = last ?? cursor ?? null; break; }
        if (!page.next) { out.next = null; break; }
        cursor = page.next; out.next = cursor;
        if (used > SUB_BUDGET - 10) break;
      }
      return out;
    });
    const total = { ok: acc0.ok + r.ok, dead: 0, failed: acc0.failed + r.failed, skipped: acc0.skipped + r.skipped };
    if (r.next) return await this.handoff(step, root, { adminChatId, text: "", webPush: msg, rootId: root, pcursor: r.next, seq: seq + 1, pacc: total }, `w${seq + 1}`);
    await step.do("report", async () => {
      await sendMessage(this.env, adminChatId, `🔔 <b>پوش وب ارسال شد</b>\n✅ حساب‌هایی که دست‌کم یک دستگاهشان دریافت کرد: ${toFa(String(total.ok))}\n❌ ناموفق (اشتراک مرده/خطای مرورگر): ${toFa(String(total.failed))}` + (total.skipped ? `\n⏭ بدون دستگاه معتبر: ${toFa(String(total.skipped))}` : ""));
    }).catch(() => {});
  }

  /** اعلان FCM به اپ اندروید (زنجیره‌ای): هر نمونه با بودجه‌ی زیردرخواست خودش چند صفحه‌ی توکن را می‌فرستد و ادامه را به نمونه‌ی بعدی می‌سپارد.
   *  هزینه‌ها (تخمینی و محافظه‌کارانه): هر صفحه ۶، هر ارسال ۳ (خواندن توکن دسترسی + FCM)، حذف توکن مرده ۲ */
  private async runAppPush(step: WorkflowStep, root: string, P: BroadcastParams, adminChatId: number, msg: PushMsg, seg: PushSegment) {
    const acc0 = P.pacc ?? { ok: 0, dead: 0, failed: 0, skipped: 0 };
    const seq = P.seq ?? 0;
    const r = await step.do("push", { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" }, async () => {
      const out = { ok: 0, dead: 0, failed: 0, skipped: 0, next: null as string | null };
      let used = 0;
      let cursor: string | undefined = P.pcursor;
      for (;;) {
        const page = await pushTokenPage(this.env, cursor, 15); used += 3;
        const targets = await filterSegment(this.env, page.rows, seg); used += 3;
        const ok = new Set(targets.map((t) => t.token));
        let last: string | undefined, stopped = false;
        for (const row of page.rows) {
          if (!ok.has(row.token)) { out.skipped++; last = `pt1:${row.token}`; continue; }
          if (used > SUB_BUDGET - 2) { stopped = true; break; } // بودجه‌ی این نمونه تمام شد
          const res = await sendPush(this.env, row.token, msg); used += 3;
          if (res === "ok") out.ok++;
          else if (res === "dead") { out.dead++; used += 2; await Promise.all([this.env.KV.delete(`pt1:${row.token}`), this.env.KV.delete(`pt0:${row.token}`)]).catch(() => {}); }
          else out.failed++;
          last = `pt1:${row.token}`;
        }
        if (stopped) { out.next = last ?? cursor ?? null; break; }
        if (!page.next) { out.next = null; break; }
        cursor = page.next; out.next = cursor;
        if (used > SUB_BUDGET - 14) break; // جا برای یک صفحه‌ی دیگر نیست
      }
      return out;
    });
    const total = { ok: acc0.ok + r.ok, dead: acc0.dead + r.dead, failed: acc0.failed + r.failed, skipped: acc0.skipped + r.skipped };
    if (r.next) return await this.handoff(step, root, { adminChatId, text: "", appPush: msg, appSegment: seg, rootId: root, pcursor: r.next, seq: seq + 1, pacc: total }, `p${seq + 1}`);
    await step.do("report", async () => {
      await sendMessage(this.env, adminChatId, `📲 <b>اعلان اپ ارسال شد</b> (${PUSH_SEGMENTS[seg]})\n✅ موفق: ${toFa(String(total.ok))}\n🗑 توکن نامعتبر (حذف شد): ${toFa(String(total.dead))}\n❌ ناموفق: ${toFa(String(total.failed))}` + (seg !== "all" ? `\n⏭ خارج از گروه (ارسال نشد): ${toFa(String(total.skipped))}` : ""));
    }).catch(() => {});
  }

  /** پیام به همه‌ی مدیرها (ADMIN_IDS)؛ خطای یکی بقیه را متوقف نمی‌کند */
  private async toAdmins(text: string) {
    for (const id of adminIds(this.env)) await sendMessage(this.env, Number(id), text).catch(() => {});
  }

  private async reportDaily(step: WorkflowStep, d: DailyAcc) {
    await step.do("report", async () => {
      const unsent = Math.max(0, d.credited - d.sent - d.failed); // اعتبار ثبت شد ولی به‌خاطر سقف زیردرخواست پیام نرفت
      const skipped = Math.max(0, d.users - d.credited - d.err);   // مسدود یا امروز قبلاً سهمش را گرفته
      await this.toAdmins(
        `🎁 <b>اعتبار رایگان روزانه</b> (${toFa(today())})\n` +
        `👥 کاربران بدون اعتبار: ${toFa(String(d.users))}\n` +
        `✅ اعتبار ${toFa(String(DAILY_FREE_CREDITS))}تایی گرفتند: ${toFa(String(d.credited))}\n` +
        `📨 پیام رسید: ${toFa(String(d.sent))}\n` +
        (d.failed + unsent ? `🚫 پیام نرسید: ${toFa(String(d.failed + unsent))} (اعتبار ثبت شده؛ معمولاً ربات را بلاک کرده‌اند)\n` : "") +
        (skipped ? `⏭ رد شدند (مسدود یا امروز قبلاً گرفته): ${toFa(String(skipped))}\n` : "") +
        (d.err ? `⚠️ خطا در ثبت اعتبار: ${toFa(String(d.err))} کاربر` : ""));
    }).catch(() => {});
  }

  /** اعتبار رایگان روزانه (زنجیره‌ای): هر نمونه ۲۵ کاربر. ثبت اعتبار روزی یک‌بار برای هر کاربر است، پس اجرای دوباره اعتبار تکراری نمی‌دهد.
   *  آخرین نمونه‌ی زنجیره گزارش را برای مدیرها می‌فرستد. */
  private async runDaily(step: WorkflowStep, root: string, P: BroadcastParams) {
    if (!P.ids) {
      const all = (await step.do("collect", () => listAudience(this.env, "nocredit"))).slice(0, DAILY_MAX_USERS);
      if (!all.length) return await this.reportDaily(step, { users: 0, credited: 0, sent: 0, failed: 0, err: 0 });
      return await this.handoff(step, root, { adminChatId: 0, text: "", daily: true, rootId: root, ids: all, offset: 0, dacc: { users: all.length, credited: 0, sent: 0, failed: 0, err: 0 } });
    }
    const ids = P.ids, offset = P.offset ?? 0;
    const r = await step.do("daily", { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" }, async () => {
      const out = { credited: 0, sent: 0, failed: 0, err: 0 };
      const chunk = ids.slice(offset, offset + DAILY_CHUNK);
      let used = 0;
      try {
        await this.env.KV.ready(); used += 2;
        // ۱ زیردرخواست: پروفایل وب و مسدودی کل دسته (۵۰ پارامتر؛ سقف D1 برای هر پرس‌وجو ۱۰۰ است)
        const keys = chunk.flatMap((id) => [`tg2w:${id}`, `ban:${id}`]);
        const rows = await this.env.DB.prepare(`SELECT k, v FROM kv WHERE (exp IS NULL OR exp > ${Math.floor(Date.now() / 1000)}) AND k IN (${keys.map((_, n) => `?${n + 1}`).join(",")})`)
          .bind(...keys).all<{ k: string; v: string }>();
        used += 1;
        const map = new Map(((rows.results ?? []) as { k: string; v: string }[]).map((r) => [r.k, r.v]));
        const byUid = new Map<string, number>(); // پروفایل وب (یا شناسه‌ی عددی کاربران قدیمی) → شناسه‌ی تلگرام
        for (const id of chunk) {
          if (map.has(`ban:${id}`)) continue;
          const w = map.get(`tg2w:${id}`);
          byUid.set(w && /^w_[0-9a-f]{16}$/.test(w) ? w : String(id), id);
        }
        const won = await claimDailyFreeMany(this.env, [...byUid.keys()]); used += 2;
        out.credited = won.length;
        for (const u of won) {
          if (used >= SUB_BUDGET + 6) break; // فقط در حالت نادر تلاش‌های مجدد ۴۲۹؛ اعتبار ثبت شده و فقط پیام جا می‌ماند
          const s = await sendOneCounted(this.env, byUid.get(String(u))!, DAILY_FREE_MSG);
          used += s.calls;
          if (s.ok) out.sent++; else out.failed++;
        }
      } catch (e) { console.error("daily free batch", offset, String(e).slice(0, 160)); out.err = chunk.length - out.credited; }
      return out;
    });
    const p = P.dacc ?? { users: ids.length, credited: 0, sent: 0, failed: 0, err: 0 };
    const dacc: DailyAcc = { users: p.users, credited: p.credited + r.credited, sent: p.sent + r.sent, failed: p.failed + r.failed, err: p.err + r.err };
    const next = offset + DAILY_CHUNK;
    if (next < ids.length) return await this.handoff(step, root, { adminChatId: 0, text: "", daily: true, rootId: root, ids, offset: next, dacc });
    await this.reportDaily(step, dacc);
  }
}
