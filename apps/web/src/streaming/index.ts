// The meeting stream client, its frame parser and the feed types.
export { parseSseText, openMeetingFeed, type SseFrame, type FeedStatus, type MeetingFeedOptions, type MeetingFeed } from "./sse-client.js";
// The poll fallback: one poll, and a loop that never overlaps itself.
export { pollEventsOnce, createPoller, PollEnvelope, type Poller } from "./poll-fallback.js";
// The reconnect delays and the page-visibility trigger.
export { reconnectDelayMs, watchVisibility, JITTER_FRACTION, type VisibilitySource } from "./reconnect-schedule.js";
