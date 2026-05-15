import { describe, expect, it } from "vitest";
import { parseStream } from "../src/index.js";
import type { StreamEvent } from "../src/index.js";
import { bytesToStream, loadFixture, stringToStream } from "./helpers.js";

async function collect(
  stream: ReadableStream<Uint8Array>,
  provider: Parameters<typeof parseStream>[1]["provider"],
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const ev of parseStream(stream, { provider })) {
    events.push(ev);
  }
  return events;
}

describe("parseStream — OpenAI text", () => {
  it("emits text deltas and done", async () => {
    const text = loadFixture("openai-text.txt");
    const events = await collect(stringToStream(text), "openai");

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents.map((e) => e.type === "text" && e.delta)).toEqual([
      "Hello",
      ", ",
      "world",
      "!",
    ]);

    const last = textEvents[textEvents.length - 1];
    expect(last?.type === "text" && last.cumulative).toBe("Hello, world!");

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done?.type === "done" && done.reason).toBe("stop");
    expect(done?.type === "done" && done.usage).toEqual({
      input_tokens: 10,
      output_tokens: 4,
    });
  });

  it("produces identical output regardless of chunk size", async () => {
    const text = loadFixture("openai-text.txt");
    const reference = await collect(stringToStream(text), "openai");

    for (const size of [1, 5, 100]) {
      const events = await collect(stringToStream(text, size), "openai");
      expect(stripErrorObjects(events)).toEqual(stripErrorObjects(reference));
    }
  });
});

describe("parseStream — OpenAI tool use", () => {
  it("accumulates JSON args across deltas and parses on tool_use_end", async () => {
    const text = loadFixture("openai-tool-use.txt");
    const events = await collect(stringToStream(text), "openai");

    const start = events.find((e) => e.type === "tool_use_start");
    expect(start?.type === "tool_use_start" && start.name).toBe("get_weather");
    expect(start?.type === "tool_use_start" && start.id).toBe("call_abc");

    const deltas = events.filter((e) => e.type === "tool_use_delta");
    expect(deltas).toHaveLength(3);

    const end = events.find((e) => e.type === "tool_use_end");
    expect(end?.type === "tool_use_end" && end.input).toEqual({
      location: "Paris",
    });

    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" && done.reason).toBe("tool_use");
  });
});

describe("parseStream — OpenAI thinking", () => {
  it("emits thinking events from reasoning_content", async () => {
    const text = loadFixture("openai-thinking.txt");
    const events = await collect(stringToStream(text), "openai");

    const thinking = events.filter((e) => e.type === "thinking");
    expect(thinking).toHaveLength(2);
    const last = thinking[thinking.length - 1];
    expect(last?.type === "thinking" && last.cumulative).toBe("Let me think about this...");

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents[0]?.type === "text" && textEvents[0].delta).toBe("Answer is 42");
  });
});

describe("parseStream — Anthropic text", () => {
  it("emits text deltas, ignores ping, emits done with usage", async () => {
    const text = loadFixture("anthropic-text.txt");
    const events = await collect(stringToStream(text), "anthropic");

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents.map((e) => e.type === "text" && e.delta)).toEqual(["Hello", ", ", "world!"]);

    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" && done.reason).toBe("stop");
    expect(done?.type === "done" && done.usage?.output_tokens).toBe(4);
  });

  it("is robust to 1-byte chunking including across multi-byte UTF-8", async () => {
    const text = loadFixture("anthropic-text.txt");
    const reference = await collect(stringToStream(text), "anthropic");
    const events = await collect(stringToStream(text, 1), "anthropic");
    expect(stripErrorObjects(events)).toEqual(stripErrorObjects(reference));
  });
});

describe("parseStream — Anthropic tool use", () => {
  it("accumulates partial_json and parses on content_block_stop", async () => {
    const text = loadFixture("anthropic-tool-use.txt");
    const events = await collect(stringToStream(text), "anthropic");

    const start = events.find((e) => e.type === "tool_use_start");
    expect(start?.type === "tool_use_start" && start.name).toBe("get_weather");
    expect(start?.type === "tool_use_start" && start.id).toBe("toolu_01");

    const end = events.find((e) => e.type === "tool_use_end");
    expect(end?.type === "tool_use_end" && end.input).toEqual({
      location: "Paris",
    });

    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" && done.reason).toBe("tool_use");
  });
});

