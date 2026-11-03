import type { FastifyInstance } from "fastify";
import { ContractError, HTTP, routes, SOURCES_PER_PERSON_MAX, SourceCreateResponse, UPLOAD_BODY_LIMIT_BYTES } from "@meet-first/contracts";
import { withPerson, type DatabaseTransaction } from "@meet-first/db";
import { SCRUB_VERSION } from "@meet-first/scrub";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";
import { authoritativeScrub, type AuthoritativeScrub, type StoredTurn } from "./authoritative-scrub.js";
import { decodeUploadBody, parseSourceBody, type ParsedSourceBody } from "./ndjson-body.js";

// What one upload ended as: the row it points at, the numbers for the reply, and whether the names pass must be queued.
export type UploadOutcome = { sourceId: string; turnCount: number; redactionCount: number; isDuplicate: boolean; needsNamesPass: boolean };

// Rows per insert statement, so 10,000 turns stay well under Postgres's limit on bound values in one statement.
export const INSERT_BATCH_ROWS = 1_000;

// The sentence for a person who already holds the most sources one person may keep.
const SOURCE_LIMIT_SENTENCE = "You already have 3 sources, the most one person can keep. Use one of them instead of uploading again.";
// The sentence for a turn whose id the insert did not return; this should never reach a person, so it is an internal error.
const TURN_ID_MISSING_SENTENCE = "A message was not saved with its id. Try the upload again.";

// The first value of a header, when a client sent it more than once.
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Counts the sources one person holds, for SOURCES_PER_PERSON_MAX.
async function countSources(trx: DatabaseTransaction, personId: string): Promise<number> {
  const counted = await trx.selectFrom("sources").select((eb) => eb.fn.countAll().as("count")).where("person_id", "=", personId).executeTakeFirstOrThrow();
  return Number(counted.count);
}

// The answer for an upload whose content is already stored: the first id, its counts, and whether the names pass still has to run.
async function duplicateOutcome(trx: DatabaseTransaction, existing: { id: string; turn_count: number; frozen_at: Date | null }): Promise<UploadOutcome> {
  const counted = await trx.selectFrom("redactions").select((eb) => eb.fn.countAll().as("count")).where("source_id", "=", existing.id).executeTakeFirstOrThrow();
  const marker = await trx.selectFrom("names_passes").select("source_id").where("source_id", "=", existing.id).executeTakeFirst();
  return {
    sourceId: existing.id,
    turnCount: existing.turn_count,
    redactionCount: Number(counted.count),
    isDuplicate: true,
    needsNamesPass: existing.frozen_at === null && marker === undefined,
  };
}

// Writes the turns in batches and returns the id of each turn by its turn index.
async function insertTurns(trx: DatabaseTransaction, input: { sourceId: string; personId: string; turns: StoredTurn[] }): Promise<Map<number, string>> {
  const ids = new Map<number, string>();
  for (let start = 0; start < input.turns.length; start += INSERT_BATCH_ROWS) {
    const batch = input.turns.slice(start, start + INSERT_BATCH_ROWS);
    const rows = await trx
      .insertInto("turns")
      .values(batch.map((turn) => ({
        source_id: input.sourceId,
        person_id: input.personId,
        turn_index: turn.turnIndex,
        role: "user" as const,
        text: turn.text,
        norm_text: turn.normText,
        lang: turn.lang,
      })))
      .returning(["id", "turn_index"])
      .execute();
    for (const row of rows) ids.set(row.turn_index, row.id);
  }
  return ids;
}

// Writes one redactions row for each placeholder, in batches, pointing at the turn it came from.
async function insertRedactions(trx: DatabaseTransaction, input: { sourceId: string; personId: string; turns: StoredTurn[]; turnIds: Map<number, string> }): Promise<void> {
  const rows = input.turns.flatMap((turn) => {
    const turnId = input.turnIds.get(turn.turnIndex);
    if (turnId === undefined) throw new ContractError("turn_id_missing", TURN_ID_MISSING_SENTENCE, HTTP.internal);
    return turn.redactions.map((redaction) => ({
      source_id: input.sourceId,
      turn_id: turnId,
      person_id: input.personId,
      category: redaction.category,
      placeholder_id: redaction.placeholderId,
    }));
  });
  for (let start = 0; start < rows.length; start += INSERT_BATCH_ROWS) {
    await trx.insertInto("redactions").values(rows.slice(start, start + INSERT_BATCH_ROWS)).execute();
  }
}

