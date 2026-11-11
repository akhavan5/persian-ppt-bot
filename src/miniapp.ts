/**
 * Telegram Mini App (public/app.html، آدرس /app).
 *
 * ورود: تلگرام هنگام باز شدن Mini App رشته‌ی initData را (با امضای HMAC به کلید توکن ربات) به صفحه می‌دهد.
 * اینجا امضا و تازگی آن بررسی می‌شود؛ تلگرام کاربر همان پروفایل وب خودکار ربات (ensureUid) را می‌گیرد، پس اعتبار، پلن،
 * تنظیمات و فایل‌ها با ربات و سایت یکی است. نشست به‌صورت توکن Bearer برمی‌گردد (نه کوکی)، چون Telegram Web صفحه را در iframe
 * باز می‌کند و کوکی‌های SameSite در iframe فرستاده نمی‌شوند. سایر API ها (generate، jobs، files، settings) همان API نسخه‌ی وب‌اند.
 */
import type { Env } from "./env";
import { createSession, getUserById, hitLimit, publicUser, randomToken, reuseSession, type WebUser } from "./auth";
import { REF_MAX, REF_EVERY, displayName, isAdmin, isAllowed, isBanned, noteActive, touchUser } from "./settings";
import { ensureUid, getLinkedTg } from "./link";
import { listFiles, loadFileDirect } from "./files";
import { isSampleId, sampleById, sampleCaption, sampleMime } from "./samples";
import { buildDeckPdf, cachedPdf } from "./pdf";
import { esc, sendAudio, sendDocument } from "./telegram";
import { audioSeconds } from "./wav";
import { fileNameWithSite, siteHost, siteLoginUrl } from "./deck-service";
import { toBaleId } from "./bale-format";
import { isEitaaId, toEitaaId, validEitaaRawId } from "./eitaa-format";
import { eitaaWelcome } from "./eitaa";
import { claimReferral, referralState } from "./referral";
import { inviteLinkFor, webInviteLink } from "./invite-msg";

const enc = new TextEncoder();
const INIT_MAX_AGE = 86_400; // ثانیه؛ initData قدیمی‌تر از یک روز پذیرفته نمی‌شود
const IP_LOGIN_MAX = 400; // ورود در هر ۱۰ دقیقه برای هر IP (بالا: NAT/پروکسی)
const TG_LOGIN_MAX = 20; // ورود در هر ۱۰ دقیقه برای هر حساب تلگرام (بعد از تأیید امضا)

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const err = (message: string, status = 400) => json({ error: message }, status);

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function hmac(key: BufferSource, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}

export interface TgUser { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean; allows_write_to_pm?: boolean }

/** بررسی امضای initData طبق مستندات تلگرام؛ کاربر تلگرام یا null (امضا نادرست/منقضی) */
export async function verifyInitData(botToken: string, initData: string, now = Date.now(), bale = false): Promise<TgUser | null> {
  if (!botToken) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  p.delete("hash");
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  // کلید امضا: HMAC("WebAppData", توکن) — هم در تلگرام و هم در مستندات مینی‌اپ بله (secret_key = HMAC_SHA256(<bot_token>, "WebAppData")).
  // fallback با خود توکن به‌عنوان کلید عمداً نگه داشته شده تا اگر کلاینت واقعی بله فرق داشت ورود نشکند؛ بعد از تست روی دستگاه واقعی بله می‌توان حذفش کرد
  let okSig = safeEqual(hex(await hmac(await hmac(enc.encode("WebAppData"), botToken), check)), hash);
  if (!okSig && bale) okSig = safeEqual(hex(await hmac(enc.encode(botToken), check)), hash);
  if (!okSig) return null;
  const age = now / 1000 - Number(p.get("auth_date"));
  if (!Number.isFinite(age) || age > INIT_MAX_AGE || age < -300) return null;
  try {
    const u = JSON.parse(p.get("user") ?? "null") as TgUser | null;
    return u && Number.isSafeInteger(u.id) && u.id > 0 ? u : null;
  } catch { return null; }
}

/** نوشتن‌های جانبیِ ورود (کاربر دیده‌شده، فهرست «اخیر» مدیر، نگاشت تلگرام↔حساب). روزی یک بار برای هر کاربر اجرا می‌شود،
 *  نه در هر باز شدن Mini App؛ هر کدام جدا خطایش را می‌خورد تا ورود خراب نشود. */
