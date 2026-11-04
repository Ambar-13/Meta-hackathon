import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ContractError,
  DirectoryPage,
  ErrorBody,
  FEED_PAGE_SIZE,
  FeedPage,
  FriendRequestAcceptResponse,
  FriendRequestCreateResponse,
  FriendRequestsView,
  FriendsView,
  HomeView,
  MyPhoto,
  MyPostsView,
  OrchestratorMessage,
  OrchestratorSendResponse,
  OrchestratorThread,
  PostCreated,
  PostLiked,
  PostsView,
  PROFILE_PHOTO_MAX_BYTES,
  ProfileView,
  routes,
  SESSION_COOKIE,
  SHARES_PER_DAY,
  StoriesView,
} from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import {
  createPairedMeetingWithTurns,
  createTestPerson,
  type SeededMeeting,
} from "@meet-first/db/testing";
import { registerAsksRoutes } from "../asks/index.js";
import { registerDirectoryRoutes } from "../directory/index.js";
import { registerHomeRoutes } from "../home/index.js";
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
  t = await buildTestApp({
    routes: [registerHomeRoutes, registerDirectoryRoutes, registerAsksRoutes, registerSocialRoutes],
    env: { APP_ORIGIN: ORIGIN },
  });
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
  const row = await withPerson(t.db, personId, (trx) =>
    trx
      .insertInto("directory_listings")
      .values({ person_id: personId, card_id: cardId, line })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return row.id;
}

// One request: method, URL, the session token of the person making it, and a JSON payload.
type Call = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  token: string;
  payload?: unknown;
};

// Makes one request through the app's injector and returns the status and the parsed body.
async function send(call: Call): Promise<{ statusCode: number; body: unknown }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGIN,
    cookie: `${SESSION_COOKIE}=${call.token}`,
  };
  const payload = call.payload === undefined ? undefined : JSON.stringify(call.payload);
  const response = await t.app.inject({
    method: call.method,
    url: call.url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
  return {
    statusCode: response.statusCode,
    body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown),
  };
}

// The URL of a route with its :id filled in.
function pathOf(route: { path: string }, id: string): string {
  return route.path.replace(":id", id);
}

// Reads a profile as one person.
async function profile(token: string, listingId: string): Promise<ProfileView> {
  const response = await send({
    method: "GET",
    url: pathOf(routes.social.readProfile, listingId),
    token,
  });
  expect(response.statusCode).toBe(200);
  return ProfileView.parse(response.body);
}

