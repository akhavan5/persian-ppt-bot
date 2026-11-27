/** تست دودی اعلان یکپارچه (src/notify.ts): محیط ساختگی (KV درون‌حافظه + fetch جعلی) و بررسی اینکه «یک اعلان» به همه‌ی کانال‌های کاربر می‌رسد.
 *  اجرا: npx tsx scripts/notify-smoke.ts */
import { notifyUser } from "../src/notify";
import { toBaleId } from "../src/bale-format";
import { toEitaaId } from "../src/eitaa-format";

const mem = new Map<string, string>();
const KV = {
  get: async (k: string, t?: string) => { const v = mem.get(k) ?? null; return v !== null && t === "json" ? JSON.parse(v) : v; },
  put: async (k: string, v: string) => { mem.set(k, v); },
  delete: async (k: string) => { mem.delete(k); },
  ready: async () => {},
};
const calls: string[] = [];
(globalThis as any).fetch = async (url: string, init?: any) => {
  const u = String(url);
  calls.push(u.replace(/\/bot[^/]+\//, "/bot<token>/").replace(/(token=)[^&]+/, "$1<t>"));
  if (u.includes("eitaayar")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
  if (u.includes("api.resend.com")) return new Response(JSON.stringify({ id: "x" }), { status: 200 });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
};

const env: any = { KV, TELEGRAM_BOT_TOKEN: "t", BALE_BOT_TOKEN: "b", EITAA_APP_TOKEN: "e", RESEND_API_KEY: "r", SITE_URL: "https://pptsaz.ir" };
const tg = 111, bale = toBaleId(222), eitaa = toEitaaId(333), uid = "w_0123456789abcdef";
mem.set(`wu:${uid}`, JSON.stringify({ id: uid, email: "a@b.ir", name: "علی", verified: true, created: 1 }));
mem.set(`w2ids:${uid}`, JSON.stringify([tg, bale, eitaa]));
mem.set(`w2tg:${uid}`, String(tg));
mem.set(`tg2w:${tg}`, uid); mem.set(`tg2w:${bale}`, uid); mem.set(`tg2w:${eitaa}`, uid);

let fails = 0;
const check = (name: string, cond: boolean, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); if (!cond) fails++; };

// ۱) حساب وب: هر سه پیام‌رسان + ایمیل (اپ/مرورگر کلید ندارند ⇒ بی‌صدا کنار می‌روند)
let r = await notifyUser(env, uid, { title: "سلام", body: "این یک اعلان آزمایشی است", url: "/?buy=1", tag: "t" });
check("حساب وب: سه پیام‌رسان رسید", r.messengers.length === 3 && r.messengers.every((m) => m.ok), r.messengers.map((m) => m.label).join("،"));
check("حساب وب: ایمیل رفت", r.delivered.includes("email"));
check("ok و reachable", r.ok && r.reachable === 2, `reachable=${r.reachable}`);
check("مسیر تلگرام/بله/ایتا هرکدام به API خودشان", calls.some((c) => c.includes("api.telegram.org")) && calls.some((c) => /bale/.test(c)) && calls.some((c) => c.includes("eitaayar")), calls.join(" | "));

// ۲) ورودی = شناسه‌ی عددیِ بله ⇒ به حساب اصلی تبدیل می‌شود و به همه‌ی کانال‌ها می‌رسد (وابسته به پلتفرم ورودی نیست)
calls.length = 0;
r = await notifyUser(env, bale, { title: "x", body: "y" });
check("ورودی بله ⇒ همه‌ی پیام‌رسان‌های حساب + ایمیل", r.messengers.length === 3 && r.delivered.includes("email"));

// ۳) فقط‌ربات (بدون حساب وب): فقط همان پیام‌رسان
calls.length = 0;
r = await notifyUser(env, 999, { title: "x", body: "y" });
check("کاربر فقط‌ربات: یک پیام‌رسان، بدون ایمیل", r.messengers.length === 1 && !r.delivered.includes("email") && r.reachable === 1);

// ۴) only / except
calls.length = 0;
r = await notifyUser(env, uid, { title: "x", body: "y", except: ["email"] });
check("except: ایمیل نرفت", !r.delivered.includes("email") && r.messengers.length === 3);
r = await notifyUser(env, uid, { title: "x", body: "y", only: ["email"] });
check("only: فقط ایمیل", r.delivered.length === 1 && r.delivered[0] === "email" && r.messengers.length === 0);

// ۵) خطای یک کانال بقیه را نمی‌اندازد (تلگرام خطا می‌دهد)
const realFetch = (globalThis as any).fetch;
(globalThis as any).fetch = async (url: string, init?: any) => String(url).includes("api.telegram.org")
  ? new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was blocked by the user" }), { status: 403 })
  : realFetch(url, init);
r = await notifyUser(env, uid, { title: "x", body: "y" });
check("تلگرام خطا داد ⇒ بله، ایتا و ایمیل همچنان رسیدند", r.ok && r.messengers.filter((m) => m.ok).length === 2 && r.delivered.includes("email"), r.messengers.map((m) => `${m.label}:${m.ok}`).join(" "));
(globalThis as any).fetch = realFetch;

// ۶) کاربر بدون هیچ کانال
r = await notifyUser({ ...env, TELEGRAM_BOT_TOKEN: "", BALE_BOT_TOKEN: "", EITAA_APP_TOKEN: "", RESEND_API_KEY: "" }, uid, { title: "x", body: "y" });
check("بدون کانال فعال: reachable=0 و ok=false", !r.ok && r.reachable === 0);

// ۷) ایمیل پیش‌فرض (render) و ایمیل سفارشی و کلید یکتا
let sent: any;
(globalThis as any).fetch = async (url: string, init?: any) => { if (String(url).includes("resend")) sent = { url, init }; return realFetch(url, init); };
await notifyUser(env, uid, { title: "عنوان تست", body: "متن تست", only: ["email"], key: "k1" });
const sentBody = JSON.parse(sent.init.body);
check("ایمیل پیش‌فرض ساخته شد (موضوع، HTML)", /عنوان تست/.test(sentBody.subject) && /<html/.test(sentBody.html), sentBody.subject);
check("کلید یکتا به Resend رفت", JSON.stringify(sent.init.headers).includes("k1"));

// ۸) کلید FCM/VAPID تنظیم است ولی دستگاهی ثبت نشده: بی‌صدا کنار می‌رود (نه خطا، نه reachable)
(globalThis as any).fetch = realFetch;
r = await notifyUser({ ...env, FCM_SERVICE_ACCOUNT: "{}", VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b" }, uid, { title: "x", body: "y", except: ["email"] });
check("اپ/مرورگر بدون دستگاه ثبت‌شده: بدون خطا و بدون شمارش", r.ok && r.reachable === 1 && !r.failed.length);

// ۹) مسیر واقعی «اعتبار پلن تمام شد» (plan-notify ← notifyUser): به هر سه پیام‌رسان + ایمیل می‌رسد و نشانگر یک‌بار می‌نشیند
const { notifyPlanCreditsOut } = await import("../src/plan-notify");
mem.set(`sub:${uid}`, JSON.stringify({ plan: "plus", exp: Date.now() + 5 * 86_400_000, credits: 0 }));
calls.length = 0;
await notifyPlanCreditsOut(env, uid);
check("اعتبار پلن تمام شد: ۳ پیام‌رسان + ایمیل", calls.filter((c) => /sendMessage|eitaayar/.test(c)).length === 3 && calls.some((c) => c.includes("resend")), calls.length + " تماس");
check("نشانگر «فرستاده شد» ثبت شد", [...mem.keys()].some((k) => k.startsWith(`planout:${uid}:`)));
calls.length = 0;
await notifyPlanCreditsOut(env, uid);
check("بار دوم دوباره نمی‌فرستد", calls.length === 0);

// ۱۰) دستور مدیر /notifyall: پیش‌نمایش ← تأیید ⇒ هر سه ورک‌فلو با یک متن؛ گروه محدود ⇒ بدون پوش وب؛ لغو
const { notifyAllCommand } = await import("../src/notify");
const wf: { id: string; params: any }[] = [];
const msgs: string[] = [];
(globalThis as any).fetch = async (url: string, init?: any) => { if (String(url).includes("/sendMessage")) msgs.push(JSON.parse(init.body).text); return realFetch(url, init); };
const aenv = { ...env, FCM_SERVICE_ACCOUNT: "{}", VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b", BROADCAST_WORKFLOW: { create: async (x: any) => { wf.push(x); } } };
await notifyAllCommand(aenv, 5, "/notifyall سلام | متن آزمایشی | https://pptsaz.ir/x");
check("پیش‌نمایش ساخته شد و هنوز چیزی نرفته", wf.length === 0 && /پیش‌نمایش/.test(msgs.at(-1) ?? ""));
await notifyAllCommand(aenv, 5, "/notifyall_send");
check("تأیید ⇒ سه ورک‌فلو (پیام‌رسان + اپ + مرورگر)", wf.length === 3 && wf.some((w) => w.params.text && !w.params.appPush && !w.params.webPush) && wf.some((w) => w.params.appPush) && wf.some((w) => w.params.webPush));
await notifyAllCommand(aenv, 5, "/notifyall_send");
check("تأیید دوباره بی‌اثر است (پیش‌نویس مصرف شد)", wf.length === 3);
wf.length = 0;
await notifyAllCommand(aenv, 5, "/notifyall سلام | متن | ");
await notifyAllCommand(aenv, 5, "/notifyall_send nocredit");
check("گروه nocredit ⇒ پوش وب نمی‌رود", wf.length === 2 && !wf.some((w) => w.params.webPush) && wf.every((w) => (w.params.audience ?? w.params.appSegment) === "nocredit"));
await notifyAllCommand(aenv, 5, "/notifyall x | y | http://insecure");
check("لینک غیر https رد می‌شود", /قالب/.test(msgs.at(-1) ?? ""));

console.log(fails ? `\n❌ ${fails} مورد ناموفق` : "\n✅ همه‌ی موارد درست بود");
process.exit(fails ? 1 : 0);
