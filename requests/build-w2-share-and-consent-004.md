Request build/w2-share-and-consent-004. File: packages/contracts/src/briefs/share.ts. Change wanted:

```diff
-// Random bytes in a share slug: 96 bits, which is 16 URL-safe base64 characters. Picked here [confirm].
-export const SHARE_SLUG_BYTES = 12;
+// Random bytes in a share slug: 128 bits, which is 22 URL-safe base64 characters (R9.4, D68).
+export const SHARE_SLUG_BYTES = 16;
```

Why: a contradiction inside the wave-2 share spec. Spec section 4.1 gives `SLUG_BYTES = 16` ("22 characters"), section 4.4 says makeSlug gives 22 characters from 16 bytes, section 4.6 says `--slug <22 chars>`, and test W2-SHARE-T5 says a 22-character slug. Section 4.3 says the slug is 16 characters, `SHARE_SLUG_BYTES is 12`, and gives the pattern `{16}`. The contracts constant says 12 bytes, which is 16 characters. I followed section 4.1 (the earlier section, and the value four other places use): the code makes 16 random bytes, 22 characters, and the public read accepts exactly 22 base64url characters. No code reads the contracts constant; this request only brings its comment and value into line with the code.

Until then: the code uses SLUG_BYTES = 16 from apps/api/src/share/snapshot.ts, and SHARE_SLUG_BYTES stays 12 and unused. No test depends on the contracts constant.
