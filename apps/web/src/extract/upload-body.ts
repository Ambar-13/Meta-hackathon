import { ContractError, HTTP, UPLOAD_COMPRESSED_MAX_BYTES, UPLOAD_DECODED_MAX_BYTES, type SourceHeader, type Turn } from "@meet-first/contracts";

// Shown when the body is over a cap; the API uses the same code and sentence.
export const UPLOAD_TOO_LARGE_SENTENCE = "The upload is over the size limit. Export a shorter date range, or paste fewer notes.";

// The request body and the sizes checked against the caps of.
export type EncodedBody = { body: Blob; contentEncoding: "gzip" | null; decodedBytes: number; encodedBytes: number };

// The refusal for a body over one of the two caps.
function tooLarge(): ContractError {
  return new ContractError("upload_too_large", UPLOAD_TOO_LARGE_SENTENCE, HTTP.payloadTooLarge);
}

// Refuses a body whose NDJSON is over 20 MiB, checked before any compression runs.
function checkDecodedSize(decodedBytes: number): void {
  if (decodedBytes > UPLOAD_DECODED_MAX_BYTES) throw tooLarge();
}

// Refuses a body that is over 8 MiB as sent, whichever encoding it has, the same rule the API applies.
function checkEncodedSize(encodedBytes: number): void {
  if (encodedBytes > UPLOAD_COMPRESSED_MAX_BYTES) throw tooLarge();
}

// Writes the SourceHeader line, then one Turn line per turn, joined by "\n", with no newline at the end.
export function buildNdjson(header: SourceHeader, turns: readonly Turn[]): string {
  return [JSON.stringify(header), ...turns.map((turn) => JSON.stringify(turn))].join("\n");
}

// True when this browser has CompressionStream; iOS Safari support is unverified.
export function hasCompressionStream(): boolean {
  return typeof globalThis.CompressionStream === "function";
}

// Gzips a text through CompressionStream and returns the compressed bytes as a Blob.
export async function gzipText(text: string): Promise<Blob> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

// Gzips the NDJSON when it can, else sends it as is; refuses over 20 MiB decoded or 8 MiB as sent.
export async function encodeUploadBody(ndjson: string): Promise<EncodedBody> {
  const decodedBytes = new TextEncoder().encode(ndjson).length;
  checkDecodedSize(decodedBytes);
  const isCompressed = hasCompressionStream();
  const body = isCompressed ? await gzipText(ndjson) : new Blob([ndjson], { type: "application/x-ndjson" });
  const encodedBytes = body.size;
  checkEncodedSize(encodedBytes);
  return { body, contentEncoding: isCompressed ? "gzip" : null, decodedBytes, encodedBytes };
}
