import { CODEX_FILE_NAME, isCodexLineWanted } from "@meet-first/parsers";

// Gathers the bytes of one file as they arrive and gives back the text the parser reads once the last chunk is in.
export type TextCollector = { push: (chunk: Uint8Array) => void; finish: () => string };

// Keeps every byte of a file and reads them as UTF-8 text at the end.
function everyByte(): TextCollector {
  const chunks: Uint8Array[] = [];
  return {
    push: (chunk) => {
      chunks.push(chunk);
    },
    finish: () => {
      const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      return new TextDecoder("utf-8").decode(joined);
    },
  };
}

// Keeps only the wanted lines of a file, judging each line as soon as its line break arrives, so the rest of a large file is never
// held. A line split across chunks, or a character split between its bytes, is joined before it is judged. The kept lines come back
// joined by "\n".
export function wantedLines(isWanted: (line: string) => boolean): TextCollector {
  const decoder = new TextDecoder("utf-8");
  const kept: string[] = [];
  const pending: string[] = [];
  const judge = (line: string): void => {
    if (isWanted(line)) kept.push(line);
  };
  return {
    push: (chunk) => {
      const text = decoder.decode(chunk, { stream: true });
      let start = 0;
      for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n", start)) {
        pending.push(text.slice(start, end));
        judge(pending.join(""));
        pending.length = 0;
        start = end + 1;
      }
      if (start < text.length) pending.push(text.slice(start));
    },
    finish: () => {
      pending.push(decoder.decode());
      judge(pending.join(""));
      return kept.join("\n");
    },
  };
}

// The collector for one file: the lines the Codex reader wants from a Codex session log (.jsonl), every byte of anything else. One
// Codex session can run to hundreds of megabytes, almost all of it tool output and the agent's own work.
export function collectorFor(name: string): TextCollector {
  return CODEX_FILE_NAME.test(name) ? wantedLines(isCodexLineWanted) : everyByte();
}

// Reads a whole file through a collector, a chunk at a time.
export async function collectFile(file: Blob, collector: TextCollector): Promise<string> {
  const reader = file.stream().getReader();
  for (let result = await reader.read(); !result.done; result = await reader.read()) collector.push(result.value);
  return collector.finish();
}
