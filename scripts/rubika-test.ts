// اجرا: npx tsx scripts/rubika-test.ts  (آزمون با fetch و KV شبیه‌سازی‌شده؛ به توکن واقعی نیاز ندارد)
import { buildPlain, buildRich, htmlToRubika, rubikaText, rubikaKeypad, rubikaUserId, rubikaMsgHandle, isRubikaId, RUBIKA_ID_BASE } from "../src/rubika-format";
import { isBaleId } from "../src/bale-format";
import { rubikaTg, callbackHandle } from "../src/rubika-api";
import { normalizeRubikaUpdate } from "../src/rubika-update";

const mem = new Map<string, string>();
const KV: any = { get: async (k: string, t?: string) => { const v = mem.get(k) ?? null; return v && t === "json" ? JSON.parse(v) : v; }, put: async (k: string, v: string) => { mem.set(k, v); }, delete: async (k: string) => { mem.delete(k); } };
const calls: any[] = [];
let failKeypad = false, failMeta = false;
(globalThis as any).fetch = async (url: string, init: any) => {
  const m = String(url).split("/").pop()!; const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
  calls.push({ m, body });
  let status = "OK", data: any = {};
  if (m === "sendMessage") { if (failMeta && body.metadata) status = "INVALID_INPUT"; data = { message_id: String(200000000000000000n + BigInt(calls.length)) }; }
  if (m === "getChat") data = { chat: { first_name: "Ali", username: "ali_u" } };
  if (m === "editMessageKeypad" || m === "editInlineKeypad") { if (failKeypad) status = "NOT_FOUND"; }
  return new Response(JSON.stringify({ status, data }), { status: 200 });
};
const env: any = { KV, RUBIKA_BOT_TOKEN: "TOK", SITE_URL: "https://pptsaz.ir", PLATFORM: "rubika" };
const eq = (a: unknown, b: unknown, msg: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.log("FAIL", msg, JSON.stringify(a), "!=", JSON.stringify(b)); process.exitCode = 1; } else console.log("ok  ", msg); };

