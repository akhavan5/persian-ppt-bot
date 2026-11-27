/** مینی‌اپ بله دانلود مستقیم ندارد (SDK بله متد دانلود ندارد)؛ پس هر فایلی که برای کاربرِ مینی‌اپ بله ساخته می‌شود
 *  (ارائه، پوستر، جزوه، اسلاید صوتی، پادکست) خودکار توسط ربات به چت بله‌ی خودش فرستاده می‌شود.
 *  فقط برای بله (فراخواننده botPlatform را چک می‌کند)؛ خطا نمی‌پرتابد: هر فایلی که نشد فقط لاگ می‌شود و کاربر همچنان می‌تواند از داخل اپ «ارسال به چت» بزند.
 *  ids: شناسه‌ی فایل‌های ذخیره‌شده (files.ts)؛ خروجی = تعداد فایل‌های فرستاده‌شده. */
import type { Env } from "./env";
import type { Uid } from "./settings";
import { loadFileDirect } from "./files";
import { esc, sendAudio, sendDocument } from "./telegram";
import { audioSeconds } from "./wav";

const MIME: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", wav: "audio/wav", mp3: "audio/mpeg", pdf: "application/pdf",
};
/** سقف تعداد فایل در هر اعلان (اسلاید صوتیِ ارائه‌ی بلند فایل زیاد دارد؛ بقیه از داخل اپ گرفته می‌شوند) */
const MAX_FILES = 20;

export async function autoSendToBale(env: Env, uid: Uid, chatId: number, ids: string[]): Promise<number> {
  let sent = 0;
  for (const id of [...new Set(ids)].slice(0, MAX_FILES)) {
    try {
      const f = await loadFileDirect(env, uid, id);
      if (!f) continue;
      const ext = (f.entry.name.split(".").pop() ?? "").toLowerCase();
      const data = new Uint8Array(f.data);
      const title = esc(f.entry.title.slice(0, 120));
      const podcast = /-podcast(-\d+)?$/.test(id);
      if (ext === "wav" || ext === "mp3") {
        await sendAudio(env, chatId, data, f.entry.name, `${podcast ? "🎙 پادکست" : "🔊 صدای اسلاید"}: ${title}`, { title: f.entry.title, duration: audioSeconds(data) });
      } else {
        const label = ext === "docx" ? "📝 جزوه" : ext === "png" || ext === "jpg" || ext === "jpeg" ? "🖼 پوستر" : /-audio(-s\d+)?$/.test(id) ? "🔊 اسلاید صوتی" : "📥 ارائه";
        await sendDocument(env, chatId, data, f.entry.name, `${label}: ${title}`, { mime: MIME[ext] ?? "application/octet-stream" });
      }
      sent++;
    } catch (e) { console.error("bale-autosend", id, String(e).slice(0, 200)); }
  }
  return sent;
}
