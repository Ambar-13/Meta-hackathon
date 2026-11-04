import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AskCreateResponse,
  ErrorBody,
  FriendsView,
  routes,
  SESSION_COOKIE,
} from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import { createPairedMeetingWithTurns } from "@meet-first/db/testing";
import { registerDirectoryRoutes } from "../directory/index.js";
import { buildTestApp } from "../testing/index.js";
import { registerAsksRoutes } from "./index.js";

// The origin every request of this file sends: the test app's own address.
const ORIGIN = "http://localhost:3000";

let t: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => {
  t = await buildTestApp({
    routes: [registerDirectoryRoutes, registerAsksRoutes],
    env: { APP_ORIGIN: ORIGIN },
  });
});
afterAll(async () => {
  await t.close();
});

// One request: method, URL, the session token of the person making it (none for a request without a session), a JSON payload or a
// raw string payload, and whether to leave out the Origin header.
type Call = {
  method: "GET" | "POST";
  url: string;
  token?: string;
  payload?: unknown;
  withoutOrigin?: boolean;
};

// The text a payload is sent as: a string as it is, anything else as JSON.
function payloadText(payload: unknown): string | undefined {
  if (payload === undefined) return undefined;
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

// Makes one request through the app's injector and returns the status, the headers and the parsed body.
async function send(
  call: Call,
): Promise<{ statusCode: number; headers: Record<string, unknown>; body: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (call.withoutOrigin !== true) headers.origin = ORIGIN;
  if (call.token !== undefined) headers.cookie = `${SESSION_COOKIE}=${call.token}`;
  const payload = payloadText(call.payload);
  const response = await t.app.inject({
    method: call.method,
    url: call.url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown),
  };
}

describe("friends from GET /api/friends", () => {
  it("W6-ASKA-T27 (design sections 6 and 7, P3): a friend taken from GET /api/friends is asked by its pairId, and once the friend turns friend asks off both routes agree", async () => {
    const m = await createPairedMeetingWithTurns(t.db);
    await withPerson(t.db, m.b.personId, (trx) =>
      trx
        .updateTable("cards")
        .set({ friends_can_ask: true })
        .where("id", "=", m.b.cardId)
        .execute(),
    );

    const listed = await send({
      method: "GET",
      url: routes.directory.friends.path,
      token: m.a.sessionToken,
    });

    expect(listed.statusCode).toBe(200);
    expect(FriendsView.parse(listed.body)).toEqual({
      friends: [
        {
          pairId: m.pairId,
          displayName: "Test B",
          canAsk: true,
          listingId: null,
          isSample: false,
          photo: null,
        },
      ],
    });
    const friend = FriendsView.parse(listed.body).friends[0];
    const asked = await send({
      method: "POST",
      url: routes.asks.createAsk.path,
      token: m.a.sessionToken,
      payload: {
        mode: "react",
        pairId: friend?.pairId,
        text: "Our demo breaks an hour before judging.",
      },
    });
    expect(asked.statusCode).toBe(201);
    AskCreateResponse.parse(asked.body);

    await withPerson(t.db, m.b.personId, (trx) =>
      trx
        .updateTable("cards")
        .set({ friends_can_ask: false })
        .where("id", "=", m.b.cardId)
        .execute(),
    );

    const relisted = await send({
      method: "GET",
      url: routes.directory.friends.path,
      token: m.a.sessionToken,
    });
    expect(FriendsView.parse(relisted.body).friends[0]?.canAsk).toBe(false);
    const refused = await send({
      method: "POST",
      url: routes.asks.createAsk.path,
      token: m.a.sessionToken,
      payload: { mode: "react", pairId: m.pairId, text: "Our demo breaks an hour before judging." },
    });
    expect(refused.statusCode).toBe(409);
    expect(ErrorBody.parse(refused.body)).toEqual({
      code: "friend_asks_off",
      message: "Test B has not turned on friend asks.",
    });
  });
});