async function dailyTouch(env: Env, u: TgUser, uid: string, name: string): Promise<void> {
  await touchUser(env, u.id, u.username, name).catch((e) => console.error("touchUser", e));
  // ایتا: پیام خوش‌آمدگویی (الزام انتشار)؛ فقط اگر کاربر دسترسی ارسال پیام داده باشد
  if (isEitaaId(u.id) && u.allows_write_to_pm) await eitaaWelcome(env, u.id).catch(() => {});
  await noteActive(env, u.id, u.username, name).catch((e) => console.error("noteActive", e));
  if ((await getLinkedTg(env, uid)) !== u.id) await env.KV.put(`w2tg:${uid}`, String(u.id)).catch(() => {});
}

/** POST /api/auth/miniapp {initData} ← {token, user}؛ توکن را کلاینت در هدر Authorization: Bearer می‌فرستد.
 *  کلاینت توکن را نگه می‌دارد و فقط وقتی ۴۰۱ بگیرد (یا حدود روزی یک بار) دوباره اینجا می‌آید؛ اگر هدر Bearer معتبرِ همین کاربر باشد، همان نشست تمدید می‌شود. */
export async function miniappLogin(req: Request, env: Env, ip: string): Promise<Response> {
  // سقف IP فقط جلوی سیل درخواست را می‌گیرد و عمداً بالاست: پشت NAT یا پروکسی چند کاربر یک IP دارند. سقف دقیق بعد از تأیید امضا و بر پایه‌ی tgId است.
  if (await hitLimit(env, `mal:${ip}`, IP_LOGIN_MAX, 600)) return err("تعداد درخواست از این شبکه زیاد بود؛ چند دقیقه بعد دوباره امتحان کن.", 429);
  if (Number(req.headers.get("content-length") ?? 0) > 8_000) return err("درخواست نامعتبر", 413);
  const b = (await req.json().catch(() => null)) as { initData?: unknown; platform?: unknown } | null;
  const initData = typeof b?.initData === "string" ? b.initData : "";
  if (initData.length < 20 || initData.length > 4_096) return err("اطلاعات ورود از تلگرام نیامد؛ Mini App را از داخل ربات باز کن.", 400);
  // ایتا: امضا با توکن برنامه‌ی ایتا (همان الگوریتم تلگرام)؛ شناسه با EITAA_ID_BASE جمع می‌شود. کلاینت ایتا platform را می‌فرستد تا اول همان امتحان شود؛ تصمیم همیشه با امضاست
  const asEitaa = async (): Promise<TgUser | null> => {
    if (!env.EITAA_APP_TOKEN) return null;
    const x = await verifyInitData(env.EITAA_APP_TOKEN, initData);
    return x && validEitaaRawId(x.id) ? { ...x, id: toEitaaId(x.id) } : null;
  };
  // Mini App بله: امضا با توکن ربات بله؛ شناسه‌ی کاربر مثل ربات بله با BALE_ID_BASE جمع می‌شود تا از تلگرام جدا بماند.
  // کلاینت بله (صفحه‌ی /bale-app) platform را می‌فرستد تا اول همان امتحان شود؛ تصمیم همیشه با امضاست
  const asBale = async (): Promise<TgUser | null> => {
    if (!env.BALE_BOT_TOKEN) return null;
    const bb = await verifyInitData(env.BALE_BOT_TOKEN, initData, Date.now(), true);
    return bb ? { ...bb, id: toBaleId(bb.id) } : null;
  };
  const eitaaFirst = b?.platform === "eitaa", baleFirst = b?.platform === "bale";
  let u: TgUser | null = eitaaFirst ? await asEitaa() : baleFirst ? await asBale() : null;
  if (!u) u = await verifyInitData(env.TELEGRAM_BOT_TOKEN, initData);
  if (!u) u = await asBale();
  if (!u && !eitaaFirst) u = await asEitaa();
  if (!u || u.is_bot) return err("ورود از تلگرام/بله تایید نشد؛ Mini App را بسته و دوباره از داخل ربات باز کن.", 401);
  if (await hitLimit(env, `mal:t:${u.id}`, TG_LOGIN_MAX, 600)) return err("تعداد ورود زیاد بود؛ چند دقیقه بعد دوباره امتحان کن.", 429);

  if (await isBanned(env, u.id)) return err("دسترسی شما مسدود شده است.", 403);
  if (!isAllowed(env, u.id)) return err("این سرویس خصوصی است و دسترسی نداری.", 403);
  if (isAdmin(env, u.id)) return err("مدیرها حساب وب ندارند؛ برای کار با ربات از خود چت تلگرام استفاده کن.", 403); // مثل ورود خودکار به سایت

  const name = displayName(u);
  const uid = await ensureUid(env, u.id, name); // پروفایل وب خودکار (همان پروفایل ربات)
  if (typeof uid !== "string") return err("حساب شما پیدا نشد؛ ابتدا ربات را Start کن.", 403);
  if (await isBanned(env, uid)) return err("دسترسی شما مسدود شده است.", 403);

  // نوشتن‌های جانبی روزی یک بار (شمارنده‌ی اتمی D1: فقط اولین ورودِ هر ۲۴ ساعت از سقف ۱ رد می‌شود)
  if (!(await hitLimit(env, `mad:${u.id}`, 1, 86_400))) {
    await dailyTouch(env, u, uid, name);
  }

  const user = await getUserById(env, uid);
  if (!user) return err("حساب شما پیدا نشد؛ دوباره امتحان کن.", 500);
  const token = (await reuseSession(env, req, uid)) ?? (await createSession(env, uid));
  return json({ token, user: publicUser(user) });
}

