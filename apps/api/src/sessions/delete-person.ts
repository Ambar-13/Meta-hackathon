import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { DeletionResponse, routes } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { clearSessionCookie, requirePerson } from "./cookie.js";

// What startDeletion wrote, so the undo can find exactly those rows again.
type DeletionWrite = { personId: string; deletionId: string; now: Date };

// Undoes what startDeletion wrote, after its job failed to enqueue: the person is active again, their sessions are
// live again, and the deletions row is gone. Only the rows this call changed are touched, found by their id and time.
async function undoDeletion(
  deps: RouteDeps,
  write: DeletionWrite,
  log: FastifyBaseLogger,
): Promise<void> {
  const { personId, deletionId, now } = write;
  try {
    await withPerson(deps.db, personId, async (trx) => {
      await trx.deleteFrom("deletions").where("id", "=", deletionId).execute();
      await trx
        .updateTable("sessions")
        .set({ revoked_at: null })
        .where("person_id", "=", personId)
        .where("revoked_at", "=", now)
        .execute();
      await trx
        .updateTable("people")
        .set({ state: "active", deleted_at: null })
        .where("id", "=", personId)
        .execute();
    });
  } catch (undoError) {
    log.error({ code: "deletion_undo_failed", err: undoError, deletionId }, "deletion_undo_failed");
  }
}

// Marks the person deleted, revokes every session and writes the deletions row in one transaction, then enqueues
// delete_person after that transaction has committed. If the enqueue throws, the rows are undone and the error is
// thrown on, so the person can try again.
export async function startDeletion(
  deps: RouteDeps,
  personId: string,
  log: FastifyBaseLogger,
): Promise<string> {
  const now = deps.now();
  const deletionId = await withPerson(deps.db, personId, async (trx) => {
    await trx
      .updateTable("people")
      .set({ state: "deleted", deleted_at: now })
      .where("id", "=", personId)
      .execute();
    await trx
      .updateTable("sessions")
      .set({ revoked_at: now })
      .where("person_id", "=", personId)
      .where("revoked_at", "is", null)
      .execute();
    const row = await trx
      .insertInto("deletions")
      .values({ person_id: personId, requested_at: now })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  });
  try {
    await deps.enqueue("delete_person", { personId });
  } catch (error) {
    await undoDeletion(deps, { personId, deletionId, now }, log);
    throw error;
  }
  return deletionId;
}

// Registers DELETE /api/people/me: 202 {deletionId} with the session cookie cleared.
export function registerDeletePerson(app: FastifyInstance, deps: RouteDeps): void {
  app.delete(routes.people.deleteMe.path, async (request, reply) => {
    const personId = requirePerson(request);
    const deletionId = await startDeletion(deps, personId, request.log);
    clearSessionCookie(reply);
    return reply.code(202).send(DeletionResponse.parse({ deletionId }));
  });
}
