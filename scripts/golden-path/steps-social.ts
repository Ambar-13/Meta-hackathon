// Steps 22 and 23: a new person C asks to be B's friend from B's profile and B accepts; then A asks the orchestrator how B
// would probably react, runs the plan it gives, and gets B's persona's answer through the friend ask it starts.
import { ErrorBody, routes, type AskView, type OrchestratorMessage } from "@meet-first/contracts";
import { ORCHESTRATOR_MESSAGE, REACT_ASK_TEXT } from "./fixtures.js";
import { PersonClient } from "./person-client.js";
import {
  check,
  finishStep,
  need,
  pollUntil,
  routePath,
  type Assertion,
  type RunState,
  type StepResult,
} from "./report.js";
import { signUpBody } from "./steps-people-and-sources.js";

// The orchestrator's reply may take 120 s on a live run: one model call at effort low, queued behind the worker's other jobs.
const REPLY_WAIT_MS = 120_000;
const REPLY_POLL_MS = 1_500;
// An ask may take 180 s, as in step 20.
const ASK_WAIT_MS = 180_000;
const ASK_POLL_MS = 3_000;
// The states an ask stops in.
const ASK_FINAL_STATES = new Set(["done", "refused", "failed"]);

// Reads one person's profile of a listing.
async function readProfile(
  client: PersonClient,
  listingId: string,
): Promise<{ friendship: string; requestId: string | null; pairId: string | null }> {
  const route = routes.social.readProfile;
  return (
    await client.json({
      method: "GET",
      path: routePath(route.path, { id: listingId }),
      expect: 200,
      schema: route.response,
    })
  ).body;
}

// Reads one person's friends, by display name and listing.
async function readFriends(
  client: PersonClient,
): Promise<Array<{ displayName: string; listingId: string | null }>> {
  const reply = await client.json({
    method: "GET",
    path: routes.directory.friends.path,
    expect: 200,
    schema: routes.directory.friends.response,
  });
  return reply.body.friends
    .map((friend) => ({ displayName: friend.displayName, listingId: friend.listingId }))
    .sort((first, second) => first.displayName.localeCompare(second.displayName));
}

// Step 22: C signs up, finds B's profile, sends a friend request; B sees it incoming and accepts; each now lists the other as a friend,
// and A, already B's friend by invite, is refused a request.
export async function step22FriendRequest(run: RunState): Promise<StepResult> {
  const listingB = need(run.ids.listingB, "listingB");
  const c = new PersonClient("C", run.options.base);
  const created = routes.people.createPerson;
  const signedUp = await c.json({
    method: created.method,
    path: created.path,
    body: signUpBody("C"),
    expect: 201,
    schema: created.response,
  });
  run.ids.personC = signedUp.body.personId;
  const before = await readProfile(c, listingB);
  const sent = await c.json({
    method: "POST",
    path: routes.social.sendFriendRequest.path,
    body: { listingId: listingB },
    expect: 201,
    schema: routes.social.sendFriendRequest.response,
  });
  const waiting = await readProfile(c, listingB);
  const requests = await run.b.json({
    method: "GET",
    path: routes.social.listFriendRequests.path,
    expect: 200,
    schema: routes.social.listFriendRequests.response,
  });
  const incoming = requests.body.incoming.map((view) => ({
    requestId: view.requestId,
    otherName: view.otherName,
    otherListingId: view.otherListingId,
  }));
  const acceptRoute = routes.social.acceptFriendRequest;
  const accepted = await run.b.json({
    method: "POST",
    path: routePath(acceptRoute.path, { id: sent.body.requestId }),
    expect: 200,
    schema: acceptRoute.response,
  });
  const after = await readProfile(c, listingB);
  const refused = await run.a.json({
    method: "POST",
    path: routes.social.sendFriendRequest.path,
    body: { listingId: listingB },
    expect: 409,
    schema: ErrorBody,
  });
  const assertions: Assertion[] = [
    check("C starts with no friendship to B", "none", before.friendship),
    check(
      "C's profile of B shows the request as sent",
      ["requested", sent.body.requestId],
      [waiting.friendship, waiting.requestId],
    ),
    check(
      "B sees C's request incoming, with no listing for C",
      [{ requestId: sent.body.requestId, otherName: "C", otherListingId: null }],
      incoming,
    ),
    check(
      "after B accepts, C's profile of B shows friends by the new pair",
      ["friends", accepted.body.pairId],
      [after.friendship, after.pairId],
    ),
    check(
      "C's friends are B, with B's listing",
      [{ displayName: "B", listingId: listingB }],
      await readFriends(c),
    ),
    check(
      "B's friends are A and C",
      ["A", "C"],
      (await readFriends(run.b)).map((friend) => friend.displayName),
    ),
    check("A, already B's friend, is refused a request", "already_friends", refused.body.code),
  ];
  return finishStep(22, "friend-request", {
    rows: ["wave 7: friend requests"],
    detail: "C and B are friends by an accepted request",
    assertions,
  });
}