describe("friend requests", () => {
  it("W7-API-T1: a request to a listing shows as requested to the sender, incoming to the receiver, and in both request lists", async () => {
    const sent = await send({
      method: "POST",
      url: routes.social.sendFriendRequest.path,
      token: x.a.sessionToken,
      payload: { listingId: listingYb },
    });
    expect(sent.statusCode).toBe(201);
    const { requestId } = FriendRequestCreateResponse.parse(sent.body);

    expect(await profile(x.a.sessionToken, listingYb)).toMatchObject({
      friendship: "requested",
      requestId,
      pairId: null,
      canAsk: false,
      displayName: "Test B",
    });
    expect(await profile(y.b.sessionToken, listingXa)).toMatchObject({
      friendship: "incoming",
      requestId,
    });
    const mine = FriendRequestsView.parse(
      (
        await send({
          method: "GET",
          url: routes.social.listFriendRequests.path,
          token: x.a.sessionToken,
        })
      ).body,
    );
    const theirs = FriendRequestsView.parse(
      (
        await send({
          method: "GET",
          url: routes.social.listFriendRequests.path,
          token: y.b.sessionToken,
        })
      ).body,
    );
    expect(
      mine.outgoing.map((view) => [view.requestId, view.otherName, view.otherListingId]),
    ).toEqual([[requestId, "Test B", listingYb]]);
    expect(
      theirs.incoming.map((view) => [view.requestId, view.otherName, view.otherListingId]),
    ).toEqual([[requestId, "Test A", listingXa]]);
  });

  it("W7-API-T2: the refusals answer with their codes: pending both ways, your own listing, already friends, a missing listing, a bad id", async () => {
    const again = await send({
      method: "POST",
      url: routes.social.sendFriendRequest.path,
      token: x.a.sessionToken,
      payload: { listingId: listingYb },
    });
    const reverse = await send({
      method: "POST",
      url: routes.social.sendFriendRequest.path,
      token: y.b.sessionToken,
      payload: { listingId: listingXa },
    });
    const self = await send({
      method: "POST",
      url: routes.social.sendFriendRequest.path,
      token: y.b.sessionToken,
      payload: { listingId: listingYb },
    });
    const friends = await send({
      method: "POST",
      url: routes.social.sendFriendRequest.path,
      token: y.a.sessionToken,
      payload: { listingId: listingYb },
    });
    const missing = await send({
      method: "POST",
      url: routes.social.sendFriendRequest.path,
      token: x.a.sessionToken,
      payload: { listingId: "00000000-0000-4000-8000-000000000999" },
    });
    const badId = await send({
      method: "GET",
      url: pathOf(routes.social.readProfile, "not-a-uuid"),
      token: x.a.sessionToken,
    });

    expect([
      again.statusCode,
      reverse.statusCode,
      self.statusCode,
      friends.statusCode,
      missing.statusCode,
      badId.statusCode,
    ]).toEqual([409, 409, 409, 409, 404, 404]);
    expect(ErrorBody.parse(again.body)).toEqual({
      code: "friend_request_pending",
      message: "You already asked this person. They have not answered yet.",
    });
    expect(ErrorBody.parse(reverse.body)).toEqual({
      code: "friend_request_pending",
      message:
        "This person already asked to be your friend. Accept their request on your Friends page.",
    });
    expect(ErrorBody.parse(self.body).code).toBe("friend_request_self");
    expect(ErrorBody.parse(friends.body)).toEqual({
      code: "already_friends",
      message: "You are already friends.",
    });
    expect(ErrorBody.parse(missing.body)).toEqual({
      code: "listing_not_found",
      message: "This person is no longer in Explore.",
    });
  });

  it("W7-API-T3: accepting makes the two friends both ways, with the listing on the friend, and a second answer is refused", async () => {
    const pending = FriendRequestsView.parse(
      (
        await send({
          method: "GET",
          url: routes.social.listFriendRequests.path,
          token: y.b.sessionToken,
        })
      ).body,
    ).incoming[0];
    const requestId = pending?.requestId ?? "";
    const bySender = await send({
      method: "POST",
      url: pathOf(routes.social.acceptFriendRequest, requestId),
      token: x.a.sessionToken,
    });
    const accepted = await send({
      method: "POST",
      url: pathOf(routes.social.acceptFriendRequest, requestId),
      token: y.b.sessionToken,
    });
    const twice = await send({
      method: "POST",
      url: pathOf(routes.social.acceptFriendRequest, requestId),
      token: y.b.sessionToken,
    });

    expect(bySender.statusCode).toBe(404);
    expect(ErrorBody.parse(bySender.body).code).toBe("friend_request_not_found");
    expect(accepted.statusCode).toBe(200);
    const { pairId } = FriendRequestAcceptResponse.parse(accepted.body);
    expect(twice.statusCode).toBe(409);
    expect(ErrorBody.parse(twice.body).code).toBe("friend_request_decided");
    const aFriends = FriendsView.parse(
      (await send({ method: "GET", url: routes.directory.friends.path, token: x.a.sessionToken }))
        .body,
    ).friends;
    const bFriends = FriendsView.parse(
      (await send({ method: "GET", url: routes.directory.friends.path, token: y.b.sessionToken }))
        .body,
    ).friends;
    expect(aFriends.find((friend) => friend.pairId === pairId)).toEqual({
      pairId,
      displayName: "Test B",
      canAsk: false,
      listingId: listingYb,
      isSample: false,
      photo: null,
    });
    expect(bFriends.find((friend) => friend.pairId === pairId)).toEqual({
      pairId,
      displayName: "Test A",
      canAsk: false,
      listingId: listingXa,
      isSample: false,
      photo: null,
    });
    expect(await profile(x.a.sessionToken, listingYb)).toMatchObject({
      friendship: "friends",
      pairId,
      requestId: null,
    });
    expect(
      FriendRequestsView.parse(
        (
          await send({
            method: "GET",
            url: routes.social.listFriendRequests.path,
            token: x.a.sessionToken,
          })
        ).body,
      ),
    ).toEqual({ incoming: [], outgoing: [] });
  });

  it("W7-API-T4: a decline removes the request from both lists, and the sender may ask again", async () => {
    const stranger = await createTestPerson(t.db, "Test C");
    const sent = FriendRequestCreateResponse.parse(
      (
        await send({
          method: "POST",
          url: routes.social.sendFriendRequest.path,
          token: stranger.sessionToken,
          payload: { listingId: listingXa },
        })
      ).body,
    );
    const declined = await send({
      method: "POST",
      url: pathOf(routes.social.declineFriendRequest, sent.requestId),
      token: x.a.sessionToken,
    });

    expect(declined.statusCode).toBe(204);
    expect(
      FriendRequestsView.parse(
        (
          await send({
            method: "GET",
            url: routes.social.listFriendRequests.path,
            token: stranger.sessionToken,
          })
        ).body,
      ).outgoing,
    ).toEqual([]);
    expect(await profile(stranger.sessionToken, listingXa)).toMatchObject({
      friendship: "none",
      requestId: null,
    });
    const again = await send({
      method: "POST",
      url: routes.social.sendFriendRequest.path,
      token: stranger.sessionToken,
      payload: { listingId: listingXa },
    });
    expect(again.statusCode).toBe(201);
  });

  it("W7-API-T5: your own listing reads as self, and a listing that left Explore is listing_not_found", async () => {
    expect(await profile(x.a.sessionToken, listingXa)).toMatchObject({
      friendship: "self",
      requestId: null,
      pairId: null,
    });
    const gone = await listMember(x.b.personId, x.b.cardId, "Here for a moment.");
    await withPerson(t.db, x.b.personId, (trx) =>
      trx.deleteFrom("directory_listings").where("id", "=", gone).execute(),
    );
    const response = await send({
      method: "GET",
      url: pathOf(routes.social.readProfile, gone),
      token: x.a.sessionToken,
    });
    expect(response.statusCode).toBe(404);
    expect(ErrorBody.parse(response.body)).toEqual({
      code: "listing_not_found",
      message: "This person is no longer in Explore.",
    });
  });
});

