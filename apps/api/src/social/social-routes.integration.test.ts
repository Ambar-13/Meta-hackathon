import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContractError, DirectoryPage, ErrorBody, FriendRequestAcceptResponse, FriendRequestCreateResponse, FriendRequestsView, FriendsView, OrchestratorMessage, OrchestratorSendResponse, OrchestratorThread, PostsView, ProfileView, routes, SESSION_COOKIE } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import { createPairedMeetingWithTurns, createTestPerson, type SeededMeeting } from "@meet-first/db/testing";
import { registerAsksRoutes } from "../asks/index.js";
import { registerDirectoryRoutes } from "../directory/index.js";
import { buildTestApp } from "../testing/index.js";
import { enqueuedJobs } from "../testing/app-factory.js";
import { registerSocialRoutes } from "./index.js";
import { runPlan } from "./orchestrator.js";

// The origin every request of this file sends: the test app's own address.
const ORIGIN = "http://localhost:3000";

let t: Awaited<ReturnType<typeof buildTestApp>>;
// Two invite pairs: x.a and x.b are friends, y.a and y.b are friends; x.a and y.b are not.
let x: SeededMeeting;
let y: SeededMeeting;
let listingYb: string;
let listingXa: string;

beforeAll(async () => {
  t = await buildTestApp({ routes: [registerDirectoryRoutes, registerAsksRoutes, registerSocialRoutes], env: { APP_ORIGIN: ORIGIN } });
  x = await createPairedMeetingWithTurns(t.db);
  y = await createPairedMeetingWithTurns(t.db);
  listingYb = await listMember(y.b.personId, y.b.cardId, "Plans the week on Sunday.");
  listingXa = await listMember(x.a.personId, x.a.cardId, "Likes one clear owner for every task.");
});
afterAll(async () => {
  await t.close();
});

// Lists a person in Explore with their card and this line, as that person; returns the listing id.
async function listMember(personId: string, cardId: string, line: string): Promise<string> {
  const row = await withPerson(t.db, personId, (trx) => trx.insertInto("directory_listings").values({ person_id: personId, card_id: cardId, line }).returning("id").executeTakeFirstOrThrow());
  return row.id;
}

// One request: method, URL, the session token of the person making it, and a JSON payload.
type Call = { method: "GET" | "POST"; url: string; token: string; payload?: unknown };

// Makes one request through the app's injector and returns the status and the parsed body.
async function send(call: Call): Promise<{ statusCode: number; body: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN, cookie: `${SESSION_COOKIE}=${call.token}` };
  const payload = call.payload === undefined ? undefined : JSON.stringify(call.payload);
  const response = await t.app.inject({ method: call.method, url: call.url, headers, ...(payload === undefined ? {} : { payload }) });
  return { statusCode: response.statusCode, body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown) };
}

// The URL of a route with its :id filled in.
function pathOf(route: { path: string }, id: string): string {
  return route.path.replace(":id", id);
}

// Reads a profile as one person.
async function profile(token: string, listingId: string): Promise<ProfileView> {
  const response = await send({ method: "GET", url: pathOf(routes.social.readProfile, listingId), token });
  expect(response.statusCode).toBe(200);
  return ProfileView.parse(response.body);
}

