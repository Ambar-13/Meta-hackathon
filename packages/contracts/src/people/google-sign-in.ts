import { z } from "zod";

// What GET /api/auth/options returns: the ways to sign in this site offers, so the start page shows Continue with Google only when the
// site has a Google client.
export const AuthOptions = z.object({ google: z.boolean() });
// The type of AuthOptions, read from the schema above.
export type AuthOptions = z.infer<typeof AuthOptions>;

// The query name the Google sign-in sends the start page back with when sign-in did not finish.
export const GOOGLE_RESULT_QUERY = "google";
// Why a Google sign-in did not finish: cancelled when the person said no at Google, failed for anything else.
export const GoogleSignInResult = z.enum(["cancelled", "failed"]);
// The type of GoogleSignInResult, read from the schema above.
export type GoogleSignInResult = z.infer<typeof GoogleSignInResult>;