describe("the orchestrator chat", () => {
  it("W7-API-T6: a message writes the person's message and a thinking reply with the friend list, and enqueues orchestrate for the reply", async () => {
    const before = enqueuedJobs(t.app).length;
    const sent = await send({
      method: "POST",
      url: routes.social.sendToOrchestrator.path,
      token: y.a.sessionToken,
      payload: { text: "  How would Test B react if I moved our trip to March?  " },
    });

    expect(sent.statusCode).toBe(202);
    const ids = OrchestratorSendResponse.parse(sent.body);
    const thread = OrchestratorThread.parse(
      (await send({ method: "GET", url: routes.social.readThread.path, token: y.a.sessionToken }))
        .body,
    );
    expect(
      thread.messages.map((message) => [message.id, message.role, message.state, message.text]),
    ).toEqual([
      [ids.messageId, "you", "done", "How would Test B react if I moved our trip to March?"],
      [ids.replyId, "agent", "thinking", ""],
    ]);
    expect(enqueuedJobs(t.app).slice(before)).toEqual([
      { name: "orchestrate", payload: { messageId: ids.replyId, personId: y.a.personId } },
    ]);
    const snapshot = await withPerson(t.db, y.a.personId, (trx) =>
      trx
        .selectFrom("orchestrator_messages")
        .select("friends_snapshot")
        .where("id", "=", ids.replyId)
        .executeTakeFirstOrThrow(),
    );
    expect(snapshot.friends_snapshot).toEqual([
      { pairId: y.pairId, displayName: "Test B", canAsk: false },
    ]);
    expect(
      OrchestratorThread.parse(
        (await send({ method: "GET", url: routes.social.readThread.path, token: y.b.sessionToken }))
          .body,
      ).messages,
    ).toEqual([]);
  });

  it("W7-API-T7: running a plan starts the friend ask once; a second press returns the reply unchanged; a thinking reply is not ready", async () => {
    await withPerson(t.db, y.b.personId, (trx) =>
      trx
        .updateTable("cards")
        .set({ friends_can_ask: true })
        .where("id", "=", y.b.cardId)
        .execute(),
    );
    const ids = OrchestratorSendResponse.parse(
      (
        await send({
          method: "POST",
          url: routes.social.sendToOrchestrator.path,
          token: y.a.sessionToken,
          payload: { text: "How would Test B react to a Saturday demo day?" },
        })
      ).body,
    );
    const early = await send({
      method: "POST",
      url: pathOf(routes.social.runPlan, ids.replyId),
      token: y.a.sessionToken,
    });
    expect(early.statusCode).toBe(409);
    expect(ErrorBody.parse(early.body).code).toBe("plan_not_ready");
    await withPerson(t.db, y.a.personId, (trx) =>
      trx
        .updateTable("orchestrator_messages")
        .set({
          state: "planned",
          text: "I can ask Test B's agent.",
          action: "react",
          action_question: "How would you probably react to a Saturday demo day?",
          action_friend_name: "Test B",
          action_pair_id: y.pairId,
        })
        .where("id", "=", ids.replyId)
        .execute(),
    );
    const before = enqueuedJobs(t.app).length;

    const first = OrchestratorMessage.parse(
      (
        await send({
          method: "POST",
          url: pathOf(routes.social.runPlan, ids.replyId),
          token: y.a.sessionToken,
        })
      ).body,
    );
    const second = OrchestratorMessage.parse(
      (
        await send({
          method: "POST",
          url: pathOf(routes.social.runPlan, ids.replyId),
          token: y.a.sessionToken,
        })
      ).body,
    );

    expect(first).toMatchObject({ state: "running", action: "react", actionFriendName: "Test B" });
    expect(first.askId).not.toBeNull();
    expect(second).toEqual(first);
    expect(enqueuedJobs(t.app).slice(before)).toEqual([
      { name: "run_ask", payload: { askId: first.askId, personId: y.a.personId } },
    ]);
    const asks = await withPerson(t.db, y.a.personId, (trx) =>
      trx
        .selectFrom("persona_asks")
        .select(["mode", "pair_id", "text"])
        .where("id", "=", first.askId ?? "")
        .execute(),
    );
    expect(asks).toEqual([
      {
        mode: "react",
        pair_id: y.pairId,
        text: "How would you probably react to a Saturday demo day?",
      },
    ]);
  });

  it("W7-API-T8: a refused run settles the reply as done with the refusal below its words, and starts no ask", async () => {
    await withPerson(t.db, x.b.personId, (trx) =>
      trx
        .updateTable("cards")
        .set({ friends_can_ask: false })
        .where("id", "=", x.b.cardId)
        .execute(),
    );
    const ids = OrchestratorSendResponse.parse(
      (
        await send({
          method: "POST",
          url: routes.social.sendToOrchestrator.path,
          token: x.a.sessionToken,
          payload: { text: "How would Test B react if I left?" },
        })
      ).body,
    );
    await withPerson(t.db, x.a.personId, (trx) =>
      trx
        .updateTable("orchestrator_messages")
        .set({
          state: "planned",
          text: "I can ask Test B's agent.",
          action: "react",
          action_question: "How would you probably react if I left the team?",
          action_friend_name: "Test B",
          action_pair_id: x.pairId,
        })
        .where("id", "=", ids.replyId)
        .execute(),
    );

    const run = await send({
      method: "POST",
      url: pathOf(routes.social.runPlan, ids.replyId),
      token: x.a.sessionToken,
    });

    expect(run.statusCode).toBe(200);
    expect(OrchestratorMessage.parse(run.body)).toMatchObject({
      state: "done",
      askId: null,
      text: "I can ask Test B's agent.\n\nTest B has not turned on friend asks.",
    });
  });

  it("W7-API-T9: another person's reply is not_found, and the 41st message of a UTC day is refused", async () => {
    const ids = OrchestratorSendResponse.parse(
      (
        await send({
          method: "POST",
          url: routes.social.sendToOrchestrator.path,
          token: x.a.sessionToken,
          payload: { text: "Who could help me with sales?" },
        })
      ).body,
    );
    const foreign = await send({
      method: "POST",
      url: pathOf(routes.social.runPlan, ids.replyId),
      token: y.b.sessionToken,
    });
    expect(foreign.statusCode).toBe(404);

    const busy = await createTestPerson(t.db, "Test Busy");
    await withPerson(t.db, busy.personId, (trx) =>
      trx
        .insertInto("orchestrator_messages")
        .values(
          Array.from({ length: 40 }, () => ({
            person_id: busy.personId,
            role: "you" as const,
            text: "hello there",
            state: "done" as const,
          })),
        )
        .execute(),
    );
    const capped = await send({
      method: "POST",
      url: routes.social.sendToOrchestrator.path,
      token: busy.sessionToken,
      payload: { text: "one more" },
    });
    expect(capped.statusCode).toBe(429);
    expect(ErrorBody.parse(capped.body)).toEqual({
      code: "orchestrator_daily_cap",
      message: "You have sent today's messages to Meety. Try again tomorrow.",
    });
    const empty = await send({
      method: "POST",
      url: routes.social.sendToOrchestrator.path,
      token: busy.sessionToken,
      payload: { text: "   " },
    });
    expect(empty.statusCode).toBe(400);
  });

  it("W7-CHECK-T4: when the queue refuses the ask's job, the plan goes back to planned with no ask, so the person can press again", async () => {
    const ids = OrchestratorSendResponse.parse(
      (
        await send({
          method: "POST",
          url: routes.social.sendToOrchestrator.path,
          token: y.a.sessionToken,
          payload: { text: "Who could help me with sales?" },
        })
      ).body,
    );
    await withPerson(t.db, y.a.personId, (trx) =>
      trx
        .updateTable("orchestrator_messages")
        .set({
          state: "planned",
          text: "I can run a help search.",
          action: "help",
          action_question: "Who could help me get better at sales?",
        })
        .where("id", "=", ids.replyId)
        .execute(),
    );
    const refusingQueue = (): Promise<void> =>
      Promise.reject(
        new ContractError(
          "enqueue_failed",
          "The job queue did not accept the job. Retry the request.",
        ),
      );

    const outcome = await runPlan(
      { db: t.db, now: () => new Date(), enqueue: refusingQueue },
      { personId: y.a.personId, messageId: ids.replyId },
    ).then(
      () => "settled",
      (error: unknown) => (error instanceof ContractError ? error.code : "other"),
    );

    expect(outcome).toBe("enqueue_failed");
    const row = await withPerson(t.db, y.a.personId, (trx) =>
      trx
        .selectFrom("orchestrator_messages")
        .select(["state", "ask_id", "text"])
        .where("id", "=", ids.replyId)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ state: "planned", ask_id: null, text: "I can run a help search." });
  });
});

