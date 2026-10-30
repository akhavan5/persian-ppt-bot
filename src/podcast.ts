/** پادکست دو‌گوینده از روی ارائه: نوشتن گفت‌وگو با LLM پروژه (همان مدل انتخابی کاربر) و تکه‌کردن آن برای TTS. */
import type { Env } from "./env";
import type { Deck } from "./types";
import { askJson } from "./llm";
import { prepareSpeech } from "./tts-text";
import type { Turn } from "./gemini-tts";

export interface PodcastScript { title: string; turns: Turn[] }

const MAX_TURN_CHARS = 450;
const MAX_TOTAL_CHARS = 7000; // ≈ ۶ تا ۷ دقیقه گفتار؛ فایل WAV حدود ۱۸ مگابایت می‌شود (سقف تلگرام ۵۰)
const MIN_TURNS = 6;

/** خلاصه‌ی ارائه برای پرامپت (عنوان، نکته‌ها و یادداشت هر اسلاید)؛ سقف طول برای ارائه‌های بزرگ */
function material(deck: Deck): string {
  const parts: string[] = [`Presentation title: ${deck.title}`];
  deck.slides.forEach((s, i) => {
    const bullets = [...(s.bullets ?? []), ...(s.columns ?? []).flatMap((c) => [c.heading, ...c.bullets]), ...(s.steps ?? []).map((x) => `${x.label}: ${x.text}`), ...(s.items ?? []).map((x) => `${x.heading}: ${x.text}`)]
      .filter(Boolean).slice(0, 8).join(" | ");
    const notes = (s.notes ?? "").replace(/\s+/g, " ").slice(0, 500);
    parts.push(`[${i + 1}] ${s.title}${s.subtitle ? ` — ${s.subtitle}` : ""}${bullets ? `\n  points: ${bullets}` : ""}${notes ? `\n  speaker notes: ${notes}` : ""}`);
  });
  return parts.join("\n").slice(0, 14000);
}

export async function makePodcastScript(env: Env, deck: Deck, o: { model?: string } = {}): Promise<PodcastScript> {
  const prompt = `Write the script of a short podcast episode in natural spoken Persian (Farsi) in which two hosts talk about the presentation below.

Hosts:
- "A" = علی: the host. Curious, friendly; opens and closes the episode, asks the questions a listener would ask, reacts, and sums up.
- "B" = سارا: the guest expert. Clear, calm and confident; explains the ideas with simple words and one concrete example or analogy.

Content rules:
- Use ONLY the material below. Do not invent statistics, dates, names, quotes or sources. If something is not in the material, keep it general.
- Follow the order of the presentation, grouping related slides. Never say "slide", "اسلاید" or slide numbers: they are talking about the topic, not reading a deck.
- Open with a short warm greeting and the question that makes the topic worth listening to. Close with 2-3 key takeaways and a friendly goodbye.
- Length: 18-28 turns in total, about 4-6 minutes of speech (3500-6000 Persian characters overall). Every turn is 1-3 short sentences (max ${MAX_TURN_CHARS} characters). Alternate speakers naturally (a speaker may take two turns in a row only rarely). Include a few natural reactions («آره»، «دقیقاً»، «جالبه») but no filler monologues.

Style rules (the text is read aloud by a TTS engine):
- Light conversational Persian: polite, warm, NOT slangy and NOT stiff bookish prose. Correct half-spaces (نیم‌فاصله) e.g. «می‌شود», «کتاب‌خانه».
- Write ALL numbers in words (e.g. «بیست و دو درصد»); never digits.
- No emojis, markdown, parentheses, quotation marks, English words (except unavoidable acronyms), stage directions, sound tags or speaker names inside the text.

Return ONLY JSON: {"title": "<short Persian episode title>", "turns": [{"s": "A", "t": "..."}, {"s": "B", "t": "..."}]}

Material:
${material(deck)}`;

  const data = await askJson(env, prompt, 7000, o.model);
  const rawTurns: any[] = Array.isArray(data?.turns) ? data.turns : [];
  const turns: Turn[] = [];
  let total = 0;
  let last: "A" | "B" = "B";
  for (const t of rawTurns) {
    const text = prepareSpeech(String(t?.t ?? t?.text ?? "")).slice(0, MAX_TURN_CHARS + 80);
    if (text.length < 2) continue;
    const s = String(t?.s ?? t?.speaker ?? "").trim().toUpperCase();
    const speaker: "A" | "B" = s === "A" || s === "B" ? s : last === "A" ? "B" : "A";
    if (total + text.length > MAX_TOTAL_CHARS) break;
    turns.push({ speaker, text });
    total += text.length;
    last = speaker;
  }
  if (turns.length < MIN_TURNS) throw new Error(`podcast script too short (${turns.length} turns)`);
  return { title: String(data?.title ?? "").trim().slice(0, 120) || deck.title, turns };
}

/** تکه‌کردن گفت‌وگو برای درخواست‌های TTS: هر تکه حداکثر maxChars نویسه و maxTurns نوبت (حدود یک تا دو دقیقه صدا) */
export function chunkTurns(turns: Turn[], maxChars = 1500, maxTurns = 8): Turn[][] {
  const out: Turn[][] = [];
  let cur: Turn[] = [];
  let len = 0;
  for (const t of turns) {
    if (cur.length && (len + t.text.length > maxChars || cur.length >= maxTurns)) { out.push(cur); cur = []; len = 0; }
    cur.push(t);
    len += t.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** متن گفت‌وگو برای ارسال به‌صورت فایل متنی */
export const transcript = (s: PodcastScript) => `${s.title}\n\n` + s.turns.map((t) => `${t.speaker === "A" ? "علی" : "سارا"}: ${t.text}`).join("\n\n") + "\n";
