// Instagram's Edit profile for the signed-in person: a new display name, and a profile photo put
// up, replaced or taken down. The browser draws the photo itself as a square JPEG, which drops any
// camera or location data, and sends the bytes; the api checks they are a JPEG of a sane size and
// stores them. GET /api/photos/:id serves a photo, a profile's or a post's, to anyone signed in who
// was shown its id, and a new photo always gets a new id.
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import {
  MyPhoto,
  NameUpdate,
  NameUpdated,
  PROFILE_PHOTO_MAX_BYTES,
  routes,
  Uuid,
} from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";
import { photoKeyOf } from "./person-photos.js";

// The smallest body that could be a JPEG at all.
const PHOTO_MIN_BYTES = 64;
// The params of GET /api/photos/:id.
const PhotoParams = z.object({ id: Uuid });

// True for bytes that start and end as a JPEG does: FF D8 FF at the start, FF D9 at the end.
export function isJpeg(bytes: Buffer): boolean {
  if (bytes.length < PHOTO_MIN_BYTES) return false;
  return (
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

// Registers PUT /api/people/me/name: 200 NameUpdated with the name as saved, trimmed; 400 for an
// empty or too long name.
function registerNameUpdate(app: FastifyInstance, deps: RouteDeps): void {
  app.put(routes.people.updateName.path, async (request, reply) => {
    const personId = requirePerson(request);
    const body = NameUpdate.safeParse(request.body);
    if (!body.success) throw makePayloadInvalidError();
    const row = await withPerson(deps.db, personId, (trx) =>
      trx
        .updateTable("people")
        .set({ display_name: body.data.displayName })
        .where("id", "=", personId)
        .returning("display_name")
        .executeTakeFirstOrThrow(),
    );
    return reply.code(200).send(NameUpdated.parse({ displayName: row.display_name }));
  });
}

// Registers PUT and DELETE /api/people/me/photo. PUT takes the JPEG bytes as image/jpeg, at most
// PROFILE_PHOTO_MAX_BYTES (a larger body is 413 before it is read), replaces any earlier photo with
// a new row, and answers 200 MyPhoto with the new key; a body that is not a JPEG is 400. DELETE
// takes the photo down and answers 200 MyPhoto with null, also when there was none.
function registerPhotoUpdate(app: FastifyInstance, deps: RouteDeps): void {
  app.addContentTypeParser(
    "image/jpeg",
    { parseAs: "buffer", bodyLimit: PROFILE_PHOTO_MAX_BYTES },
    (request, body, done) => {
      done(null, body);
    },
  );
  app.put(
    routes.people.uploadPhoto.path,
    { bodyLimit: PROFILE_PHOTO_MAX_BYTES },
    async (request, reply) => {
      const personId = requirePerson(request);
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes) || !isJpeg(bytes)) throw makePayloadInvalidError();
      const row = await withPerson(deps.db, personId, async (trx) => {
        await trx.deleteFrom("profile_photos").where("person_id", "=", personId).execute();
        return trx
          .insertInto("profile_photos")
          .values({ person_id: personId, image: bytes })
          .returning("id")
          .executeTakeFirstOrThrow();
      });
      return reply.code(200).send(MyPhoto.parse({ photo: photoKeyOf(row.id) }));
    },
  );
  app.delete(routes.people.removePhoto.path, async (request, reply) => {
    const personId = requirePerson(request);
    await withPerson(deps.db, personId, (trx) =>
      trx.deleteFrom("profile_photos").where("person_id", "=", personId).execute(),
    );
    return reply.code(200).send(MyPhoto.parse({ photo: null }));
  });
}

// Registers GET /api/photos/:id: 200 with the JPEG, kept by the browser for a year since an id
// never changes its image. The id is a profile photo's, or since migration 0013 a post's or a
// story's, whose photo shows while the story has not expired. 404 for an id that is not a photo of
// an active person, or not an id at all.
function registerPhotoRead(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.people.readPhoto.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = PhotoParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const id = params.data.id;
    const image = await withPerson(
      deps.db,
      personId,
      async (trx) =>
        (
          await sql<{
            image: Buffer | null;
          }>`SELECT coalesce(profile_photo_read(${id}::uuid), post_photo_read(${id}::uuid)) AS image`.execute(
            trx,
          )
        ).rows[0]?.image ?? null,
    );
    if (image === null) throw makeNotFoundError();
    return reply
      .code(200)
      .header("content-type", "image/jpeg")
      .header("cache-control", "private, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .send(image);
  });
}

// Registers the Edit profile routes: the name, the photo, and reading a photo.
export function registerProfileEdit(app: FastifyInstance, deps: RouteDeps): void {
  registerNameUpdate(app, deps);
  registerPhotoUpdate(app, deps);
  registerPhotoRead(app, deps);
}
