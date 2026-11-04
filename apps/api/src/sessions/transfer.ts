// POST /api/sessions/transfer: an invite opened inside an app's own browser (Discord, Instagram) keeps the
// session there; the person moves it to Safari or Chrome with a link that works once and for 10 minutes.
// The token travels in the URL fragment, which a browser never sends to a server, so no log line can hold it
// (the /claim screen reads the token from the fragment).
import type { FastifyInstance } from "fastify";
import {
  routes,
  TRANSFER_LIFETIME_MINUTES,
  TRANSFER_TOKEN_BYTES,
  TransferResponse,
} from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { hashToken, newHexToken, requirePerson } from "./cookie.js";
import { appOrigin } from "./origin-check.js";

// The client path that claims a transfer link (APP_PATHS.claim).
export const TRANSFER_CLAIM_PATH = "/claim";

// The link a signed-in person opens in the other browser: APP_ORIGIN, the claim path, and the token after "#".
export function transferUrl(appOriginValue: string, token: string): string {
  return `${appOrigin(appOriginValue)}${TRANSFER_CLAIM_PATH}#${token}`;
}

// Registers POST /api/sessions/transfer: stores the hash of a new 128-bit token with a 10-minute expiry and returns the link.
export function registerTransfer(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.people.transfer.path, async (request, reply) => {
    const personId = requirePerson(request);
    const token = newHexToken(TRANSFER_TOKEN_BYTES);
    const expiresAt = new Date(deps.now().getTime() + TRANSFER_LIFETIME_MINUTES * 60_000);
    await withPerson(deps.db, personId, (trx) =>
      trx
        .insertInto("transfer_links")
        .values({ person_id: personId, token_hash: hashToken(token), expires_at: expiresAt })
        .execute(),
    );
    return reply.code(200).send(
      TransferResponse.parse({
        url: transferUrl(deps.env.APP_ORIGIN, token),
        expiresAt: expiresAt.toISOString(),
      }),
    );
  });
}
