// What the home screen shows the signed-in person: their name, newest source, newest card, meetings and live pairs.
// Every read runs in the person's own context, and the only things about anyone else are the display names the lobby
// and the meeting screen already show them.
import { sql } from "kysely";
import {
  HOME_CARD_ITEMS_MAX,
  HOME_LIST_MAX,
  HomeView,
  type HomeCard,
  type HomeMeetingRow,
  type HomePairRow,
  type HomeSource,
} from "@meet-first/contracts";
import type { DatabaseTransaction } from "@meet-first/db";
import { readMemberNames } from "../meetings/start.js";
import { readOwnPhoto } from "./person-photos.js";

// The names pair_display_names returns for one pair the caller is in.
type PairNames = { creator_display_name: string; joiner_display_name: string | null };

// The person's newest source by creation time, or null. namesPassDone is the names_passes row GET /api/sources/:id reads.
export async function readHomeSource(
  trx: DatabaseTransaction,
  personId: string,
): Promise<HomeSource | null> {
  const source = await trx
    .selectFrom("sources")
    .select(["id", "names_reviewed_at"])
    .where("person_id", "=", personId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (source === undefined) return null;
  const pass = await trx
    .selectFrom("names_passes")
    .select("source_id")
    .where("source_id", "=", source.id)
    .executeTakeFirst();
  return {
    id: source.id,
    namesPassDone: pass !== undefined,
    namesReviewed: source.names_reviewed_at !== null,
  };
}

// The person's newest card by creation time, or null: its state, its item count, and its first items in position order
// (only approved items once the card is approved).
export async function readHomeCard(
  trx: DatabaseTransaction,
  personId: string,
): Promise<HomeCard | null> {
  const card = await trx
    .selectFrom("cards")
    .select(["id", "state"])
    .where("person_id", "=", personId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (card === undefined) return null;
  const counted = await trx
    .selectFrom("card_items")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("card_id", "=", card.id)
    .executeTakeFirstOrThrow();
  let items = trx
    .selectFrom("card_items")
    .select(["kind", "claim", "quote"])
    .where("card_id", "=", card.id);
  if (card.state === "approved") items = items.where("approved", "=", true);
  const rows = await items.orderBy("position", "asc").limit(HOME_CARD_ITEMS_MAX).execute();
  return { id: card.id, state: card.state, itemCount: Number(counted.count), items: rows };
}

// The meetings the person is a member of, newest first, at most HOME_LIST_MAX, deleted ones left out. The other member's
// name comes from readMemberNames, the same read GET /api/meetings/:id uses; isBriefReady looks only at the person's own brief.
export async function readHomeMeetings(
  trx: DatabaseTransaction,
  personId: string,
): Promise<HomeMeetingRow[]> {
  const rows = await trx
    .selectFrom("meeting_members as mm")
    .innerJoin("meetings as m", "m.id", "mm.meeting_id")
    .select(["m.id", "m.question_text", "m.question_kind", "m.state", "m.created_at", "mm.side"])
    .where("mm.person_id", "=", personId)
    .where("m.state", "!=", "deleted")
    .orderBy("m.created_at", "desc")
    .orderBy("m.id", "desc")
    .limit(HOME_LIST_MAX)
    .execute();
  if (rows.length === 0) return [];
  const briefs = await trx
    .selectFrom("briefs")
    .select("meeting_id")
    .where("person_id", "=", personId)
    .where(
      "meeting_id",
      "in",
      rows.map((row) => row.id),
    )
    .execute();
  const briefMeetingIds = new Set(briefs.map((brief) => brief.meeting_id));
  const meetings: HomeMeetingRow[] = [];
  for (const row of rows) {
    const names = await readMemberNames(trx, row.id);
    meetings.push({
      id: row.id,
      questionText: row.question_text,
      questionKind: row.question_kind,
      state: row.state,
      otherDisplayName: row.side === "a" ? names.b : names.a,
      isBriefReady: briefMeetingIds.has(row.id),
      createdAt: row.created_at.toISOString(),
    });
  }
  return meetings;
}

// The other person's name in one pair, through pair_display_names as the lobby reads it; null while nobody has joined.
async function readOtherPairName(
  trx: DatabaseTransaction,
  pair: { id: string; creator_person_id: string; joiner_person_id: string | null },
  personId: string,
): Promise<string | null> {
  if (pair.joiner_person_id === null) return null;
  const names = (
    await sql<PairNames>`SELECT creator_display_name, joiner_display_name FROM pair_display_names(${pair.id}::uuid)`.execute(
      trx,
    )
  ).rows[0];
  if (names === undefined) return null;
  return pair.creator_person_id === personId
    ? names.joiner_display_name
    : names.creator_display_name;
}

// The pairs the person made or joined whose expiry is later than now, newest first, at most HOME_LIST_MAX.
export async function readHomePairs(
  trx: DatabaseTransaction,
  input: { personId: string; now: Date },
): Promise<HomePairRow[]> {
  const rows = await trx
    .selectFrom("pairs")
    .select(["id", "creator_person_id", "joiner_person_id", "created_at", "expires_at"])
    .where((eb) =>
      eb.or([
        eb("creator_person_id", "=", input.personId),
        eb("joiner_person_id", "=", input.personId),
      ]),
    )
    .where("expires_at", ">", input.now)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(HOME_LIST_MAX)
    .execute();
  const pairs: HomePairRow[] = [];
  for (const row of rows) {
    pairs.push({
      id: row.id,
      otherDisplayName: await readOtherPairName(trx, row, input.personId),
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    });
  }
  return pairs;
}

// Reads the whole home view for the person and checks it against the contracts schema.
export async function readHomeView(
  trx: DatabaseTransaction,
  input: { personId: string; now: Date },
): Promise<HomeView> {
  const person = await trx
    .selectFrom("people")
    .select("display_name")
    .where("id", "=", input.personId)
    .executeTakeFirstOrThrow();
  return HomeView.parse({
    displayName: person.display_name,
    photo: await readOwnPhoto(trx, input.personId),
    source: await readHomeSource(trx, input.personId),
    card: await readHomeCard(trx, input.personId),
    meetings: await readHomeMeetings(trx, input.personId),
    pairs: await readHomePairs(trx, input),
    serverNow: input.now.toISOString(),
  });
}
