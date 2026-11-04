import { z } from "zod";
import { Uuid, IsoTime } from "../primitives.js";

// The cookie that holds the session. The __Host- prefix forces Secure, Path=/ and no Domain.
export const SESSION_COOKIE = "__Host-session";
// Random bytes in a session token: 256 bits.
export const SESSION_TOKEN_BYTES = 32;
// Days a session stays valid after it is created.
export const SESSION_LIFETIME_DAYS = 90;
// Random bytes in a transfer token: 128 bits.
export const TRANSFER_TOKEN_BYTES = 16;
// Minutes a transfer link works before it expires.
export const TRANSFER_LIFETIME_MINUTES = 10;
// Attributes of the session cookie.
export const COOKIE_ATTRIBUTES = {
  httpOnly: true,
  secure: true,
  path: "/",
  sameSite: "lax",
} as const;
// The body of POST /api/sessions/recover: the 32-character recovery code.
export const Recover = z.object({ code: z.string().length(32) });
export type Recover = z.infer<typeof Recover>;
// What a successful recovery returns; the cookie is set on the same response.
export const RecoverResponse = z.object({ personId: Uuid });
export type RecoverResponse = z.infer<typeof RecoverResponse>;
// What POST /api/sessions/transfer returns: a link and when it stops working.
export const TransferResponse = z.object({ url: z.string().url(), expiresAt: IsoTime });
export type TransferResponse = z.infer<typeof TransferResponse>;
// The body of POST /api/sessions/claim. The token is 16 random bytes as 32 lower-case hex
// characters.
export const TransferClaim = z.object({ token: z.string().regex(/^[0-9a-f]{32}$/) });
export type TransferClaim = z.infer<typeof TransferClaim>;
// What a successful claim returns; the new session cookie is set on the same response.
export const TransferClaimResponse = z.object({ personId: Uuid });
export type TransferClaimResponse = z.infer<typeof TransferClaimResponse>;
