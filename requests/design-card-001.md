Request design/card-001. File: apps/web/src/app-shell/app.css. Change wanted:

```diff
-.flag { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 999px; background: var(--yellow); font: 700 12.5px/1.15 var(--sans); }
+.flag { display: inline-flex; align-items: center; padding: 6px 11px; border-radius: 999px; background: var(--yellow); font: 700 12.5px/1.15 var(--sans); }
+.flag .stk { margin-right: 6px; }
```

Why: ReceiptFlag puts "no receipt" and ", so treat it as a guess" in two spans, and the flex gap draws a space before the comma ("no receipt , so treat it as a guess") wherever the flag shows: the card screen, meetings and briefs. app.css is not in this builder's paths.

Until then: card.css closes the gap for flags inside a card row only (.card-item-foot .flag).


Resolved by the integrator on 27 Oct 2026: app.css keeps the gap and gives `.flag-more` a -6px left margin, so "no receipt, so treat it as a guess" reads with no space before the comma.
