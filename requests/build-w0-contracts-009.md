Request build/w0-contracts-009.
File: packages/llm/README.md.
Change wanted: a README for the llm package with the five headings in order, a Mermaid flowchart under How it fits, and the closing line. Section 8 gives this README to dossier in Wave 1. But the readme-headings check requires a README for every package that has a package.json, and section 3 creates packages/llm/package.json in Wave 0. The integrator either copies docs/README-TEMPLATE.md into packages/llm/README.md and fills it in, or accepts this check as a warning until Wave 1.
Why: pnpm checks, readme-headings, reports "is missing" as an error.
Until then: no README for llm. pnpm checks reports one error here.
Resolved at the Wave 0 freeze, 26 Oct: packages/llm/README.md is written; the dossier builder rewrites it.
