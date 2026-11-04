import fastify, { type FastifyInstance } from "fastify";
import { expect, it } from "vitest";
import { registerAnalyticsTag, TAG_KEEP_MS, TAG_PATH, TAG_SOURCE_URL } from "./analytics-tag.js";

// An app with only the tag route, a stand-in for Google, and a stand-in clock.
function tagApp(fetchTag: () => Promise<string>, now: () => number): FastifyInstance {
  const app = fastify();
  registerAnalyticsTag(app, fetchTag, now);
  return app;
}

it("W7-ANALYTICS-T5: /gtag.js serves Google's tag for Meety's one id as JavaScript, whatever the query says, and asks Google at most once an hour", async () => {
  let asked = 0;
  let clock = 0;
  const app = tagApp(
    () => {
      asked += 1;
      return Promise.resolve(`tag ${String(asked)}`);
    },
    () => clock,
  );

  const first = await app.inject({ method: "GET", url: TAG_PATH });
  clock = TAG_KEEP_MS - 1;
  const second = await app.inject({ method: "GET", url: `${TAG_PATH}?id=GTM-SOMEONEELSE` });
  clock = TAG_KEEP_MS;
  const third = await app.inject({ method: "GET", url: TAG_PATH });
  await app.close();

  expect(TAG_SOURCE_URL).toBe("https://www.googletagmanager.com/gtag/js?id=G-0DLJPMZJV4");
  expect(first.statusCode).toBe(200);
  expect(first.headers["content-type"]).toBe("text/javascript; charset=utf-8");
  expect(first.headers["cache-control"]).toBe("public, max-age=3600");
  expect([first.body, second.body, third.body]).toEqual(["tag 1", "tag 1", "tag 2"]);
  expect(asked).toBe(2);
});

it("W7-ANALYTICS-T6: when Google does not answer, the last copy still serves, and with no copy the answer is 503", async () => {
  let clock = 0;
  let isGoogleUp = true;
  const app = tagApp(
    () => (isGoogleUp ? Promise.resolve("tag") : Promise.reject(new Error("gtag_fetch_failed"))),
    () => clock,
  );
  const noCopy = tagApp(
    () => Promise.reject(new Error("gtag_fetch_failed")),
    () => 0,
  );

  await app.inject({ method: "GET", url: TAG_PATH });
  isGoogleUp = false;
  clock = TAG_KEEP_MS;
  const stale = await app.inject({ method: "GET", url: TAG_PATH });
  const missing = await noCopy.inject({ method: "GET", url: TAG_PATH });
  await app.close();
  await noCopy.close();

  expect([stale.statusCode, stale.body]).toEqual([200, "tag"]);
  expect(missing.statusCode).toBe(503);
});