// Writes the source row, its turns and its redactions, and returns the source id.
async function insertSource(trx: DatabaseTransaction, input: { personId: string; body: ParsedSourceBody; scrubbed: AuthoritativeScrub }, now: Date): Promise<string> {
  const source = await trx
    .insertInto("sources")
    .values({
      person_id: input.personId,
      kind: input.body.header.kind,
      content_hash: input.scrubbed.contentHash,
      turn_count: input.scrubbed.turns.length,
      canonical_chars: input.scrubbed.canonicalChars,
      persona_signal: input.body.header.personaSignal,
      parser_version: input.body.header.parserVersion,
      scrub_version: SCRUB_VERSION,
      attested_at: now,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const turnIds = await insertTurns(trx, { sourceId: source.id, personId: input.personId, turns: input.scrubbed.turns });
  await insertRedactions(trx, { sourceId: source.id, personId: input.personId, turns: input.scrubbed.turns, turnIds });
  return source.id;
}

// Stores one parsed upload in the caller's transaction after the authoritative scrub, or finds the earlier identical one.
export async function storeUpload(trx: DatabaseTransaction, input: { personId: string; body: ParsedSourceBody }, now: Date): Promise<UploadOutcome> {
  const person = await trx.selectFrom("people").select(["display_name", "affiliations"]).where("id", "=", input.personId).forUpdate().executeTakeFirst();
  if (person === undefined) throw makeNotFoundError();
  const scrubbed = authoritativeScrub(input.body.turns, [person.display_name, ...person.affiliations]);
  const existing = await trx
    .selectFrom("sources")
    .select(["id", "turn_count", "frozen_at"])
    .where("person_id", "=", input.personId)
    .where("content_hash", "=", scrubbed.contentHash)
    .executeTakeFirst();
  if (existing !== undefined) return duplicateOutcome(trx, existing);
  if ((await countSources(trx, input.personId)) >= SOURCES_PER_PERSON_MAX) {
    throw new ContractError("source_limit_reached", SOURCE_LIMIT_SENTENCE, HTTP.tooMany);
  }
  const sourceId = await insertSource(trx, { personId: input.personId, body: input.body, scrubbed }, now);
  return { sourceId, turnCount: scrubbed.turns.length, redactionCount: scrubbed.redactionCount, isDuplicate: false, needsNamesPass: true };
}

// Registers POST /api/sources: 201 SourceCreateResponse for a new or a duplicate upload; the refusals of 4.3.2, 4.3.3 and source_limit_reached.
// Registration is synchronous, as the pairs and sessions folders do; the handlers themselves are async.
export function registerUploadRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.addContentTypeParser("application/x-ndjson", { parseAs: "buffer", bodyLimit: UPLOAD_BODY_LIMIT_BYTES }, (request, body, done) => {
    done(null, body);
  });
  app.post(routes.sources.createSource.path, { bodyLimit: UPLOAD_BODY_LIMIT_BYTES }, async (request, reply) => {
    const personId = requirePerson(request);
    if (!Buffer.isBuffer(request.body)) throw makePayloadInvalidError();
    const decoded = await decodeUploadBody(request.body, firstHeader(request.headers["content-encoding"]));
    const body = parseSourceBody(decoded);
    const outcome = await withPerson(deps.db, personId, (trx) => storeUpload(trx, { personId, body }, deps.now()));
    // The job is queued after the commit, because the queue writes through its own connection. When the queue
    // refuses it, the error goes to the client and the stored source stays whole; a later upload of the same file is a
    // duplicate that queues the names check again (4.3.1 step 6).
    if (outcome.needsNamesPass) await deps.enqueue("scrub_names", { sourceId: outcome.sourceId, personId });
    return reply.code(201).send(
      SourceCreateResponse.parse({
        sourceId: outcome.sourceId,
        turnCount: outcome.turnCount,
        redactionCount: outcome.redactionCount,
        duplicate: outcome.isDuplicate,
      }),
    );
  });
}
