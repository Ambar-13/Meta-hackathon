import { z } from "zod";
import { Uuid } from "../primitives.js";

// The body a new person sends to POST /api/people (IMPLEMENTATION.md 2.1).
export const PersonCreate = z.object({
  displayName: z.string().trim().min(1).max(80),
  // Affiliations the scrubber must leave alone. The 80 and 10 caps are builder defaults marked [confirm].
  affiliations: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
});
// The type of PersonCreate, read from the schema above.
export type PersonCreate = z.infer<typeof PersonCreate>;
// What POST /api/people returns: the new person and their recovery code, shown once (A5).
export const PersonCreateResponse = z.object({
  personId: Uuid,
  recoveryCode: z.string().length(32),
});
// The type of PersonCreateResponse, read from the schema above.
export type PersonCreateResponse = z.infer<typeof PersonCreateResponse>;
// Length of the recovery code in characters, A5.
export const RECOVERY_CODE_LENGTH = 32;
// Characters a recovery code may use: 31 symbols with no 0, o, 1, l or i, so a code is easy to read aloud. Picked here [confirm].
export const RECOVERY_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
// Person creations allowed per IP address per hour, R9.5 and D60.
export const PERSON_CREATE_RATE_LIMIT = { max: 10, windowMs: 3_600_000 };
