import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import { z } from "zod";
import { ContractError, HTTP, routes, ShareSnapshot } from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";

// A slug is 22 URL-safe base64 characters, from 16 random bytes (SLUG_BYTES in snapshot.ts). Any
// other text is not a slug.
export const SLUG_PATTERN = /^[A-Za-z0-9_-]{22}$/;
// The params of the public read: the slug from the address.
const SlugParams = z.object({ slug: z.string() });

// The answer for an unknown, unpublished, revoked or malformed slug: the same sentence for each, so
// a slug tells nothing (404).
export function shareNotFound(): ContractError {
  return new ContractError(
    "share_not_found",
    "No page here. It may have been taken down.",
    HTTP.notFound,
  );
}

// Reads a published page by slug through share_read, which returns nothing once either consent is
// withdrawn or revoked_at is set. A malformed slug returns null before any query runs. A stored
// snapshot that no longer parses also returns null, so nothing leaks.
export async function readSharePage(
  db: Kysely<Database>,
  slug: string,
): Promise<ShareSnapshot | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const row = await db
    .selectNoFrom((eb) => eb.fn<unknown>("share_read", [eb.val(slug)]).as("snapshot"))
    .executeTakeFirst();
  if (row === undefined || row.snapshot === null) return null;
  const parsed = ShareSnapshot.safeParse(row.snapshot);
  return parsed.success ? parsed.data : null;
}

// Registers GET /api/share/:slug, public: 200 ShareSnapshot; 404 share_not_found. Every reply says
// no-store and no-referrer.
export function registerReadSharePage(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get(routes.briefs.readShare.path, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    const params = SlugParams.safeParse(request.params);
    const snapshot = params.success ? await readSharePage(deps.db, params.data.slug) : null;
    if (snapshot === null) throw shareNotFound();
    return reply.code(200).send(snapshot);
  });
  return Promise.resolve();
}
