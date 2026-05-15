import type { FinishReason, ProviderMapper, ProviderState, StreamEvent } from "../types.js";

interface OAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

const FINISH: Record<string, FinishReason> = {
  stop: "stop",
  length: "length",
  tool_calls: "tool_use",
  function_call: "tool_use",
  content_filter: "content_filter",
};

const indexMaps = new WeakMap<ProviderState, Map<number, string>>();

export const openaiMapper: ProviderMapper = (sseEvent, state) => {
  const out: StreamEvent[] = [];
  const raw = sseEvent.data.trim();
  if (!raw) return out;
  if (raw === "[DONE]") {
    out.push({
      type: "done",
      reason: state.finishReason ?? "stop",
      ...(state.usage ? { usage: state.usage } : {}),
    });
    return out;
  }

  let chunk: OAIChunk;
  try {
    chunk = JSON.parse(raw) as OAIChunk;
  } catch (err) {
    out.push({
      type: "error",
      error: new Error(`Bad JSON: ${(err as Error).message}`),
      recoverable: true,
    });
    return out;
  }

  let idxMap = indexMaps.get(state);
  if (!idxMap) {
    idxMap = new Map();
    indexMaps.set(state, idxMap);
  }

  if (chunk.usage) {
    state.usage = {
      input_tokens: chunk.usage.input_tokens ?? chunk.usage.prompt_tokens ?? 0,
      output_tokens: chunk.usage.output_tokens ?? chunk.usage.completion_tokens ?? 0,
    };
  }

  for (const choice of chunk.choices ?? []) {
    const delta = choice.delta ?? {};

    if (typeof delta.content === "string" && delta.content) {
      state.textCumulative += delta.content;
      out.push({
        type: "text",
        delta: delta.content,
        cumulative: state.textCumulative,
      });
    }

    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      state.thinkingCumulative += delta.reasoning_content;
      out.push({
        type: "thinking",
        delta: delta.reasoning_content,
        cumulative: state.thinkingCumulative,
      });
    }

    for (const tc of delta.tool_calls ?? []) {
      const idx = tc.index;
      let id = tc.id ?? idxMap.get(idx);
      if (!id && tc.function?.name) id = `tool_${idx}`;
      if (id && !idxMap.has(idx)) idxMap.set(idx, id);
      if (!id) continue;

      if (tc.function?.name && !state.toolBuffers.has(id)) {
        state.toolBuffers.set(id, { name: tc.function.name, args: "" });
        state.activeToolId = id;
        out.push({ type: "tool_use_start", id, name: tc.function.name });
      }

      const frag = tc.function?.arguments;
      if (typeof frag === "string" && frag) {
        const buf = state.toolBuffers.get(id);
        if (buf) buf.args += frag;
        out.push({ type: "tool_use_delta", id, delta: frag });
      }
    }

    if (choice.finish_reason) {
      state.finishReason = FINISH[choice.finish_reason] ?? "stop";
      for (const [id, buf] of state.toolBuffers) {
        let input: unknown = {};
        if (buf.args) {
          try {
            input = JSON.parse(buf.args);
          } catch (err) {
            out.push({
              type: "error",
              error: new Error(`Bad tool args ${id}: ${(err as Error).message}`),
              recoverable: true,
            });
            input = buf.args;
          }
        }
        out.push({ type: "tool_use_end", id, input });
      }
      state.toolBuffers.clear();
      state.activeToolId = null;
    }
  }

  return out;
};
