// A browser keeps the session cookie and sends it back on the next request; light-my-request does not, so route
// tests use this jar (docs/contracts.md section 4). Every request it builds also carries the Origin of the test app,
// because every request the web app sends does, and the Origin check refuses a POST without it (A7) [confirm].
import type { LightMyRequestResponse } from "fastify";
import { SESSION_COOKIE } from "@meet-first/contracts";
import { TEST_APP_ORIGIN } from "./app-factory.js";

// Turns a Set-Cookie header value into its lines; a missing header has none.
function toCookieLines(value: string | string[] | number | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [String(value)];
}

// Reads __Host-session from Set-Cookie: the token, "" when the server cleared it (an empty value or Max-Age=0), or undefined when no such line came.
export function readSessionCookie(setCookie: string | string[] | number | undefined): string | undefined {
  for (const line of toCookieLines(setCookie)) {
    const [pair = "", ...attributes] = line.split(";");
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== SESSION_COOKIE) {
      continue;
    }
    const value = pair.slice(separator + 1).trim();
    const isCleared = value === "" || attributes.some((attribute) => attribute.trim().toLowerCase() === "max-age=0");
    return isCleared ? "" : value;
  }
  return undefined;
}

// The headers of a request from the web app for a person whose token is known, such as one from createTestPerson.
export function sessionHeader(token: string): Record<string, string> {
  return { origin: TEST_APP_ORIGIN, cookie: `${SESSION_COOKIE}=${token}` };
}

// Keeps the session cookie between inject calls the way a browser would, and adds the test app's Origin to every request.
export function cookieJar(): { header: () => Record<string, string>; absorb: (response: LightMyRequestResponse) => void } {
  let token: string | undefined;
  return {
    header: () => (token === undefined ? { origin: TEST_APP_ORIGIN } : sessionHeader(token)),
    absorb: (response) => {
      const value = readSessionCookie(response.headers["set-cookie"]);
      if (value !== undefined) {
        token = value === "" ? undefined : value;
      }
    },
  };
}
