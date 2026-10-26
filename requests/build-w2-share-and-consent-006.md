Request build/w2-share-and-consent-006. File: apps/web/src/screens/share/public-page.tsx (the constant REPORT_LINK_HREF). Change wanted: the value Ambar chooses for the report destination, as a fenced diff:

```diff
-export const REPORT_LINK_HREF = "{GAP: the report destination Ambar chooses; the inputs name a report link and no address, and no personal email goes in the repo}";
+export const REPORT_LINK_HREF = "<the report destination Ambar chooses>";
```

Why: the wave-2 spec, section 4.7, leaves the report destination open. The inputs name a report link and no address, and no personal email goes in the repo. The accessibility test W2-SHARE-T12 asserts that the Report this page link has an href that is not "#" and not empty; the placeholder passes that check, but a real page needs a real destination before merge. Section 7 of the spec says Ambar fills this in before merge, or the merge request names it as open. This request is that naming.

No proposed value. I did not choose an address, a mailbox or a form, because the spec leaves that choice to Ambar.

Until then: the constant holds the spec's own placeholder text, so the link exists and points nowhere useful. This is open and is reported in the wave-2 share report.
