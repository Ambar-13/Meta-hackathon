// A byte order mark at the start of the text. Write it in code as the escape /^﻿/, never as the
// invisible character.
export const BOM = /^﻿/;
// A Windows line ending (CR then LF) or a lone CR; both become LF.
export const CRLF = /\r\n?/g;
// In words: every character in the Unicode categories "format" and "control", except the line feed
// (U+000A) and the tab (U+0009).
export const FORMAT_AND_CONTROL = /(?![\n\t])[\p{Cf}\p{Cc}]/gu;

// The fewest letters a text needs before guessLang names a script (the language label of a turn).
const LANG_MIN_LETTERS = 20;
// The label guessLang gives when the letters do not decide the language.
const UNDETERMINED = "und";
// One letter, for counting letters in a text.
const LETTER = /\p{L}/u;

// The script buckets of guessLang, in tie-break order. Japanese holds the kana; Han letters join it
// when kana is present.
const SCRIPT_BUCKETS: ReadonlyArray<{ tag: string; pattern: RegExp }> = [
  { tag: "en", pattern: /\p{Script=Latin}/u },
  { tag: "hi", pattern: /\p{Script=Devanagari}/u },
  { tag: "ta", pattern: /\p{Script=Tamil}/u },
  { tag: "zh", pattern: /\p{Script=Han}/u },
  { tag: "ja", pattern: /[\p{Script=Hiragana}\p{Script=Katakana}]/u },
  { tag: "ko", pattern: /\p{Script=Hangul}/u },
  { tag: "ar", pattern: /\p{Script=Arabic}/u },
  { tag: "ru", pattern: /\p{Script=Cyrillic}/u },
  { tag: "bn", pattern: /\p{Script=Bengali}/u },
];

// Strips the BOM, turns CRLF into LF, normalises to NFC, and removes every Unicode format (Cf) and
// control (Cc) character except line feed and tab. The result is the text that is hashed, stored,
// scrubbed and quoted; offsets are UTF-16 code units of it.
export function canonicalise(text: string): string {
  return text.replace(BOM, "").replace(CRLF, "\n").normalize("NFC").replace(FORMAT_AND_CONTROL, "");
}

// Counts the letters of a text in each script bucket, with Han letters moved into Japanese when
// kana is present.
function bucketCounts(letters: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const bucket of SCRIPT_BUCKETS) {
    counts.set(bucket.tag, letters.filter((letter) => bucket.pattern.test(letter)).length);
  }
  const kana = counts.get("ja") ?? 0;
  if (kana > 0) {
    counts.set("ja", kana + (counts.get("zh") ?? 0));
    counts.set("zh", 0);
  }
  return counts;
}

// A cheap language guess for `turns.lang`: the script of the majority of letters, mapped to a BCP
// 47 tag; "und" when under 20 letters.
export function guessLang(text: string): string {
  const letters = [...text].filter((ch) => LETTER.test(ch));
  if (letters.length < LANG_MIN_LETTERS) return UNDETERMINED;
  const counts = bucketCounts(letters);
  let best = UNDETERMINED;
  let bestCount = 0;
  for (const bucket of SCRIPT_BUCKETS) {
    const count = counts.get(bucket.tag) ?? 0;
    if (count > bestCount) {
      best = bucket.tag;
      bestCount = count;
    }
  }
  return best;
}