(async () => {
  eq(buildPlain('<b>a</b> &amp; <a href="https://x.ir/p?a=1&amp;b=2">go</a> <code>z</code>', []).text, "a & go (https://x.ir/p?a=1&b=2) z", "plain html");
  const rich = htmlToRubika('\u{1F600} <b>سلام</b> <a href="https://x.ir">لینک</a> <a href="tg://user?id=1">x</a>');
  eq([rich.text, rich.parts], ["\u{1F600} سلام لینک x", [{ type: "Bold", from_index: 3, length: 4 }, { type: "Link", from_index: 8, length: 4, link_url: "https://x.ir" }]], "metadata utf-16 indices (emoji = 2)");
  const many = buildRich({ text: "x".repeat(50), parts: Array.from({ length: 40 }, (_, i) => ({ type: "Bold", from_index: i, length: 5 })) }, []);
  eq([many.parts.length, many.parts.every((p) => p.from_index + p.length <= many.text.length)], [30, true], "max 30 parts, in range");
  eq(rubikaText("<b>تلگرامت</b>"), "روبیکات", "wording");
  const u = await rubikaUserId("b0ABC"); eq([isRubikaId(u), isBaleId(u), u < 1e15, Number.isSafeInteger(u)], [true, false, true, true], "id range");
  eq(await rubikaUserId("b0ABC"), u, "id deterministic");
  const kp = rubikaKeypad({ inline_keyboard: [[{ text: "x", callback_data: "p:1" }, { text: "site", url: "https://a.b" }], [{ text: "app", web_app: { url: "https://a.b/app" } }]] }, "https://pptsaz.ir");
  eq([kp.keypad!.rows.map((r) => r.buttons.map((b) => b.type)), kp.links], [[["Simple"]], [{ label: "site", url: "https://a.b" }, { label: "app", url: "https://pptsaz.ir" }]], "keypad: Simple only, links separate");

  // incoming message
  const upd = await normalizeRubikaUpdate(env, { update: { type: "NewMessage", chat_id: "b0ABC", new_message: { message_id: "123456789012345678", text: "سلام", sender_type: "User", sender_id: "u0X" } } });
  eq([upd.message.chat.id === u, upd.message.chat.type, upd.message.text, upd.message.from.first_name, typeof upd.message.message_id], [true, "private", "سلام", "Ali", "number"], "normalize message");
  // group ignored, bot echo ignored
  eq(await normalizeRubikaUpdate(env, { update: { type: "NewMessage", chat_id: "g0Z", new_message: { text: "x", sender_type: "User" } } }), null, "group ignored");
  eq(await normalizeRubikaUpdate(env, { update: { type: "NewMessage", chat_id: "b0ABC", new_message: { text: "x", sender_type: "Bot" } } }), null, "bot echo ignored");
  // file
  const f = await normalizeRubikaUpdate(env, { update: { type: "NewMessage", chat_id: "b0ABC", new_message: { message_id: "9", text: "cap", sender_type: "User", file: { file_id: "F1", file_name: "a.pdf", size: "1234" } } } });
  eq([f.message.document.file_id, f.message.document.mime_type, f.message.document.file_size, f.message.caption, f.message.text], ["F1", "application/pdf", 1234, "cap", undefined], "normalize file");
  // start dedupe + start_id
  const s1 = await normalizeRubikaUpdate(env, { update: { type: "StartedBot", chat_id: "b0NEW" } });
  const s2 = await normalizeRubikaUpdate(env, { update: { type: "NewMessage", chat_id: "b0NEW", new_message: { message_id: "1", text: "/start", sender_type: "User" } } });
  eq([s1.message.text, s2], ["/start", null], "start dedupe");
  const s3 = await normalizeRubikaUpdate(env, { update: { type: "NewMessage", chat_id: "b0REF", new_message: { message_id: "1", text: "/start", sender_type: "User", aux_data: { start_id: "ref_42" } } } });
  eq(s3.message.text, "/start ref_42", "start_id -> /start ref_42");

  // send + edit
  calls.length = 0;
  const sent = await rubikaTg(env, "sendMessage", { chat_id: u, text: "<b>hi</b>", reply_markup: { inline_keyboard: [[{ text: "A", callback_data: "p:a" }]] } });
  eq([typeof sent.message_id, calls[calls.length - 1].body.text, calls[calls.length - 1].body.chat_id], ["number", "hi", "b0ABC"], "sendMessage");
  calls.length = 0;
  await rubikaTg(env, "editMessageText", { chat_id: u, message_id: sent.message_id, text: "new", reply_markup: { inline_keyboard: [[{ text: "B", callback_data: "p:b" }]] } });
  eq(calls.map((c) => c.m), ["editMessageText", "editMessageKeypad"], "edit text + keypad");
  calls.length = 0;
  await rubikaTg(env, "editMessageText", { chat_id: u, message_id: sent.message_id, text: "final" }); // no markup => clear
  eq(calls.map((c) => c.m).join(","), "editMessageText,editMessageKeypad", "edit w/o markup clears keypad");
  eq(calls[1].body.inline_keypad, { rows: [] }, "clear payload");
  calls.length = 0;
  await rubikaTg(env, "editMessageText", { chat_id: u, message_id: sent.message_id, text: "again" }); // already cleared => no keypad call
  eq(calls.map((c) => c.m).join(","), "editMessageText", "no redundant clear");

  // keypad edit unsupported -> delete + resend keeps the old handle valid through alias
  failKeypad = true; calls.length = 0;
  const s = await rubikaTg(env, "sendMessage", { chat_id: u, text: "card", reply_markup: { inline_keyboard: [[{ text: "A", callback_data: "p:a" }]] } });
  await rubikaTg(env, "editMessageText", { chat_id: u, message_id: s.message_id, text: "card2", reply_markup: { inline_keyboard: [[{ text: "B", callback_data: "p:b" }]] } });
  const names = calls.map((c) => c.m);
  eq(names.includes("deleteMessage") && names.filter((x) => x === "sendMessage").length === 2, true, "fallback delete+resend");
  const newMid = calls.filter((c) => c.m === "sendMessage")[1];
  const resp = (await (async () => { const r = await fetch("x/getChat"); return r; })());
  void resp; void newMid;
  // callback from the resent message maps to the original handle
  const lastSend = mem.get([...mem.keys()].filter((k) => k.startsWith("rb:a:")).pop()!);
  eq(Number(lastSend), s.message_id, "alias points at original handle");
  failKeypad = false;

  // links in the text as Link metadata; formatting rejected by Rubika -> plain retry
  calls.length = 0;
  await rubikaTg(env, "sendMessage", { chat_id: u, text: "<b>x</b>", reply_markup: { inline_keyboard: [[{ text: "Site", url: "https://pptsaz.ir" }, { text: "A", callback_data: "p:a" }]] } });
  const b0 = calls[0].body;
  eq([b0.text, b0.metadata.meta_data_parts.map((p: any) => p.type), b0.inline_keypad.rows[0].buttons.length], ["x\n\nSite", ["Bold", "Link"], 1], "links as Link metadata, no Link button");
  failMeta = true; calls.length = 0;
  await rubikaTg(env, "sendMessage", { chat_id: u, text: "<b>x</b>", reply_markup: { inline_keyboard: [[{ text: "Site", url: "https://pptsaz.ir" }]] } });
  eq([calls.length, calls[1].body.text, calls[1].body.metadata], [2, "x\n\nSite: https://pptsaz.ir", undefined], "plain retry when metadata rejected");
  failMeta = false;
  console.log("done");
})();
