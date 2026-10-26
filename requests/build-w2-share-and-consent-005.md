Request build/w2-share-and-consent-005. File: packages/contracts/src/briefs/share.ts, packages/contracts/src/routes/briefs.ts, and one route file in apps/api/src/share (to be assigned). Change wanted (a proposal that needs a decision; not applied):

```diff
 // packages/contracts/src/routes/briefs.ts
   consent: { method: "POST", path: "/api/meetings/:id/consent", request: z.undefined(), response: ConsentResponse },
   withdrawConsent: { method: "DELETE", path: "/api/meetings/:id/consent", request: z.undefined(), response: ConsentWithdrawResponse },
+  readConsent: { method: "GET", path: "/api/meetings/:id/consent", request: z.undefined(), response: ConsentResponse },
```

Why: the wave-2 spec, section 4.7, says the consent screen "loads the member's consent state from the meeting view and the consent route". Neither exists. MeetingView (packages/contracts/src/meetings/meeting.ts) has no consent field, and routes.briefs has only POST and DELETE on the consent path. So after a reload the screen cannot tell whether this person already consented or whether the other person did. The screen shows the consent button and learns the flags from the next POST or DELETE reply. Test W2-SHARE-T11 covers the waiting state only after a consent is posted in the same render.

The alternative is a `consent` field on MeetingView, which the meeting screen already reads. Either choice is a contracts change plus a read handler in the share folder, and the handler is not in my owned list, so the choice is the integrator's and Ambar's.

Until then: the consent screen starts with both flags false and mySide taken from MeetingView.viewerSide. No value is used beyond that, and no route is added.