const MIME: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  wav: "audio/wav", mp3: "audio/mpeg", pdf: "application/pdf",
};

/** POST /api/miniapp/send {id} — فایل (pptx، جزوه، پوستر، اسلاید صوتی، پادکست) را ربات به چت تلگرام خود کاربر می‌فرستد.
 *  دانلود مستقیم blob داخل WebView تلگرام (به‌خصوص iOS) قابل‌اتکا نیست؛ ارسال به چت همه‌جا کار می‌کند. */
export async function miniappSend(env: Env, user: WebUser, body: Record<string, unknown> | null, ip: string): Promise<Response> {
  const id = typeof body?.id === "string" ? body.id : "";
  if (!/^[\w-]{1,100}$/.test(id)) return err("فایل نامعتبر است.", 400);
  const tgId = await getLinkedTg(env, user.id);
  if (!tgId) return err("حساب تلگرام شما پیدا نشد؛ Mini App را از داخل ربات باز کن.", 409);
  if (isEitaaId(tgId)) return err("در ایتا ارسال فایل به چت ممکن نیست؛ دکمه‌ی «دانلود» را بزن.", 409);
  if (await hitLimit(env, `mas:${user.id}`, 30, 3600) || await hitLimit(env, `mas:ip:${ip}`, 90, 3600)) return err("تعداد ارسال‌ها زیاد بود؛ کمی بعد دوباره امتحان کن.", 429);
  const f = await loadFileDirect(env, user.id, id);
  if (!f) return err("فایل پیدا نشد یا منقضی شده است (فایل‌ها ۲۴ ساعت نگه داشته می‌شوند).", 404);
  const ext = (f.entry.name.split(".").pop() ?? "").toLowerCase();
  // اسلاید صوتی و پادکست از روی شناسه‌ی فایل شناخته می‌شوند: «<کار>-audio[-s<n>]» و «<کار>-podcast[-<n>]»
  const slidesAudio = /-audio(-s\d+)?$/.test(id), podcast = /-podcast(-\d+)?$/.test(id);
  const isAudio = ext === "wav" || ext === "mp3";
  const label = ext === "docx" ? "📝 جزوه" : ext === "png" || ext === "jpg" || ext === "jpeg" ? "🖼 پوستر" : isAudio ? (podcast ? "🎙 پادکست" : "🔊 صدای اسلاید") : slidesAudio ? "🔊 اسلاید صوتی" : "📥 ارائه";
  const sm = await sampleById(env, id); // نمونه: همان کپشن آماده‌ی خودش
  try {
    if (sm && !isAudio) {
      await sendDocument(env, tgId, new Uint8Array(f.data), f.entry.name, sampleCaption(sm), { mime: sampleMime(sm) });
    } else if (isAudio) {
      // فایل صوتی (MP3/WAV) با پخش‌کننده‌ی تلگرام (اگر نپذیرفت، sendAudio خودش به‌صورت سند می‌فرستد)
      const wav = new Uint8Array(f.data);
      await sendAudio(env, tgId, wav, f.entry.name, sm ? sampleCaption(sm) : `${label}: ${esc(f.entry.title.slice(0, 120))}`, { title: f.entry.title, ...(podcast ? { performer: siteHost(env) } : {}), duration: audioSeconds(wav) });
    } else {
      await sendDocument(env, tgId, new Uint8Array(f.data), f.entry.name, `${label}: ${esc(f.entry.title.slice(0, 120))}`, { mime: MIME[ext] ?? "application/octet-stream" });
    }
  } catch (e) {
    console.error("miniapp send", String(e).slice(0, 200));
    return err("ارسال فایل به چت ناموفق بود؛ مطمئن شو ربات را مسدود نکرده‌ای و دوباره امتحان کن.", 502);
  }
  return json({ ok: true });
}

