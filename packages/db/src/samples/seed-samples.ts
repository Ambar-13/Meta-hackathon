// pnpm db:seed-samples: writes the sample people of sample-people.ts that Explore does not list yet, through the app's own roles and
// rules, the way a person is made: a person whose session and recovery code are random and never kept, so nobody can sign in as
// them; notes frozen after a names pass by the worker; an approved card whose items quote the notes word for word; the listing; the
// posts. The start script runs it after the migrations when SEED_SAMPLES is 1 (render.yaml). A second run adds nothing.
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { sql, type Kysely } from "kysely";
import { apiEnv, ContractError, workerEnv } from "@meet-first/contracts";
import { normQuote, verifyQuote } from "@meet-first/receipts";
import { makeDatabase } from "../client.js";
import { describeError } from "../database-errors.js";
import { withPerson } from "../transaction.js";
import type { Database } from "../types.js";
import { SAMPLE_PEOPLE, type SamplePerson } from "./sample-people.js";

// The advisory lock two seeds at once take turns on, so a sample person is never written twice. Any fixed number works.
const SEED_LOCK = 9_003_011;
// One connection holds the lock while the other writes.
const SEED_POOL_SIZE = 2;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

// What one run did: the sample people it added and the ones Explore already listed.
export type SeedReport = { added: string[]; present: string[] };
// The two clients the seed writes through: app_api, with a pool of at least two connections so one can hold the lock, and app_worker.
export type SeedClients = { api: Kysely<Database>; worker: Kysely<Database> };

// sha256 of 32 random bytes nobody keeps: the session and recovery code of a sample person, which no one can ever send.
function unusableHash(): Buffer {
  return createHash("sha256").update(randomBytes(32)).digest();
}

// The card item rows of one sample person, each quote checked against its note as the card job checks the model's (D26).
function itemRows(person: SamplePerson, ids: { personId: string; cardId: string }, turns: ReadonlyArray<{ id: string; text: string; norm_text: string }>) {
  return person.items.map((item, index) => {
    const turn = turns[item.note];
    const check = turn === undefined ? null : verifyQuote({ quote: item.quote, turnText: turn.text, turnNormText: turn.norm_text, forbidden: [] });
    if (turn === undefined || check === null || !check.ok) {
      throw new ContractError("seed_quote_not_in_note", `${person.displayName}'s item ${String(index + 1)} quotes words that are not in note ${String(item.note)}. Fix sample-people.ts.`, 500);
    }
    return {
      card_id: ids.cardId, person_id: ids.personId, position: index + 1, kind: item.kind, claim: item.claim, lang: "en", gloss: item.claim, turn_id: turn.id,
      quote: item.quote, norm_quote: normQuote(item.quote), verified: true, flagged: false, approved: true, sensitive: false, is_public: item.isPublic,
    };
  });
}