describe("friend requests", () => {
  it("W7-API-T1: a request to a listing shows as requested to the sender, incoming to the receiver, and in both request lists", async () => {
    const sent = await send({ method: "POST", url: routes.social.sendFriendRequest.path, token: x.a.sessionToken, payload: { listingId: listingYb } });
    expect(sent.statusCode).toBe(201);
    const { requestId } = FriendRequestCreateResponse.parse(sent.body);

    expect(await profile(x.a.sessionToken, listingYb)).toMatchObject({ friendship: "requested", requestId, pairId: null, canAsk: false, displayName: "Test B" });
    expect(await profile(y.b.sessionToken, listingXa)).toMatchObject({ friendship: "incoming", requestId });
    const mine = FriendRequestsView.parse((await send({ method: "GET", url: routes.social.listFriendRequests.path, token: x.a.sessionToken })).body);
    const theirs = FriendRequestsView.parse((await send({ method: "GET", url: routes.social.listFriendRequests.path, token: y.b.sessionToken })).body);
    expect(mine.outgoing.map((view) => [view.requestId, view.otherName, view.otherListingId])).toEqual([[requestId, "Test B", listingYb]]);
    expect(theirs.incoming.map((view) => [view.requestId, view.otherName, view.otherListingId])).toEqual([[requestId, "Test A", listingXa]]);
  });

  it("W7-API-T2: the refusals answer with their codes: pending both ways, your own listing, already friends, a missing listing, a bad id", async () => {
    const again = await send({ method: "POST", url: routes.social.sendFriendRequest.path, token: x.a.sessionToken, payload: { listingId: listingYb } });
    const reverse = await send({ method: "POST", url: routes.social.sendFriendRequest.path, token: y.b.sessionToken, payload: { listingId: listingXa } });
    const self = await send({ method: "POST", url: routes.social.sendFriendRequest.path, token: y.b.sessionToken, payload: { listingId: listingYb } });
    const friends = await send({ method: "POST", url: routes.social.sendFriendRequest.path, token: y.a.sessionToken, payload: { listingId: listingYb } });
    const missing = await send({ method: "POST", url: routes.social.sendFriendRequest.path, token: x.a.sessionToken, payload: { listingId: "00000000-0000-4000-8000-000000000999" } });
    const badId = await send({ method: "GET", url: pathOf(routes.social.readProfile, "not-a-uuid"), token: x.a.sessionToken });

    expect([again.statusCode, reverse.statusCode, self.statusCode, friends.statusCode, missing.statusCode, badId.statusCode]).toEqual([409, 409, 409, 409, 404, 404]);
    expect(ErrorBody.parse(again.body)).toEqual({ code: "friend_request_pending", message: "You already asked this person. They have not answered yet." });
    expect(ErrorBody.parse(reverse.body)).toEqual({ code: "friend_request_pending", message: "This person already asked to be your friend. Accept their request on your Friends page." });
    expect(ErrorBody.parse(self.body).code).toBe("friend_request_self");
    expect(ErrorBody.parse(friends.body)).toEqual({ code: "already_friends", message: "You are already friends." });
    expect(ErrorBody.parse(missing.body)).toEqual({ code: "listing_not_found", message: "This person is no longer in Explore." });
  });

  it("W7-API-T3: accepting makes the two friends both ways, with the listing on the friend, and a second answer is refused", async () => {
    const pending = FriendRequestsView.parse((await send({ method: "GET", url: routes.social.listFriendRequests.path, token: y.b.sessionToken })).body).incoming[0];
    const requestId = pending?.requestId ?? "";
    const bySender = await send({ method: "POST", url: pathOf(routes.social.acceptFriendRequest, requestId), token: x.a.sessionToken });
    const accepted = await send({ method: "POST", url: pathOf(routes.social.acceptFriendRequest, requestId), token: y.b.sessionToken });
    const twice = await send({ method: "POST", url: pathOf(routes.social.acceptFriendRequest, requestId), token: y.b.sessionToken });

    expect(bySender.statusCode).toBe(404);
    expect(ErrorBody.parse(bySender.body).code).toBe("friend_request_not_found");
    expect(accepted.statusCode).toBe(200);
    const { pairId } = FriendRequestAcceptResponse.parse(accepted.body);
    expect(twice.statusCode).toBe(409);
    expect(ErrorBody.parse(twice.body).code).toBe("friend_request_decided");
    const aFriends = FriendsView.parse((await send({ method: "GET", url: routes.directory.friends.path, token: x.a.sessionToken })).body).friends;
    const bFriends = FriendsView.parse((await send({ method: "GET", url: routes.directory.friends.path, token: y.b.sessionToken })).body).friends;
    expect(aFriends.find((friend) => friend.pairId === pairId)).toEqual({ pairId, displayName: "Test B", canAsk: false, listingId: listingYb });
    expect(bFriends.find((friend) => friend.pairId === pairId)).toEqual({ pairId, displayName: "Test A", canAsk: false, listingId: listingXa });
    expect(await profile(x.a.sessionToken, listingYb)).toMatchObject({ friendship: "friends", pairId, requestId: null });
    expect(FriendRequestsView.parse((await send({ method: "GET", url: routes.social.listFriendRequests.path, token: x.a.sessionToken })).body)).toEqual({ incoming: [], outgoing: [] });
  });

  it("W7-API-T4: a decline removes the request from both lists, and the sender may ask again", async () => {
    const stranger = await createTestPerson(t.db, "Test C");
    const sent = FriendRequestCreateResponse.parse((await send({ method: "POST", url: routes.social.sendFriendRequest.path, token: stranger.sessionToken, payload: { listingId: listingXa } })).body);
    const declined = await send({ method: "POST", url: pathOf(routes.social.declineFriendRequest, sent.requestId), token: x.a.sessionToken });

    expect(declined.statusCode).toBe(204);
    expect(FriendRequestsView.parse((await send({ method: "GET", url: routes.social.listFriendRequests.path, token: stranger.sessionToken })).body).outgoing).toEqual([]);
    expect(await profile(stranger.sessionToken, listingXa)).toMatchObject({ friendship: "none", requestId: null });
    const again = await send({ method: "POST", url: routes.social.sendFriendRequest.path, token: stranger.sessionToken, payload: { listingId: listingXa } });
    expect(again.statusCode).toBe(201);
  });

  it("W7-API-T5: your own listing reads as self, and a listing that left Explore is listing_not_found", async () => {
    expect(await profile(x.a.sessionToken, listingXa)).toMatchObject({ friendship: "self", requestId: null, pairId: null });
    const gone = await listMember(x.b.personId, x.b.cardId, "Here for a moment.");
    await withPerson(t.db, x.b.personId, (trx) => trx.deleteFrom("directory_listings").where("id", "=", gone).execute());
    const response = await send({ method: "GET", url: pathOf(routes.social.readProfile, gone), token: x.a.sessionToken });
    expect(response.statusCode).toBe(404);
    expect(ErrorBody.parse(response.body)).toEqual({ code: "listing_not_found", message: "This person is no longer in Explore." });
  });
});

