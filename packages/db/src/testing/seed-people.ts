import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { CARD_ITEMS_MAX, CARD_ITEMS_MIN, ContractError, ItemKind, RECOVERY_CODE_ALPHABET, RECOVERY_CODE_LENGTH, SESSION_TOKEN_BYTES } from "@meet-first/contracts";
import { normQuote } from "@meet-first/receipts";
import { makeDatabase } from "../client.js";
import { withPerson } from "../transaction.js";
import type { Database } from "../types.js";
import { readTestDatabaseUrls } from "./fresh-database.js";

// The owner of each source a test made with createFrozenSource, so createApprovedCard can find it without a context.
const sourceOwners = new Map<string, string>();

// Returns the item at index, and throws when the list is shorter.
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`The list has no item at index ${String(index)}.`);
  return item;
}

// sha256 of a token's text as it travels: the rule every stored hash in these seeds follows.
export function sha256Text(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

// One recovery code: RECOVERY_CODE_LENGTH characters drawn from the contracts alphabet.
function newRecoveryCode(): string {
  return Array.from({ length: RECOVERY_CODE_LENGTH }, () => RECOVERY_CODE_ALPHABET.charAt(randomInt(RECOVERY_CODE_ALPHABET.length))).join("");
}

// Creates a person and a first session through auth_create_person, and returns the raw token and recovery code a test can send.
export async function createTestPerson(db: Kysely<Database>, displayName: string): Promise<{ personId: string; sessionToken: string; recoveryCode: string }> {
  const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString("hex");
  const recoveryCode = newRecoveryCode();
  const result = await sql<{ person_id: string | null }>`SELECT auth_create_person(${displayName}, ${[]}::text[], ${sha256Text(recoveryCode)}, ${sha256Text(sessionToken)}) AS person_id`.execute(db);
  const personId = result.rows[0]?.person_id;
  if (personId === null || personId === undefined) throw new ContractError("seed_person_failed", "auth_create_person returned no id. Check that migration 0001 ran.", 500);
  return { personId, sessionToken, recoveryCode };
}

// Writes the names pass row of one source through the worker, as the names check does, so the freeze may proceed (migration 0002).
async function writeNamesPass(personId: string, sourceId: string): Promise<void> {
  const worker = makeDatabase(readTestDatabaseUrls(process.env).workerUrl, 1);
  try {
    await withPerson(worker, personId, (trx) => trx.insertInto("names_passes").values({ source_id: sourceId, person_id: personId }).execute());
  } finally {
    await worker.destroy();
  }
}

// Creates a paste source with these turns for the person and freezes it, as the names review would (D10, D16).
export async function createFrozenSource(db: Kysely<Database>, personId: string, turns: string[]): Promise<{ sourceId: string; turnIds: string[] }> {
  if (turns.length === 0) throw new ContractError("seed_turns_empty", "createFrozenSource needs at least one turn.", 500);
  const inserted = await withPerson(db, personId, async (trx) => {
    const source = await trx.insertInto("sources").values({
      person_id: personId, kind: "paste", content_hash: sha256Text(`${randomUUID()}\n${turns.join("\n")}`), turn_count: turns.length,
      canonical_chars: turns.reduce((sum, text) => sum + text.length, 0), persona_signal: "0.500", parser_version: "test", scrub_version: "test", attested_at: new Date(),
    }).returning("id").executeTakeFirstOrThrow();
    const rows = await trx.insertInto("turns").values(turns.map((text, index) => ({ source_id: source.id, person_id: personId, turn_index: index, role: "user" as const, text, norm_text: normQuote(text) }))).returning(["id", "turn_index"]).execute();
    return { sourceId: source.id, rows };
  });
  await writeNamesPass(personId, inserted.sourceId);
  const now = new Date();
  await withPerson(db, personId, (trx) => trx.updateTable("sources").set({ names_reviewed_at: now, frozen_at: now }).where("id", "=", inserted.sourceId).execute());
  sourceOwners.set(inserted.sourceId, personId);
  return { sourceId: inserted.sourceId, turnIds: inserted.rows.sort((a, b) => a.turn_index - b.turn_index).map((row) => row.id) };
}

// Creates an approved card on a source made by createFrozenSource, with items quoting its turns in order (D21, R7.1).
export async function createApprovedCard(db: Kysely<Database>, sourceId: string, options: { recallAllowed?: boolean; items?: number } = {}): Promise<{ cardId: string; itemIds: string[] }> {
  const personId = sourceOwners.get(sourceId);
  if (personId === undefined) throw new ContractError("seed_source_unknown", "createApprovedCard only knows sources made by createFrozenSource in this test process.", 500);
  const count = options.items ?? CARD_ITEMS_MIN;
  if (!Number.isInteger(count) || count < 0 || count > CARD_ITEMS_MAX) throw new ContractError("seed_items_out_of_range", "items must be a whole number from 0 to 40.", 500);
  return withPerson(db, personId, async (trx) => {
    const turns = await trx.selectFrom("turns").select(["id", "text"]).where("source_id", "=", sourceId).orderBy("turn_index").execute();
    const now = new Date();
    const card = await trx.insertInto("cards").values({ source_id: sourceId, person_id: personId, state: "approved", model: "test-model", prompt_version: "test", items_total: count, items_verified: count, thin: count < CARD_ITEMS_MIN, recall_allowed: options.recallAllowed ?? false, built_at: now, approved_at: now }).returning("id").executeTakeFirstOrThrow();
    const itemIds: string[] = [];
    for (let position = 1; position <= count; position += 1) {
      const turn = at(turns, (position - 1) % turns.length);
      const kind = at(ItemKind.options, (position - 1) % ItemKind.options.length);
      const item = await trx.insertInto("card_items").values({ card_id: card.id, person_id: personId, position, kind, claim: `Test claim ${String(position)}`, lang: "en", gloss: `Test gloss ${String(position)}`, turn_id: turn.id, quote: turn.text, norm_quote: normQuote(turn.text), verified: true, flagged: false, approved: true, sensitive: false }).returning("id").executeTakeFirstOrThrow();
      itemIds.push(item.id);
    }
    return { cardId: card.id, itemIds };
  });
}