// Reads A's reply until the orchestrate job has planned it.
async function waitForReply(
  run: RunState,
  replyId: string,
): Promise<OrchestratorMessage | undefined> {
  const read = async () =>
    (
      await run.a.json({
        method: "GET",
        path: routes.social.readThread.path,
        expect: 200,
        schema: routes.social.readThread.response,
      })
    ).body.messages.find((message) => message.id === replyId);
  return pollUntil(read, (message) => message !== undefined && message.state !== "thinking", {
    timeoutMs: REPLY_WAIT_MS,
    intervalMs: REPLY_POLL_MS,
  });
}

// Reads one ask until it stops.
async function waitForAsk(client: PersonClient, askId: string): Promise<AskView> {
  const path = routePath(routes.asks.readAsk.path, { id: askId });
  return pollUntil(
    async () =>
      (
        await client.json({
          method: "GET",
          path,
          expect: 200,
          schema: routes.asks.readAsk.response,
        })
      ).body,
    (view) => ASK_FINAL_STATES.has(view.state),
    { timeoutMs: ASK_WAIT_MS, intervalMs: ASK_POLL_MS },
  );
}

// Step 23: A asks the orchestrator to ask B the step 20 question; the reply is a planned friend ask about B; A runs it, the second press
// changes nothing, and the friend ask finishes with B's persona's answer.
export async function step23Orchestrator(run: RunState): Promise<StepResult> {
  const sent = await run.a.json({
    method: "POST",
    path: routes.social.sendToOrchestrator.path,
    body: { text: ORCHESTRATOR_MESSAGE },
    expect: 202,
    schema: routes.social.sendToOrchestrator.response,
  });
  run.ids.orchestratorReplyId = sent.body.replyId;
  const reply = await waitForReply(run, sent.body.replyId);
  const runRoute = routes.social.runPlan;
  const runPath = routePath(runRoute.path, { id: sent.body.replyId });
  const ran = await run.a.json({
    method: "POST",
    path: runPath,
    expect: 200,
    schema: runRoute.response,
  });
  const again = await run.a.json({
    method: "POST",
    path: runPath,
    expect: 200,
    schema: runRoute.response,
  });
  const askId = need(ran.body.askId ?? undefined, "orchestratorAskId");
  run.ids.orchestratorAskId = askId;
  const view = await waitForAsk(run.a, askId);
  const assertions: Assertion[] = [
    check(
      "the reply is a planned friend ask about B",
      ["planned", "react", "B"],
      [reply?.state, reply?.action, reply?.actionFriendName],
    ),
    check(
      "the plan carries the quoted question word for word",
      REACT_ASK_TEXT,
      reply?.actionQuestion,
    ),
    check(
      "running the plan starts one ask",
      ["running", true],
      [ran.body.state, ran.body.askId !== null],
    ),
    check("a second press returns the same reply and ask", ran.body, again.body),
    check("the friend ask is done", "done", view.state),
    check(
      "the ask is about B, with one answer from B's persona",
      ["B", ["B"]],
      [view.aboutName, view.answers.map((answer) => answer.displayName)],
    ),
  ];
  return finishStep(23, "orchestrator", {
    rows: ["wave 7: the orchestrator chat"],
    detail: `orchestrator reply ${reply?.state ?? "missing"}; ask ${view.state}`,
    assertions,
  });
}
