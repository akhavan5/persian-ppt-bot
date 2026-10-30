/**
 * متن گویای «اسلاید صوتی»: برای هر اسلاید یک متن سخنرانی گفتاری و خودمانی (هم‌لحن پادکست) با LLM پروژه نوشته می‌شود.
 * یادداشت‌های معمولی ارائه (notes) دست‌نخورده می‌مانند؛ چون برای ارائه‌دهنده نوشته شده‌اند (گاهی دستورالعمل‌اند، نه متنِ گفتنی).
 * اگر LLM برای اسلایدی جواب نداد، audio-workflow همان متن قبلی (narrationFor) را می‌خواند.
 */
import type { Env } from "./env";
import type { Deck, Slide } from "./types";
import { askJson } from "./llm";
import { prepareSpeech } from "./tts-text";
import { spoken } from "./podcast";

const MAX_CHARS = 900;
export const NARRATION_BATCH = 8;

/** نکته‌های اسلاید به‌صورت یک خط (برای پرامپت) */
function facts(s: Slide, i: number): string {
  const points = [...(s.bullets ?? []), ...(s.columns ?? []).flatMap((c) => [c.heading, ...c.bullets]), ...(s.steps ?? []).map((x) => `${x.label}: ${x.text}`),
    ...(s.items ?? []).map((x) => `${x.heading}: ${x.text}`), ...(s.stats ?? []).map((x) => `${x.value} ${x.label}`), ...(s.quote ? [s.quote.text] : [])]
    .filter(Boolean).slice(0, 10).join(" | ");
  const notes = (s.notes ?? "").replace(/\s+/g, " ").slice(0, 500);
  return `[${i}] layout=${s.layout} | ${s.title}${s.subtitle ? ` — ${s.subtitle}` : ""}${points ? `\n  on-screen points: ${points}` : ""}${notes ? `\n  presenter notes: ${notes}` : ""}`;
}

/** متن گفتنی اسلایدهای idxs (شماره‌ی صفرمبنا)؛ خروجی: شماره ⇒ متن آماده‌ی TTS. اسلایدهای بدون جواب معتبر در خروجی نیستند. */
export async function makeNarration(env: Env, deck: Deck, idxs: number[], o: { model?: string } = {}): Promise<Record<number, string>> {
  const last = deck.slides.length - 1;
  const outline = deck.slides.map((s, i) => `${i}. ${s.title}`).join("\n").slice(0, 3000);
  const prompt = `You are writing the voice-over of a narrated presentation, in SPOKEN, COLLOQUIAL Persian (Farsi). One friendly narrator talks to the listener while each slide is on screen. It must sound like a relaxed person explaining something to a friend, not like someone reading a text aloud.

Rules for the content:
- Use ONLY the slide material and presenter notes below. Do not invent statistics, dates, names, quotes or sources; if something is missing, keep it general.
- Do NOT read the bullets word by word: the slide already shows them. Explain the idea in your own words, add the "why it matters" or one simple everyday example or analogy that the material supports.
- 3-6 SHORT sentences per slide (about 20-45 seconds, 250-650 characters). Title slide (index 0): a warm greeting and what we will talk about. Section slides: one or two sentences that bridge to the next part. Questions slide: invite the listener to ask or think. Closing slide (index ${last}): a short wrap-up with the key takeaway and a friendly goodbye.
- Slides follow each other: connect them naturally («خب، حالا بریم سراغ…», «حالا سؤال اینه که…») and never repeat the previous slide. Never say "slide", "اسلاید" or slide numbers.
- Address the listener directly and warmly («شما» is fine, or avoid pronouns); no lecturing tone.

Spoken-Persian style rules (the text is read aloud by a TTS engine, so spell words exactly as they are pronounced):
- Write the way Tehrani Persians actually talk, NOT the way books are written: spoken verb forms and contractions «می‌شه، می‌گه، می‌خواد، می‌تونه، می‌دونی، اینه که، چیه، چطوره، اون، اونا»; «رو» instead of «را»; «هست/نیست/ـه» instead of «می‌باشد»; «اگه» instead of «اگر»; «ولی» instead of «اما»; «چون» instead of «زیرا».
- Avoid bookish words and long multi-clause sentences: «بنابراین، همچنین، لذا، از این رو، در نتیجه، به منظور، جهت، در خصوص، چنانچه، می‌گردد، قرار می‌گیرد، مورد استفاده».
- A little natural filler, not in every sentence: «خب، راستش، ببین، یعنی، آخه، دیگه، مثلاً، جالبه». Friendly but never rude: no swear words, no street slang.
- Correct half-spaces (نیم‌فاصله). Write ALL numbers in words (e.g. «بیست و دو درصد»), never digits.
- No emojis, markdown, parentheses, quotation marks, English words (except unavoidable acronyms), stage directions or sound tags.

Presentation title: ${deck.title}
Outline (for flow only):
${outline}

Write the voice-over ONLY for these slides:
${idxs.map((i) => facts(deck.slides[i], i)).join("\n")}

Return ONLY JSON: {"slides": [{"i": <slide index>, "t": "<what the narrator says>"}]}`;

  const data = await askJson(env, prompt, 4500, o.model);
  const rows: any[] = Array.isArray(data?.slides) ? data.slides : [];
  const out: Record<number, string> = {};
  for (const r of rows) {
    const i = Number(r?.i);
    if (!idxs.includes(i)) continue;
    const text = spoken(prepareSpeech(String(r?.t ?? r?.text ?? ""))).slice(0, MAX_CHARS);
    if (text.length >= 25) out[i] = text;
  }
  return out;
}