/** POST /api/miniapp/buy — لینک ورود یک‌بارمصرف به صفحه‌ی خرید پلن در سایت (برای باز شدن در مرورگر بیرونی) */
export async function miniappBuy(env: Env, user: WebUser): Promise<Response> {
  const tgId = await getLinkedTg(env, user.id);
  return json({ url: await siteLoginUrl(env, tgId ?? undefined, "buy") });
}

/** سقف روزانه‌ی ساخت PDF؛ همان کلید و سقف ربات (pdf:<کاربر>:<روز>) تا مصرف مرورگر مشترک حساب شود */
const PDF_DAILY_LIMIT = 8;

/** POST /api/miniapp/pdf {id} — نسخه‌ی PDF ارائه (مثل دکمه‌ی PDF ربات) ساخته و به چت تلگرام کاربر فرستاده می‌شود */
export async function miniappPdf(env: Env, user: WebUser, body: Record<string, unknown> | null): Promise<Response> {
  const id = typeof body?.id === "string" ? body.id : "";
  if (!/^[\w-]{1,100}$/.test(id)) return err("فایل نامعتبر است.", 400);
  const tgId = await getLinkedTg(env, user.id);
  if (!tgId) return err("حساب تلگرام شما پیدا نشد؛ Mini App را از داخل ربات باز کن.", 409);
  if (isEitaaId(tgId)) return err("در ایتا ارسال PDF به چت ممکن نیست؛ فایل PPTX را دانلود کن.", 409);
  const name = (title: string) => fileNameWithSite(env, title, "pdf", "", 80);
  const cap = (title: string) => `📄 <b>${esc(title)}</b>\nنسخه‌ی PDF`;
  try {
    const hit = await cachedPdf(env, user.id, id).catch(() => null); // قبلاً ساخته شده: بدون مصرف مرورگر و سقف
    if (hit) {
      const f = (await listFiles(env, user.id).catch(() => [])).find((x) => x.id === id);
      await sendDocument(env, tgId, hit, name(f?.title ?? "presentation"), cap(f?.title ?? "ارائه"), { mime: "application/pdf" });
      return json({ ok: true });
    }
    const day = new Date().toISOString().slice(0, 10);
    if (await hitLimit(env, `pdf:${user.id}:${day}`, PDF_DAILY_LIMIT, 172_800)) return err("سقف روزانه‌ی ساخت PDF تمام شد؛ فردا دوباره امتحان کن (فایل PPTX همیشه در دسترس است).", 429);
    const r = await buildDeckPdf(env, user.id, id);
    if (!r.ok) return err(r.error, 404);
    await sendDocument(env, tgId, r.data, name(r.title), cap(r.title), { mime: "application/pdf" });
    return json({ ok: true });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    console.error("miniapp pdf", msg.slice(0, 400));
    return err(/time limit/i.test(msg) ? "سقف ساخت PDF برای امروز تمام شده است؛ فردا دوباره امتحان کن. فایل PPTX همیشه در دسترس است."
      : /429|rate|too many|concurrent/i.test(msg) ? "الان سرویس ساخت PDF شلوغ است؛ حدود یک دقیقه دیگر دوباره امتحان کن."
      : "ساخت PDF ناموفق بود؛ کمی بعد دوباره امتحان کن.", 502);
  }
}

/** GET|POST /api/invite (و POST /api/miniapp/invite برای نسخه‌های قدیمی) — دعوت دوستان برای همه‌ی کلاینت‌ها: سایت، اپ اندروید، Mini App تلگرام/بله و برنامک ایتا.
 *  link = لینک اختصاصی پلتفرم خودِ حساب (ربات تلگرام/بله/روبیکا یا برنامک ایتا)؛ webLink = لینک سایت (برای همه کار می‌کند: ثبت‌نام/ورود در سایت یا اپ، بعد کد خودکار ثبت می‌شود).
 *  هر ۵ دوست جدید که اولین ارائه‌شان را بسازند = ۱ اعتبار پلن پلاس تا ۵۰ دعوت (مثل /invite ربات). */