describe("parseStream — Anthropic thinking", () => {
  it("emits thinking events for thinking_delta", async () => {
    const text = loadFixture("anthropic-thinking.txt");
    const events = await collect(stringToStream(text), "anthropic");

    const thinking = events.filter((e) => e.type === "thinking");
    const last = thinking[thinking.length - 1];
    expect(last?.type === "thinking" && last.cumulative).toBe("Let me reason step by step.");

    const text2 = events.filter((e) => e.type === "text");
    expect(text2[0]?.type === "text" && text2[0].delta).toBe("The answer is 42.");
  });
});

describe("parseStream — Anthropic error", () => {
  it("emits error event for error event_type", async () => {
    const text = loadFixture("anthropic-error.txt");
    const events = await collect(stringToStream(text), "anthropic");
    const err = events.find((e) => e.type === "error");
    expect(err?.type === "error" && err.error.message).toContain("Overloaded");
  });
});

describe("parseStream — unsupported providers in 0.1.0", () => {
  it("emits error event when google mapper is invoked", async () => {
    const text = 'data: {"candidates":[{"content":{"parts":[{"text":"x"}]}}]}\n\n';
    const events = await collect(stringToStream(text), "google");
    const err = events.find((e) => e.type === "error");
    expect(err?.type === "error" && err.error.message).toContain("not supported");
  });
});

describe("parseStream — UTF-8 across chunk boundaries", () => {
  it("decodes multi-byte chars correctly even when split", async () => {
    const payload = {
      choices: [{ index: 0, delta: { content: "héllo 🌍 wörld" } }],
    };
    const sse = `data: ${JSON.stringify(payload)}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`;
    const bytes = new TextEncoder().encode(sse);

    const events = await collect(bytesToStream(bytes, 1), "openai");
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents[0]?.type === "text" && textEvents[0].delta).toBe("héllo 🌍 wörld");
  });
});

describe("parseStream — error recovery", () => {
  it("recovers from a malformed JSON chunk and continues", async () => {
    const sse =
      'data: {"choices":[{"index":0,"delta":{"content":"A"}}]}\n\n' +
      "data: {not valid json}\n\n" +
      'data: {"choices":[{"index":0,"delta":{"content":"B"},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n";

    const events = await collect(stringToStream(sse), "openai");
    const textDeltas = events
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.delta : ""));
    expect(textDeltas).toEqual(["A", "B"]);

    const errors = events.filter((e) => e.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.type === "error" && errors[0].recoverable).toBe(true);
  });
});

describe("parseStream — abort handling", () => {
  it("emits done event with reason=error when aborted", async () => {
    const controller = new AbortController();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        if (pulls === 1) {
          c.enqueue(
            new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"X"}}]}\n\n'),
          );
          controller.abort();
        } else {
          c.close();
        }
      },
    });

    const events: StreamEvent[] = [];
    for await (const ev of parseStream(stream, {
      provider: "openai",
      signal: controller.signal,
    })) {
      events.push(ev);
    }

    const done = events.find((e) => e.type === "done");
    expect(done?.type === "done" && done.reason).toBe("error");
  });
});

describe("parseStream — callback API", () => {
  it("invokes callbacks and returns a thenable promise", async () => {
    const text = loadFixture("openai-text.txt");
    const textDeltas: string[] = [];
    let doneReason: string | undefined;

    await parseStream(stringToStream(text), {
      provider: "openai",
      onText: (e) => textDeltas.push(e.delta),
      onDone: (e) => {
        doneReason = e.reason;
      },
    });

    expect(textDeltas.join("")).toBe("Hello, world!");
    expect(doneReason).toBe("stop");
  });
});

describe("parseStream — Response input", () => {
  it("accepts a Response object", async () => {
    const text = loadFixture("openai-text.txt");
    const response = new Response(stringToStream(text));
    const events: StreamEvent[] = [];
    for await (const ev of parseStream(response, { provider: "openai" })) {
      events.push(ev);
    }
    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});

function stripErrorObjects(events: StreamEvent[]): unknown[] {
  return events.map((e) => {
    if (e.type === "error") {
      return { type: "error", message: e.error.message, recoverable: e.recoverable };
    }
    return e;
  });
}
