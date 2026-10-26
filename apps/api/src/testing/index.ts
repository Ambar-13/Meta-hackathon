// The api test kit, imported by every api builder as ../testing/index.js (seams S5); nobody writes a second one.
// Builds the api on a fresh test database with the real hooks and the routes given (docs/contracts.md section 4).
export { buildTestApp } from "./app-factory.js";
// Keeps the session cookie between inject calls and adds the test app's Origin (docs/contracts.md section 4).
export { cookieJar } from "./cookie-jar.js";
// Reads an SSE body into frames until a seq, the end, or a timeout (docs/contracts.md section 4).
export { readSse } from "./sse-reader.js";
// The frame type readSse returns.
export type { SseItem } from "./sse-reader.js";