describe("posts and the sample mark", () => {
  it("W7-SAMPLE-API-T1: GET /api/posts lists the newest posts of listed people, your own among them marked as yours, and a profile's posts route lists one person's", async () => {
    const hour = 3_600_000;
    const now = Date.now();
    await withPerson(t.db, y.b.personId, (trx) =>
      trx
        .insertInto("posts")
        .values([
          {
            person_id: y.b.personId,
            text: "Older post by B.",
            created_at: new Date(now - 2 * hour),
          },
          { person_id: y.b.personId, text: "Newer post by B.", created_at: new Date(now - hour) },
        ])
        .execute(),
    );
    await withPerson(t.db, x.a.personId, (trx) =>
      trx
        .insertInto("posts")
        .values({ person_id: x.a.personId, text: "A post by A.", created_at: new Date(now) })
        .execute(),
    );

    const feed = await send({
      method: "GET",
      url: routes.social.listPosts.path,
      token: x.a.sessionToken,
    });
    const ofB = await send({
      method: "GET",
      url: pathOf(routes.social.listListingPosts, listingYb),
      token: x.a.sessionToken,
    });
    const badId = await send({
      method: "GET",
      url: pathOf(routes.social.listListingPosts, "not-a-uuid"),
      token: x.a.sessionToken,
    });

    expect(feed.statusCode).toBe(200);
    expect(
      PostsView.parse(feed.body).posts.map((post) => [
        post.text,
        post.displayName,
        post.listingId,
        post.isSample,
        post.isMine,
      ]),
    ).toEqual([
      ["A post by A.", "Test A", listingXa, false, true],
      ["Newer post by B.", "Test B", listingYb, false, false],
      ["Older post by B.", "Test B", listingYb, false, false],
    ]);
    expect(PostsView.parse(ofB.body).posts.map((post) => post.text)).toEqual([
      "Newer post by B.",
      "Older post by B.",
    ]);
    expect(badId.statusCode).toBe(404);
  });

  it("W7-SAMPLE-API-T2: Explore and a profile carry the sample mark", async () => {
    await withPerson(t.db, y.b.personId, (trx) =>
      trx.updateTable("people").set({ is_sample: true }).where("id", "=", y.b.personId).execute(),
    );

    const page = DirectoryPage.parse(
      (await send({ method: "GET", url: routes.directory.browse.path, token: x.a.sessionToken }))
        .body,
    );
    const shown = await profile(x.a.sessionToken, listingYb);

    expect(page.listings.find((listing) => listing.listingId === listingYb)?.isSample).toBe(true);
    expect(shown.isSample).toBe(true);
    expect((await profile(y.b.sessionToken, listingXa)).isSample).toBe(false);
  });

  it("W7-PHOTO-API-T1: a sample person's face shows in Explore, on their profile and among friends, their post carries its photo and the words for it, and a real person carries none", async () => {
    const mayaPost =
      "Founders: send me the one number you check every morning. Not the deck, just the number and why it matters to you.";
    await withPerson(t.db, y.b.personId, (trx) =>
      trx
        .updateTable("people")
        .set({ is_sample: true, display_name: "Maya" })
        .where("id", "=", y.b.personId)
        .execute(),
    );
    await withPerson(t.db, y.b.personId, (trx) =>
      trx
        .insertInto("posts")
        .values([
          { person_id: y.b.personId, text: mayaPost, created_at: new Date() },
          {
            person_id: y.b.personId,
            text: "A post with no photo.",
            created_at: new Date(Date.now() - 60_000),
          },
        ])
        .execute(),
    );
    try {
      const page = DirectoryPage.parse(
        (await send({ method: "GET", url: routes.directory.browse.path, token: x.a.sessionToken }))
          .body,
      );
      const pageOfYb = DirectoryPage.parse(
        (await send({ method: "GET", url: routes.directory.browse.path, token: y.b.sessionToken }))
          .body,
      );
      const feed = PostsView.parse(
        (await send({ method: "GET", url: routes.social.listPosts.path, token: x.a.sessionToken }))
          .body,
      ).posts;
      const friendsOfYa = FriendsView.parse(
        (await send({ method: "GET", url: routes.directory.friends.path, token: y.a.sessionToken }))
          .body,
      ).friends;
      const withPhoto = feed.find((post) => post.text === mayaPost);
      const withoutPhoto = feed.find((post) => post.text === "A post with no photo.");

      expect(page.listings.find((listing) => listing.listingId === listingYb)?.photo).toBe(
        "faces/maya",
      );
      expect(
        pageOfYb.listings.find((listing) => listing.listingId === listingXa)?.photo,
      ).toBeNull();
      expect((await profile(x.a.sessionToken, listingYb)).photo).toBe("faces/maya");
      expect((await profile(y.b.sessionToken, listingXa)).photo).toBeNull();
      expect(withPhoto).toMatchObject({
        authorPhoto: "faces/maya",
        photo: "maya-morning",
        photoAlt: "A latte on a book by a sunny window.",
      });
      expect(withoutPhoto).toMatchObject({
        authorPhoto: "faces/maya",
        photo: null,
        photoAlt: null,
      });
      expect(friendsOfYa.find((friend) => friend.displayName === "Maya")).toMatchObject({
        isSample: true,
        photo: "faces/maya",
      });
    } finally {
      await withPerson(t.db, y.b.personId, (trx) =>
        trx
          .updateTable("people")
          .set({ is_sample: false, display_name: "Test B" })
          .where("id", "=", y.b.personId)
          .execute(),
      );
    }
  });
});

