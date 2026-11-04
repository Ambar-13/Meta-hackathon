import { z } from "zod";

// Environment names and their defaults, shared by every app.
const base = { LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info") };
// The variables apps/api reads at boot. PORT defaults to 3000 because Render's PORT handling is
// unverified.
export const apiEnv = z.object({
  ...base,
  DATABASE_URL_API: z.string().url(),
  APP_ORIGIN: z.string().url(),
  PORT: z.coerce.number().int().default(3000),
  MAX_CONCURRENT_MEETINGS: z.coerce.number().int().default(40),
  // The database plan's disk in bytes, which /api/health measures the database against: the free
  // plan's 1 GB unless the host sets a paid plan's size. Decimal GB is the smaller reading, so
  // degraded comes early, not late.
  DATABASE_DISK_BYTES: z.coerce.number().int().positive().default(1_000_000_000),
  // The code a person gives to sign up, or empty for open sign-up. The deployed site sets one, so a
  // script cannot make accounts and spend the model budget through them.
  ACCESS_CODE: z.string().trim().default(""),
  // The site's Google sign-in client from Google Cloud, or empty to leave Continue with Google off.
  // The secret is set only in the host's settings, never in the repo. A Google sign-in needs no
  // access code: a script cannot make Google accounts at will.
  GOOGLE_CLIENT_ID: z.string().trim().default(""),
  GOOGLE_CLIENT_SECRET: z.string().trim().default(""),
});
// The variables apps/worker reads at boot. Production refuses LLM_MODE=replay.
export const workerEnv = z.object({
  ...base,
  DATABASE_URL_WORKER: z.string().url(),
  META_API_KEY: z.string().min(1),
  META_API_BASE_URL: z.string().url(), // https://api.meta.ai/v1
  LLM_MODE: z.enum(["live", "record", "replay"]), // production refuses 'replay'
  DAILY_USD_CAP: z.coerce.number().default(40),
  TOTAL_USD_CAP: z.coerce.number().default(130),
  MAX_CONCURRENT_MEETINGS: z.coerce.number().int().default(40),
});
// The variable the migrate command reads. Migrations run as the table owner, never as a runtime
// role.
export const migrateEnv = z.object({ DATABASE_URL_MIGRATE: z.string().url() });
// The three ways model calls run: live, record to fixtures, or replay recorded fixtures.
export const LlmMode = z.enum(["live", "record", "replay"]);
export type LlmMode = z.infer<typeof LlmMode>;
// Production refuses to boot in replay mode, so a demo can never run on recorded replies.
export const isProductionRefusingReplay = true;
