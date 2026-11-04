import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { CallSite, RecordedCall } from "@meet-first/contracts";
import { requestHash } from "../modes.js";
import { SCRIPTED_REPLIES_DIR } from "./replay-folder.js";

// Writes one hand-written fixture into the scripted replies tests replay: the request file names
// the call, the response file holds the reply and its usage. Hand-written replies never go into
// model-replies, which holds only recordings.
export function writeFixture(
  callSiteArgument: string,
  requestPath: string,
  responsePath: string,
): number {
  const callSite = CallSite.parse(callSiteArgument);
  const request = JSON.parse(readFileSync(requestPath, "utf8")) as {
    callSite: string;
    promptVersion: string;
    body: Record<string, unknown>;
  };
  if (request.callSite !== callSite) {
    console.log("write-fixture: the call site argument differs from the request file");
    return 1;
  }
  const response = JSON.parse(readFileSync(responsePath, "utf8")) as {
    response: Record<string, unknown>;
    usage: RecordedCall["usage"];
  };
  const hash = requestHash(request.body);
  const call = RecordedCall.parse({
    callSite,
    promptVersion: request.promptVersion,
    requestHash: hash,
    request,
    response: response.response,
    usage: response.usage,
    recordedAt: null,
    handWritten: true,
  });
  const target = join(SCRIPTED_REPLIES_DIR, callSite, `${hash}.json`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(call, null, 2)}\n`);
  console.log(target);
  return 0;
}

// The command line: pnpm --filter @meet-first/llm write-fixture <callSite> <request.json>
// <response.json>.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [callSite, requestPath, responsePath] = process.argv.slice(2);
  if (callSite === undefined || requestPath === undefined || responsePath === undefined) {
    console.log("write-fixture: use <callSite> <request.json> <response.json>");
    process.exitCode = 2;
  } else {
    process.exitCode = writeFixture(callSite, requestPath, responsePath);
  }
}