describe("Edit profile: the name and the photo", () => {
  // A stand-in for a JPEG: the start and end marks around some bytes, which is all the api checks.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(200, 9),
    Buffer.from([0xff, 0xd9]),
  ]);

  // Sends raw bytes to a route as one person, with this content type.
  async function sendBytes(call: {
    method: "PUT" | "GET" | "DELETE";
    url: string;
    token: string | null;
    type?: string;
    body?: Buffer;
  }) {
    const headers: Record<string, string> = { origin: ORIGIN };
    if (call.token !== null) headers["cookie"] = `${SESSION_COOKIE}=${call.token}`;
    if (call.type !== undefined) headers["content-type"] = call.type;
    return t.app.inject({
      method: call.method,
      url: call.url,
      headers,
      ...(call.body === undefined ? {} : { payload: call.body }),
    });
  }

  it("W7-PHOTO-API-T2: a JPEG put up is served as image/jpeg to someone else signed in and shows on the listing, the profile, the friends list and the person's own home; taking it down ends all of that", async () => {
    const put = await sendBytes({
      method: "PUT",
      url: routes.people.uploadPhoto.path,
      token: y.b.sessionToken,
      type: "image/jpeg",
      body: jpeg,
    });
    const key = MyPhoto.parse(put.json()).photo ?? "";
    const photoPath = pathOf(routes.people.readPhoto, key.replace("photos/", ""));
    const served = await sendBytes({ method: "GET", url: photoPath, token: x.a.sessionToken });

    expect(put.statusCode).toBe(200);
    expect(key).toMatch(/^photos\/[0-9a-f-]{36}$/);
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("image/jpeg");
    expect(served.rawPayload.equals(jpeg)).toBe(true);
    const page = DirectoryPage.parse(
      (await send({ method: "GET", url: routes.directory.browse.path, token: x.a.sessionToken }))
        .body,
    );
    expect(page.listings.find((listing) => listing.listingId === listingYb)?.photo).toBe(key);
    expect((await profile(x.a.sessionToken, listingYb)).photo).toBe(key);
    const friendsOfYa = FriendsView.parse(
      (await send({ method: "GET", url: routes.directory.friends.path, token: y.a.sessionToken }))
        .body,
    ).friends;
    expect(friendsOfYa.find((friend) => friend.pairId === y.pairId)?.photo).toBe(key);
    expect(
      HomeView.parse(
        (await send({ method: "GET", url: routes.people.readHome.path, token: y.b.sessionToken }))
          .body,
      ).photo,
    ).toBe(key);

    const removed = await sendBytes({
      method: "DELETE",
      url: routes.people.removePhoto.path,
      token: y.b.sessionToken,
    });
    expect(MyPhoto.parse(removed.json()).photo).toBeNull();
    expect(
      (await sendBytes({ method: "GET", url: photoPath, token: x.a.sessionToken })).statusCode,
    ).toBe(404);
    expect((await profile(x.a.sessionToken, listingYb)).photo).toBeNull();
  });

  it("W7-PHOTO-API-T3: bytes that are not a JPEG are 400, a body over the limit is 413, a photo needs a session to read, and an id that is not a photo is 404", async () => {
    const notJpeg = await sendBytes({
      method: "PUT",
      url: routes.people.uploadPhoto.path,
      token: y.b.sessionToken,
      type: "image/jpeg",
      body: Buffer.alloc(200, 1),
    });
    const tooBig = await sendBytes({
      method: "PUT",
      url: routes.people.uploadPhoto.path,
      token: y.b.sessionToken,
      type: "image/jpeg",
      body: Buffer.concat([jpeg, Buffer.alloc(PROFILE_PHOTO_MAX_BYTES, 0)]),
    });
    const noSession = await sendBytes({
      method: "GET",
      url: pathOf(routes.people.readPhoto, "00000000-0000-4000-8000-000000000999"),
      token: null,
    });
    const unknown = await sendBytes({
      method: "GET",
      url: pathOf(routes.people.readPhoto, "00000000-0000-4000-8000-000000000999"),
      token: x.a.sessionToken,
    });
    const notAnId = await sendBytes({
      method: "GET",
      url: pathOf(routes.people.readPhoto, "not-a-uuid"),
      token: x.a.sessionToken,
    });

    expect(notJpeg.statusCode).toBe(400);
    expect(tooBig.statusCode).toBe(413);
    expect(noSession.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(404);
    expect(notAnId.statusCode).toBe(404);
  });

  it("W7-NAME-API-T1: a new name is saved trimmed and shows on the home view and in Explore; an empty or too long name is 400", async () => {
    const renamed = await send({
      method: "PUT",
      url: routes.people.updateName.path,
      token: y.b.sessionToken,
      payload: { displayName: "  Bea Lin  " },
    });
    const empty = await send({
      method: "PUT",
      url: routes.people.updateName.path,
      token: y.b.sessionToken,
      payload: { displayName: "   " },
    });
    const long = await send({
      method: "PUT",
      url: routes.people.updateName.path,
      token: y.b.sessionToken,
      payload: { displayName: "a".repeat(81) },
    });
    try {
      expect(renamed.statusCode).toBe(200);
      expect(renamed.body).toEqual({ displayName: "Bea Lin" });
      expect(
        HomeView.parse(
          (await send({ method: "GET", url: routes.people.readHome.path, token: y.b.sessionToken }))
            .body,
        ).displayName,
      ).toBe("Bea Lin");
      const page = DirectoryPage.parse(
        (await send({ method: "GET", url: routes.directory.browse.path, token: x.a.sessionToken }))
          .body,
      );
      expect(page.listings.find((listing) => listing.listingId === listingYb)?.displayName).toBe(
        "Bea Lin",
      );
      expect(empty.statusCode).toBe(400);
      expect(long.statusCode).toBe(400);
    } finally {
      await send({
        method: "PUT",
        url: routes.people.updateName.path,
        token: y.b.sessionToken,
        payload: { displayName: "Test B" },
      });
    }
  });
});

