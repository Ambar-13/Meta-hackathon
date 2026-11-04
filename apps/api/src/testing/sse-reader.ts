// One frame item: an event with its id (null for a delta), its event name and its data, or a comment line such as the :hb heartbeat or the padding.
export type SseItem = { id: string | null; event: string; data: string } | { comment: string };

// The fields one frame's lines carry, collected before the frame becomes an item.
type FrameFields = { id?: string; event?: string; data: string[] };
// Why a read stopped: the time was up, the stream ended, or the wanted event came.
type StopReason = "timeout" | "ended" | "reached";
// What a read has collected so far: the text not yet cut into frames, and the items already made.
type ReadState = { buffer: string; items: SseItem[] };

// Splits one field line into its name and its value, with one leading space removed from the value.
function splitFieldLine(line: string): { field: string; value: string } {
  const separator = line.indexOf(":");
  if (separator < 0) {
    return { field: line, value: "" };
  }
  const rest = line.slice(separator + 1);
  return { field: line.slice(0, separator), value: rest.startsWith(" ") ? rest.slice(1) : rest };
}

// Keeps the id, event and data a field line carries; other field names are ignored.
function applyField(fields: FrameFields, field: string, value: string): void {
  if (field === "id") fields.id = value;
  if (field === "event") fields.event = value;
  if (field === "data") fields.data.push(value);
}

// Parses one frame (the text between two blank lines) into items: one item per comment line, then one event item when the frame has an id, event or data field.
export function parseSseFrame(frame: string): SseItem[] {
  const items: SseItem[] = [];
  const fields: FrameFields = { data: [] };
  for (const line of frame.split("\n")) {
    if (line === "") {
      continue;
    }
    if (line.startsWith(":")) {
      items.push({ comment: line.slice(1) });
      continue;
    }
    const { field, value } = splitFieldLine(line);
    applyField(fields, field, value);
  }
  if (fields.id !== undefined || fields.event !== undefined || fields.data.length > 0) {
    items.push({
      id: fields.id ?? null,
      event: fields.event ?? "message",
      data: fields.data.join("\n"),
    });
  }
  return items;
}

// True when an item is an event whose id is the wanted seq or more.
function reachesSeq(item: SseItem, untilSeq: number | undefined): boolean {
  return untilSeq !== undefined && "id" in item && item.id !== null && Number(item.id) >= untilSeq;
}

// Adds the chunk to the buffer, cuts every complete frame out of it, and says whether the wanted event has come.
function absorbChunk(state: ReadState, chunk: string, untilSeq: number | undefined): boolean {
  state.buffer += chunk;
  let cut = state.buffer.indexOf("\n\n");
  while (cut >= 0) {
    const frame = state.buffer.slice(0, cut);
    state.buffer = state.buffer.slice(cut + 2);
    for (const item of parseSseFrame(frame)) {
      state.items.push(item);
      if (reachesSeq(item, untilSeq)) {
        return true;
      }
    }
    cut = state.buffer.indexOf("\n\n");
  }
  return false;
}

// What one read loop needs: the reader and decoder, the timer, the state it fills, and the wanted seq.
type ReadLoop = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  timeout: Promise<"timeout">;
  state: ReadState;
  untilSeq: number | undefined;
};

// Reads chunks until the stream ends, the time is up, or the wanted event has come, and says which.
async function readUntilStop(loop: ReadLoop): Promise<StopReason> {
  for (;;) {
    const next = await Promise.race([loop.reader.read(), loop.timeout]);
    if (next === "timeout") {
      return "timeout";
    }
    if (next.done) {
      return "ended";
    }
    if (absorbChunk(loop.state, loop.decoder.decode(next.value, { stream: true }), loop.untilSeq)) {
      return "reached";
    }
  }
}

// Reads an SSE body into frames, stopping at the first event whose id is untilSeq or more, at the end of the stream, or at timeoutMs.
export async function readSse(
  response: ReadableStream<Uint8Array>,
  options: { untilSeq?: number; timeoutMs: number },
): Promise<SseItem[]> {
  const reader = response.getReader();
  const decoder = new TextDecoder();
  const state: ReadState = { buffer: "", items: [] };
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    handle = setTimeout(() => {
      resolve("timeout");
    }, options.timeoutMs);
  });
  const reason = await readUntilStop({
    reader,
    decoder,
    timeout,
    state,
    untilSeq: options.untilSeq,
  });
  clearTimeout(handle);
  await reader.cancel().catch(() => undefined);
  if (reason === "timeout" && options.untilSeq !== undefined) {
    throw new Error(
      `sse_read_timeout: no event with id ${String(options.untilSeq)} or more within ${String(options.timeoutMs)} ms; got ${String(state.items.length)} items`,
    );
  }
  return state.items;
}
