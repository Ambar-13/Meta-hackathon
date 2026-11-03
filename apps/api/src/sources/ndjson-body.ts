import { createGunzip } from "node:zlib";
import { z } from "zod";
import { ContractError, HTTP, SourceHeader, TURNS_PER_SOURCE_MAX, Turn, UPLOAD_COMPRESSED_MAX_BYTES, UPLOAD_DECODED_MAX_BYTES } from "@meet-first/contracts";
import { makePayloadInvalidError } from "../route-errors.js";

// The decoded body split into its SourceHeader line and its Turn lines.
export type ParsedSourceBody = { header: SourceHeader; turns: Turn[] };

// The sentence for a body over either size cap. The browser shows the same sentence for the same cap.
const UPLOAD_TOO_LARGE_SENTENCE = "The upload is over the size limit. Export a shorter date range, or paste fewer notes.";
// The sentence for a body that says it is gzip and is not.
const NOT_GZIP_SENTENCE = "The upload says it is gzip but is not. Upload again from the app.";
// The sentence for a Content-Encoding the server does not read.
const ENCODING_UNSUPPORTED_SENTENCE = "The upload uses an encoding the server does not read. Upload again from the app.";
// The sentence for a header that announces more messages than one source may hold.
const TOO_MANY_TURNS_SENTENCE = "The upload has more than 10,000 messages. Upload again from the app, which keeps the 10,000 most useful ones.";
// The sentence for a body with no message written by the uploader (on the server too).
const NO_OWN_TURNS_SENTENCE = "No messages written by you were found in this file. Pick the export file itself (conversations.json inside the zip), or paste some notes instead.";
// The sentence for a header that does not carry the attestation.
const NOT_ATTESTED_SENTENCE = "Tick the box that says these are your own chats, then upload again.";
// The sentence for a header whose count does not match the lines that came after it.
const COUNT_MISMATCH_SENTENCE = "The number of messages in the upload does not match its first line. Upload again from the app.";

// The refusal for a body over one of the two caps.
function tooLarge(): ContractError {
  return new ContractError("upload_too_large", UPLOAD_TOO_LARGE_SENTENCE, HTTP.payloadTooLarge);
}

// Inflates a gzip body, and refuses it as soon as the inflated total passes the decoded cap, so a small bomb stops early.
function inflateGzip(raw: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];
    let total = 0;
    gunzip.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > UPLOAD_DECODED_MAX_BYTES) {
        gunzip.destroy();
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    gunzip.on("error", () => {
      reject(new ContractError("upload_not_gzip", NOT_GZIP_SENTENCE, HTTP.badRequest));
    });
    gunzip.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    gunzip.end(raw);
  });
}

// Returns the body's bytes, inflated when Content-Encoding is gzip; refuses more than 8 MiB as sent or 20 MiB decoded.
export async function decodeUploadBody(raw: Buffer, contentEncoding: string | undefined): Promise<Buffer> {
  if (raw.length > UPLOAD_COMPRESSED_MAX_BYTES) throw tooLarge();
  const encoding = (contentEncoding ?? "identity").trim().toLowerCase();
  if (encoding === "identity") return raw;
  if (encoding !== "gzip") {
    throw new ContractError("upload_encoding_unsupported", ENCODING_UNSUPPORTED_SENTENCE, HTTP.badRequest);
  }
  return inflateGzip(raw);
}

// Splits the decoded bytes into lines, dropping one final line break; an empty body or a blank line is a shape error.
function splitLines(decoded: Buffer): string[] {
  const lines = decoded.toString("utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0 || lines.includes("")) throw makePayloadInvalidError();
  return lines;
}

// Reads one NDJSON line as JSON; a line that does not parse is a shape error.
function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw makePayloadInvalidError();
  }
}

// Refuses a header that announces too many messages, and a body with no messages, before anything else is read.
function checkAnnouncedCounts(headerValue: unknown, turnLines: number): void {
  const announced = z.object({ turnCount: z.number() }).safeParse(headerValue);
  const announcedCount = announced.success ? announced.data.turnCount : undefined;
  if ((announcedCount !== undefined && announcedCount > TURNS_PER_SOURCE_MAX) || turnLines > TURNS_PER_SOURCE_MAX) {
    throw new ContractError("source_too_many_turns", TOO_MANY_TURNS_SENTENCE, HTTP.payloadTooLarge);
  }
  if (announcedCount === 0 || turnLines === 0) {
    throw new ContractError("source_no_own_turns", NO_OWN_TURNS_SENTENCE, HTTP.unprocessable);
  }
}

// Refuses a header that does not say the uploader attested the chats.
function checkAttested(headerValue: unknown): void {
  if (!z.object({ attested: z.literal(true) }).safeParse(headerValue).success) {
    throw new ContractError("source_not_attested", NOT_ATTESTED_SENTENCE, HTTP.unprocessable);
  }
}

// Reads every turn line, checking each one's shape and that its turnIndex is its position after the header.
function parseTurnLines(lines: string[]): Turn[] {
  return lines.map((line, position) => {
    const parsed = Turn.safeParse(parseJsonLine(line));
    if (!parsed.success || parsed.data.turnIndex !== position) throw makePayloadInvalidError();
    return parsed.data;
  });
}

// Splits decoded NDJSON into the header and the turns, checking caps and counts in a fixed order.
export function parseSourceBody(decoded: Buffer): ParsedSourceBody {
  const lines = splitLines(decoded);
  const [headerLine = "", ...turnLines] = lines;
  const headerValue = parseJsonLine(headerLine);
  checkAnnouncedCounts(headerValue, turnLines.length);
  checkAttested(headerValue);
  const header = SourceHeader.safeParse(headerValue);
  if (!header.success) throw makePayloadInvalidError();
  if (turnLines.length !== header.data.turnCount) {
    throw new ContractError("source_turn_count_mismatch", COUNT_MISMATCH_SENTENCE, HTTP.unprocessable);
  }
  return { header: header.data, turns: parseTurnLines(turnLines) };
}