describe("sharing posts and stories, and likes", () => {
  // The smallest bytes that pass as a JPEG: FF D8 FF at the start, FF D9 at the end.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    Buffer.alloc(300, 7),
    Buffer.from([0xff, 0xd9]),
  ]);

  // Shares one post or story as one person and returns the response.
  async function share(
    token: string,
    body: { kind: "post" | "story"; text: string; photo: string | null },
  ): Promise<{ statusCode: number; body: unknown }> {
    return send({ method: "POST", url: routes.social.createPost.path, token, payload: body });
  }

  // The feed as one person sees it.
  async function feedOf(token: string): Promise<PostsView["posts"]> {
    return PostsView.parse(
      (await send({ method: "GET", url: routes.social.listPosts.path, token })).body,
    ).posts;
  }

  // The stories as one person sees them.
  async function storiesOf(token: string): Promise<StoriesView["stories"]> {
    return StoriesView.parse(
      (await send({ method: "GET", url: routes.social.listStories.path, token })).body,
    ).stories;
  }

  // The status of reading one photo by id as one person.
  async function photoStatus(
    token: string,
    id: string,
  ): Promise<{ statusCode: number; bytes: Buffer }> {
    const response = await t.app.inject({
      method: "GET",
      url: pathOf(routes.people.readPhoto, id),
      headers: { origin: ORIGIN, cookie: `${SESSION_COOKIE}=${token}` },
    });
    return { statusCode: response.statusCode, bytes: response.rawPayload };
  }

  it("W7-SHARE-API-T1: a post of words shows on your own Posts list and, once you are listed, in everyone's feed marked as yours to you; only you can delete it", async () => {
    const shared = await share(x.a.sessionToken, {
      kind: "post",
      text: "  Shipping the stories row tonight.  ",
      photo: null,
    });
    const created = PostCreated.parse(shared.body);
    const mine = MyPostsView.parse(
      (await send({ method: "GET", url: routes.social.listMyPosts.path, token: x.a.sessionToken }))
        .body,
    ).posts;

    expect(shared.statusCode).toBe(201);
    expect(created).toMatchObject({ kind: "post", expiresAt: null });
    expect(mine[0]).toMatchObject({
      postId: created.postId,
      text: "Shipping the stories row tonight.",
      photo: null,
    });
    expect(
      (await feedOf(x.a.sessionToken)).find((post) => post.postId === created.postId),
    ).toMatchObject({ isMine: true, isLiked: false, listingId: listingXa, photo: null });
    expect(
      (await feedOf(y.b.sessionToken)).find((post) => post.postId === created.postId),
    ).toMatchObject({ isMine: false, displayName: "Test A" });
    const byOther = await send({
      method: "DELETE",
      url: pathOf(routes.social.deletePost, created.postId),
      token: y.b.sessionToken,
    });
    const byOwner = await send({
      method: "DELETE",
      url: pathOf(routes.social.deletePost, created.postId),
      token: x.a.sessionToken,
    });
    expect(byOther.statusCode).toBe(404);
    expect(byOwner.statusCode).toBe(204);
    expect((await feedOf(y.b.sessionToken)).some((post) => post.postId === created.postId)).toBe(
      false,
    );
  });

  it("W7-SHARE-API-T2: a photo post with no words is served to someone else signed in by its id; a body with neither, bytes that are not a JPEG, and a bad kind are 400", async () => {
    const shared = PostCreated.parse(
      (await share(y.b.sessionToken, { kind: "post", text: "", photo: jpeg.toString("base64") }))
        .body,
    );
    const read = await photoStatus(x.a.sessionToken, shared.postId);
    const empty = await share(y.b.sessionToken, { kind: "post", text: "   ", photo: null });
    const notJpeg = await share(y.b.sessionToken, {
      kind: "post",
      text: "",
      photo: Buffer.alloc(300, 1).toString("base64"),
    });
    const badKind = await send({
      method: "POST",
      url: routes.social.createPost.path,
      token: y.b.sessionToken,
      payload: { kind: "reel", text: "Hi", photo: null },
    });

    expect(read.statusCode).toBe(200);
    expect(read.bytes.equals(jpeg)).toBe(true);
    expect(
      (await feedOf(x.a.sessionToken)).find((post) => post.postId === shared.postId),
    ).toMatchObject({ photo: `photos/${shared.postId}`, text: "" });
    expect([empty.statusCode, notJpeg.statusCode, badKind.statusCode]).toEqual([400, 400, 400]);
    await send({
      method: "DELETE",
      url: pathOf(routes.social.deletePost, shared.postId),
      token: y.b.sessionToken,
    });
    expect((await photoStatus(x.a.sessionToken, shared.postId)).statusCode).toBe(404);
  });

  it("W7-SHARE-API-T3: a story shows first to its writer and to others for 24 hours, never in a feed or on a Posts list, and its photo goes when it expires", async () => {
    const created = PostCreated.parse(
      (
        await share(x.a.sessionToken, {
          kind: "story",
          text: "Sunrise run.",
          photo: jpeg.toString("base64"),
        })
      ).body,
    );
    const hours = (Date.parse(created.expiresAt ?? "") - Date.now()) / 3_600_000;
    const ownRow = await storiesOf(x.a.sessionToken);
    const otherRow = await storiesOf(y.b.sessionToken);

    expect(created.kind).toBe("story");
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    expect(ownRow[0]).toMatchObject({
      storyId: created.postId,
      isMine: true,
      listingId: listingXa,
      text: "Sunrise run.",
      photo: `photos/${created.postId}`,
    });
    expect(otherRow.find((story) => story.storyId === created.postId)).toMatchObject({
      isMine: false,
      displayName: "Test A",
    });
    expect((await feedOf(y.b.sessionToken)).some((post) => post.postId === created.postId)).toBe(
      false,
    );
    expect(
      MyPostsView.parse(
        (
          await send({
            method: "GET",
            url: routes.social.listMyPosts.path,
            token: x.a.sessionToken,
          })
        ).body,
      ).posts.some((post) => post.postId === created.postId),
    ).toBe(false);
    expect((await photoStatus(y.b.sessionToken, created.postId)).statusCode).toBe(200);

    await withPerson(t.db, x.a.personId, (trx) =>
      trx
        .updateTable("posts")
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where("id", "=", created.postId)
        .execute(),
    );
    expect(
      (await storiesOf(y.b.sessionToken)).some((story) => story.storyId === created.postId),
    ).toBe(false);
    expect((await photoStatus(y.b.sessionToken, created.postId)).statusCode).toBe(404);
  });

  it("W7-SHARE-API-T4: someone not in Explore sees their own post and story, with no listing, and nobody else sees either", async () => {
    const post = PostCreated.parse(
      (await share(y.a.sessionToken, { kind: "post", text: "Not listed yet.", photo: null })).body,
    );
    const story = PostCreated.parse(
      (await share(y.a.sessionToken, { kind: "story", text: "Still not listed.", photo: null }))
        .body,
    );

    expect(
      MyPostsView.parse(
        (
          await send({
            method: "GET",
            url: routes.social.listMyPosts.path,
            token: y.a.sessionToken,
          })
        ).body,
      ).posts[0]?.postId,
    ).toBe(post.postId);
    expect((await storiesOf(y.a.sessionToken))[0]).toMatchObject({
      storyId: story.postId,
      isMine: true,
      listingId: null,
    });
    expect((await feedOf(x.a.sessionToken)).some((row) => row.postId === post.postId)).toBe(false);
    expect((await storiesOf(x.a.sessionToken)).some((row) => row.storyId === story.postId)).toBe(
      false,
    );
  });

  it("W7-SHARE-API-T5: a sample person's newest photo post shows as their story, after real people's, with no end", async () => {
    const mayaPost =
      "Founders: send me the one number you check every morning. Not the deck, just the number and why it matters to you.";
    await withPerson(t.db, y.b.personId, (trx) =>
      trx
        .updateTable("people")
        .set({ is_sample: true, display_name: "Maya" })
        .where("id", "=", y.b.personId)
        .execute(),
    );
    const real = PostCreated.parse(
      (await share(x.a.sessionToken, { kind: "story", text: "A real story.", photo: null })).body,
    );
    try {
      const stories = await storiesOf(x.b.sessionToken);
      const maya = stories.filter((story) => story.displayName === "Maya");

      expect(maya).toHaveLength(1);
      expect(maya[0]).toMatchObject({
        isSample: true,
        isMine: false,
        listingId: listingYb,
        photo: "maya-morning",
        authorPhoto: "faces/maya",
        expiresAt: null,
        text: mayaPost,
      });
      expect(stories.findIndex((story) => story.storyId === real.postId)).toBeLessThan(
        stories.findIndex((story) => story.displayName === "Maya"),
      );
    } finally {
      await withPerson(t.db, y.b.personId, (trx) =>
        trx
          .updateTable("people")
          .set({ is_sample: false, display_name: "Test B" })
          .where("id", "=", y.b.personId)
          .execute(),
      );
    }
  });

  it("W7-LIKE-API-T1: a like shows only to the person who liked, liking twice changes nothing, unliking takes it away, and a post you are not shown cannot be liked", async () => {
    const post = PostCreated.parse(
      (
        await share(y.b.sessionToken, {
          kind: "post",
          text: "Like me if you also plan on Sundays.",
          photo: null,
        })
      ).body,
    );
    const story = PostCreated.parse(
      (await share(y.b.sessionToken, { kind: "story", text: "A story, not a post.", photo: null }))
        .body,
    );
    const hidden = PostCreated.parse(
      (
        await share(y.a.sessionToken, {
          kind: "post",
          text: "A post of someone not listed.",
          photo: null,
        })
      ).body,
    );
    const likePath = pathOf(routes.social.likePost, post.postId);

    const liked = await send({ method: "PUT", url: likePath, token: x.a.sessionToken });
    const again = await send({ method: "PUT", url: likePath, token: x.a.sessionToken });
    expect([liked.statusCode, again.statusCode]).toEqual([200, 200]);
    expect(PostLiked.parse(liked.body)).toEqual({ postId: post.postId, isLiked: true });
    expect(
      (await feedOf(x.a.sessionToken)).find((row) => row.postId === post.postId)?.isLiked,
    ).toBe(true);
    expect(
      (await feedOf(y.b.sessionToken)).find((row) => row.postId === post.postId)?.isLiked,
    ).toBe(false);

    const unliked = await send({ method: "DELETE", url: likePath, token: x.a.sessionToken });
    expect(PostLiked.parse(unliked.body)).toEqual({ postId: post.postId, isLiked: false });
    expect(
      (await feedOf(x.a.sessionToken)).find((row) => row.postId === post.postId)?.isLiked,
    ).toBe(false);
    const statuses = await Promise.all(
      [story.postId, hidden.postId, "00000000-0000-4000-8000-000000000999", "not-a-uuid"].map(
        async (id) =>
          (
            await send({
              method: "PUT",
              url: pathOf(routes.social.likePost, id),
              token: x.a.sessionToken,
            })
          ).statusCode,
      ),
    );
    expect(statuses).toEqual([404, 404, 404, 404]);
  });

  it("W7-SHARE-API-T6: after the day's shares, one more is refused with post_daily_cap", async () => {
    await withPerson(t.db, x.b.personId, (trx) =>
      trx
        .insertInto("posts")
        .values(
          [...Array(SHARES_PER_DAY).keys()].map((index) => ({
            person_id: x.b.personId,
            text: `Share ${String(index)}`,
          })),
        )
        .execute(),
    );
    const refused = await share(x.b.sessionToken, {
      kind: "post",
      text: "One too many.",
      photo: null,
    });

    expect(refused.statusCode).toBe(429);
    expect(ErrorBody.parse(refused.body).code).toBe("post_daily_cap");
  });

  it("W7-SHARE-API-T7: a share waits until the sharer's other shares are done before it counts the day's, so shares sent at once cannot pass the cap together", async () => {
    const rush = await createTestPerson(t.db, "Rush");
    let isDone = false;
    let shared: Promise<{ statusCode: number; body: unknown }> | undefined;
    await withPerson(t.db, rush.personId, async (trx) => {
      await trx
        .selectFrom("people")
        .select("id")
        .where("id", "=", rush.personId)
        .forNoKeyUpdate()
        .execute();
      shared = share(rush.sessionToken, {
        kind: "post",
        text: "Waits its turn.",
        photo: null,
      }).then((response) => {
        isDone = true;
        return response;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(isDone).toBe(false);
    });

    expect((await shared)?.statusCode).toBe(201);
  });
});

