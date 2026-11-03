import { createHash } from "node:crypto";
import { CANONICAL_TEXT_MAX_BYTES, ContractError, HTTP, TURN_TEXT_MAX_CHARS, TURNS_PER_SOURCE_MAX, type Redaction, type Turn } from "@meet-first/contracts";
import { canonicalise } from "@meet-first/parsers";
import { findPlaceholders, makePlaceholderCounter, scrub } from "@meet-first/scrub";
import { normQuote } from "@meet-first/receipts";
import { makePayloadInvalidError } from "../route-errors.js";

// The sentence for a placeholder the app did not write, such as a redaction mark with an unknown category.
const PLACEHOLDER_INVALID_SENTENCE = "The upload has a redaction mark the app did not write. Upload the original file again.";
// The sentence for a message that the scrub made longer than the turn limit.
const TURN_TOO_LONG_SENTENCE = "A message grew past 20,000 characters during the scrub. Upload again from the app.";
// The sentence for messages that add up to more than the source cap.
const SOURCE_TOO_LARGE_SENTENCE = "The scrubbed messages add up to more than 2 MiB. Upload again from the app.";
// The sentence for a source with more messages than one source may hold.
const TOO_MANY_TURNS_SENTENCE = "The upload has more than 10,000 messages. Upload again from the app, which keeps the 10,000 most useful ones.";

// One turn as it will be stored: canonical, scrubbed, its norm text for quote checks, and its redactions.
export type StoredTurn = { turnIndex: number; text: string; normText: string; lang: string | null; redactions: Redaction[] };
// The authoritative pass over a whole upload: the turns to store, their content hash, and the sizes the checks need.
export type AuthoritativeScrub = { turns: StoredTurn[]; contentHash: Buffer; canonicalChars: number; redactionCount: number };

// A turn with its canonical text, made before any scrub runs so the size checks can read it.
type CanonicalTurn = { turn: Turn; canonical: string };

// sha256 of JSON.stringify of the stored texts in turn order, so the same text always gives the same hash.
export function contentHashOf(texts: readonly string[]): Buffer {
  return createHash("sha256").update(JSON.stringify(texts), "utf8").digest();
}

// Refuses an upload with too many turns, or with more canonical text than one source may hold, before any turn is scrubbed.
function refuseOversized(turns: readonly Turn[]): CanonicalTurn[] {
  if (turns.length > TURNS_PER_SOURCE_MAX) throw new ContractError("source_too_many_turns", TOO_MANY_TURNS_SENTENCE, HTTP.payloadTooLarge);
  const canonicalTurns = turns.map((turn) => ({ turn, canonical: canonicalise(turn.text) }));
  const total = canonicalTurns.reduce((sum, entry) => sum + entry.canonical.length, 0);
  if (total > CANONICAL_TEXT_MAX_BYTES) throw new ContractError("source_too_large", SOURCE_TOO_LARGE_SENTENCE, HTTP.payloadTooLarge);
  return canonicalTurns;
}

// Scrubs one canonical turn with the source's shared counter, refusing a placeholder it cannot read or a turn that grew too long.
function storedTurnOf(entry: CanonicalTurn, allowlist: readonly string[], nextId: () => string): StoredTurn {
  if (!/\S/.test(entry.canonical)) throw makePayloadInvalidError();
  if (findPlaceholders(entry.canonical).some((found) => !found.isKnownCategory)) {
    throw new ContractError("source_placeholder_invalid", PLACEHOLDER_INVALID_SENTENCE, HTTP.unprocessable);
  }
  const result = scrub(entry.canonical, { allowlist, nextId });
  if (result.text.length > TURN_TEXT_MAX_CHARS) {
    throw new ContractError("source_turn_too_long", TURN_TOO_LONG_SENTENCE, HTTP.unprocessable);
  }
  return {
    turnIndex: entry.turn.turnIndex,
    text: result.text,
    normText: normQuote(result.text),
    lang: entry.turn.lang ?? null,
    redactions: result.redactions,
  };
}

// Canonicalises and scrubs every turn again with one placeholder counter for the source, so ids run from 00000001 in turn order.
// The turn count and the canonical total are checked before the first turn is scrubbed, so an oversized upload costs no scrub work.
export function authoritativeScrub(turns: readonly Turn[], allowlist: readonly string[]): AuthoritativeScrub {
  const canonicalTurns = refuseOversized(turns);
  const nextId = makePlaceholderCounter();
  const stored = canonicalTurns.map((entry) => storedTurnOf(entry, allowlist, nextId));
  const canonicalChars = stored.reduce((sum, turn) => sum + turn.text.length, 0);
  if (canonicalChars > CANONICAL_TEXT_MAX_BYTES) {
    throw new ContractError("source_too_large", SOURCE_TOO_LARGE_SENTENCE, HTTP.payloadTooLarge);
  }
  return {
    turns: stored,
    contentHash: contentHashOf(stored.map((turn) => turn.text)),
    canonicalChars,
    redactionCount: stored.reduce((sum, turn) => sum + turn.redactions.length, 0),
  };
}
