// What exists: POST /api/asks starts a help search, a friend ask or a self ask, and the run_ask job
// does the rest. The problem: a person must stay under the daily caps, and a friend ask must reach
// only a friend who said yes, through an invite pair. The step: one transaction checks the pair and
// the friend's switch, takes the caller's people row lock, counts today's asks of that mode and
// writes the ask; run_ask is enqueued after the commit, because the queue writes through its own
// connection. What it does not do: check the question or ask any persona; the job does both.
import type { FastifyInstance } from "fastify";
import { sql, type Transaction } from "kysely";
import {
  AskCreate,
  AskCreateResponse,
  ContractError,
  HELP_SEARCHES_PER_PERSON_PER_DAY,
  HTTP,
  REACT_ASKS_PER_PERSON_PER_DAY,
  routes,
  type AskMode,
} from "@meet-first/contracts";
import { withPerson, type Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { startOfUtcDay } from "../meetings/create-meeting.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The fewest characters an ask may have. AskCreate counts UTF-16 units and the persona_asks CHECK
// counts characters, so the route counts characters too, and a short text is payload_invalid, never
// a database error.
const ASK_TEXT_MIN_CHARACTERS = 5;

// The daily cap of each kind of ask, with its code and sentence. A self ask counts as a friend ask.
const DAILY_ASK_CAPS: Readonly<
  Record<"help" | "react", { limit: number; code: string; sentence: string }>
> = {
  help: {
    limit: HELP_SEARCHES_PER_PERSON_PER_DAY,
    code: "help_daily_cap",
    sentence: "You have used today's help searches. Try again tomorrow.",
  },
  react: {
    limit: REACT_ASKS_PER_PERSON_PER_DAY,
    code: "react_daily_cap",
    sentence: "You have sent today's friend asks. Try again tomorrow.",
  },
};

// One row of friend_list(): the pair, the friend's display name, and whether the friend lets
// friends ask their persona (migration 0006).
type FriendRow = { pair_id: string; display_name: string; can_ask: boolean };

// What the ask routes need from RouteDeps: the database, the clock and the job queue. A test passes
// these three alone.
export type AskDeps = Pick<RouteDeps, "db" | "now" | "enqueue">;

// True when the text has at least 5 characters counted as Postgres counts them, one per code point.
// Example: "a😀😀" is 5 UTF-16 units and 3 characters, so it is too short.
export function isLongEnoughAskText(text: string): boolean {
  return Array.from(text).length >= ASK_TEXT_MIN_CHARACTERS;
}

// Refuses an ask past the caller's cap for its mode in this UTC day: help searches on their own,
// friend asks and self asks together. The caller's people row is locked first, so asks sent at the
// same moment take turns and none can pass the count.
async function assertUnderDailyAskCap(
  trx: Transaction<Database>,
  input: { personId: string; mode: AskMode; now: Date },
): Promise<void> {
  await trx
    .selectFrom("people")
    .select("id")
    .where("id", "=", input.personId)
    .forUpdate()
    .execute();
  const modes: AskMode[] = input.mode === "help" ? ["help"] : ["react", "self"];
  // In words: how many asks under this cap the caller has made since midnight UTC today.
  const row = await trx
    .selectFrom("persona_asks")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("person_id", "=", input.personId)
    .where("mode", "in", modes)
    .where("created_at", ">=", startOfUtcDay(input.now))
    .executeTakeFirstOrThrow();
  const cap = DAILY_ASK_CAPS[input.mode === "help" ? "help" : "react"];
  if (Number(row.count) >= cap.limit) throw new ContractError(cap.code, cap.sentence, HTTP.tooMany);
}

// The friend_list() row of this pair, or undefined when the pair is not the caller's latest invite
// pair with an active friend.
async function findFriendRow(
  trx: Transaction<Database>,
  pairId: string,
): Promise<FriendRow | undefined> {
  const result =
    await sql<FriendRow>`SELECT pair_id, display_name, can_ask FROM friend_list()`.execute(trx);
  return result.rows.find((row) => row.pair_id === pairId);
}

// The other member's display name, from pair_display_names, which returns no row unless the caller
// is in the pair.
async function readOtherName(
  trx: Transaction<Database>,
  input: { pairId: string; isCreator: boolean },
): Promise<string> {
  const result = await sql<{
    creator_display_name: string;
    joiner_display_name: string | null;
  }>`SELECT creator_display_name, joiner_display_name FROM pair_display_names(${input.pairId}::uuid)`.execute(
    trx,
  );
  const names = result.rows[0];
  const name = input.isCreator ? names?.joiner_display_name : names?.creator_display_name;
  if (name === undefined || name === null) throw makeNotFoundError();
  return name;
}

// Writes a help search under the help cap.
async function insertHelpAsk(
  trx: Transaction<Database>,
  input: { personId: string; text: string; now: Date },
): Promise<string> {
  await assertUnderDailyAskCap(trx, { personId: input.personId, mode: "help", now: input.now });
  const row = await trx
    .insertInto("persona_asks")
    .values({ person_id: input.personId, mode: "help", text: input.text })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// Writes a friend ask: the pair must be the caller's joined invite pair (404), the friend must have
// turned on friend asks (409), then the react cap (429). about_name keeps the friend's display name
// as it was when the ask was sent.
async function insertReactAsk(
  trx: Transaction<Database>,
  input: { personId: string; pairId: string; text: string; now: Date },
): Promise<string> {
  const pair = await trx
    .selectFrom("pairs")
    .select(["creator_person_id", "joined_at", "via_directory"])
    .where("id", "=", input.pairId)
    .executeTakeFirst();
  if (pair === undefined || pair.joined_at === null || pair.via_directory)
    throw makeNotFoundError();
  const friend = await findFriendRow(trx, input.pairId);
  if (friend === undefined) throw makeNotFoundError();
  const aboutName = await readOtherName(trx, {
    pairId: input.pairId,
    isCreator: pair.creator_person_id === input.personId,
  });
  if (!friend.can_ask)
    throw new ContractError(
      "friend_asks_off",
      `${aboutName} has not turned on friend asks.`,
      HTTP.conflict,
    );
  await assertUnderDailyAskCap(trx, { personId: input.personId, mode: "react", now: input.now });
  const row = await trx
    .insertInto("persona_asks")
    .values({
      person_id: input.personId,
      mode: "react",
      pair_id: input.pairId,
      text: input.text,
      about_name: aboutName,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// Writes a self ask under the friend-ask cap. about_name keeps the caller's own display name, as a
// friend ask keeps the friend's.
async function insertSelfAsk(
  trx: Transaction<Database>,
  input: { personId: string; text: string; now: Date },
): Promise<string> {
  await assertUnderDailyAskCap(trx, { personId: input.personId, mode: "self", now: input.now });
  const person = await trx
    .selectFrom("people")
    .select("display_name")
    .where("id", "=", input.personId)
    .executeTakeFirstOrThrow();
  const row = await trx
    .insertInto("persona_asks")
    .values({
      person_id: input.personId,
      mode: "self",
      text: input.text,
      about_name: person.display_name,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// Writes one ask of the caller by its mode.
function insertAsk(
  trx: Transaction<Database>,
  input: { personId: string; body: AskCreate; now: Date },
): Promise<string> {
  const { personId, body, now } = input;
  if (body.mode === "help") return insertHelpAsk(trx, { personId, text: body.text, now });
  if (body.mode === "self") return insertSelfAsk(trx, { personId, text: body.text, now });
  return insertReactAsk(trx, { personId, pairId: body.pairId, text: body.text, now });
}

// Writes the caller's ask in one transaction, then enqueues run_ask after the commit. When the
// queue refuses, the ask is deleted again and the queue's error goes on, as job-queue.ts says every
// route does.
export async function createAsk(deps: AskDeps, personId: string, body: AskCreate): Promise<string> {
  if (!isLongEnoughAskText(body.text)) throw makePayloadInvalidError();
  const now = deps.now();
  const askId = await withPerson(deps.db, personId, (trx) =>
    insertAsk(trx, { personId, body, now }),
  );
  try {
    await deps.enqueue("run_ask", { askId, personId });
  } catch (error) {
    await withPerson(deps.db, personId, (trx) =>
      trx.deleteFrom("persona_asks").where("id", "=", askId).execute(),
    );
    throw error;
  }
  return askId;
}

// Registers POST /api/asks: 201 {askId}; 400 payload_invalid, 404 not_found, 409 friend_asks_off,
// 429 help_daily_cap or react_daily_cap.
export function registerCreateAsk(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.asks.createAsk.path, async (request, reply) => {
    const personId = requirePerson(request);
    const body = AskCreate.safeParse(request.body);
    if (!body.success) throw makePayloadInvalidError();
    const askId = await createAsk(deps, personId, body.data);
    return reply.code(201).send(AskCreateResponse.parse({ askId }));
  });
}
