import { describe, expect, it } from "vitest";
import { APP_PATHS, chatPathWithDraft, createPath, lobbyPathWithCard, meetingPathWithSide, pairPathWithCard, readCardQuery, readCreateKind, readFragmentToken, readSideQuery, ROUTE_PATTERNS } from "./app-paths.js";
import { IDS } from "../testing/fixtures.js";

const KEYS = ["welcome", "upload", "pair", "join", "claim", "settings", "namesReview", "card", "quiz", "lobby", "meeting", "brief", "comic", "consent", "sharePage", "directory", "help", "friends", "ask", "home", "explore", "me", "person", "meety", "search", "create", "privacy", "terms", "cookies"];

describe("client paths", () => {
  it("D32-T1: readFragmentToken returns the 32-hex token after the # and null for anything else", () => {
    expect(readFragmentToken("#0123456789abcdef0123456789abcdef")).toBe("0123456789abcdef0123456789abcdef");
    expect(readFragmentToken("0123456789abcdef0123456789abcdef")).toBe("0123456789abcdef0123456789abcdef");
    expect(readFragmentToken("#0123")).toBeNull();
    expect(readFragmentToken("#0123456789ABCDEF0123456789ABCDEF")).toBeNull();
    expect(readFragmentToken("#token=0123456789abcdef0123456789abcdef")).toBeNull();
    expect(readFragmentToken("")).toBeNull();
  });

  it("R13.2-T1: APP_PATHS and ROUTE_PATTERNS share the 27 keys in order and every builder fills its pattern", () => {
    expect(Object.keys(APP_PATHS)).toEqual(KEYS);
    expect(Object.keys(ROUTE_PATTERNS)).toEqual(KEYS);
    const paths: Record<string, string | ((id: string) => string)> = APP_PATHS;
    const patterns: Record<string, string> = ROUTE_PATTERNS;
    for (const key of KEYS) {
      const value = paths[key];
      const pattern = patterns[key];
      if (value === undefined || pattern === undefined) throw new Error(`missing path for ${key}`);
      if (typeof value === "function") {
        expect(value("x")).toBe(pattern.replace(/:[A-Za-z]+/, "x"));
      } else {
        expect(value).toBe(pattern);
      }
    }
    expect(APP_PATHS.consent(IDS.meeting)).toBe(`/meetings/${IDS.meeting}/share`);
  });

  it("R13.2-T2: the card query functions carry a uuid and refuse anything else", () => {
    expect(pairPathWithCard(IDS.card)).toBe(`/pair?card=${IDS.card}`);
    expect(lobbyPathWithCard(IDS.pair, IDS.card)).toBe(`/pairs/${IDS.pair}?card=${IDS.card}`);
    expect(lobbyPathWithCard(IDS.pair, null)).toBe(`/pairs/${IDS.pair}`);
    expect(readCardQuery(`?card=${IDS.card}`)).toBe(IDS.card);
    expect(readCardQuery("?card=nope")).toBeNull();
    expect(readCardQuery("")).toBeNull();
  });

  it("A8-T1: the side query accepts only a or b", () => {
    expect(readSideQuery("?side=a")).toBe("a");
    expect(readSideQuery("?side=b")).toBe("b");
    expect(readSideQuery("?side=c")).toBeNull();
    expect(readSideQuery("")).toBeNull();
    expect(meetingPathWithSide(IDS.meeting, "b")).toBe(`/meetings/${IDS.meeting}?side=b`);
    expect(meetingPathWithSide(IDS.meeting, null)).toBe(`/meetings/${IDS.meeting}`);
  });

  it("W7-WEB-A-U1: chatPathWithDraft opens the chat with the words encoded in the draft query", () => {
    expect(chatPathWithDraft("How would Mira react to ")).toBe("/meety?draft=How%20would%20Mira%20react%20to%20");
    expect(chatPathWithDraft("a&b=c?")).toBe("/meety?draft=a%26b%3Dc%3F");
    expect(new URLSearchParams(chatPathWithDraft("How would Mira react to ").split("?")[1]).get("draft")).toBe("How would Mira react to ");
    expect(APP_PATHS.person(IDS.card)).toBe(`/people/${IDS.card}`);
  });

  it("W7-CREATE-U1: Create opens ready for a story only when the address says so", () => {
    expect(createPath("post")).toBe("/create");
    expect(createPath("story")).toBe("/create?kind=story");
    expect(readCreateKind("?kind=story")).toBe("story");
    expect(readCreateKind("")).toBe("post");
    expect(readCreateKind("?kind=reel")).toBe("post");
  });
});
