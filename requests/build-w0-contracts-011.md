Request build/w0-contracts-011.
File: scripts/probe-server.ts (not written).
Change wanted: the Monday-night probe needs a Fastify version. The spec says Fastify 5 and gives no minor or patch number. It also needs the gzip content parser for the 21 MiB body and the exact D50 response headers. Section 4.3 writes the function bodies as "{ ... }", so they are not in the spec.
Why: the two hour-2 checks in IMPLEMENTATION.md section 4 use this URL. No Wave 0 test covers the probe.
Until then: the file is not written, and Fastify is not installed.
Resolved at the Wave 0 freeze, 26 Oct: Deferred: the probe server waits for Render, which is not set up yet.
