import { createHash } from "node:crypto";
import { CANONICAL_TEXT_MAX_BYTES, ContractError, HTTP, TURN_TEXT_MAX_CHARS, type Redaction, type Turn } from "@meet-first/contracts";
import { canonicalise } from "@meet-first/parsers";
import { findPlaceholders, makePlaceholderCounter, scrub } from "@meet-first/scrub";
import { normQuote } from "@meet-first/receipts";
import { makePayloadInvalidError } from "../route-errors.js";

// The sentence for a placeholder the app did not write, such as a redaction mark with an unknown category.
const PLACEHOLDER_INVALID_SENTENCE = "The upload has a redaction mark the app did not write. Upload the original file again.";
// The sentence for a message that the scrub made longer than the turn limit.
const TURN_TOO_LONG_SENTENCE = "A message grew past 20,000 characters during the scrub. Upload again from the app.";
// The sentence for scrubbed messages that add up to more than the source cap.
const SOURCE_TOO_LARGE_SENTENCE = "The scrubbed messages add up to more than 2 MiB. Upload again from the app.";

// One turn as it will be stored: canonical, scrubbed, its norm text for quote checks, and its redactions.
export type StoredTurn = { turnIndex: number; text: string; normText: string; lang: string | null; redactions: Redaction[] };
// The authoritative pass over a whole upload: the turns to store, their content hash, and the sizes the checks need.
export type AuthoritativeScrub = { turns: StoredTurn[]; contentHash: Buffer; canonicalChars: number; redactionCount: number };

// sha256 of JSON.stringify of the stored texts in turn order, so the same text always gives the same hash (D8).
export function contentHashOf(texts: readonly string[]): Buffer {
  return createHash("sha256").update(JSON.stringify(texts), "utf8").digest();
}

// Canonicalises and scrubs one turn with the source's shared counter, refusing a placeholder it cannot read or a turn that grew too long (D6, D11).
function storedTurnOf(turn: Turn, allowlist: readonly string[], nextId: () => string): StoredTurn {
  const canonical = canonicalise(turn.text);
  if (!/\S/.test(canonical)) throw makePayloadInvalidError();
  if (findPlaceholders(canonical).some((found) => !found.isKnownCategory)) {
    throw new ContractError("source_placeholder_invalid", PLACEHOLDER_INVALID_SENTENCE, HTTP.unprocessable);
  }
  const result = scrub(canonical, { allowlist, nextId });
  if (result.text.length > TURN_TEXT_MAX_CHARS) {
    throw new ContractError("source_turn_too_long", TURN_TOO_LONG_SENTENCE, HTTP.unprocessable);
  }
  return {
    turnIndex: turn.turnIndex,
    text: result.text,
    normText: normQuote(result.text),
    lang: turn.lang ?? null,
    redactions: result.redactions,
  };
}

// Canonicalises and scrubs every turn again with one placeholder counter for the source, so ids run from 00000001 in turn order (D6, D11, D14).
export function authoritativeScrub(turns: readonly Turn[], allowlist: readonly string[]): AuthoritativeScrub {
  const nextId = makePlaceholderCounter();
  const stored = turns.map((turn) => storedTurnOf(turn, allowlist, nextId));
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
