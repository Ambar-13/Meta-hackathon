import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import { AVATARS } from "@meet-first/contracts";
import { makeDatabase, numberFromPostgres } from "./client.js";
import { TRIGGER_CODES } from "./database-errors.js";
import { appendMeetingEvent } from "./event-seq.js";
import { withRebuildLock } from "./fresh.js";
import { listMigrationFiles, MIGRATIONS_FOLDER } from "./migrate.js";
import { asMeeting, asPerson, countVisibleRows, createPairedMeetingWithTurns, freshTestDatabase, readTestDatabaseUrls, sha256Text, SEED_TURNS_A, withNoContext, type SeededMeeting, type TestDatabase } from "./testing/index.js";
import { withMeeting, withPerson, type DatabaseTransaction } from "./transaction.js";
import type { Database } from "./types.js";

// The user-data tables; names_passes and source_names come from migration 0002, the directory's three from 0006, friend_requests and orchestrator_messages from 0008, and posts from 0009.
const USER_DATA_TABLES = ["people", "sessions", "transfer_links", "sources", "turns", "redactions", "cards", "card_items", "quizzes", "quiz_items", "pairs", "meetings", "meeting_members", "meeting_steps", "meeting_events", "claims", "briefs", "comics", "comic_panels", "share_pages", "ledger", "deletions", "names_passes", "source_names", "directory_listings", "persona_asks", "persona_answers", "friend_requests", "orchestrator_messages", "posts", "post_likes", "profile_photos", "google_accounts"] as const;
// The three reference tables with no person or meeting column.
const REFERENCE_TABLES = ["quiz_bank", "service_heartbeats", "schema_migrations"] as const;
// The tables keyed by meeting_id that a member of another meeting must not read (R8.7-T1, R8.7-T2).
const MEETING_TABLES = ["meeting_members", "meeting_steps", "meeting_events", "claims", "briefs", "comics", "comic_panels", "share_pages", "ledger"] as const;
// The functions of migrations 0001 to 0012 that run as app_definer, in byte order.
const DEFINER_FUNCTIONS = ["app_shares_meeting", "auth_claim_transfer", "auth_create_person", "auth_google_person", "auth_person_for_session", "auth_redeem_recovery", "claim_meeting_slot", "directory_browse", "directory_meeting_create", "directory_profile", "directory_shortlist", "explore_posts", "feed_posts", "friend_list", "friend_request_accept", "friend_request_decline", "friend_request_send", "friend_requests_mine", "ledger_meeting_tokens", "ledger_usd_since", "ledger_window", "liked_posts", "listing_photo_ids", "listing_posts", "meeting_create", "pair_display_names", "pair_photo_ids", "pairs_join", "post_is_visible", "post_photo_read", "profile_photo_read", "purge_expired_rows", "sample_people_listed", "share_read", "share_revoke", "story_feed", "sweep_candidates"];

// Returns the item at index, and throws when the list is shorter.
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`The list has no item at index ${String(index)}.`);
  return item;
}

