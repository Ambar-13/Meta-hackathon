// The two lists of other people a person can reach: the open directory, where people opted their
// persona in, and their friends, the people they joined an invite pair with.
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import {
  DIRECTORY_PAGE_SIZE,
  DirectoryPage,
  DirectoryQuery,
  FriendsView,
  routes,
} from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";
import {
  personPhoto,
  readListingPhotos,
  readPairPhotos,
  type PhotoIds,
} from "../home/person-photos.js";

// The last page the directory reads, the same bound GET /api/sources/:id puts on its pages. A later
// page answers empty without a database call, so the offset always fits a Postgres int.
const BROWSE_PAGE_MAX = 100_000;

// One row of directory_browse by its SQL names (migration 0009): listing fields, the dating switch,
// the sample mark and the public items, never an id of a person, card, item or turn.
export type BrowseRow = {
  listing_id: string;
  display_name: string;
  line: string;
  open_to_romance: boolean;
  is_sample: boolean;
  items: unknown;
};
// One row of friend_list by its SQL names (migration 0010): with the friend's sample mark.
export type FriendRow = {
  pair_id: string;
  display_name: string;
  can_ask: boolean;
  listing_id: string | null;
  is_sample: boolean;
};

// One directory page from one read. The read asks for one row more than a page holds: when that
// extra row comes back a next page exists, and the row is dropped. photos holds the photo ids of
// the people who put up a photo, by listing.
export function toDirectoryPage(
  rows: readonly BrowseRow[],
  page: number,
  photos: PhotoIds = new Map(),
): DirectoryPage {
  return DirectoryPage.parse({
    listings: rows.slice(0, DIRECTORY_PAGE_SIZE).map((row) => ({
      listingId: row.listing_id,
      displayName: row.display_name,
      line: row.line,
      openToRomance: row.open_to_romance,
      isSample: row.is_sample,
      items: row.items,
      photo: personPhoto({
        isSample: row.is_sample,
        displayName: row.display_name,
        photoId: photos.get(row.listing_id),
      }),
    })),
    page,
    hasMore: rows.length > DIRECTORY_PAGE_SIZE,
  });
}

// Reads one page as the caller. directory_browse leaves out the caller's own listing and returns
// listing fields and public items only.
async function readDirectoryPage(
  deps: RouteDeps,
  input: { personId: string; query: string; page: number },
): Promise<DirectoryPage> {
  if (input.page > BROWSE_PAGE_MAX) return toDirectoryPage([], input.page);
  const read = await withPerson(deps.db, input.personId, async (trx) => {
    const result =
      await sql<BrowseRow>`SELECT listing_id, display_name, line, open_to_romance, is_sample, items FROM directory_browse(${input.query}::text, ${DIRECTORY_PAGE_SIZE + 1}::int, ${input.page * DIRECTORY_PAGE_SIZE}::int)`.execute(
        trx,
      );
    return {
      rows: result.rows,
      photos: await readListingPhotos(
        trx,
        result.rows.map((row) => row.listing_id),
      ),
    };
  });
  return toDirectoryPage(read.rows, input.page, read.photos);
}

// Registers GET /api/directory?query=&page=: 200 DirectoryPage, best match first with search words,
// else newest first; 400 payload_invalid for a query string DirectoryQuery refuses.
export function registerBrowse(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.directory.browse.path, async (request, reply) => {
    const personId = requirePerson(request);
    const parsed = DirectoryQuery.safeParse(request.query);
    if (!parsed.success) throw makePayloadInvalidError();
    const page = await readDirectoryPage(deps, {
      personId,
      query: parsed.data.query ?? "",
      page: parsed.data.page,
    });
    return reply.code(200).send(page);
  });
}

// Registers GET /api/friends: 200 FriendsView, the people the caller joined an invite pair with or
// accepted a request from, most recently joined first, each with their own ask switch and their
// listing when Explore shows it; a directory pair never counts.
export function registerFriends(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.directory.friends.path, async (request, reply) => {
    const personId = requirePerson(request);
    const read = await withPerson(deps.db, personId, async (trx) => {
      const rows = (
        await sql<FriendRow>`SELECT pair_id, display_name, can_ask, listing_id, is_sample FROM friend_list()`.execute(
          trx,
        )
      ).rows;
      return {
        rows,
        photos: await readPairPhotos(
          trx,
          rows.map((row) => row.pair_id),
        ),
      };
    });
    const friends = read.rows.map((row) => ({
      pairId: row.pair_id,
      displayName: row.display_name,
      canAsk: row.can_ask,
      listingId: row.listing_id,
      isSample: row.is_sample,
      photo: personPhoto({
        isSample: row.is_sample,
        displayName: row.display_name,
        photoId: read.photos.get(row.pair_id),
      }),
    }));
    return reply.code(200).send(FriendsView.parse({ friends }));
  });
}
