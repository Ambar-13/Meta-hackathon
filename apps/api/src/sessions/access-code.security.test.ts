// Sign-up on a site that sets ACCESS_CODE: without the code nobody gets an account, so a script cannot make accounts and spend
// the model budget through them. Open sign-up, with no ACCESS_CODE, is what sessions.security.test.ts runs on.
import { afterAll, beforeAll, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildTestApp } from "../testing/app-factory.js";
import { registerSessionsRoutes } from "./index.js";

const ORIGIN = "http://localhost:3000";
const CODE = "Meet-First-Judges";

let t: Awaited<ReturnType<typeof buildTestApp>>;
let appUnderTest: FastifyInstance;

// Signs up one person from its own address, so the account limit never trips, with the given body.
function signUp(n: number, body: Record<string, unknown>): Promise<LightMyRequestResponse> {
  return appUnderTest.inject({
    method: "POST",
    url: "/api/people",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100." + String(n),
    },
    payload: JSON.stringify(body),
  });
}

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerSessionsRoutes], env: { ACCESS_CODE: CODE } });
  appUnderTest = t.app;
});

afterAll(async () => {
  await t.close();
});

it("R9.5-T3: with ACCESS_CODE set, sign-up without a code is 403 access_code_needed and opens no session", async () => {
  const r = await signUp(1, { displayName: "A" });

  expect(r.statusCode).toBe(403);
  expect(r.json()).toMatchObject({ code: "access_code_needed" });
  expect(r.headers["set-cookie"]).toBeUndefined();
});

it("R9.5-T4: a wrong code is 403 access_code_wrong; the right code, in other capitals and with spaces around it, is 201 with a session", async () => {
  const wrong = await signUp(2, { displayName: "B", accessCode: "not-it" });
  expect(wrong.statusCode).toBe(403);
  expect(wrong.json()).toMatchObject({ code: "access_code_wrong" });
  expect(wrong.headers["set-cookie"]).toBeUndefined();

  const right = await signUp(3, { displayName: "C", accessCode: "  meet-first-JUDGES " });
  expect(right.statusCode).toBe(201);
  expect(String(right.headers["set-cookie"])).toMatch(/^__Host-session=[0-9a-f]{64};/);
});
