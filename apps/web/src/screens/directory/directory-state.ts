import { useEffect, useRef, useState } from "react";
import type { DirectoryListing, DirectoryPage, ListedMeeting, MyListing, QuestionKind } from "@meet-first/contracts";
import { apiFetch, ApiError, APP_PATHS, asApiError, readCardQuery, routes } from "../../app-shell/index.js";
import { readListingOrNull } from "../card/index.js";
import { meetingCreateBody, type QuestionPick } from "../lobby/index.js";

// The longest search the directory takes: the maximum of the query in DirectoryQuery in contracts, which names no constant.
export const SEARCH_MAX_CHARS = 200;
// The lobby's sentence for free text outside 5 to 300 characters, in the same words, so both pickers say the same (lobby-state.ts).
export const FREE_TEXT_REFUSAL = "Write a question of 5 to 300 characters.";

// The listings shown so far: the search they answer, the next page to ask for, whether more exist, and how the last load went.
export type BrowseState = { query: string; listings: DirectoryListing[]; nextPage: number; hasMore: boolean; hasLoaded: boolean; isLoading: boolean; error: ApiError | null };
// The listings with their two actions: a new search from page 0, and the next page of the same search.
export type BrowseHook = BrowseState & { search: (query: string) => void; loadMore: () => void };
// Where the Meet flow stands: whose picker is open, whether a create is out, and the sentence of the last refusal.
export type MeetState = { openListingId: string | null; isSending: boolean; error: string | null };
// The Meet flow with its two actions: open or close one listing's picker, and create the meeting from a pick.
export type MeetControls = { state: MeetState; toggle: (listingId: string) => void; create: (listingId: string, pick: QuestionPick) => Promise<void> };
// The Your listing part's data: loading, failed, or ready with the listing (null when not listed), the card it was on when the page
// opened, and the meetings the persona was in.
export type YourListingLoad =
  | { kind: "loading" }
  | { kind: "failed"; error: ApiError }
  | { kind: "ready"; listing: MyListing | null; listedCardId: string | null; meetings: ListedMeeting[] };
// Where the Leave button stands.
export type LeaveState = { kind: "idle" } | { kind: "sending" } | { kind: "left" } | { kind: "failed"; error: ApiError };
// The Your listing part's data with the Leave action, and replaceListing for a listing the person has joined with or saved.
export type YourListingHook = { load: YourListingLoad; leaveState: LeaveState; leave: () => Promise<void>; replaceListing: (listing: MyListing) => void };

// The listings before the first page arrives.
const FIRST_BROWSE: BrowseState = { query: "", listings: [], nextPage: 0, hasMore: false, hasLoaded: false, isLoading: true, error: null };

// The query values of one directory request: the page always, and the words only when the trimmed search is not empty.
export function directoryQueryFor(query: string, page: number): Record<string, string | number> {
  const words = query.trim();
  return words === "" ? { page } : { query: words, page };
}

// The listings after a page arrives: page 0 replaces them, and a later page is added after them.
export function withPage(state: BrowseState, reply: DirectoryPage): BrowseState {
  const listings = reply.page === 0 ? reply.listings : [...state.listings, ...reply.listings];
  return { ...state, listings, nextPage: reply.page + 1, hasMore: reply.hasMore, hasLoaded: true, isLoading: false, error: null };
}

// The card a Meet button speaks from: the card in the address, else the card this tab approved, else the card of the person's listing.
export function cardForMeeting(input: { search: string; approvedCardId: string | null; listedCardId: string | null }): string | null {
  return readCardQuery(input.search) ?? input.approvedCardId ?? input.listedCardId;
}

// The question kinds the Meet picker leaves out: romance, unless the listing is open to dating questions.
export function leaveOutKindsFor(listing: DirectoryListing): readonly QuestionKind[] {
  return listing.openToRomance ? [] : ["romance"];
}

// The directory listings with search and More. A reply to an older request is dropped, so a new search never mixes with an old page.
export function useDirectoryBrowse(): BrowseHook {
  const [state, setState] = useState<BrowseState>(FIRST_BROWSE);
  const latestTicket = useRef(0);
  const load = (query: string, page: number): void => {
    latestTicket.current += 1;
    const ticket = latestTicket.current;
    setState((previous) => ({ ...previous, query, isLoading: true, error: null }));
    apiFetch(routes.directory.browse, { query: directoryQueryFor(query, page) }).then(
      (reply) => {
        if (ticket === latestTicket.current) setState((previous) => withPage(previous, reply));
      },
      (thrown: unknown) => {
        if (ticket === latestTicket.current) setState((previous) => ({ ...previous, isLoading: false, error: asApiError(thrown) }));
      },
    );
  };
  useEffect(() => {
    load("", 0);
    // The first page loads once when the page opens; later loads come only from Search and More.
  }, []);
  return {
    ...state,
    search: (query) => {
      load(query.trim(), 0);
    },
    loadMore: () => {
      load(state.query, state.nextPage);
    },
  };
}

// The Meet flow of the directory page: one picker open at a time, and a created meeting opens its page.
export function useListingMeeting(options: { cardId: string | null; go: (path: string) => void }): MeetControls {
  const { cardId, go } = options;
  const [state, setState] = useState<MeetState>({ openListingId: null, isSending: false, error: null });
  const toggle = (listingId: string): void => {
    setState((previous) => ({ openListingId: previous.openListingId === listingId ? null : listingId, isSending: false, error: null }));
  };
  const create = async (listingId: string, pick: QuestionPick): Promise<void> => {
    if (cardId === null) return;
    const body = meetingCreateBody(pick, cardId);
    if (body === null) {
      setState((previous) => ({ ...previous, error: FREE_TEXT_REFUSAL }));
      return;
    }
    setState((previous) => ({ ...previous, isSending: true, error: null }));
    try {
      const reply = await apiFetch(routes.directory.createListingMeeting, { params: { id: listingId }, body });
      go(APP_PATHS.meeting(reply.meetingId));
    } catch (thrown: unknown) {
      setState((previous) => ({ ...previous, isSending: false, error: asApiError(thrown).message }));
    }
  };
  return { state, toggle, create };
}

// The person's own listing, the card it was on when the page opened, the meetings their persona was in, and Leave.
export function useYourListing(): YourListingHook {
  const [load, setLoad] = useState<YourListingLoad>({ kind: "loading" });
  const [leaveState, setLeaveState] = useState<LeaveState>({ kind: "idle" });
  useEffect(() => {
    let isActive = true;
    Promise.all([readListingOrNull(), apiFetch(routes.directory.listedMeetings)]).then(
      ([listing, view]) => {
        if (isActive) setLoad({ kind: "ready", listing, listedCardId: listing?.cardId ?? null, meetings: view.meetings });
      },
      (thrown: unknown) => {
        if (isActive) setLoad({ kind: "failed", error: asApiError(thrown) });
      },
    );
    return () => {
      isActive = false;
    };
  }, []);
  const leave = async (): Promise<void> => {
    setLeaveState({ kind: "sending" });
    try {
      await apiFetch(routes.directory.leave);
      setLoad((previous) => (previous.kind === "ready" ? { ...previous, listing: null } : previous));
      setLeaveState({ kind: "left" });
    } catch (thrown: unknown) {
      setLeaveState({ kind: "failed", error: asApiError(thrown) });
    }
  };
  const replaceListing = (listing: MyListing): void => {
    setLoad((previous) => (previous.kind === "ready" ? { ...previous, listing } : previous));
    setLeaveState({ kind: "idle" });
  };
  return { load, leaveState, leave, replaceListing };
}
