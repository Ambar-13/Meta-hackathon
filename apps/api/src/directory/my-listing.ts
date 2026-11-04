// The caller's own place in the directory: reading, joining or changing the listing, leaving it, and the meetings the listed
// persona was in. The listing row is the consent to be met, and deleting it leaves the directory at once.
import type { FastifyInstance } from "fastify";
import { sql, type Transaction } from "kysely";
import {
  ContractError,
  HTTP,
  ListedMeetingsView,
  ListingUpsert,
  MyListing,
  routes,
  type ListedMeeting,
  type PublicItem,
} from "@meet-first/contracts";
import { withPerson, type Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";
import {
  lockPersonRow,
  makeCardNotApprovedError,
  makeListingNeedsPublicItemError,
} from "./card-sharing.js";

// Most meetings GET /api/directory/me/meetings returns, newest first.
const LISTED_MEETINGS_MAX = 50;

// One directory_listings row as the view reads it.
export type ListingRow = {
  id: string;
  card_id: string;
  line: string;
  open_to_romance: boolean;
  created_at: Date;
};

// Reads a card's public items in position order. The database lets only approved items whose quote was found be public.
export function readPublicItems(trx: Transaction<Database>, cardId: string): Promise<PublicItem[]> {
  return trx
    .selectFrom("card_items")
    .select(["kind", "claim", "quote"])
    .where("card_id", "=", cardId)
    .where("is_public", "=", true)
    .orderBy("position", "asc")
    .execute();
}

// The caller's listing as MyListing: the row, its card's public items, and the dating switch.
export function toMyListing(row: ListingRow, items: readonly PublicItem[]): MyListing {
  return MyListing.parse({
    listingId: row.id,
    cardId: row.card_id,
    line: row.line,
    openToRomance: row.open_to_romance,
    items,
    createdAt: row.created_at.toISOString(),
  });
}

// not_listed, 404: the caller has no listing.
function makeNotListedError(): ContractError {
  return new ContractError("not_listed", "You are not in Explore yet.", HTTP.notFound);
}

// Registers GET /api/directory/me: 200 MyListing; 404 not_listed.
export function registerReadMyListing(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.directory.readMyListing.path, async (request, reply) => {
    const personId = requirePerson(request);
    const listing = await withPerson(deps.db, personId, async (trx) => {
      const row = await trx
        .selectFrom("directory_listings")
        .select(["id", "card_id", "line", "open_to_romance", "created_at"])
        .where("person_id", "=", personId)
        .executeTakeFirst();
      if (row === undefined) return null;
      return toMyListing(row, await readPublicItems(trx, row.card_id));
    });
    if (listing === null) throw makeNotListedError();
    return reply.code(200).send(listing);
  });
}

// Registers PUT /api/directory/me: 200 MyListing; 400 payload_invalid; 409 card_not_approved when the card is not the caller's approved card, listing_needs_public_item when it has no public item.
export function registerUpsertMyListing(app: FastifyInstance, deps: RouteDeps): void {
  app.put(routes.directory.upsertMyListing.path, async (request, reply) => {
    const personId = requirePerson(request);
    const body = ListingUpsert.safeParse(request.body);
    if (!body.success) throw makePayloadInvalidError();
    const upsert = body.data;
    const listing = await withPerson(deps.db, personId, async (trx) => {
      await lockPersonRow(trx, personId);
      const card = await trx
        .selectFrom("cards")
        .select("state")
        .where("id", "=", upsert.cardId)
        .where("person_id", "=", personId)
        .executeTakeFirst();
      if (card?.state !== "approved") throw makeCardNotApprovedError();
      const items = await readPublicItems(trx, upsert.cardId);
      if (items.length === 0) throw makeListingNeedsPublicItemError();
      const row = await trx
        .insertInto("directory_listings")
        .values({
          person_id: personId,
          card_id: upsert.cardId,
          line: upsert.line,
          open_to_romance: upsert.openToRomance,
        })
        .onConflict((conflict) =>
          conflict.column("person_id").doUpdateSet({
            card_id: upsert.cardId,
            line: upsert.line,
            open_to_romance: upsert.openToRomance,
          }),
        )
        .returning(["id", "card_id", "line", "open_to_romance", "created_at"])
        .executeTakeFirstOrThrow();
      return toMyListing(row, items);
    });
    return reply.code(200).send(listing);
  });
}

// Registers DELETE /api/directory/me: 204 whether or not the caller was listed. Leaving takes effect at once, and help answers made from the listing keep no link to it.
export function registerLeaveDirectory(app: FastifyInstance, deps: RouteDeps): void {
  app.delete(routes.directory.leave.path, async (request, reply) => {
    const personId = requirePerson(request);
    await withPerson(deps.db, personId, (trx) =>
      trx.deleteFrom("directory_listings").where("person_id", "=", personId).execute(),
    );
    return reply.code(204).send();
  });
}

// The display name of a directory pair's creator. directory_meeting_create makes the person who asked for the meeting the creator, so for the listed side the creator is always the other person.
async function readCreatorName(trx: Transaction<Database>, pairId: string): Promise<string> {
  const names = await sql<{
    creator_display_name: string;
  }>`SELECT creator_display_name FROM pair_display_names(${pairId}::uuid)`.execute(trx);
  const row = names.rows[0];
  if (row === undefined)
    throw new ContractError(
      "pair_names_missing",
      "The names of this meeting could not be read. Reload the page and try again.",
      HTTP.internal,
    );
  return row.creator_display_name;
}

// Reads the meetings where the caller is the listed, public-only side, newest first, at most LISTED_MEETINGS_MAX, each with the other person's display name.
// In words: the caller's own member rows with public_only true, joined to their meetings, ordered by the meeting's created_at, newest first, ties by meeting id.
export async function readListedMeetings(
  trx: Transaction<Database>,
  personId: string,
): Promise<ListedMeetingsView> {
  const rows = await trx
    .selectFrom("meeting_members as mm")
    .innerJoin("meetings as m", "m.id", "mm.meeting_id")
    .select(["m.id", "m.pair_id", "m.question_text", "m.state", "m.created_at"])
    .where("mm.person_id", "=", personId)
    .where("mm.public_only", "=", true)
    .orderBy("m.created_at", "desc")
    .orderBy("m.id", "desc")
    .limit(LISTED_MEETINGS_MAX)
    .execute();
  const meetings: ListedMeeting[] = [];
  for (const row of rows) {
    meetings.push({
      meetingId: row.id,
      otherDisplayName: await readCreatorName(trx, row.pair_id),
      questionText: row.question_text,
      state: row.state,
      createdAt: row.created_at.toISOString(),
    });
  }
  return ListedMeetingsView.parse({ meetings });
}

// Registers GET /api/directory/me/meetings: 200 ListedMeetingsView, the directory meetings the caller's listed persona was in.
export function registerListedMeetings(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.directory.listedMeetings.path, async (request, reply) => {
    const personId = requirePerson(request);
    const view = await withPerson(deps.db, personId, (trx) => readListedMeetings(trx, personId));
    return reply.code(200).send(view);
  });
}
