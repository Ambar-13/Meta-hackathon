import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import { ContractError, HTTP } from "@meet-first/contracts";
import { CODEX_FILE_NAME, type ExtractInput } from "@meet-first/parsers";
import { collectFile, collectorFor } from "./text-collectors.js";

// A picked file larger than this is refused before any byte is read: 150 MB, read as decimal
// megabytes.
export const ZIP_MAX_BYTES = 150_000_000;
// Reading stops once this many bytes have been inflated across a zip's entries: 1.5 GB, read as
// decimal gigabytes.
export const INFLATED_MAX_BYTES = 1_500_000_000;
// The first four bytes of every zip file: P, K, 3, 4.
export const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;
// Compressed bytes handed to the inflater per push; DEFLATE expands at most about 1,032 times, so
// one push adds at most 4,227,072 bytes before the counter is checked.
export const INFLATE_SLICE_BYTES = 4_096;
// Names a file that is not a zip may have and still be read as text, .jsonl being a Codex session
// log.
export const TEXT_FILE_NAME = /\.(json|jsonl|md|txt)$/i;
// Shown when a file cannot be read; the worker also uses it for any failure it did not expect.
export const FILE_UNREADABLE_SENTENCE =
  "This file could not be read. Pick the .zip, .json, .jsonl, .md or .txt file again, or paste your notes instead.";

// Shown when a zip is over 150 MB; the code is zip_too_large.
const ZIP_TOO_LARGE_SENTENCE =
  "This file is over 150 MB, more than a phone browser can read. Export a shorter date range, or paste your notes instead.";
// Shown when a zip unpacks to more than 1.5 GB; the code is zip_inflated_too_large.
const ZIP_INFLATED_TOO_LARGE_SENTENCE =
  "This zip unpacks to more than 1.5 GB, so reading stopped. Pick conversations.json on its own, or export a shorter date range.";

// How one read reports and limits inflation; the cap is a parameter so a test can use a small one.
export type ReadOptions = { inflatedCapBytes: number; onInflated: (inflatedBytes: number) => void };

// The state one zip read shares between its entry callbacks: bytes inflated so far, and the refusal
// that stops the read.
type ZipProgress = { inflated: number; failure: ContractError | null };

// The two lists a zip read fills: conversations.json entries, and every other text entry.
type ZipLists = { preferred: ExtractInput[]; others: ExtractInput[] };

// Everything one zip read shares with each entry it starts: where the text goes, the running count,
// and the caller's options.
type ZipContext = { lists: ZipLists; progress: ZipProgress; options: ReadOptions };

// The refusal for a zip entry that could not be inflated.
function unreadable(): ContractError {
  return new ContractError("file_unreadable", FILE_UNREADABLE_SENTENCE, HTTP.unprocessable);
}

// True when the first four bytes are the zip signature, whatever the file is called.
export function isZip(head: Uint8Array): boolean {
  return head.length >= 4 && ZIP_SIGNATURE.every((byte, index) => head[index] === byte);
}

// Which list a zip entry belongs to, or null when the entry is never inflated: conversations.json
// first, else text names outside __MACOSX and not dot files.
function listFor(name: string): keyof ZipLists | null {
  const baseName = (name.split("/").pop() ?? "").toLowerCase();
  if (baseName === "conversations.json") return "preferred";
  if (name.split("/").includes("__MACOSX") || baseName.startsWith("._")) return null;
  return TEXT_FILE_NAME.test(name) ? "others" : null;
}

// Starts inflating one wanted entry; each piece counts toward the cap, and an entry past the cap
// stops the whole read.
function startEntry(entry: UnzipFile, context: ZipContext): void {
  const target = listFor(entry.name);
  if (target === null) return;
  const { lists, progress, options } = context;
  const collector = collectorFor(entry.name);
  entry.ondata = (error, chunk, isFinal) => {
    if (error) {
      progress.failure = unreadable();
      return;
    }
    progress.inflated += chunk.length;
    options.onInflated(progress.inflated);
    if (progress.inflated > options.inflatedCapBytes) {
      progress.failure = new ContractError(
        "zip_inflated_too_large",
        ZIP_INFLATED_TOO_LARGE_SENTENCE,
        HTTP.payloadTooLarge,
      );
      entry.terminate();
      return;
    }
    collector.push(chunk);
    if (isFinal) lists[target].push({ name: entry.name, text: collector.finish() });
  };
  entry.start();
}

// Hands one slice to the unzipper; a broken zip makes the push throw, which the page reports as an
// unreadable file.
function pushSlice(unzip: Unzip, data: Uint8Array, isFinal = false): void {
  try {
    unzip.push(data, isFinal);
  } catch {
    throw unreadable();
  }
}

// Reads the file in slices, so the inflated counter is checked after every slice and never at the
// size the zip claims.
async function pumpFile(file: Blob, unzip: Unzip, progress: ZipProgress): Promise<void> {
  const reader = file.stream().getReader();
  let result = await reader.read();
  while (!result.done) {
    const value = result.value;
    for (let offset = 0; offset < value.length; offset += INFLATE_SLICE_BYTES) {
      pushSlice(unzip, value.subarray(offset, offset + INFLATE_SLICE_BYTES));
      if (progress.failure !== null) {
        await reader.cancel();
        throw progress.failure;
      }
    }
    result = await reader.read();
  }
  pushSlice(unzip, new Uint8Array(0), true);
}

// Streams a zip and returns the entries to parse, counting inflated bytes and stopping past the
// cap.
export async function readZipEntries(file: Blob, options: ReadOptions): Promise<ExtractInput[]> {
  const lists: ZipLists = { preferred: [], others: [] };
  const progress: ZipProgress = { inflated: 0, failure: null };
  const context: ZipContext = { lists, progress, options };
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (entry: UnzipFile) => {
    startEntry(entry, context);
  };
  await pumpFile(file, unzip, progress);
  if (progress.failure !== null) throw progress.failure;
  return lists.preferred.length > 0 ? lists.preferred : lists.others;
}

// Reads a picked file into parser inputs: a zip through readZipEntries, a Codex .jsonl session log
// a chunk at a time keeping only the lines its reader wants, and a .json, .md or .txt file as UTF-8
// text.
export async function readPickedFile(file: File, options: ReadOptions): Promise<ExtractInput[]> {
  if (file.size > ZIP_MAX_BYTES)
    throw new ContractError("zip_too_large", ZIP_TOO_LARGE_SENTENCE, HTTP.payloadTooLarge);
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (isZip(head)) return readZipEntries(file, options);
  if (!TEXT_FILE_NAME.test(file.name)) {
    throw new ContractError("file_unreadable", FILE_UNREADABLE_SENTENCE, HTTP.unprocessable);
  }
  if (CODEX_FILE_NAME.test(file.name))
    return [{ name: file.name, text: await collectFile(file, collectorFor(file.name)) }];
  return [{ name: file.name, text: new TextDecoder("utf-8").decode(await file.arrayBuffer()) }];
}
