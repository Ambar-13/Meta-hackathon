// Unit tests for the simulated person's HTTP client, run against a fake fetch (no server).
import { describe, expect, it } from "vitest";
import { routes } from "@meet-first/contracts";
import { PersonClient, type FetchLike } from "./person-client.js";

const BASE = "http://localhost:3000";
const PERSON_ID = "0f8c7a52-4d3e-4b8a-9c1e-2a3b4c5d6e7f";

// A JSON response with the given status.
function jsonReply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("person client", () => {
  it("A7-T1: client using a fake fetch sends Origin on POST and not on GET", async () => {
    const seen: Array<{ method: string; origin: string | null }> = [];
    const fetchLike: FetchLike = (url, init) => {
      seen.push({ method: String(init.method), origin: new Headers(init.headers).get("Origin") });
      if (init.method === "GET")
        return Promise.resolve(
          jsonReply(200, {
            ok: true,
            db: true,
            worker: true,
            schemaVersion: 1,
            diskPct: null,
            degraded: false,
          }),
        );
      return Promise.resolve(jsonReply(201, { personId: PERSON_ID, recoveryCode: "a".repeat(32) }));
    };
    const client = new PersonClient("A", BASE, fetchLike);
    await client.json({
      method: "POST",
      path: routes.people.createPerson.path,
      body: { displayName: "A" },
      expect: 201,
      schema: routes.people.createPerson.response,
    });
    await client.json({
      method: "GET",
      path: routes.people.health.path,
      expect: 200,
      schema: routes.people.health.response,
    });
    expect(seen).toEqual([
      { method: "POST", origin: BASE },
      { method: "GET", origin: null },
    ]);
  });

  it("R9.5-T1: client using a fake fetch exits 3 on 429 from POST /api/people", async () => {
    const fetchLike: FetchLike = () =>
      Promise.resolve(jsonReply(429, { code: "rate_limited", message: "slow down" }));
    const client = new PersonClient("A", BASE, fetchLike);
    const attempt = client.json({
      method: "POST",
      path: routes.people.createPerson.path,
      body: { displayName: "A" },
      expect: 201,
      schema: routes.people.createPerson.response,
    });
    await expect(attempt).rejects.toMatchObject({ exitCode: 3 });
    await expect(attempt).rejects.toThrow(/^golden_path_rate_limited/);
  });
});
