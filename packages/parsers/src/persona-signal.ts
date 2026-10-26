// First-person pronouns, lower case, matched as whole words (Latin scripts) or as substrings (scripts without word spaces) (R3.8).
export const FIRST_PERSON_WORDS: ReadonlyArray<string> = [
  "i", "i'm", "i've", "i'd", "i'll", "me", "my", "mine", "myself", // English
  "je", "j'ai", "moi", "mon", "ma", "mes", // French
  "ich", "mir", "mich", "mein", "meine", // German
  "yo", "mi", "mis", "conmigo", // Spanish
  "eu", "meu", "minha", "comigo", // Portuguese
  "io", "mio", "mia", "miei", // Italian
  "saya", "aku", "gue", // Malay, Indonesian
  "ako", "ko", "akin", // Filipino
];
// Pronouns of scripts written without spaces between words, matched as substrings of the lower-cased text (R3.8).
export const FIRST_PERSON_SUBSTRINGS: ReadonlyArray<string> = [
  "मैं", "मेरा", "मुझे", // Hindi: main, mera, mujhe
  "நான்", "என்", // Tamil: naan, en
  "我", "我的", // Chinese: wo, wode
  "私", "僕", "俺", // Japanese: watashi, boku, ore
  "나는", "제가", "내가", // Korean: naneun, jega, naega
  "أنا", // Arabic: ana
  "я ", "мне", "мой", // Russian: ya, mne, moy
  "আমি", // Bengali: ami
];

// A prose turn has at least this many words (R3.8).
const PROSE_MIN_WORDS = 6;
// Fenced blocks, from a run of three or more backticks or tildes to the same run or the end of the text.
const FENCED_BLOCK = /(`{3,}|~{3,})[\s\S]*?(?:\1|$)/g;
// Characters of a Han, Hiragana or Katakana run: each one counts as a word.
const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
// A run of word characters, including apostrophes, for matching pronouns.
const WORD_RUN = /[\p{L}\p{M}\p{N}']+/gu;
// One letter, for telling a word from a piece of punctuation.
const LETTER = /\p{L}/u;
// The first-person words as a set, built once for quick lookup.
const FIRST_PERSON_SET = new Set(FIRST_PERSON_WORDS);

// Counts the words of a text outside its fenced blocks, stopping at the prose minimum; a Han or kana piece counts per character.
function wordCount(text: string): number {
  const outsideFences = text.replace(FENCED_BLOCK, " ");
  let count = 0;
  for (const piece of outsideFences.split(/\s+/)) {
    if (!LETTER.test(piece)) continue;
    const cjk = Array.from(piece.matchAll(CJK_CHARACTER)).length;
    count += cjk > 0 ? cjk : 1;
    if (count >= PROSE_MIN_WORDS) return count;
  }
  return count;
}

// True when a text is prose: at least 6 words, so a code-fence-only turn never is.
function isProse(text: string): boolean {
  return wordCount(text) >= PROSE_MIN_WORDS;
}

// True when a text holds a first-person pronoun, matched in lower case with curly apostrophes folded to straight ones.
function hasFirstPerson(text: string): boolean {
  const folded = text.toLowerCase().replace(/[‘’]/g, "'");
  for (const match of folded.matchAll(WORD_RUN)) {
    if (FIRST_PERSON_SET.has(match[0].replace(/^'+|'+$/g, ""))) return true;
  }
  return FIRST_PERSON_SUBSTRINGS.some((entry) => folded.includes(entry));
}

// Share of prose turns that contain a first-person pronoun, 0 to 1 (R3.8). A prose turn has at least 6 words and is not a code-fence-only turn.
export function computePersonaSignal(texts: string[]): number {
  const prose = texts.filter(isProse);
  if (prose.length === 0) return 0;
  const withPronoun = prose.filter(hasFirstPerson).length;
  return Math.round((withPronoun / prose.length) * 1000) / 1000;
}

// Per-turn score used for ranking: 1 when the turn has a first-person pronoun, 0 otherwise, plus 0.5 when it is prose.
export function personaScore(text: string): number {
  return (hasFirstPerson(text) ? 1 : 0) + (isProse(text) ? 0.5 : 0);
}
