Request design/share-001. Two shared gaps the share, directory and help screens met in the design pass.

1. File: apps/web/src/app-shell/app.css. Change wanted:

```diff
-input, textarea, select, button { font: inherit; }
+input, textarea, select { font: inherit; }
```

Why: this rule comes after the `button, .btn` rule and resets every button's weight to 400, so buttons read lighter than DESIGN.md says (Hanken Grotesk 700). Links styled `.btn` keep 700, so a button and a link side by side look different. app.css is not in this builder's paths. No test needs it.

Until then: buttons on these screens show at weight 400.

2. File: apps/web/src/screens/share/screen.accessibility.test.tsx (W2-SHARE-T15). Change wanted: check that each comic image has the class the column rule is set on, instead of reading `image.style.maxWidth`.

Why: DESIGN.md forbids inline style attributes, and T15 asserts one (`style.maxWidth === "100%"`). The builder brief forbids changing a test's expected value outside a design fix, so snapshot-view.tsx keeps that one inline `maxWidth` on the comic image, and share.css sets the same rule on `.share-comic img`. Once T15 reads the class instead, the inline style can go.

Until then: the comic image keeps `style={{ maxWidth: "100%" }}`.
