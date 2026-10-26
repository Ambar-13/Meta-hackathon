import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RecordedCall } from "@meet-first/contracts";

// Makes a temporary fixture folder with the given RecordedCall files, for tests that replay without the real fixtures (a fake, named as such in tests).
export async function makeReplayFolder(calls: RecordedCall[]): Promise<{ root: string; remove: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "replay-"));
  for (const call of calls) {
    await mkdir(join(root, call.callSite), { recursive: true });
    await writeFile(join(root, call.callSite, `${call.requestHash}.json`), JSON.stringify(call, null, 2));
  }
  return { root, remove: () => rm(root, { recursive: true, force: true }) };
}