describe("the orchestrator chat", () => {
  it("W7-API-T6: a message writes the person's message and a thinking reply with the friend list, and enqueues orchestrate for the reply", async () => {
    const before = enqueuedJobs(t.app).length;
    const sent = await send({ method: "POST", url: routes.social.sendToOrchestrator.path, token: y.a.sessionToken, payload: { text: "  How would Test B react if I moved our trip to March?  " } });

    expect(sent.statusCode).toBe(202);
    const ids = OrchestratorSendResponse.parse(sent.body);
    const thread = OrchestratorThread.parse((await send({ method: "GET", url: routes.social.readThread.path, token: y.a.sessionToken })).body);
    expect(thread.messages.map((message) => [message.id, message.role, message.state, message.text])).toEqual([[ids.messageId, "you", "done", "How would Test B react if I moved our trip to March?"], [ids.replyId, "agent", "thinking", ""]]);
    expect(enqueuedJobs(t.app).slice(before)).toEqual([{ name: "orchestrate", payload: { messageId: ids.replyId, personId: y.a.personId } }]);
    const snapshot = await withPerson(t.db, y.a.personId, (trx) => trx.selectFrom("orchestrator_messages").select("friends_snapshot").where("id", "=", ids.replyId).executeTakeFirstOrThrow());
    expect(snapshot.friends_snapshot).toEqual([{ pairId: y.pairId, displayName: "Test B", canAsk: false }]);
    expect(OrchestratorThread.parse((await send({ method: "GET", url: routes.social.readThread.path, token: y.b.sessionToken })).body).messages).toEqual([]);
  });

  it("W7-API-T7: running a plan starts the friend ask once; a second press returns the reply unchanged; a thinking reply is not ready", async () => {
    await withPerson(t.db, y.b.personId, (trx) => trx.updateTable("cards").set({ friends_can_ask: true }).where("id", "=", y.b.cardId).execute());
    const ids = OrchestratorSendResponse.parse((await send({ method: "POST", url: routes.social.sendToOrchestrator.path, token: y.a.sessionToken, payload: { text: "How would Test B react to a Saturday demo day?" } })).body);
    const early = await send({ method: "POST", url: pathOf(routes.social.runPlan, ids.replyId), token: y.a.sessionToken });
    expect(early.statusCode).toBe(409);
    expect(ErrorBody.parse(early.body).code).toBe("plan_not_ready");
    await withPerson(t.db, y.a.personId, (trx) => trx.updateTable("orchestrator_messages")
      .set({ state: "planned", text: "I can ask Test B's agent.", action: "react", action_question: "How would you probably react to a Saturday demo day?", action_friend_name: "Test B", action_pair_id: y.pairId })
      .where("id", "=", ids.replyId).execute());
    const before = enqueuedJobs(t.app).length;

    const first = OrchestratorMessage.parse((await send({ method: "POST", url: pathOf(routes.social.runPlan, ids.replyId), token: y.a.sessionToken })).body);
    const second = OrchestratorMessage.parse((await send({ method: "POST", url: pathOf(routes.social.runPlan, ids.replyId), token: y.a.sessionToken })).body);

    expect(first).toMatchObject({ state: "running", action: "react", actionFriendName: "Test B" });
    expect(first.askId).not.toBeNull();
    expect(second).toEqual(first);
    expect(enqueuedJobs(t.app).slice(before)).toEqual([{ name: "run_ask", payload: { askId: first.askId, personId: y.a.personId } }]);
    const asks = await withPerson(t.db, y.a.personId, (trx) => trx.selectFrom("persona_asks").select(["mode", "pair_id", "text"]).where("id", "=", first.askId ?? "").execute());
    expect(asks).toEqual([{ mode: "react", pair_id: y.pairId, text: "How would you probably react to a Saturday demo day?" }]);
  });

  it("W7-API-T8: a refused run settles the reply as done with the refusal below its words, and starts no ask", async () => {
    await withPerson(t.db, x.b.personId, (trx) => trx.updateTable("cards").set({ friends_can_ask: false }).where("id", "=", x.b.cardId).execute());
    const ids = OrchestratorSendResponse.parse((await send({ method: "POST", url: routes.social.sendToOrchestrator.path, token: x.a.sessionToken, payload: { text: "How would Test B react if I left?" } })).body);
    await withPerson(t.db, x.a.personId, (trx) => trx.updateTable("orchestrator_messages")
      .set({ state: "planned", text: "I can ask Test B's agent.", action: "react", action_question: "How would you probably react if I left the team?", action_friend_name: "Test B", action_pair_id: x.pairId })
      .where("id", "=", ids.replyId).execute());

    const run = await send({ method: "POST", url: pathOf(routes.social.runPlan, ids.replyId), token: x.a.sessionToken });

    expect(run.statusCode).toBe(200);
    expect(OrchestratorMessage.parse(run.body)).toMatchObject({ state: "done", askId: null, text: "I can ask Test B's agent.\n\nTest B has not turned on friend asks." });
  });

  it("W7-API-T9: another person's reply is not_found, and the 41st message of a UTC day is refused", async () => {
    const ids = OrchestratorSendResponse.parse((await send({ method: "POST", url: routes.social.sendToOrchestrator.path, token: x.a.sessionToken, payload: { text: "Who could help me with sales?" } })).body);
    const foreign = await send({ method: "POST", url: pathOf(routes.social.runPlan, ids.replyId), token: y.b.sessionToken });
    expect(foreign.statusCode).toBe(404);

    const busy = await createTestPerson(t.db, "Test Busy");
    await withPerson(t.db, busy.personId, (trx) => trx.insertInto("orchestrator_messages").values(Array.from({ length: 40 }, () => ({ person_id: busy.personId, role: "you" as const, text: "hello there", state: "done" as const }))).execute());
    const capped = await send({ method: "POST", url: routes.social.sendToOrchestrator.path, token: busy.sessionToken, payload: { text: "one more" } });
    expect(capped.statusCode).toBe(429);
    expect(ErrorBody.parse(capped.body)).toEqual({ code: "orchestrator_daily_cap", message: "You have sent today's messages to Meety. Try again tomorrow." });
    const empty = await send({ method: "POST", url: routes.social.sendToOrchestrator.path, token: busy.sessionToken, payload: { text: "   " } });
    expect(empty.statusCode).toBe(400);
  });

  it("W7-CHECK-T4: when the queue refuses the ask's job, the plan goes back to planned with no ask, so the person can press again", async () => {
    const ids = OrchestratorSendResponse.parse((await send({ method: "POST", url: routes.social.sendToOrchestrator.path, token: y.a.sessionToken, payload: { text: "Who could help me with sales?" } })).body);
    await withPerson(t.db, y.a.personId, (trx) => trx.updateTable("orchestrator_messages")
      .set({ state: "planned", text: "I can run a help search.", action: "help", action_question: "Who could help me get better at sales?" })
      .where("id", "=", ids.replyId).execute());
    const refusingQueue = (): Promise<void> => Promise.reject(new ContractError("enqueue_failed", "The job queue did not accept the job. Retry the request."));

    const outcome = await runPlan({ db: t.db, now: () => new Date(), enqueue: refusingQueue }, { personId: y.a.personId, messageId: ids.replyId }).then(() => "settled", (error: unknown) => (error instanceof ContractError ? error.code : "other"));

    expect(outcome).toBe("enqueue_failed");
    const row = await withPerson(t.db, y.a.personId, (trx) => trx.selectFrom("orchestrator_messages").select(["state", "ask_id", "text"]).where("id", "=", ids.replyId).executeTakeFirstOrThrow());
    expect(row).toEqual({ state: "planned", ask_id: null, text: "I can run a help search." });
  });
});

