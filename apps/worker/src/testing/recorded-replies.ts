import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractError, type CallSite, RecordedCall } from "@meet-first/contracts";

// The repository path of one fixture file.
export function recordedReplyPath(callSite: CallSite, requestHash: string): string {
  return join(fileURLToPath(new URL("../../../../packages/evals/fixtures/model-replies", import.meta.url)), callSite, `${requestHash}.json`);
}

// Reads one fixture and parses it with RecordedCall; a missing file throws replay_fixture_missing with the modes.ts sentence.
export function loadRecordedReply(callSite: CallSite, requestHash: string): RecordedCall {
  const path = recordedReplyPath(callSite, requestHash);
  if (!existsSync(path)) {
    throw new ContractError("replay_fixture_missing", `No recorded reply for ${callSite} ${requestHash}. Record the flow once in record mode or write the fixture by hand.`, 500);
  }
  return RecordedCall.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

// Throws unless the fixture's usage passes the check, so a test can assert recorded token counts (R3.3).
export function assertRecordedUsage(callSite: CallSite, requestHash: string, predicate: (usage: RecordedCall["usage"]) => boolean): void {
  const usage = loadRecordedReply(callSite, requestHash).usage;
  if (!predicate(usage)) throw new Error(`recorded usage check failed for ${callSite} ${requestHash}: ${JSON.stringify(usage)}`);
}
