Request design-upload-001. To: the integrator. From: the upload and names screen builder, design pass of 27 Oct 2026, branch design/upload on main 8f6693c. File: apps/web/src/app-shell/app.css, the rule `input, textarea, select, button { font: inherit; }` (form fields section). Kind: shared style gap.

What happens: the rule `button, .btn { ... font: 700 16px/1.1 var(--sans); ... }` sets the weight and size of every button, and the later rule `input, textarea, select, button { font: inherit; }` has the same specificity for `button`, so it wins and every `<button>` in the app renders at the body weight (400) and 17px. `.btn` links keep 700. Seen in the gallery: "Stop", "Start again", "Save and build my card" and the tabs all render regular weight, while the probe and DESIGN.md want 700 pills.

Change wanted, the smallest diff: drop `button` from that list, or move the `font: inherit` rule above the button rules.

```diff
-input, textarea, select, button { font: inherit; }
+input, textarea, select { font: inherit; }
```

`button.text-button` already sets `font` through `button, .btn`, and `.tabs button` sets its own size, so neither changes in a way the screens rely on. Check `.tabs button` afterwards: it would become 700 at 15px.

Until then: upload.css and names-review.css set `font-weight` again on their own buttons, scoped to their own classes. Those lines can go once app.css is changed.
