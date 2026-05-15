import type { SSEEvent } from "./types.js";

export interface SSEParserState {
  buffer: string;
  decoder: TextDecoder;
}

export function createSSEState(): SSEParserState {
  return {
    buffer: "",
    decoder: new TextDecoder("utf-8"),
  };
}

export function feedChunk(
  state: SSEParserState,
  chunk: Uint8Array | undefined,
  flush = false,
): SSEEvent[] {
  if (chunk && chunk.length > 0) {
    state.buffer += state.decoder.decode(chunk, { stream: !flush });
  } else if (flush) {
    state.buffer += state.decoder.decode();
  }

  const events: SSEEvent[] = [];
  const buf = state.buffer;
  let start = 0;
  let i = 0;

  while (i < buf.length) {
    const lf = buf.indexOf("\n\n", i);
    const crlf = buf.indexOf("\r\n\r\n", i);
    let boundary = -1;
    let boundaryLen = 0;

    if (lf === -1 && crlf === -1) break;
    if (lf === -1) {
      boundary = crlf;
      boundaryLen = 4;
    } else if (crlf === -1) {
      boundary = lf;
      boundaryLen = 2;
    } else if (crlf < lf) {
      boundary = crlf;
      boundaryLen = 4;
    } else {
      boundary = lf;
      boundaryLen = 2;
    }

    const block = buf.slice(start, boundary);
    const parsed = parseEventBlock(block);
    if (parsed) events.push(parsed);

    i = boundary + boundaryLen;
    start = i;
  }

  state.buffer = buf.slice(start);
  return events;
}

function parseEventBlock(block: string): SSEEvent | null {
  if (block.length === 0) return null;

  const lines = block.split(/\r?\n/);
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  const dataLines: string[] = [];
  let hasField = false;

  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.startsWith(":")) continue;

    let field: string;
    let value: string;
    const colon = line.indexOf(":");
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
    }

    hasField = true;
    switch (field) {
      case "event":
        event = value;
        break;
      case "data":
        dataLines.push(value);
        break;
      case "id":
        id = value;
        break;
      case "retry": {
        const n = Number.parseInt(value, 10);
        if (!Number.isNaN(n)) retry = n;
        break;
      }
      default:
        break;
    }
  }

  if (!hasField) return null;

  return {
    event,
    data: dataLines.join("\n"),
    id,
    retry,
  };
}