describe("posts and the sample mark", () => {
  it("W7-SAMPLE-API-T1: GET /api/posts lists the newest posts of listed people but not your own, and a profile's posts route lists one person's", async () => {
    const hour = 3_600_000;
    const now = Date.now();
    await withPerson(t.db, y.b.personId, (trx) => trx.insertInto("posts").values([
      { person_id: y.b.personId, text: "Older post by B.", created_at: new Date(now - 2 * hour) },
      { person_id: y.b.personId, text: "Newer post by B.", created_at: new Date(now - hour) },
    ]).execute());
    await withPerson(t.db, x.a.personId, (trx) => trx.insertInto("posts").values({ person_id: x.a.personId, text: "A post by A.", created_at: new Date(now) }).execute());

    const feed = await send({ method: "GET", url: routes.social.listPosts.path, token: x.a.sessionToken });
    const ofB = await send({ method: "GET", url: pathOf(routes.social.listListingPosts, listingYb), token: x.a.sessionToken });
    const badId = await send({ method: "GET", url: pathOf(routes.social.listListingPosts, "not-a-uuid"), token: x.a.sessionToken });

    expect(feed.statusCode).toBe(200);
    expect(PostsView.parse(feed.body).posts.map((post) => [post.text, post.displayName, post.listingId, post.isSample])).toEqual([["Newer post by B.", "Test B", listingYb, false], ["Older post by B.", "Test B", listingYb, false]]);
    expect(PostsView.parse(ofB.body).posts.map((post) => post.text)).toEqual(["Newer post by B.", "Older post by B."]);
    expect(badId.statusCode).toBe(404);
  });

  it("W7-SAMPLE-API-T2: Explore and a profile carry the sample mark", async () => {
    await withPerson(t.db, y.b.personId, (trx) => trx.updateTable("people").set({ is_sample: true }).where("id", "=", y.b.personId).execute());

    const page = DirectoryPage.parse((await send({ method: "GET", url: routes.directory.browse.path, token: x.a.sessionToken })).body);
    const shown = await profile(x.a.sessionToken, listingYb);

    expect(page.listings.find((listing) => listing.listingId === listingYb)?.isSample).toBe(true);
    expect(shown.isSample).toBe(true);
    expect((await profile(y.b.sessionToken, listingXa)).isSample).toBe(false);
  });
});
