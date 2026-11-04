// Which picture a person shows: a sample person's bundled face, or the profile photo a real person put up themselves, read
// by listing or by pair through definer functions (migration 0012), so no person id leaves the database.
import { sql } from "kysely";
import { sampleFaceKey, type DatabaseTransaction } from "@meet-first/db";

// Photo ids by the listing or pair they were read for.
export type PhotoIds = ReadonlyMap<string, string>;

// No photos, for a reply with nobody in it.
const NO_PHOTOS: PhotoIds = new Map();

// The photo key the app shows for a profile photo id.
export function photoKeyOf(photoId: string): string {
  return `photos/${photoId}`;
}

// The picture of one person: a sample person's face by their name, else their own photo when they put one up, else none.
export function personPhoto(input: {
  isSample: boolean;
  displayName: string;
  photoId: string | undefined;
}): string | null {
  if (input.isSample) return sampleFaceKey(input.displayName);
  return input.photoId === undefined ? null : photoKeyOf(input.photoId);
}

// The photo ids of the people behind these listings who put up a photo, by listing.
export async function readListingPhotos(
  trx: DatabaseTransaction,
  listingIds: readonly string[],
): Promise<PhotoIds> {
  if (listingIds.length === 0) return NO_PHOTOS;
  const rows = (
    await sql<{
      listing_id: string;
      photo_id: string;
    }>`SELECT listing_id, photo_id FROM listing_photo_ids(${[...listingIds]}::uuid[])`.execute(trx)
  ).rows;
  return new Map(rows.map((row) => [row.listing_id, row.photo_id]));
}

// The photo ids of the caller's friends behind these pairs who put up a photo, by pair.
export async function readPairPhotos(
  trx: DatabaseTransaction,
  pairIds: readonly string[],
): Promise<PhotoIds> {
  if (pairIds.length === 0) return NO_PHOTOS;
  const rows = (
    await sql<{
      pair_id: string;
      photo_id: string;
    }>`SELECT pair_id, photo_id FROM pair_photo_ids(${[...pairIds]}::uuid[])`.execute(trx)
  ).rows;
  return new Map(rows.map((row) => [row.pair_id, row.photo_id]));
}

// The signed-in person's own photo key, or null when they have none.
export async function readOwnPhoto(
  trx: DatabaseTransaction,
  personId: string,
): Promise<string | null> {
  const row = await trx
    .selectFrom("profile_photos")
    .select("id")
    .where("person_id", "=", personId)
    .executeTakeFirst();
  return row === undefined ? null : photoKeyOf(row.id);
}
