import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "kysely";
import { AuthOptions, HomeView, routes, SESSION_COOKIE } from "@meet-first/contracts";
import { registerHomeRoutes } from "../home/index.js";
import { buildTestApp } from "../testing/index.js";
import { hashToken } from "./cookie.js";
import { registerSessionsRoutes } from "./index.js";

// The site's own address in these tests, and a Google client made up for them.
const ORIGIN = "http://localhost:3000";
const CLIENT_ID = "test-client.apps.googleusercontent.com";
const CLIENT_SECRET = "test-secret-not-a-real-one";
// Google's token endpoint, which the fake model of Google below answers.
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let t: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerSessionsRoutes, registerHomeRoutes], env: { APP_ORIGIN: ORIGIN, GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, ACCESS_CODE: "only-for-the-form" } });
});
afterAll(async () => {
  await t.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// An ID token with these claims, as Google's token endpoint returns one: a header, the claims and a signature, each base64url.
function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256", kid: "test" })}.${part(claims)}.${Buffer.from("signature").toString("base64url")}`;
}

// The claims of a good sign-in for this nonce: Google's, for this client, an hour from expiring, with a name and an email Meety must
// not keep.
function goodClaims(nonce: string, sub = "google-sub-1"): Record<string, unknown> {
  return { iss: "https://accounts.google.com", aud: CLIENT_ID, sub, exp: Math.floor(Date.now() / 1000) + 3600, nonce, name: "Asha Rao", email: "asha@example.com" };
}

// Stands in for Google's token endpoint: answers this status and body, and keeps each form the server sent.
function fakeGoogle(answer: (form: URLSearchParams) => { status: number; body: unknown }): URLSearchParams[] {
  const forms: URLSearchParams[] = [];
  vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit): Promise<Response> => {
    if (String(input) !== TOKEN_URL) throw new Error(`unexpected fetch of ${String(input)}`);
    const form = new URLSearchParams(String(init?.body));
    forms.push(form);
    const { status, body } = answer(form);
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  });
  return forms;
}

// One cookie's value from a reply's set-cookie headers, with its whole header.
function setCookie(headers: Record<string, unknown>, name: string): { value: string; header: string } | null {
  const raw = headers["set-cookie"];
  const list = Array.isArray(raw) ? raw.map(String) : [raw].filter((line) => line !== undefined).map(String);
  const header = list.find((line) => line.startsWith(`${name}=`));
  return header === undefined ? null : { value: header.slice(name.length + 1).split(";")[0] ?? "", header };
}

// Starts a sign-in and returns the cookie it set and the Google address it sent the browser to.
async function start(): Promise<{ cookie: string; google: URL }> {
  const response = await t.app.inject({ method: "GET", url: routes.people.googleStart.path });
  const cookie = setCookie(response.headers, "__Host-google");
  if (response.statusCode !== 303 || cookie === null) throw new Error(`the start answered ${String(response.statusCode)} with no sign-in cookie`);
  return { cookie: cookie.value, google: new URL(String(response.headers.location)) };
}

// Sends the browser back to the callback with this query and sign-in cookie.
async function callback(query: string, cookie: string | null): Promise<{ statusCode: number; location: string; session: string | null; googleCookie: string | null }> {
  const response = await t.app.inject({ method: "GET", url: `${routes.people.googleCallback.path}?${query}`, headers: cookie === null ? {} : { cookie: `__Host-google=${cookie}` } });
  return { statusCode: response.statusCode, location: String(response.headers.location), session: setCookie(response.headers, SESSION_COOKIE)?.value ?? null, googleCookie: setCookie(response.headers, "__Host-google")?.header ?? null };
}

// The person behind a session token, as the session hook finds them.
async function personOf(token: string): Promise<string | null> {
  return (await sql<{ person_id: string | null }>`SELECT auth_person_for_session(${hashToken(token)}) AS person_id`.execute(t.db)).rows[0]?.person_id ?? null;
}

// A full sign-in that Google answers with these claims; the session token it gave, or null.
async function signIn(claimsFor: (nonce: string) => Record<string, unknown>): Promise<string | null> {
  const { cookie, google } = await start();
  const nonce = google.searchParams.get("nonce") ?? "";
  fakeGoogle(() => ({ status: 200, body: { id_token: idToken(claimsFor(nonce)), access_token: "unused" } }));
  return (await callback(`code=one-time-code&state=${google.searchParams.get("state") ?? ""}`, cookie)).session;
}