export async function inviteInfo(env: Env, user: WebUser): Promise<Response> {
  const st = await referralState(env, user.id);
  if (st.id === null) return err("حساب شما پیدا نشد؛ دوباره وارد شو.", 409);
  if (st.banned) return err("دسترسی شما مسدود شده است.", 403);
  const webLink = webInviteLink(env, st.id);
  const link = (await inviteLinkFor(env, st.id).catch(() => "")) || webLink;
  return json({ link, webLink, code: String(st.id), count: st.count, max: REF_MAX, every: REF_EVERY, canClaim: st.canClaim });
}

/** POST /api/invite/claim {code} — ثبت کد/لینک دعوتِ یک دوست برای حساب فعلی (در هر زمان، یک‌بار برای هر حساب). سایت بعد از ورود، اپ اندروید با کد واردشده و
 *  Mini App/برنامک با startapp=ref_… همین را صدا می‌زنند؛ پاداش دعوت‌کننده با ساخت اولین ارائه‌ی این حساب شمرده می‌شود. */
export async function inviteClaim(env: Env, user: WebUser, body: Record<string, unknown> | null, ip: string): Promise<Response> {
  const r = await claimReferral(env, user.id, body?.code, ip);
  return "error" in r ? err(r.error, r.status) : json({ ok: true });
}

/** POST /api/miniapp/dl {id} ← {path, name} — لینک ۵ دقیقه‌ای برای web_app_request_file_download.
 *  کلاینت تلگرام آدرس را بدون هدر Authorization دانلود می‌کند؛ پس مالکیت فایل همین‌جا بررسی و در توکن تصادفی ذخیره می‌شود. */
export async function miniappDlLink(env: Env, user: WebUser, body: Record<string, unknown> | null): Promise<Response> {
  const id = typeof body?.id === "string" ? body.id : "";
  if (!/^[\w-]{1,100}$/.test(id)) return err("فایل نامعتبر است.", 400);
  if (await hitLimit(env, `mdl:${user.id}`, 60, 3600)) return err("تعداد درخواست دانلود زیاد بود؛ کمی بعد دوباره امتحان کن.", 429);
  const sm = isSampleId(id) ? await sampleById(env, id) : undefined;
  const f = sm ? { name: sm.name } : (await listFiles(env, user.id).catch(() => [])).find((x) => x.id === id);
  if (!f) return err("فایل پیدا نشد یا منقضی شده است (فایل‌ها ۲۴ ساعت نگه داشته می‌شوند).", 404);
  const token = randomToken(24);
  await env.KV.put(`mdl:${token}`, `${user.id}|${id}`, { expirationTtl: 300 });
  return json({ path: `/api/miniapp/dl/${token}`, name: f.name });
}

/** GET /api/miniapp/dl/<توکن> — بدون ورود؛ فقط با توکن کوتاه‌مدتِ ساخته‌شده در miniappDlLink */
export async function miniappDownload(env: Env, token: string): Promise<Response> {
  if (!/^[\w-]{20,64}$/.test(token)) return err("پیدا نشد", 404);
  const v = await env.KV.get(`mdl:${token}`);
  const i = v ? v.indexOf("|") : -1;
  if (!v || i < 1) return err("لینک دانلود منقضی شده است.", 404);
  const uid = v.slice(0, i), id = v.slice(i + 1);
  if (!/^[\w-]{1,100}$/.test(id)) return err("پیدا نشد", 404);
  const f = await loadFileDirect(env, uid, id);
  if (!f) return err("فایل پیدا نشد یا منقضی شده است.", 404);
  const ext = (f.entry.name.split(".").pop() ?? "").toLowerCase();
  return new Response(f.data, { headers: {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "content-disposition": `attachment; filename="file.${/^[a-z0-9]{1,5}$/.test(ext) ? ext : "bin"}"; filename*=UTF-8''${encodeURIComponent(f.entry.name)}`,
    "cache-control": "no-store", "x-content-type-options": "nosniff",
  } });
}

/** POST /api/miniapp/welcome — کلاینت ایتا بعد از موافقت کاربر با requestWriteAccess صدا می‌زند؛ پیام خوش‌آمدگویی (فقط یک بار برای هر کاربر) */
export async function miniappWelcome(env: Env, user: WebUser): Promise<Response> {
  const id = await getLinkedTg(env, user.id);
  if (!id || !isEitaaId(id)) return json({ ok: true, sent: false });
  if (await hitLimit(env, `mawel:${id}`, 5, 3600)) return json({ ok: true, sent: false });
  return json({ ok: true, sent: await eitaaWelcome(env, id).catch(() => false) });
}
