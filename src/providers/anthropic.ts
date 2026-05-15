import type { FinishReason, ProviderMapper, ProviderState, StreamEvent } from "../types.js";

interface AntChunk {
  type?: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    thinking?: string;
    stop_reason?: string;
    citation?: { cited_text?: string; url?: string; source?: string };
  };
  message?: {
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

const STOP: Record<string, FinishReason> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_use",
  refusal: "content_filter",
};

const blockMaps = new WeakMap<ProviderState, Map<number, string>>();

export const anthropicMapper: ProviderMapper = (sseEvent, state) => {
  const out: StreamEvent[] = [];
  const raw = sseEvent.data.trim();
  if (!raw) return out;

  let chunk: AntChunk;
  try {
    chunk = JSON.parse(raw) as AntChunk;
  } catch (err) {
    out.push({
      type: "error",
      error: new Error(`Bad JSON: ${(err as Error).message}`),
      recoverable: true,
    });
    return out;
  }

  let idxMap = blockMaps.get(state);
  if (!idxMap) {
    idxMap = new Map();
    blockMaps.set(state, idxMap);
  }

  const type = sseEvent.event ?? chunk.type;
  const index = chunk.index ?? 0;

  if (type === "message_start") {
    const u = chunk.message?.usage;
    if (u) {
      state.usage = {
        input_tokens: u.input_tokens ?? 0,
        output_tokens: u.output_tokens ?? 0,
      };
    }
  } else if (type === "content_block_start") {
    const block = chunk.content_block;
    if (block) {
      if (block.type === "tool_use" && block.id && block.name) {
        idxMap.set(index, block.id);
        state.toolBuffers.set(block.id, { name: block.name, args: "" });
        state.activeToolId = block.id;
        out.push({ type: "tool_use_start", id: block.id, name: block.name });
      } else {
        state.activeBlockIsThinking = block.type === "thinking";
      }
    }
  } else if (type === "content_block_delta") {
    const d = chunk.delta;
    if (d) {
      if (d.type === "text_delta" && typeof d.text === "string") {
        state.textCumulative += d.text;
        out.push({
          type: "text",
          delta: d.text,
          cumulative: state.textCumulative,
        });
      } else if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
        const id = idxMap.get(index);
        if (id) {
          const buf = state.toolBuffers.get(id);
          if (buf) buf.args += d.partial_json;
          out.push({ type: "tool_use_delta", id, delta: d.partial_json });
        }
      } else if (d.type === "thinking_delta" && typeof d.thinking === "string") {
        state.thinkingCumulative += d.thinking;
        out.push({
          type: "thinking",
          delta: d.thinking,
          cumulative: state.thinkingCumulative,
        });
      } else if (d.type === "citations_delta" && d.citation) {
        out.push({
          type: "citation",
          text: d.citation.cited_text ?? "",
          source: d.citation.url ?? d.citation.source ?? "",
        });
      }
    }
  } else if (type === "content_block_stop") {
    const id = idxMap.get(index);
    if (id) {
      const buf = state.toolBuffers.get(id);
      if (buf) {
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
        state.toolBuffers.delete(id);
      }
      idxMap.delete(index);
    }
    state.activeBlockIsThinking = false;
  } else if (type === "message_delta") {
    const stop = chunk.delta?.stop_reason;
    if (stop) state.finishReason = STOP[stop] ?? "stop";
    if (chunk.usage) {
      const e = state.usage ?? { input_tokens: 0, output_tokens: 0 };
      state.usage = {
        input_tokens: chunk.usage.input_tokens ?? e.input_tokens,
        output_tokens: chunk.usage.output_tokens ?? e.output_tokens,
      };
    }
  } else if (type === "message_stop") {
    out.push({
      type: "done",
      reason: state.finishReason ?? "stop",
      ...(state.usage ? { usage: state.usage } : {}),
    });
  } else if (type === "error") {
    out.push({
      type: "error",
      error: new Error(chunk.error?.message ?? "Anthropic stream error"),
      recoverable: false,
    });
  }

  return out;
};