describe("sign in with Google", () => {
  it("W7-GOOGLE-T1: the start sets a 10-minute sign-in cookie and sends the browser to Google for the code flow with PKCE, openid and profile only, back to this site", async () => {
    const options = AuthOptions.parse((await t.app.inject({ method: "GET", url: routes.people.authOptions.path })).json());
    const response = await t.app.inject({ method: "GET", url: routes.people.googleStart.path });
    const cookie = setCookie(response.headers, "__Host-google");
    const google = new URL(String(response.headers.location));
    const [state, nonce, verifier] = (cookie?.value ?? "").split(".");

    expect(options).toEqual({ google: true });
    expect(response.statusCode).toBe(303);
    expect(`${google.origin}${google.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(google.searchParams)).toEqual({
      client_id: CLIENT_ID, redirect_uri: `${ORIGIN}/api/auth/google/callback`, response_type: "code", scope: "openid profile", state, nonce,
      code_challenge: createHash("sha256").update(verifier ?? "").digest("base64url"), code_challenge_method: "S256", prompt: "select_account",
    });
    expect(cookie?.header).toMatch(/HttpOnly/);
    expect(cookie?.header).toMatch(/Secure/);
    expect(cookie?.header).toMatch(/SameSite=Lax/);
    expect(cookie?.header).toMatch(/Max-Age=600/);
  });

  it("W7-GOOGLE-T2: a callback that checks out makes a person with Google's name and no access code, sends them Home signed in, spends the sign-in cookie, and the same Google account comes back to the same person", async () => {
    const { cookie, google } = await start();
    const nonce = google.searchParams.get("nonce") ?? "";
    const forms = fakeGoogle(() => ({ status: 200, body: { id_token: idToken(goodClaims(nonce)), access_token: "unused" } }));
    const back = await callback(`code=one-time-code&state=${google.searchParams.get("state") ?? ""}`, cookie);
    const home = await t.app.inject({ method: "GET", url: routes.people.readHome.path, headers: { cookie: `${SESSION_COOKIE}=${back.session ?? ""}` } });

    expect(back.statusCode).toBe(303);
    expect(back.location).toBe("/home");
    expect(back.googleCookie).toMatch(/Max-Age=0/);
    expect(Object.fromEntries(forms[0] ?? [])).toEqual({
      code: "one-time-code", client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: `${ORIGIN}/api/auth/google/callback`, grant_type: "authorization_code", code_verifier: cookie.split(".")[2],
    });
    expect(HomeView.parse(home.json()).displayName).toBe("Asha Rao");
    const again = await signIn((nextNonce) => goodClaims(nextNonce));
    expect(await personOf(again ?? "")).toBe(await personOf(back.session ?? ""));
  });

  it("W7-GOOGLE-T3: a callback goes back to the start page with no session when the cookie is missing or its state differs, the person said no, Google refuses the code, or the token is for another client, expired, or without this sign-in's nonce", async () => {
    const { cookie, google } = await start();
    const state = google.searchParams.get("state") ?? "";
    const nonce = google.searchParams.get("nonce") ?? "";
    const withClaims = async (claims: Record<string, unknown>) => {
      fakeGoogle(() => ({ status: 200, body: { id_token: idToken(claims) } }));
      return callback(`code=c&state=${state}`, cookie);
    };
    fakeGoogle(() => ({ status: 400, body: { error: "invalid_grant" } }));
    const results = [
      await callback(`code=c&state=${state}`, null),
      await callback("code=c&state=another-state-of-twenty-chars", cookie),
      await callback(`error=access_denied&state=${state}`, cookie),
      await callback(`code=c&state=${state}`, cookie),
      await withClaims({ ...goodClaims(nonce), aud: "someone-else.apps.googleusercontent.com" }),
      await withClaims({ ...goodClaims(nonce), exp: Math.floor(Date.now() / 1000) - 60 }),
      await withClaims({ ...goodClaims("a-nonce-from-another-sign-in"), sub: "google-sub-2" }),
      await withClaims({ ...goodClaims(nonce), iss: "https://evil.example" }),
    ];

    expect(results.map((result) => result.location)).toEqual([
      "/?google=failed", "/?google=failed", "/?google=cancelled", "/?google=failed", "/?google=failed", "/?google=failed", "/?google=failed", "/?google=failed",
    ]);
    expect(results.every((result) => result.statusCode === 303 && result.session === null)).toBe(true);
  });

  it("W7-GOOGLE-T4: a site with no Google client says so, and its start sends the browser back to the start page", async () => {
    const off = await buildTestApp({ routes: [registerSessionsRoutes], env: { APP_ORIGIN: ORIGIN } });
    try {
      const options = AuthOptions.parse((await off.app.inject({ method: "GET", url: routes.people.authOptions.path })).json());
      const response = await off.app.inject({ method: "GET", url: routes.people.googleStart.path });

      expect(options).toEqual({ google: false });
      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe("/?google=failed");
    } finally {
      await off.close();
    }
  });
});
