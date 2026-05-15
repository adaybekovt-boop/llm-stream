export type Provider = "openai" | "anthropic" | "google" | "mistral" | "cohere" | "xai" | "auto";

export type FinishReason = "stop" | "length" | "tool_use" | "content_filter" | "error";

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface TextEvent {
  type: "text";
  delta: string;
  cumulative: string;
}

export interface ToolUseStartEvent {
  type: "tool_use_start";
  id: string;
  name: string;
}

export interface ToolUseDeltaEvent {
  type: "tool_use_delta";
  id: string;
  delta: string;
}

export interface ToolUseEndEvent {
  type: "tool_use_end";
  id: string;
  input: unknown;
}

export interface ThinkingEvent {
  type: "thinking";
  delta: string;
  cumulative: string;
}

export interface CitationEvent {
  type: "citation";
  text: string;
  source: string;
}

export interface ErrorEvent {
  type: "error";
  error: Error;
  recoverable: boolean;
}

export interface DoneEvent {
  type: "done";
  reason: FinishReason;
  usage?: Usage;
}

export type StreamEvent =
  | TextEvent
  | ToolUseStartEvent
  | ToolUseDeltaEvent
  | ToolUseEndEvent
  | ThinkingEvent
  | CitationEvent
  | ErrorEvent
  | DoneEvent;

export interface ParseOptions {
  provider: Provider;
  signal?: AbortSignal;
  onText?: (event: TextEvent) => void;
  onToolUse?: (event: ToolUseStartEvent | ToolUseDeltaEvent | ToolUseEndEvent) => void;
  onThinking?: (event: ThinkingEvent) => void;
  onCitation?: (event: CitationEvent) => void;
  onError?: (event: ErrorEvent) => void;
  onDone?: (event: DoneEvent) => void;
  debug?: (message: string, data?: unknown) => void;
}

export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

export type StreamInput = Response | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

export interface ProviderState {
  textCumulative: string;
  thinkingCumulative: string;
  toolBuffers: Map<string, { name: string; args: string }>;
  activeToolId: string | null;
  activeBlockIsThinking: boolean;
  finishReason: FinishReason | null;
  usage: Usage | null;
}

export type ProviderMapper = (
  sseEvent: SSEEvent,
  state: ProviderState,
  debug?: (msg: string, data?: unknown) => void,
) => StreamEvent[];
