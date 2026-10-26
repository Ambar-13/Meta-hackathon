import { z } from "zod";

// Environment names and their defaults, from IMPLEMENTATION.md 2.6 and D73. Shared by every app.
const base = { LOG_LEVEL: z.enum(['debug','info','warn','error']).default('info') };
// The variables apps/api reads at boot. PORT defaults to 3000 because Render's PORT handling is unverified (ARCHITECTURE.md 12).
export const apiEnv = z.object({ ...base,
  DATABASE_URL_API: z.string().url(),
  APP_ORIGIN: z.string().url(),
  PORT: z.coerce.number().int().default(3000),
  MAX_CONCURRENT_MEETINGS: z.coerce.number().int().default(40),
});
// The variables apps/worker reads at boot. Production refuses LLM_MODE=replay (D74).
export const workerEnv = z.object({ ...base,
  DATABASE_URL_WORKER: z.string().url(),
  META_API_KEY: z.string().min(1),
  META_API_BASE_URL: z.string().url(),            // https://api.meta.ai/v1
  LLM_MODE: z.enum(['live','record','replay']),   // production refuses 'replay' (D74)
  DAILY_USD_CAP: z.coerce.number().default(40),
  TOTAL_USD_CAP: z.coerce.number().default(130),
  MAX_CONCURRENT_MEETINGS: z.coerce.number().int().default(40),
});
// The variable the migrate command reads. Migrations run as the table owner, never as a runtime role.
export const migrateEnv = z.object({ DATABASE_URL_MIGRATE: z.string().url() });
// The three ways model calls run: live, record to fixtures, or replay recorded fixtures (D74).
export const LlmMode = z.enum(["live", "record", "replay"]);
// The type of LlmMode, read from the schema above.
export type LlmMode = z.infer<typeof LlmMode>;
// Production refuses to boot in replay mode, so a demo can never run on recorded replies (D74).
export const isProductionRefusingReplay = true;
