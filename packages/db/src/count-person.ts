import { sql, type Kysely } from "kysely";
import { pathToFileURL } from "node:url";
import { ContractError, Uuid, apiEnv } from "@meet-first/contracts";
import { makeDatabase, numberFromPostgres } from "./client.js";
import { describeError } from "./database-errors.js";
import { withPerson, type DatabaseTransaction } from "./transaction.js";
import type { Database } from "./types.js";

// One table where a person's rows can be found, and the columns there that point at the person.
export type PersonColumns = { table: string; columns: string[] };

// One connection is enough to count one person's rows.
const COUNT_POOL_SIZE = 1;

// The foreign keys to people, read from the system catalog: every column that points at people, sorted by byte order.
const PERSON_FOREIGN_KEYS = `
SELECT c.conrelid::regclass::text AS table_name, a.attname::text AS column_name
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f' AND c.confrelid = 'public.people'::regclass
ORDER BY c.conrelid::regclass::text COLLATE "C", a.attname COLLATE "C"`;

// Lists people by id, then every table with a foreign key to people, read from the system catalog so a new table is never missed.
export async function listPersonColumns(trx: DatabaseTransaction): Promise<PersonColumns[]> {
  const rows = await sql<{
    table_name: string;
    column_name: string;
  }>`${sql.raw(PERSON_FOREIGN_KEYS)}`.execute(trx);
  const grouped: PersonColumns[] = [];
  for (const row of rows.rows) {
    const last = grouped[grouped.length - 1];
    if (last !== undefined && last.table === row.table_name) last.columns.push(row.column_name);
    else grouped.push({ table: row.table_name, columns: [row.column_name] });
  }
  return [
    { table: "people", columns: ["id"] },
    ...grouped.filter((entry) => entry.table !== "people"),
  ];
}

// Counts, table by table, the rows that still point at this person, inside the person's own context.
export async function countRowsForPerson(
  db: Kysely<Database>,
  personId: string,
): Promise<Record<string, number>> {
  return withPerson(db, personId, async (trx) => {
    const counts: Record<string, number> = {};
    for (const entry of await listPersonColumns(trx)) {
      const condition = sql.join(
        entry.columns.map((column) => sql`${sql.ref(column)} = ${personId}::uuid`),
        sql` OR `,
      );
      const result = await sql<{
        n: string;
      }>`SELECT count(*) AS n FROM ${sql.table(entry.table)} WHERE ${condition}`.execute(trx);
      counts[entry.table] = numberFromPostgres(result.rows[0]?.n);
    }
    return counts;
  });
}

// Turns the counts into the printed lines and the exit code: 0 when every count is 0, 1 otherwise.
export function formatCounts(counts: Record<string, number>): { text: string; exitCode: 0 | 1 } {
  const lines = Object.entries(counts).map(
    ([table, count]) => `${table.padEnd(20)}${String(count)}`,
  );
  const sum = Object.values(counts).reduce((total, count) => total + count, 0);
  lines.push(`${"total".padEnd(20)}${String(sum)}`);
  return { text: lines.join("\n"), exitCode: sum === 0 ? 0 : 1 };
}

// The private command body: counts the rows of the person whose id is the only argument, and returns the exit code.
async function main(): Promise<0 | 1> {
  const personId = process.argv[2] ?? "";
  if (!Uuid.safeParse(personId).success) {
    throw new ContractError(
      "count_person_bad_id",
      "Pass the person's id, a uuid, as the only argument: pnpm db:count-person <id>.",
      400,
    );
  }
  const env = apiEnv.pick({ DATABASE_URL_API: true }).safeParse(process.env);
  if (!env.success) {
    const names = env.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new ContractError("env_missing", `Set ${names} before running this command.`, 500);
  }
  const db = makeDatabase(env.data.DATABASE_URL_API, COUNT_POOL_SIZE);
  const counts = await countRowsForPerson(db, personId);
  await db.destroy();
  const report = formatCounts(counts);
  console.log(report.text);
  return report.exitCode;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`count-person failed: ${describeError(error)}`);
      process.exit(2);
    },
  );
}
