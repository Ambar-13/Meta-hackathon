import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, apiUpload, buildApiPath, routes } from "./api-fetch.js";
import { resetServerClock, serverOffsetMs } from "./server-clock.js";
import { IDS, meetingView } from "../testing/fixtures.js";

const ORIGIN = "http://app.test";

// The first recorded call of a fake fetch, or a thrown error when the test made none.
function firstCall(fake: { mock: { calls: unknown[][] } }): unknown[] {
  const call = fake.mock.calls[0];
  if (call === undefined) throw new Error("the fake fetch was not called");
  return call;
}

// A JSON reply with the given status, for a fake fetch.
function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// A fake fetch that answers every call with a fresh reply from the factory.
function replying(make: () => Response): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(() => Promise.resolve(make()));
}

describe("apiFetch", () => {
  beforeEach(() => {
    resetServerClock();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("A7-T1: a GET goes to the route path on this origin with credentials same-origin and no body, using a fake fetch", async () => {
    const fetchImpl = replying(() => jsonReply(meetingView({})));
    const result = await apiFetch(routes.meetings.readMeeting, {
      params: { id: IDS.meeting },
      fetchImpl,
      origin: ORIGIN,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = firstCall(fetchImpl) as [URL, RequestInit];
    expect(String(url)).toBe(`${ORIGIN}/api/meetings/${IDS.meeting}`);
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBeUndefined();
    expect(result).toEqual(meetingView({}));
  });

  it("A7-T2: a 401 with an ErrorBody becomes ApiError session_missing with the server's sentence, using a fake fetch", async () => {
    const fetchImpl = replying(() =>
      jsonReply({ code: "session_missing", message: "Sign in again from the start page." }, 401),
    );
    const failure = (await apiFetch(routes.meetings.readMeeting, {
      params: { id: IDS.meeting },
      fetchImpl,
      origin: ORIGIN,
    }).catch((error: unknown) => error)) as ApiError;
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.status).toBe(401);
    expect(failure.code).toBe("session_missing");
    expect(failure.message).toBe("Sign in again from the start page.");
  });

  it("A7-T3: a 403 with no JSON body becomes http_403 with the Origin sentence, using a fake fetch", async () => {
    const fetchImpl = replying(() => new Response("Forbidden", { status: 403 }));
    const failure = (await apiFetch(routes.meetings.readMeeting, {
      params: { id: IDS.meeting },
      fetchImpl,
      origin: ORIGIN,
    }).catch((error: unknown) => error)) as ApiError;
    expect(failure.code).toBe("http_403");
    expect(failure.message).toBe("Open the app from its own address and try again.");
  });

  it("A7-T4: a fetch that throws becomes network_failed, using a fake fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("failed")));
    const failure = (await apiFetch(routes.meetings.readMeeting, {
      params: { id: IDS.meeting },
      fetchImpl,
      origin: ORIGIN,
    }).catch((error: unknown) => error)) as ApiError;
    expect(failure.status).toBe(0);
    expect(failure.code).toBe("network_failed");
    expect(failure.message).toBe(
      "The server could not be reached. Check your connection and try again.",
    );
  });

  it("R13.2-T3: a 200 body that fails the route schema throws response_invalid with the body attached, using a fake fetch", async () => {
    const fetchImpl = replying(() => jsonReply({ id: "x" }));
    const failure = (await apiFetch(routes.meetings.readMeeting, {
      params: { id: IDS.meeting },
      fetchImpl,
      origin: ORIGIN,
    }).catch((error: unknown) => error)) as ApiError;
    expect(failure.status).toBe(200);
    expect(failure.code).toBe("response_invalid");
    expect(failure.body).toEqual({ id: "x" });
  });

  it("R13.2-T4: a body that fails the route's request schema is refused before any fetch, using a fake fetch", async () => {
    const fetchImpl = replying(() => jsonReply({}));
    const failure = (await apiFetch(routes.people.createPerson, {
      body: { displayName: "" },
      fetchImpl,
      origin: ORIGIN,
    }).catch((error: unknown) => error)) as ApiError;
    expect(failure.code).toBe("request_invalid");
    expect(fetchImpl).toHaveBeenCalledTimes(0);
  });

  it("R13.2-T5: buildApiPath fills path values and adds the query, and refuses a missing value", () => {
    expect(buildApiPath("/api/meetings/:id/events", { id: "m1" }, { after: 3 })).toBe(
      "/api/meetings/m1/events?after=3",
    );
    expect(() => buildApiPath("/api/sources/:id", {}, {})).toThrow(ApiError);
    try {
      buildApiPath("/api/sources/:id", {}, {});
    } catch (error: unknown) {
      expect((error as ApiError).code).toBe("path_value_missing");
    }
  });

  it("R12.2-T1: the first reply with serverNow sets the server offset and a later one leaves it, using a fake fetch and fake timers", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.setSystemTime(new Date("2026-10-27T10:05:00.000Z"));
    const replies = [
      jsonReply(meetingView({})),
      jsonReply(meetingView({ serverNow: "2026-10-27T11:00:00.000Z" })),
    ];
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(replies.shift() ?? jsonReply(meetingView({}))),
    );
    await apiFetch(routes.meetings.readMeeting, {
      params: { id: IDS.meeting },
      fetchImpl,
      origin: ORIGIN,
    });
    await apiFetch(routes.meetings.readMeeting, {
      params: { id: IDS.meeting },
      fetchImpl,
      origin: ORIGIN,
    });
    expect(serverOffsetMs()).toBe(-300000);
  });

  it("D4-T1: apiUpload posts the blob as application/x-ndjson and adds Content-Encoding gzip only for a gzip body, using a fake fetch", async () => {
    const reply = { sourceId: IDS.source, turnCount: 8, redactionCount: 1, duplicate: false };
    const fetchImpl = replying(() => jsonReply(reply, 201));
    const first = await apiUpload(
      { body: new Blob(["a\nb"]), contentEncoding: "gzip" },
      { fetchImpl, origin: ORIGIN },
    );
    const second = await apiUpload(
      { body: new Blob(["a\nb"]), contentEncoding: null },
      { fetchImpl, origin: ORIGIN },
    );
    const [firstUrl, firstInit] = firstCall(fetchImpl) as [URL, RequestInit];
    const secondCall = fetchImpl.mock.calls[1];
    if (secondCall === undefined) throw new Error("the second upload was not sent");
    const secondInit: RequestInit = secondCall[1] ?? {};
    expect(String(firstUrl).endsWith("/api/sources")).toBe(true);
    expect(firstInit.method).toBe("POST");
    expect(new Headers(firstInit.headers).get("Content-Type")).toBe("application/x-ndjson");
    expect(new Headers(firstInit.headers).get("Content-Encoding")).toBe("gzip");
    expect(new Headers(secondInit.headers).get("Content-Encoding")).toBeNull();
    expect(first).toEqual(reply);
    expect(second).toEqual(reply);
  });
});
