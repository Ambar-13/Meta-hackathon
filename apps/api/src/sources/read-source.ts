import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NAMES_PAGE_SIZE, type NameRow, routes, SourceView, Uuid } from "@meet-first/contracts";
import { withPerson, type DatabaseTransaction } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The :id of every /api/sources/:id route: a uuid, or the source cannot exist (404).
export const SourceParams = z.object({ id: Uuid });
// The ?page= query: a whole number from 1 to 100,000, 1 when absent (R2.4). No contracts schema names it.
export const PageQuery = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1) });

// One name the names pass found, as this module reads it: the text, and the role token that stands for it in the turns.
type FoundName = { text: string; roleToken: string };

// The words of a text, split on any whitespace and with the empty pieces dropped.
function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}

// Up to 3 words before and 3 after the first place a role token appears in the turns, with the token in the middle (R2.3).
export function nameContext(turnTexts: readonly string[], roleToken: string): string {
  for (const text of turnTexts) {
    const index = text.indexOf(roleToken);
    if (index < 0) continue;
    const before = wordsOf(text.slice(0, index)).slice(-3);
    const after = wordsOf(text.slice(index + roleToken.length)).slice(0, 3);
    return [...before, roleToken, ...after].join(" ");
  }
  return roleToken;
}

// Orders names as the list groups them: by role token, then by name, comparing code units so every database orders them alike (R2.4).
export function compareNames(a: { text: string; roleToken: string }, b: { text: string; roleToken: string }): number {
  if (a.roleToken !== b.roleToken) return a.roleToken < b.roleToken ? -1 : 1;
  if (a.text !== b.text) return a.text < b.text ? -1 : 1;
  return 0;
}

// The names of a source that may be kept, in list order. A minor's name is never listed (D18).
async function listedNames(trx: DatabaseTransaction, sourceId: string): Promise<FoundName[]> {
  const rows = await trx.selectFrom("source_names").select(["text", "role_token"]).where("source_id", "=", sourceId).where("is_minor", "=", false).execute();
  return rows.map((row) => ({ text: row.text, roleToken: row.role_token })).sort(compareNames);
}

// The rows of one page of names, each with its context from the turns and keep set to false.
async function pageRows(trx: DatabaseTransaction, sourceId: string, names: FoundName[]): Promise<NameRow[]> {
  if (names.length === 0) return [];
  const turns = await trx.selectFrom("turns").select("text").where("source_id", "=", sourceId).orderBy("turn_index").execute();
  const turnTexts = turns.map((row) => row.text);
  return names.map((name) => ({ text: name.text, roleToken: name.roleToken, context: nameContext(turnTexts, name.roleToken), keep: false }));
}

// Reads the source as the caller sees it: its numbers, whether the names pass has finished, and one page of names (R2.3, R2.4, R2.5).
async function sourceViewOf(trx: DatabaseTransaction, input: { sourceId: string; page: number; now: Date }): Promise<SourceView> {
  const source = await trx
    .selectFrom("sources")
    .select(["id", "kind", "turn_count", "persona_signal", "names_reviewed_at", "frozen_at"])
    .where("id", "=", input.sourceId)
    .executeTakeFirst();
  if (source === undefined) throw makeNotFoundError();
  const pass = await trx.selectFrom("names_passes").select("source_id").where("source_id", "=", input.sourceId).executeTakeFirst();
  const counted = await trx.selectFrom("redactions").select((eb) => eb.fn.countAll().as("count")).where("source_id", "=", input.sourceId).executeTakeFirstOrThrow();
  const names = await listedNames(trx, input.sourceId);
  const pageNames = names.slice((input.page - 1) * NAMES_PAGE_SIZE, input.page * NAMES_PAGE_SIZE);
  return SourceView.parse({
    id: source.id,
    kind: source.kind,
    turnCount: source.turn_count,
    redactionCount: Number(counted.count),
    personaSignal: Number(source.persona_signal),
    namesPassDone: pass !== undefined,
    namesReviewedAt: source.names_reviewed_at?.toISOString() ?? null,
    frozenAt: source.frozen_at?.toISOString() ?? null,
    names: { page: input.page, pageSize: NAMES_PAGE_SIZE, total: names.length, rows: await pageRows(trx, input.sourceId, pageNames) },
    serverNow: input.now.toISOString(),
  });
}

// Registers GET /api/sources/:id: 200 SourceView; 400 payload_invalid for a bad page, 404 not_found.
export function registerReadSourceRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.sources.readSource.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = SourceParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const query = PageQuery.safeParse(request.query);
    if (!query.success) throw makePayloadInvalidError();
    const view = await withPerson(deps.db, personId, (trx) => sourceViewOf(trx, { sourceId: params.data.id, page: query.data.page, now: deps.now() }));
    return reply.code(200).send(view);
  });
}
