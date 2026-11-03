# scrub-names: test results

## v1 on a pasted summary, 4 Nov 2026

The check_summary job sends a person's pasted summary through this prompt, one block of fields per labelled message ([t:0], [t:1], ...), with the person's own name in the allowlist. On muse-spark-1.3 through the Meta Model API, with the request `namesPassCall` builds; judged by the writer, not independent. Made-up names only.

| Input | Output (all runs) | Runs | Passed |
|---|---|---|---|
| Three blocks naming the person (Ana Lee, allowlisted), a cofounder (Priya Raman) and a professor (Professor Leo Brandt) | names Priya Raman as cofounder and Leo Brandt as teacher; Ana Lee left out | 3 | 3 |

Spend: $0.0142 for the 3 runs, by the ledger.
