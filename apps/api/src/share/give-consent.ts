import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ConsentResponse, ContractError, HTTP, routes, Uuid } from "@meet-first/contracts";
import { withMeeting, withPerson, type DatabaseTransaction } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { requirePerson } from "../sessions/index.js";
import { buildShareSnapshot, makeSlug } from "./snapshot.js";

// The result of one consent: both flags, whether the page is live, its slug only while it is live,
// and whether the snapshot still needs building.
export type GiveConsentResult = {
  consentA: boolean;
  consentB: boolean;
  published: boolean;
  slug?: string;
  snapshotMissing: boolean;
};
// The params of a share route that names a meeting.
const MeetingParams = z.object({ id: Uuid });

// The sentence for a meeting this person is not in, or that does not exist (404).
export function meetingNotFound(): ContractError {
  return new ContractError(
    "meeting_not_found",
    "This meeting is not yours or does not exist.",
    HTTP.notFound,
  );
}

// Reads the meeting id from a route's params; anything that is not a uuid is meeting_not_found.
export function meetingIdOfParams(params: unknown): string {
  const parsed = MeetingParams.safeParse(params);
  if (!parsed.success) throw meetingNotFound();
  return parsed.data.id;
}

// The side this person holds in the meeting, or meeting_not_found (404) when they hold none. The
// lookup runs under their own person context.
export async function sideOfMember(
  trx: DatabaseTransaction,
  meetingId: string,
  personId: string,
): Promise<"a" | "b"> {
  const row = await trx
    .selectFrom("meeting_members")
    .select("side")
    .where("meeting_id", "=", meetingId)
    .where("person_id", "=", personId)
    .executeTakeFirst();
  if (row === undefined) throw meetingNotFound();
  return row.side;
}

// Refuses consent until the meeting has ended and its brief.ready event is stored, because the
// snapshot needs both briefs (409).
async function assertBriefReady(trx: DatabaseTransaction, meetingId: string): Promise<void> {
  const meeting = await trx
    .selectFrom("meetings")
    .select("state")
    .where("id", "=", meetingId)
    .executeTakeFirst();
  const ready = await trx
    .selectFrom("meeting_events")
    .select("seq")
    .where("meeting_id", "=", meetingId)
    .where("type", "=", "brief.ready")
    .executeTakeFirst();
  if (meeting?.state !== "ended" || ready === undefined) {
    throw new ContractError(
      "brief_not_ready",
      "Consent opens when both briefs are written.",
      HTTP.conflict,
    );
  }
}

// Writes this side's flag and sets published to the other side's flag in the same statement, so
// published equals consent_a AND consent_b. A repeated consent by the same person changes nothing.
async function recordConsent(
  trx: DatabaseTransaction,
  input: { meetingId: string; side: "a" | "b"; slug: string },
) {
  const isSideA = input.side === "a";
  return trx
    .insertInto("share_pages")
    .values({
      meeting_id: input.meetingId,
      slug: input.slug,
      consent_a: isSideA,
      consent_b: !isSideA,
      published: false,
    })
    .onConflict((conflict) =>
      conflict
        .column("meeting_id")
        .doUpdateSet((eb) =>
          isSideA
            ? { consent_a: true, published: eb.ref("share_pages.consent_b") }
            : { consent_b: true, published: eb.ref("share_pages.consent_a") },
        ),
    )
    .returning(["consent_a", "consent_b", "published", "slug", "snapshot"])
    .executeTakeFirstOrThrow();
}

// Records one member's consent and flips published when both stand. Returns the flags, and the slug
// only while the page is live.
export async function giveConsent(
  trx: DatabaseTransaction,
  input: { meetingId: string; personId: string; slug: string },
): Promise<GiveConsentResult> {
  const side = await sideOfMember(trx, input.meetingId, input.personId);
  await assertBriefReady(trx, input.meetingId);
  const row = await recordConsent(trx, { meetingId: input.meetingId, side, slug: input.slug });
  return {
    consentA: row.consent_a,
    consentB: row.consent_b,
    published: row.published,
    ...(row.published ? { slug: row.slug } : {}),
    snapshotMissing: row.published && row.snapshot === null,
  };
}

// Builds the snapshot inside the meeting context and stores it once. The UPDATE finds the snapshot
// already set when the other member's second consent got there first, so the snapshot is filled
// once.
async function publishSnapshot(
  deps: RouteDeps,
  target: { meetingId: string; personId: string },
): Promise<void> {
  const snapshot = await withMeeting(deps.db, target.meetingId, (trx) =>
    buildShareSnapshot(trx, target.meetingId),
  );
  await withPerson(deps.db, target.personId, (trx) =>
    trx
      .updateTable("share_pages")
      .set({ snapshot: JSON.stringify(snapshot), published_at: deps.now() })
      .where("meeting_id", "=", target.meetingId)
      .where("published", "=", true)
      .where("snapshot", "is", null)
      .execute(),
  );
}

// Registers POST /api/meetings/:id/consent: 200 ConsentResponse; 404 meeting_not_found; 409
// brief_not_ready; 500 share_snapshot_invalid.
export function registerGiveConsent(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post(routes.briefs.consent.path, async (request, reply) => {
    const personId = requirePerson(request);
    const meetingId = meetingIdOfParams(request.params);
    const result = await withPerson(deps.db, personId, (trx) =>
      giveConsent(trx, { meetingId, personId, slug: makeSlug() }),
    );
    if (result.snapshotMissing) await publishSnapshot(deps, { meetingId, personId });
    return reply.code(200).send(
      ConsentResponse.parse({
        consentA: result.consentA,
        consentB: result.consentB,
        published: result.published,
        ...(result.slug === undefined ? {} : { slug: result.slug }),
      }),
    );
  });
  return Promise.resolve();
}
