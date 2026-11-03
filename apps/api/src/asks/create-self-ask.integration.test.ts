import { afterAll, beforeAll, expect, it } from "vitest";
import { AskCreateResponse, ErrorBody, routes, SESSION_COOKIE } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import { createPairedMeetingWithTurns } from "@meet-first/db/testing";
import { buildTestApp } from "../testing/index.js";
import { registerAsksRoutes } from "./index.js";

// The origin every request of this file sends: the test app's own address.
const ORIGIN = "http://localhost:3000";
// The question the tests ask their own Meety.
const SELF_TEXT = "How would I react if the demo moved to Saturday?";

let t: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => {
  t = await buildTestApp({ routes: [registerAsksRoutes], env: { APP_ORIGIN: ORIGIN } });
});
afterAll(async () => {
  await t.close();
});

// Sends POST /api/asks as the person with this session token and returns the status and the parsed body.
async function sendAsk(token: string, payload: unknown): Promise<{ statusCode: number; body: unknown }> {
  const headers = { "content-type": "application/json", origin: ORIGIN, cookie: `${SESSION_COOKIE}=${token}` };
  const response = await t.app.inject({ method: "POST", url: routes.asks.createAsk.path, headers, payload: JSON.stringify(payload) });
  return { statusCode: response.statusCode, body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown) };
}

it("W7-ASK-T25: a self ask is written with the person's own name and no pair, and counts in the friend-ask daily cap", async () => {
  const m = await createPairedMeetingWithTurns(t.db);
  await withPerson(t.db, m.b.personId, (trx) => trx.updateTable("cards").set({ friends_can_ask: true }).where("id", "=", m.b.cardId).execute());
  await withPerson(t.db, m.a.personId, (trx) => trx.insertInto("persona_asks").values(Array.from({ length: 19 }, () => ({ person_id: m.a.personId, mode: "react" as const, pair_id: m.pairId, text: SELF_TEXT }))).execute());

  const accepted = await sendAsk(m.a.sessionToken, { mode: "self", text: SELF_TEXT });
  const { askId } = AskCreateResponse.parse(accepted.body);
  const row = await withPerson(t.db, m.a.personId, (trx) => trx.selectFrom("persona_asks").select(["mode", "pair_id", "about_name"]).where("id", "=", askId).executeTakeFirstOrThrow());
  const display = await withPerson(t.db, m.a.personId, (trx) => trx.selectFrom("people").select("display_name").where("id", "=", m.a.personId).executeTakeFirstOrThrow());
  const blockedSelf = await sendAsk(m.a.sessionToken, { mode: "self", text: SELF_TEXT });
  const blockedReact = await sendAsk(m.a.sessionToken, { mode: "react", pairId: m.pairId, text: SELF_TEXT });

  expect(accepted.statusCode).toBe(201);
  expect(row).toEqual({ mode: "self", pair_id: null, about_name: display.display_name });
  const capped = { code: "react_daily_cap", message: "You have sent today's friend asks. Try again tomorrow." };
  expect([blockedSelf.statusCode, blockedReact.statusCode]).toEqual([429, 429]);
  expect([ErrorBody.parse(blockedSelf.body), ErrorBody.parse(blockedReact.body)]).toEqual([capped, capped]);
});
