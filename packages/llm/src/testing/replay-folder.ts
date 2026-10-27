import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type RecordedCall } from "@meet-first/contracts";

// The folder of the scripted replies that tests replay: each written by hand for one test case, such as a judge that fails or a reply
// that cannot be read. They sit apart from model-replies, which holds only recordings of the real model (wave 3 section 4.4, R13.3).
export const SCRIPTED_REPLIES_DIR = fileURLToPath(new URL("../../../evals/fixtures/scripted-replies", import.meta.url));

// Makes a temporary fixture folder with the given RecordedCall files, for tests that replay without the real fixtures (a fake, named as such in tests).
export async function makeReplayFolder(calls: RecordedCall[]): Promise<{ root: string; remove: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "replay-"));
  for (const call of calls) {
    await mkdir(join(root, call.callSite), { recursive: true });
    await writeFile(join(root, call.callSite, `${call.requestHash}.json`), JSON.stringify(call, null, 2));
  }
  return { root, remove: () => rm(root, { recursive: true, force: true }) };
}
