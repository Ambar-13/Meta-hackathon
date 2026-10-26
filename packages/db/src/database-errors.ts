import { ContractError } from "@meet-first/contracts";

// The stable codes the triggers and meeting_create put in front of their messages (Wave 0 sections 4.5.3 and 4.5.4), the names check's code of
// migration 0002, and directory_meeting_create's three of migration 0006 (as-built item 49).
export const TRIGGER_CODES = ["turn_text_frozen", "card_source_not_frozen", "card_item_foreign_turn", "claim_foreign_turn", "meeting_bad_transition", "prefix_frozen", "event_seq_gap", "pair_not_joined", "card_not_approved", "other_card_missing", "names_pass_running", "listing_not_found", "directory_self", "directory_daily_cap"] as const;

// One of the fourteen codes above.
export type TriggerCode = (typeof TRIGGER_CODES)[number];

// A refusal read off a Postgres error: the stable code and the sentence to show (docs/contracts.md section 4).
export type DatabaseRefusal = { code: string; message: string };

// Plain CHECK constraints a route can hit, by constraint name, with the refusal to return (D29).
export const CHECK_REFUSALS: Readonly<Record<string, DatabaseRefusal>> = {
  quiz_items_check: { code: "persona_answer_missing", message: "The persona has not answered this question yet. Wait a moment and reload." },
};

// The sentence returned for any unique violation (docs/contracts.md section 4 gives the code) [confirm].
export const DUPLICATE_SENTENCE = "This already exists. Use the one that is there instead of making another.";

// Postgres's code for a unique violation; parseDatabaseError reads it as "duplicate" (docs/contracts.md section 4).
const UNIQUE_VIOLATION = "23505";
// Postgres's code for a check violation, which every RAISE in the migrations uses (Wave 0 section 4.5.3).
const CHECK_VIOLATION = "23514";

// Reads a trigger code and its sentence out of a check violation, or the entry of CHECK_REFUSALS for its constraint.
function checkRefusal(message: string, constraint: unknown): DatabaseRefusal | null {
  const match = /^([a-z_]+): (.+)$/s.exec(message);
  const group = match?.[1];
  const rest = match?.[2];
  if (group !== undefined && rest !== undefined && TRIGGER_CODES.some((known) => known === group)) return { code: group, message: rest };
  if (typeof constraint === "string" && Object.hasOwn(CHECK_REFUSALS, constraint)) return CHECK_REFUSALS[constraint] ?? null;
  return null;
}

// Reads a refusal off a Postgres error, or returns null for anything that is not one, which the caller throws again (docs/contracts.md section 4).
export function parseDatabaseError(error: unknown): DatabaseRefusal | null {
  if (typeof error !== "object" || error === null) return null;
  const code: unknown = Reflect.get(error, "code");
  const message: unknown = Reflect.get(error, "message");
  const constraint: unknown = Reflect.get(error, "constraint");
  if (typeof code !== "string" || !/^[0-9A-Z]{5}$/.test(code) || typeof message !== "string") return null;
  if (code === UNIQUE_VIOLATION) return { code: "duplicate", message: DUPLICATE_SENTENCE };
  if (code === CHECK_VIOLATION) return checkRefusal(message, constraint);
  return null;
}

// One line describing any thrown value, for a command to print when it fails.
export function describeError(error: unknown): string {
  if (error instanceof ContractError) return `${error.code}: ${error.message}`;
  const refusal = parseDatabaseError(error);
  if (refusal !== null) return `${refusal.code}: ${refusal.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}
