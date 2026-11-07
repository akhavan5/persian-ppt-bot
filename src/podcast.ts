/** پادکست دو‌گوینده از روی ارائه: نوشتن گفت‌وگو با LLM پروژه (همان مدل انتخابی کاربر) و تکه‌کردن آن برای TTS. */
import type { Env } from "./env";
import type { Deck } from "./types";
import { askJson } from "./llm";
import { prepareSpeech } from "./tts-text";
import type { Turn } from "./gemini-tts";

export interface PodcastScript { title: string; turns: Turn[] }

const MAX_TURN_CHARS = 320; // نوبت‌های کوتاه‌تر = حرف‌زدن طبیعی‌تر (قبلاً ۴۵۰)
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

/** شبکه‌ی اطمینان: اگر مدل باز هم چند واژه‌ی کتابی نوشت، رایج‌ترین‌ها به شکل گفتاری درمی‌آید (تلفظ TTS هم طبیعی‌تر می‌شود). فقط کل واژه جایگزین می‌شود. */
const word = (w: string) => new RegExp(`(?<![\\u0600-\\u06FF\\u200c])${w}(?![\\u0600-\\u06FF\\u200c])`, "g");
const SPOKEN: [RegExp, string][] = [
  [word("را"), "رو"], [word("نمی‌باشد"), "نیست"], [word("می‌باشد"), "هست"], [word("می‌باشند"), "هستن"],
  [word("بنابراین"), "برای همین"], [word("لذا"), "برای همین"], [word("زیرا"), "چون"], [word("اما"), "ولی"],
  [word("اگر"), "اگه"], [word("چنانچه"), "اگه"], [word("همچنین"), "همین‌طور"],
];
export const spoken = (t: string) => SPOKEN.reduce((s, [re, to]) => s.replace(re, to), t);

export async function makePodcastScript(env: Env, deck: Deck, o: { model?: string } = {}): Promise<PodcastScript> {
  const prompt = `Write the script of a short, relaxed podcast episode in SPOKEN, COLLOQUIAL Persian (Farsi) in which two hosts chat about the presentation below. It must sound like two friends talking, not like someone reading a text aloud.

Hosts (equals, relaxed, a bit playful):
- "A" = علی: the host. Curious and friendly; opens and closes the episode, asks the questions a listener would ask, reacts, jokes lightly, sums up.
- "B" = امیر: the guest who knows the topic well. He explains like a friend would, with simple words and one concrete everyday example or analogy; he never lectures.
- Both hosts are men. If they ever address each other by name (rarely, e.g. «آره امیر», «ببین علی»), use exactly these names: علی and امیر. Never use any other name.

Content rules:
- Use ONLY the material below. Do not invent statistics, dates, names, quotes or sources. If something is not in the material, keep it general.
- Follow the order of the presentation, grouping related slides. Never say "slide", "اسلاید" or slide numbers: they are talking about the topic, not reading a deck.
- Open with a short, casual greeting and the question that makes the topic worth listening to. Close with 2-3 key takeaways and a friendly goodbye.
- Length: 22-34 turns in total, about 4-6 minutes of speech (3500-6000 Persian characters overall). Every turn is 1-2 SHORT sentences (max ${MAX_TURN_CHARS} characters). If one host explains for two sentences, the other jumps in with a question, a reaction or a re-phrasing. Alternate speakers naturally; a speaker may take two turns in a row only rarely.

Spoken-Persian style rules (the text is read aloud by a TTS engine, so spell words exactly as they are pronounced):
- Write the way Tehrani Persians actually talk, NOT the way books are written. Use spoken verb forms and contractions: «می‌شه، می‌گه، می‌خواد، می‌تونه، نمی‌دونم، بگیم، بریم، می‌دونی، اینه که، چیه، کجاست، چطوره، اون، اونا، باهاش، براش»; «رو» instead of «را»; «هست/نیست/ـه» instead of «می‌باشد»; «اگه» instead of «اگر»; «ولی» instead of «اما»; «چون» instead of «زیرا».
- Avoid bookish words and sentence shapes: «بنابراین، همچنین، لذا، از این رو، در نتیجه، به منظور، جهت، در خصوص، چنانچه، می‌گردد، قرار می‌گیرد، نماییم، مورد استفاده، به‌طور کلی»; no long sentences with several clauses. Say it the way you would say it to a friend over tea.
- Sprinkle natural filler and reactions, but not in every turn: «خب، راستش، ببین، یعنی، آخه، دیگه، مثلاً، آها، آره، دقیقاً، جدی؟، نه بابا، وای، جالبه، خیلی خوبه».
- Friendly and warm but never rude: no swear words, no street slang, no mocking.
- Style demo only (NOT content to reuse): bookish «در این بخش به بررسی مزایای این روش می‌پردازیم و مشاهده می‌کنیم که چگونه می‌توان از آن بهره برد.» → spoken «خب، بیا ببینیم این روش دقیقاً به چه دردی می‌خوره. یعنی کجاها می‌شه ازش استفاده کرد؟»
- Correct half-spaces (نیم‌فاصله), e.g. «می‌شه», «کتاب‌خونه».
- Write ALL numbers in words (e.g. «بیست و دو درصد»); never digits.
- No emojis, markdown, parentheses, quotation marks, English words (except unavoidable acronyms), stage directions, sound tags (like laughs) or speaker labels (like "علی:") inside the text.

Return ONLY JSON: {"title": "<short Persian episode title>", "turns": [{"s": "A", "t": "..."}, {"s": "B", "t": "..."}]}

Material:
${material(deck)}`;

  const data = await askJson(env, prompt, 7000, o.model);
  const rawTurns: any[] = Array.isArray(data?.turns) ? data.turns : [];
  const turns: Turn[] = [];
  let total = 0;
  let last: "A" | "B" = "B";
  for (const t of rawTurns) {
    const text = spoken(prepareSpeech(String(t?.t ?? t?.text ?? ""))).slice(0, MAX_TURN_CHARS + 80);
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
export const transcript = (s: PodcastScript) => `${s.title}\n\n` + s.turns.map((t) => `${t.speaker === "A" ? "علی" : "امیر"}: ${t.text}`).join("\n\n") + "\n";
