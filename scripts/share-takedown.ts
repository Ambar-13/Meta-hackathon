// A human hides a reported share page: by its public slug through share_revoke, or every share page
// of one meeting.
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ContractError, HTTP } from "@meet-first/contracts";
import { makeDatabase, withMeeting } from "@meet-first/db";

// The database handle the script opens, typed from the db package so the script needs no direct
// kysely import.
type Db = ReturnType<typeof makeDatabase>;
// The Postgres error code for a function that does not exist (42883 undefined_function).
const UNDEFINED_FUNCTION = "42883";
// Exit code of a finished takedown, whether or not a page was found.
export const EXIT_OK = 0;
// Exit code of any failure, including bad arguments.
export const EXIT_FAILED = 1;
// Exit code when share_revoke is missing from the database.
export const EXIT_REVOKE_MISSING = 2;

// What the script was asked to do: hide one slug, or every page of one meeting.
type Target = { kind: "slug"; slug: string } | { kind: "meeting"; meetingId: string };
// The two output lines the script writes: one for its normal output, one for its errors.
export type TakedownOutput = { out: (line: string) => void; err: (line: string) => void };

// The sentence for a call with neither flag, or with both.
function badArguments(): ContractError {
  return new ContractError(
    "takedown_bad_arguments",
    "Give --slug with the 22-character slug, or --meeting with the meeting id. Give one of them, not both.",
    HTTP.badRequest,
  );
}

// Reads the one flag the script takes; an unknown flag, a missing value, or both flags is bad
// arguments.
function readTarget(argv: readonly string[]): Target {
  let values: { slug?: string | undefined; meeting?: string | undefined };
  try {
    values = parseArgs({
      args: [...argv],
      options: { slug: { type: "string" }, meeting: { type: "string" } },
      strict: true,
    }).values;
  } catch {
    throw badArguments();
  }
  if (values.slug !== undefined && values.meeting === undefined)
    return { kind: "slug", slug: values.slug };
  if (values.meeting !== undefined && values.slug === undefined)
    return { kind: "meeting", meetingId: values.meeting };
  throw badArguments();
}

// Hides the share page of one meeting by setting revoked_at to now() on each page not revoked yet;
// returns how many changed.
export async function revokeShareByMeeting(db: Db, meetingId: string): Promise<number> {
  return withMeeting(db, meetingId, async (trx) => {
    const result = await trx
      .updateTable("share_pages")
      .set((eb) => ({ revoked_at: eb.fn<Date>("now", []) }))
      .where("meeting_id", "=", meetingId)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  });
}

// Hides the share page with this slug through share_revoke: true the first time, null after.
async function revokeShareBySlug(db: Db, slug: string): Promise<boolean | null> {
  const row = await db
    .selectNoFrom((eb) => eb.fn<boolean | null>("share_revoke", [eb.val(slug)]).as("revoked"))
    .executeTakeFirst();
  return row?.revoked ?? null;
}

// Runs one takedown on the database given, and writes only the result word or the count, never a
// snapshot.
export async function runTakedown(
  argv: readonly string[],
  db: Db,
  output: TakedownOutput,
): Promise<number> {
  const target = readTarget(argv);
  if (target.kind === "meeting") {
    output.out(String(await revokeShareByMeeting(db, target.meetingId)));
    return EXIT_OK;
  }
  const wasRevoked = await revokeShareBySlug(db, target.slug);
  output.out(wasRevoked === true ? "revoked" : "not found");
  return EXIT_OK;
}

// True when a database error says the function is absent (42883).
function isUndefinedFunction(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === UNDEFINED_FUNCTION
  );
}

// Reads the worker URL, opens the database, runs the takedown, and maps each failure to its exit
// code.
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  output: TakedownOutput,
): Promise<number> {
  const url = env["DATABASE_URL_WORKER"];
  if (url === undefined || url === "") {
    output.err(
      "takedown_database_url_missing: Set DATABASE_URL_WORKER in the environment, then run the takedown again.",
    );
    return EXIT_FAILED;
  }
  const db = makeDatabase(url, 1);
  try {
    return await runTakedown(argv, db, output);
  } catch (error: unknown) {
    if (isUndefinedFunction(error)) {
      output.err("share_revoke_missing: The database does not have share_revoke. Use --meeting.");
      return EXIT_REVOKE_MISSING;
    }
    output.err(
      error instanceof ContractError
        ? `${error.code}: ${error.message}`
        : "takedown_failed: The takedown did not finish. Check DATABASE_URL_WORKER and try again.",
    );
    return EXIT_FAILED;
  } finally {
    await db.destroy();
  }
}

// Runs the script when this file is the process entry (pnpm share:takedown); importing it starts
// nothing.
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void main(process.argv.slice(2), process.env, {
    out: (line) => process.stdout.write(line + "\n"),
    err: (line) => process.stderr.write(line + "\n"),
  }).then((code) => {
    process.exitCode = code;
  });
}
