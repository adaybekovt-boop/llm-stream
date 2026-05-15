import { describe, expect, it } from "vitest";
import { anthropicMapper } from "../src/providers/anthropic.js";
import { openaiMapper } from "../src/providers/openai.js";
import type { ProviderState, SSEEvent } from "../src/types.js";

function freshState(): ProviderState {
  return {
    textCumulative: "",
    thinkingCumulative: "",
    toolBuffers: new Map(),
    activeToolId: null,
    activeBlockIsThinking: false,
    finishReason: null,
    usage: null,
  };
}

describe("openai mapper — edge cases", () => {
  it("handles [DONE] sentinel", () => {
    const state = freshState();
    const events = openaiMapper({ event: undefined, data: "[DONE]" } as SSEEvent, state);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("done");
  });

  it("emits recoverable error on bad JSON", () => {
    const state = freshState();
    const events = openaiMapper({ event: undefined, data: "{nope" } as SSEEvent, state);
    expect(events[0]?.type).toBe("error");
    if (events[0]?.type === "error") expect(events[0].recoverable).toBe(true);
  });

  it("emits error for unparseable tool args at finish", () => {
    const state = freshState();
    openaiMapper(
      {
        data: JSON.stringify({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_x",
                    function: { name: "fn", arguments: "{bad" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      } as SSEEvent,
      state,
    );
    const events = openaiMapper(
      {
        data: JSON.stringify({
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        }),
      } as SSEEvent,
      state,
    );
    expect(events.some((e) => e.type === "error" && e.recoverable)).toBe(true);
    expect(events.some((e) => e.type === "tool_use_end")).toBe(true);
  });
});

describe("anthropic mapper — edge cases", () => {
  it("emits recoverable error on bad JSON", () => {
    const state = freshState();
    const events = anthropicMapper(
      { event: "content_block_delta", data: "{nope" } as SSEEvent,
      state,
    );
    expect(events[0]?.type).toBe("error");
  });

  it("ignores ping events", () => {
    const state = freshState();
    const events = anthropicMapper({ event: "ping", data: '{"type":"ping"}' } as SSEEvent, state);
    expect(events).toHaveLength(0);
  });

  it("emits error for unparseable tool args at content_block_stop", () => {
    const state = freshState();
    anthropicMapper(
      {
        event: "content_block_start",
        data: JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "t1", name: "fn" },
        }),
      } as SSEEvent,
      state,
    );
    anthropicMapper(
      {
        event: "content_block_delta",
        data: JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: "{bad" },
        }),
      } as SSEEvent,
      state,
    );
    const events = anthropicMapper(
      {
        event: "content_block_stop",
        data: JSON.stringify({ type: "content_block_stop", index: 0 }),
      } as SSEEvent,
      state,
    );
    expect(events.some((e) => e.type === "error" && e.recoverable)).toBe(true);
    expect(events.some((e) => e.type === "tool_use_end")).toBe(true);
  });
});
