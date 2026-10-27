Request design/friends-001. File: apps/web/src/app-shell/app.css. Change wanted:

```diff
-input, textarea, select, button { font: inherit; }
+input, textarea, select { font: inherit; }
```

Why: the rule `button, .btn { font: 700 16px/1.1 var(--sans); }` comes first, and the later `input, textarea, select, button { font: inherit; }` resets every button to the body's 400 17px/1.5, so buttons (and `.big` buttons) render regular weight at body size, not the bold pill in docs/DESIGN.md and the probe. `.btn` links are not hit. Tab buttons and `.text-button` inherit through the same rule.

Until then: the friends, ask and settings screens set `font-weight: 700` on their own buttons in their screen CSS files.


Resolved by the integrator on 27 Oct 2026: app.css now reads `input, textarea, select { font: inherit; }`, so buttons keep their 700 weight.
