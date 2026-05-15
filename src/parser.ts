import { detectProvider } from "./detect.js";
import { anthropicMapper } from "./providers/anthropic.js";
import { cohereMapper } from "./providers/cohere.js";
import { googleMapper } from "./providers/google.js";
import { mistralMapper } from "./providers/mistral.js";
import { openaiMapper } from "./providers/openai.js";
import { xaiMapper } from "./providers/xai.js";
import { createSSEState, feedChunk } from "./sse.js";
import type {
  ParseOptions,
  Provider,
  ProviderMapper,
  ProviderState,
  StreamEvent,
  StreamInput,
} from "./types.js";

const MAPPERS: Record<Exclude<Provider, "auto">, ProviderMapper> = {
  openai: openaiMapper,
  anthropic: anthropicMapper,
  google: googleMapper,
  mistral: mistralMapper,
  cohere: cohereMapper,
  xai: xaiMapper,
};

function createState(): ProviderState {
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

async function* toAsync(input: StreamInput): AsyncGenerator<Uint8Array> {
  let stream: ReadableStream<Uint8Array> | null = null;
  if (input instanceof Response) {
    if (!input.body) throw new Error("Response has no body");
    stream = input.body;
  } else if (typeof (input as ReadableStream<Uint8Array>).getReader === "function") {
    stream = input as ReadableStream<Uint8Array>;
  }
  if (stream) {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield value;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  for await (const chunk of input as AsyncIterable<Uint8Array>) {
    yield chunk;
  }
}

export function parseStream(
  input: StreamInput,
  options: ParseOptions,
): AsyncIterable<StreamEvent> & PromiseLike<void> {
  const iter = iterate(input, options);
  let runPromise: Promise<void> | null = null;
  const ensurePromise = (): Promise<void> => {
    if (!runPromise) {
      runPromise = (async () => {
        for await (const event of iter) {
          dispatch(event, options);
        }
      })();
    }
    return runPromise;
  };

  const hybrid = {
    [Symbol.asyncIterator]: () => iter[Symbol.asyncIterator](),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for callback API
    then: (onFulfilled?: (() => unknown) | null, onRejected?: ((r: unknown) => unknown) | null) =>
      ensurePromise().then(onFulfilled as never, onRejected as never),
    catch: (onRejected?: ((r: unknown) => unknown) | null) =>
      ensurePromise().catch(onRejected as never),
    finally: (onFinally?: (() => void) | null) => ensurePromise().finally(onFinally as never),
  };

  return hybrid as AsyncIterable<StreamEvent> & PromiseLike<void>;
}

function dispatch(event: StreamEvent, options: ParseOptions): void {
  switch (event.type) {
    case "text":
      options.onText?.(event);
      break;
    case "tool_use_start":
    case "tool_use_delta":
    case "tool_use_end":
      options.onToolUse?.(event);
      break;
    case "thinking":
      options.onThinking?.(event);
      break;
    case "citation":
      options.onCitation?.(event);
      break;
    case "error":
      options.onError?.(event);
      break;
    case "done":
      options.onDone?.(event);
      break;
  }
}

function iterate(input: StreamInput, options: ParseOptions): AsyncIterable<StreamEvent> {
  return { [Symbol.asyncIterator]: () => run(input, options) };
}

async function* run(input: StreamInput, options: ParseOptions): AsyncGenerator<StreamEvent> {
  const sseState = createSSEState();
  const providerState = createState();
  let provider: Exclude<Provider, "auto"> | null =
    options.provider === "auto" ? null : options.provider;
  let mapper: ProviderMapper | null = provider ? MAPPERS[provider] : null;
  let detectionBuffer = "";
  let doneEmitted = false;
  const signal = options.signal;

  if (signal?.aborted) {
    yield { type: "done", reason: "error" };
    return;
  }

  let aborted = false;
  const onAbort = () => {
    aborted = true;
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    try {
      for await (const chunk of toAsync(input)) {
        if (aborted) break;
        const sseEvents = feedChunk(sseState, chunk);

        if (!mapper) {
          detectionBuffer += new TextDecoder().decode(chunk, { stream: true });
          if (sseEvents.length > 0 || detectionBuffer.length > 256) {
            provider = detectProvider(detectionBuffer);
            mapper = MAPPERS[provider];
            options.debug?.(`auto-detected: ${provider}`);
          }
        }

        if (mapper) {
          for (const sse of sseEvents) {
            for (const ev of mapper(sse, providerState, options.debug)) {
              if (ev.type === "done") doneEmitted = true;
              yield ev;
              if (ev.type === "done") return;
            }
          }
        }
      }

      const finalEvents = feedChunk(sseState, undefined, true);
      if (!mapper && finalEvents.length > 0) {
        mapper = MAPPERS[detectProvider(detectionBuffer)];
      }
      if (mapper) {
        for (const sse of finalEvents) {
          for (const ev of mapper(sse, providerState, options.debug)) {
            if (ev.type === "done") doneEmitted = true;
            yield ev;
            if (ev.type === "done") return;
          }
        }
      }
    } catch (err) {
      if (aborted) {
        yield { type: "done", reason: "error" };
        return;
      }
      yield { type: "error", error: err as Error, recoverable: false };
      yield { type: "done", reason: "error" };
      return;
    }

    if (aborted) {
      yield { type: "done", reason: "error" };
      return;
    }

    if (!doneEmitted) {
      yield {
        type: "done",
        reason: providerState.finishReason ?? "stop",
        ...(providerState.usage ? { usage: providerState.usage } : {}),
      };
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
