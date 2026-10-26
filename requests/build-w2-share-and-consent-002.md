Request build/w2-share-and-consent-002. File: package.json (repository root). Change wanted:

```diff
     "golden-path": "tsx scripts/golden-path.ts",
+    "share:takedown": "tsx scripts/share-takedown.ts",
     "replay:export": "tsx scripts/replay-export.ts",
```

Why: the takedown is run as `pnpm share:takedown --slug <slug>` or `pnpm share:takedown --meeting <id>` (spec 4.6, parent note 17). No test needs the name: my integration test runs the script with the local tsx runner, so this line is for the people who run the takedown by hand.

Until then: the script runs as `node_modules/.bin/tsx scripts/share-takedown.ts`. No value is used, and nothing in the acceptance list depends on this line.

This is the spec's request 003. The spec's request 002 (share_revoke) is done: migration 0003 is on the branch, so no request was written for it.