describe("Home's feed a page at a time", () => {
  // A friend pair listed in Explore, and someone listed who is friends with neither.
  let pair: SeededMeeting;
  let stranger: SeededMeeting;
  let listingFriend: string;
  let listingStranger: string;

  beforeAll(async () => {
    pair = await createPairedMeetingWithTurns(t.db);
    stranger = await createPairedMeetingWithTurns(t.db);
    await listMember(pair.a.personId, pair.a.cardId, "Reads the feed.");
    listingFriend = await listMember(pair.b.personId, pair.b.cardId, "Posts a lot.");
    listingStranger = await listMember(
      stranger.a.personId,
      stranger.a.cardId,
      "A stranger who posts.",
    );
  });

  // One page of the feed as pair.a reads it.
  async function feedPage(query: string): Promise<{ statusCode: number; page: FeedPage | null }> {
    const response = await send({
      method: "GET",
      url: `${routes.social.listFeed.path}?${query}`,
      token: pair.a.sessionToken,
    });
    return {
      statusCode: response.statusCode,
      page: response.statusCode === 200 ? FeedPage.parse(response.body) : null,
    };
  }

  // One page of the feed that must answer 200.
  async function okPage(query: string): Promise<FeedPage> {
    const { page } = await feedPage(query);
    if (page === null) throw new Error(`the feed page ${query} did not answer 200`);
    return page;
  }

  it("W7-FEED-API-T1: friends' posts and your own come first, a page at a time with no post lost between pages, even two in the same millisecond; everyone else's come apart", async () => {
    const minute = 60_000;
    const base = Date.parse("2026-11-03T10:00:00.000Z");
    const friendPosts = [...Array(8).keys()].map((index) => ({
      person_id: pair.b.personId,
      text: `Friend post ${String(index)}`,
      created_at: new Date(base + (20 - index) * minute),
    }));
    await withPerson(t.db, pair.b.personId, (trx) =>
      trx
        .insertInto("posts")
        .values([
          ...friendPosts,
          {
            person_id: pair.b.personId,
            text: "Same millisecond, later",
            created_at: "2026-11-03T10:00:00.123456Z",
          },
          {
            person_id: pair.b.personId,
            text: "Same millisecond, earlier",
            created_at: "2026-11-03T10:00:00.123300Z",
          },
        ])
        .execute(),
    );
    await withPerson(t.db, pair.a.personId, (trx) =>
      trx
        .insertInto("posts")
        .values({
          person_id: pair.a.personId,
          text: "My own post",
          created_at: new Date(base + 30 * minute),
        })
        .execute(),
    );
    await withPerson(t.db, stranger.a.personId, (trx) =>
      trx
        .insertInto("posts")
        .values({
          person_id: stranger.a.personId,
          text: "A stranger's post",
          created_at: new Date(base + 40 * minute),
        })
        .execute(),
    );

    const first = await okPage("scope=friends");
    if (first.next === null) throw new Error("the first page of friends' posts has no next page");
    const second = await okPage(
      `scope=friends&before=${encodeURIComponent(first.next.before)}&beforeId=${first.next.beforeId}`,
    );
    const others = await okPage("scope=others");
    const friendsTexts = [...first.posts, ...second.posts].map((post) => post.text);

    expect(first.posts).toHaveLength(FEED_PAGE_SIZE);
    expect(first.posts[0]).toMatchObject({ text: "My own post", isMine: true });
    expect(friendsTexts).toEqual([
      "My own post",
      ...friendPosts.map((post) => post.text),
      "Same millisecond, later",
      "Same millisecond, earlier",
    ]);
    expect(second.next).toBeNull();
    expect(second.posts.every((post) => post.listingId === listingFriend)).toBe(true);
    expect(
      others.posts.some(
        (post) => post.text === "A stranger's post" && post.listingId === listingStranger,
      ),
    ).toBe(true);
    expect(
      others.posts.some((post) => post.listingId === listingFriend || post.isMine === true),
    ).toBe(false);
  });

  it("W7-FEED-API-T2: a query with no part, an unknown part, or a start with only half its cursor is 400", async () => {
    const statuses = await Promise.all(
      [
        "",
        "scope=everyone",
        "scope=friends&before=2026-11-03T10:00:00.000Z",
        `scope=others&beforeId=${pair.pairId}`,
      ].map(async (query) => (await feedPage(query)).statusCode),
    );

    expect(statuses).toEqual([400, 400, 400, 400]);
  });
});