// Writes one sample person, listed at listedAt. The names pass runs as the worker, so the notes are committed first; everything after
// it is one transaction, so a failed run leaves at most a person with unfrozen notes, whom Explore never shows, and never half a listing.
async function addSamplePerson(clients: SeedClients, person: SamplePerson, times: { now: Date; listedAt: Date }): Promise<void> {
  const { now } = times;
  const { api, worker } = clients;
  const created = await sql<{ person_id: string | null }>`SELECT auth_create_person(${person.displayName}, ${[]}::text[], ${unusableHash()}, ${unusableHash()}) AS person_id`.execute(api);
  const personId = created.rows[0]?.person_id;
  if (personId === null || personId === undefined) throw new ContractError("seed_person_failed", "auth_create_person returned no id. Check that the migrations ran.", 500);
  const sourceId = await withPerson(api, personId, async (trx) => {
    const source = await trx.insertInto("sources").values({
      person_id: personId, kind: "notes", content_hash: createHash("sha256").update(person.notes.join("\n"), "utf8").digest(), turn_count: person.notes.length,
      canonical_chars: person.notes.reduce((sum, text) => sum + text.length, 0), persona_signal: "0.500", parser_version: "sample", scrub_version: "sample", attested_at: now,
    }).returning("id").executeTakeFirstOrThrow();
    await trx.insertInto("turns").values(person.notes.map((text, index) => ({ source_id: source.id, person_id: personId, turn_index: index, role: "user" as const, text, norm_text: normQuote(text) }))).execute();
    return source.id;
  });
  await withPerson(worker, personId, (trx) => trx.insertInto("names_passes").values({ source_id: sourceId, person_id: personId }).execute());
  await withPerson(api, personId, async (trx) => {
    await trx.updateTable("sources").set({ names_reviewed_at: now, frozen_at: now }).where("id", "=", sourceId).execute();
    const turns = await trx.selectFrom("turns").select(["id", "text", "norm_text"]).where("source_id", "=", sourceId).orderBy("turn_index").execute();
    const card = await trx.insertInto("cards").values({
      source_id: sourceId, person_id: personId, state: "approved", model: "sample", prompt_version: "sample", items_total: person.items.length, items_verified: person.items.length,
      thin: false, recall_allowed: true, friends_can_ask: true, built_at: now, approved_at: now,
    }).returning("id").executeTakeFirstOrThrow();
    await trx.insertInto("card_items").values(itemRows(person, { personId, cardId: card.id }, turns)).execute();
    await trx.updateTable("people").set({ is_sample: true }).where("id", "=", personId).execute();
    await trx.insertInto("directory_listings").values({ person_id: personId, card_id: card.id, line: person.line, open_to_romance: false, created_at: times.listedAt }).execute();
    await trx.insertInto("posts").values(person.posts.map((post) => ({ person_id: personId, text: post.text, created_at: new Date(now.getTime() - post.hoursAgo * HOUR_MS) }))).execute();
  });
}

// Adds every sample person Explore does not list yet, under the seed lock; the tests pass their own people and clock. Each listing is
// a minute older than the one before it, so Explore, newest first, shows them in the order of the list.
export async function seedSamplePeople(clients: SeedClients, options: { people?: readonly SamplePerson[]; now?: Date } = {}): Promise<SeedReport> {
  const { api } = clients;
  const people = options.people ?? SAMPLE_PEOPLE;
  const now = options.now ?? new Date();
  return api.connection().execute(async (lock) => {
    await sql`SELECT pg_advisory_lock(${SEED_LOCK}::bigint)`.execute(lock);
    try {
      const listed = await sql<{ display_name: string }>`SELECT display_name FROM sample_people_listed()`.execute(api);
      const present = new Set(listed.rows.map((row) => row.display_name));
      const report: SeedReport = { added: [], present: [] };
      for (const [index, person] of people.entries()) {
        if (present.has(person.displayName)) {
          report.present.push(person.displayName);
          continue;
        }
        await addSamplePerson(clients, person, { now, listedAt: new Date(now.getTime() - index * MINUTE_MS) });
        report.added.push(person.displayName);
      }
      return report;
    } finally {
      await sql`SELECT pg_advisory_unlock(${SEED_LOCK}::bigint)`.execute(lock);
    }
  });
}

// The two role URLs the seed needs; it never sees the app_migrate URL.
const SeedEnv = apiEnv.pick({ DATABASE_URL_API: true }).merge(workerEnv.pick({ DATABASE_URL_WORKER: true }));

async function main(): Promise<void> {
  const env = SeedEnv.safeParse(process.env);
  if (!env.success) {
    const names = env.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new ContractError("env_missing", `Set ${names} before running this command.`, 500);
  }
  const api = makeDatabase(env.data.DATABASE_URL_API, SEED_POOL_SIZE);
  const worker = makeDatabase(env.data.DATABASE_URL_WORKER, 1);
  try {
    const report = await seedSamplePeople({ api, worker });
    console.log(`seed-samples: added ${String(report.added.length)} (${report.added.join(", ") || "none"}), already listed ${String(report.present.length)}`);
  } finally {
    await api.destroy();
    await worker.destroy();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`seed-samples failed: ${describeError(error)}`);
      process.exit(1);
    },
  );
}
