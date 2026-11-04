// The fake live caller and the scripted replies, for tests that replace the vendor (a fake, named
// as such in tests).
export { fakeLiveCaller, type ScriptedReply } from "./fake-live-caller.js";
// The worker's variables for a test in one mode, parsed and raw.
export { testWorkerEnv, testWorkerVariables } from "./fake-live-caller.js";
// A temporary fixture folder with the given recorded calls, and the folder of the scripted replies
// tests replay.
export { makeReplayFolder, SCRIPTED_REPLIES_DIR } from "./replay-folder.js";