// Counts the rows of one table whose column equals a value, in the current context.
async function countWhere(trx: DatabaseTransaction, table: string, match: { column: string; value: string }): Promise<number> {
  const result = await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)} WHERE ${sql.ref(match.column)} = ${match.value}::uuid`.execute(trx);
  return numberFromPostgres(result.rows[0]?.n);
}

let t: TestDatabase;
let worker: Kysely<Database>;
let seed: { x: SeededMeeting; y: SeededMeeting };

// Writes the person-keyed rows of one seeded meeting: the API's rows through the owner, the ledger and names through the worker.
async function seedPersonRows(s: SeededMeeting): Promise<void> {
  const aId = s.a.personId;
  await asPerson(t.db, aId, async (trx) => {
    await trx.insertInto("transfer_links").values({ person_id: aId, token_hash: sha256Text(`transfer:${aId}`), expires_at: new Date(Date.now() + 10 * 60_000) }).execute();
    await trx.insertInto("redactions").values({ source_id: s.a.sourceId, turn_id: at(s.a.turnIds, 0), person_id: aId, category: "email", placeholder_id: "1a2b3c4d" }).execute();
    const quiz = await trx.insertInto("quizzes").values({ card_id: s.a.cardId, person_id: aId, bank_version: 1, seed: s.a.cardId, state: "answering" }).returning("id").executeTakeFirstOrThrow();
    await trx.insertInto("quiz_items").values({ quiz_id: quiz.id, person_id: aId, position: 1, bank_version: 1, question_id: 1, flipped: false }).execute();
    await trx.insertInto("deletions").values({ person_id: aId, requested_at: new Date() }).execute();
  });
  await withPerson(worker, aId, async (trx) => {
    await trx.insertInto("ledger").values({ person_id: aId, meeting_id: null, call_site: "card", model: "test-model", effort: "medium", est_tokens: 100, status: "started", llm_mode: "replay" }).execute();
    await trx.insertInto("source_names").values({ source_id: s.a.sourceId, person_id: aId, text: "Test Name", role_token: "[person:test-a]", placeholder_ids: ["0a0b0c0d"] }).execute();
  });
}

// Writes the meeting-keyed rows of one seeded meeting.
async function seedMeetingRows(s: SeededMeeting): Promise<void> {
  const m = s.meetingId;
  const now = new Date().toISOString();
  await asMeeting(t.db, m, async (trx) => {
    await trx.insertInto("meeting_steps").values({ meeting_id: m, step_seq: 1, side: "a", phase: "open" }).execute();
    await appendMeetingEvent(trx, m, { v: 1, meetingId: m, at: now, type: "meeting.started", startedAt: now, endsAt: now, question: "A test question?", members: [{ side: "a", displayName: "Test A" }, { side: "b", displayName: "Test B" }] });
    await trx.insertInto("claims").values({ meeting_id: m, step_seq: 1, side: "a", person_id: s.a.personId, position: 1, text: "Plans are written down first.", quote: at(SEED_TURNS_A, 0), lang: "en", turn_id: at(s.a.turnIds, 0), verified: true, flagged: false, evidence_valid: true }).execute();
    await trx.insertInto("briefs").values({ meeting_id: m, person_id: s.a.personId, agree: "[]", clash: "[]", decide_first: "[]", model: "test-model", prompt_version: "test" }).execute();
    const comic = await trx.insertInto("comics").values({ meeting_id: m, requested_by: s.a.personId, state: "rendering", avatar_a: at(AVATARS, 0), avatar_b: at(AVATARS, 1), prompt_version: "test", purge_after: new Date(Date.now() + 30 * 86_400_000) }).returning("id").executeTakeFirstOrThrow();
    await trx.insertInto("comic_panels").values({ comic_id: comic.id, meeting_id: m, position: 1, caption: "Test caption", image_prompt: "Test prompt", image: Buffer.from("RIFF") }).execute();
    await trx.insertInto("share_pages").values({ meeting_id: m, slug: `slug-${m}` }).execute();
  });
  await withMeeting(worker, m, (trx) => trx.insertInto("ledger").values({ person_id: null, meeting_id: m, call_site: "speech", model: "test-model", effort: "low", est_tokens: 100, status: "started", llm_mode: "replay" }).execute());
}

beforeAll(async () => {
  t = await freshTestDatabase();
  worker = makeDatabase(t.workerUrl, 1);
  const x = await createPairedMeetingWithTurns(t.db);
  const y = await createPairedMeetingWithTurns(t.db, { questionId: 5 });
  seed = { x, y };
  for (const s of [x, y]) {
    await seedPersonRows(s);
    await seedMeetingRows(s);
  }
});

afterAll(async () => {
  await worker.destroy();
  await t.drop();
});

// Runs one catalog query on the test database as the owner of the connection and returns its rows.
async function catalog<R extends object>(text: string): Promise<R[]> {
  const result = await sql<R>`${sql.raw(text)}`.execute(t.db);
  return result.rows;
}

describe("schema security", () => {
  it("R9.1-T1: every table in public has row security enabled and forced", async () => {
    const rows = await catalog<{ name: string; enabled: boolean; forced: boolean }>(`SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname COLLATE "C"`);

    expect(rows.map((row) => row.name)).toEqual(["briefs", "card_items", "cards", "claims", "comic_panels", "comics", "deletions", "directory_listings", "friend_requests", "google_accounts", "ledger", "meeting_events", "meeting_members", "meeting_steps", "meetings", "names_passes", "orchestrator_messages", "pairs", "people", "persona_answers", "persona_asks", "post_likes", "posts", "profile_photos", "quiz_bank", "quiz_items", "quizzes", "redactions", "schema_migrations", "service_heartbeats", "sessions", "share_pages", "source_names", "sources", "transfer_links", "turns"]);
    expect(rows.every((row) => row.enabled && row.forced)).toBe(true);
  });

  it("R9.1-T2: every table in public has at least one policy", async () => {
    const rows = await catalog<{ name: string }>(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)`);

    expect(rows).toEqual([]);
  });

  it("R9.1-T3: the four roles cannot skip row security and the app roles own nothing", async () => {
    const roles = await catalog<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }>(`SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('app_api', 'app_definer', 'app_migrate', 'app_worker') ORDER BY rolname COLLATE "C"`);
    const owned = await catalog<{ owner: string; n: string }>(`SELECT pg_get_userbyid(c.relowner) AS owner, count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') GROUP BY 1 ORDER BY 1`);

    expect(roles.map((role) => role.rolname)).toEqual(["app_api", "app_definer", "app_migrate", "app_worker"]);
    expect(roles.every((role) => !role.rolsuper && !role.rolbypassrls)).toBe(true);
    expect(roles.map((role) => role.rolcanlogin)).toEqual([true, false, true, true]);
    expect(Object.fromEntries(owned.map((row) => [row.owner, numberFromPostgres(row.n)]))).toEqual({ app_migrate: 37 });
  });

  it("R9.1-T4: the security definer functions are exactly the twenty-eight of migrations 0001 to 0009", async () => {
    const rows = await catalog<{ name: string }>(`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef ORDER BY p.proname COLLATE "C"`);

    expect(rows.map((row) => row.name)).toEqual(DEFINER_FUNCTIONS);
  });

  it("R9.1-T5: each definer function belongs to app_definer and only the named roles may call it", async () => {
    const rows = await catalog<{ name: string; owner: string; api: boolean; worker: boolean }>(`SELECT p.proname AS name, pg_get_userbyid(p.proowner) AS owner, has_function_privilege('app_api', p.oid, 'EXECUTE') AS api, has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef ORDER BY p.proname COLLATE "C"`);

    expect(rows.every((row) => row.owner === "app_definer")).toBe(true);
    expect(rows.filter((row) => row.api).map((row) => row.name)).toEqual(["app_shares_meeting", "auth_claim_transfer", "auth_create_person", "auth_google_person", "auth_person_for_session", "auth_redeem_recovery", "claim_meeting_slot", "directory_browse", "directory_meeting_create", "directory_profile", "explore_posts", "feed_posts", "friend_list", "friend_request_accept", "friend_request_decline", "friend_request_send", "friend_requests_mine", "listing_photo_ids", "listing_posts", "meeting_create", "pair_display_names", "pair_photo_ids", "pairs_join", "post_is_visible", "post_photo_read", "profile_photo_read", "sample_people_listed", "share_read", "story_feed"]);
    expect(rows.filter((row) => row.worker).map((row) => row.name)).toEqual(["app_shares_meeting", "claim_meeting_slot", "directory_shortlist", "ledger_meeting_tokens", "ledger_usd_since", "ledger_window", "liked_posts", "purge_expired_rows", "share_revoke", "sweep_candidates"]);
  });

  it("R9.1-T6: after the rebuild app_migrate is no longer a member of app_definer", async () => {
    // Held under the rebuild lock: another worktree's rebuild grants the membership for its own run, cluster-wide.
    const rows = await withRebuildLock(readTestDatabaseUrls(process.env).adminUrl, () => catalog<{ n: string }>(`SELECT count(*) AS n FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE r.rolname = 'app_definer' AND u.rolname = 'app_migrate'`));

    expect(numberFromPostgres(rows[0]?.n)).toBe(0);
  });

  it("R9.1-T7: a row written for someone else is refused by the policy", async () => {
    const insertForOther = () => asPerson(t.db, seed.x.b.personId, (trx) => trx.insertInto("transfer_links").values({ person_id: seed.x.a.personId, token_hash: sha256Text("not-mine"), expires_at: new Date(Date.now() + 10 * 60_000) }).execute());
    const insertIntoOtherMeeting = () => asMeeting(t.db, seed.x.meetingId, (trx) => trx.insertInto("meeting_events").values({ meeting_id: seed.y.meetingId, seq: 1, type: "hold", v: 1, payload: "{}" }).execute());

    const first = await insertForOther().then(() => undefined, (caught: unknown) => caught);
    const second = await insertIntoOtherMeeting().then(() => undefined, (caught: unknown) => caught);

    expect(Reflect.get(first ?? {}, "code")).toBe("42501");
    expect(Reflect.get(second ?? {}, "code")).toBe("42501");
  });

  it("R9.1-T8: the table owner reads zero rows", async () => {
    const owner = makeDatabase(t.migrateUrl, 1);
    try {
      for (const table of USER_DATA_TABLES) {
        const result = await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(owner);
        expect(numberFromPostgres(result.rows[0]?.n)).toBe(0);
      }
    } finally {
      await owner.destroy();
    }
  });

  it("R9.1-T9: the migrations create exactly these nine triggers", async () => {
    const rows = await catalog<{ name: string }>(`SELECT t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY t.tgname COLLATE "C"`);

    expect(rows.map((row) => row.name)).toEqual(["card_items_turn_owner", "cards_require_frozen_source", "claims_turn_owner", "events_gapless_seq", "events_notify", "meetings_state_transitions", "members_prefix_frozen", "sources_freeze_needs_names_pass", "turns_text_frozen"]);
  });

  it("R9.1-T10: TRIGGER_CODES lists every code the migrations raise", async () => {
    const files = await listMigrationFiles(MIGRATIONS_FOLDER);
    const raised = new Set<string>();
    for (const file of files) {
      const text = await readFile(file.path, "utf8");
      for (const match of text.matchAll(/RAISE EXCEPTION '([a-z_]+):/g)) raised.add(match[1] ?? "");
    }

    expect(raised).toEqual(new Set(TRIGGER_CODES));
    expect(TRIGGER_CODES).toHaveLength(21);
  });

  it("INV15-T1: with no context every user-data table and the recall view read zero rows as app_api", async () => {
    await withNoContext(t.db, async (trx) => {
      for (const table of [...USER_DATA_TABLES, "recall_corpus" as const]) {
        expect(await countVisibleRows(trx, table)).toBe(0);
      }
    });
  });

  it("INV15-T2: with no context every user-data table and the recall view read zero rows as app_worker", async () => {
    await withNoContext(worker, async (trx) => {
      for (const table of [...USER_DATA_TABLES, "recall_corpus" as const]) {
        expect(await countVisibleRows(trx, table)).toBe(0);
      }
    });
  });

  it("INV15-T3: the three reference tables are readable with no context", async () => {
    const files = await listMigrationFiles(MIGRATIONS_FOLDER);
    await withNoContext(t.db, async (trx) => {
      expect(await countVisibleRows(trx, "quiz_bank")).toBe(30);
      expect(await countVisibleRows(trx, "service_heartbeats")).toBe(1);
      expect(await countVisibleRows(trx, "schema_migrations")).toBe(files.length);
    });
  });

  it("INV15-T4: the user-data list is every base table except the three reference tables", async () => {
    const rows = await catalog<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
    const names = rows.map((row) => row.table_name).filter((name) => !(REFERENCE_TABLES as readonly string[]).includes(name));

    expect([...names].sort()).toEqual([...USER_DATA_TABLES].sort());
  });

  it("R8.7-T1: a member of meeting x reads no row of meeting y", async () => {
    const counts = await asPerson(t.db, seed.x.a.personId, async (trx) => {
      const found: number[] = [await countWhere(trx, "meetings", { column: "id", value: seed.y.meetingId })];
      for (const table of MEETING_TABLES) found.push(await countWhere(trx, table, { column: "meeting_id", value: seed.y.meetingId }));
      return found;
    });

    expect(counts).toEqual(Array.from({ length: 10 }, () => 0));
  });

  it("R8.7-T2: a job running as meeting x reads no row of meeting y or its people", async () => {
    const counts = await asMeeting(t.db, seed.x.meetingId, async (trx) => {
      const found: number[] = [await countWhere(trx, "meetings", { column: "id", value: seed.y.meetingId })];
      for (const table of MEETING_TABLES) found.push(await countWhere(trx, table, { column: "meeting_id", value: seed.y.meetingId }));
      found.push(await countWhere(trx, "people", { column: "id", value: seed.y.a.personId }), await countWhere(trx, "people", { column: "id", value: seed.y.b.personId }));
      found.push(await countWhere(trx, "turns", { column: "person_id", value: seed.y.a.personId }), await countWhere(trx, "cards", { column: "person_id", value: seed.y.a.personId }));
      return found;
    });

    expect(counts).toEqual(Array.from({ length: 14 }, () => 0));
  });

  it("R8.7-T3: each context sees exactly the rows its policies allow", async () => {
    // Rows per table as: no context, x.a, x.b, meeting x.
    const expected: Array<[string, [number, number, number, number]]> = [
      ["people", [0, 1, 1, 2]], ["sessions", [0, 1, 1, 0]], ["transfer_links", [0, 1, 0, 0]], ["sources", [0, 1, 1, 2]], ["turns", [0, 3, 3, 6]],
      ["redactions", [0, 1, 0, 0]], ["cards", [0, 1, 1, 2]], ["card_items", [0, 6, 6, 12]], ["quizzes", [0, 1, 0, 1]], ["quiz_items", [0, 1, 0, 1]],
      ["pairs", [0, 1, 1, 0]], ["meetings", [0, 1, 1, 1]], ["meeting_members", [0, 2, 2, 2]], ["meeting_steps", [0, 1, 1, 1]], ["meeting_events", [0, 1, 1, 1]],
      ["claims", [0, 1, 1, 1]], ["briefs", [0, 1, 0, 1]], ["comics", [0, 1, 1, 1]], ["comic_panels", [0, 1, 1, 1]], ["share_pages", [0, 1, 1, 1]],
      ["ledger", [0, 2, 1, 1]], ["deletions", [0, 1, 0, 0]], ["names_passes", [0, 1, 1, 0]], ["source_names", [0, 1, 0, 0]], ["recall_corpus", [0, 3, 0, 3]],
    ];
    const xa = seed.x.a.personId;
    const xb = seed.x.b.personId;
    const meetingId = seed.x.meetingId;
    const actual: Array<[string, number[]]> = [];
    for (const [table] of expected) {
      const none = await withNoContext(t.db, (trx) => countVisibleRows(trx, table as keyof Database));
      const forA = await asPerson(t.db, xa, (trx) => countVisibleRows(trx, table as keyof Database));
      const forB = await asPerson(t.db, xb, (trx) => countVisibleRows(trx, table as keyof Database));
      const forMeeting = await asMeeting(t.db, meetingId, (trx) => countVisibleRows(trx, table as keyof Database));
      actual.push([table, [none, forA, forB, forMeeting]]);
    }

    expect(actual).toEqual(expected);
  });

  it("R8.7-T4: a pair partner never sees the other person's private rows", async () => {
    const counts = await asPerson(t.db, seed.x.b.personId, async (trx) => {
      const found: number[] = [];
      for (const table of ["transfer_links", "redactions", "quizzes", "deletions", "sessions"]) found.push(await countWhere(trx, table, { column: "person_id", value: seed.x.a.personId }));
      return found;
    });

    expect(counts).toEqual([0, 0, 0, 0, 0]);
  });
});
