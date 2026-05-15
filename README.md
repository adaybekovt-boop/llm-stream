# llm-stream

[![npm version](https://img.shields.io/npm/v/llm-stream.svg)](https://www.npmjs.com/package/llm-stream)
[![bundle size](https://img.shields.io/badge/gzip-%3C3KB-brightgreen)](#bundle-size)
[![license](https://img.shields.io/npm/l/llm-stream.svg)](./LICENSE)

Zero-dependency, provider-agnostic SSE parser for LLM streaming responses. Browser + Node.js. TypeScript-first. Under 3KB minified+gzipped.

`llm-stream` turns the raw SSE byte stream from any LLM provider into a unified, typed event stream — text deltas, tool calls, thinking blocks, finish reasons, usage — without bundling an HTTP client or framework.

## Why

Every developer writes the same boilerplate to consume LLM streams:

| Step | Raw `fetch` | `llm-stream` |
|---|---|---|
| Open stream | ~5 lines | ✨ already done |
| Decode UTF-8 | ~3 lines | ✨ |
| Split on `data:` | ~10 lines | ✨ |
| Parse JSON | ~3 lines | ✨ |
| Extract deltas | ~15 lines | ✨ |
| Handle tool calls | ~20 lines | ✨ |
| Handle each provider differently | ×N | one API |
| **Total** | **~60 lines/provider** | **3 lines** |

Existing options are either heavy (Vercel AI SDK ≈ 50KB+ with framework deps), generic (`eventsource-parser` doesn't know LLM semantics), or single-provider.

## Installation

```bash
npm i llm-stream
```

No dependencies. Works in Node.js 18+, Deno, Bun, Cloudflare Workers, and modern browsers.

## Quickstart

### OpenAI

```ts
import { parseStream } from "llm-stream";

const response = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  },
  body: JSON.stringify({
    model: "gpt-4o",
    stream: true,
    messages: [{ role: "user", content: "Hello!" }],
  }),
});

for await (const event of parseStream(response, { provider: "openai" })) {
  if (event.type === "text") process.stdout.write(event.delta);
  else if (event.type === "done") console.log("\n", event.usage);
}
```

### Anthropic

```ts
import { parseStream } from "llm-stream";

const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY!,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    stream: true,
    messages: [{ role: "user", content: "Hello!" }],
  }),
});

for await (const event of parseStream(response, { provider: "anthropic" })) {
  if (event.type === "text") process.stdout.write(event.delta);
  else if (event.type === "thinking") console.error("[thinking]", event.delta);
  else if (event.type === "tool_use_end") console.log("tool:", event.input);
  else if (event.type === "done") console.log("\n", event.reason, event.usage);
}
```

### Auto-detect provider

```ts
for await (const event of parseStream(response, { provider: "auto" })) {
  // library inspects the first chunk and picks the right parser
}
```

### Callback style

```ts
await parseStream(response, {
  provider: "openai",
  onText: ({ delta }) => process.stdout.write(delta),
  onToolUse: (event) => {
    if (event.type === "tool_use_end") console.log("tool:", event.input);
  },
  onDone: ({ reason, usage }) => console.log(reason, usage),
});
```

When any callback is provided, `parseStream` returns a thenable that resolves on stream completion. Mix both styles as you see fit.

### Abort

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

for await (const event of parseStream(response, {
  provider: "openai",
  signal: controller.signal,
})) {
  // clean done event with reason: 'error' on abort
}
```

## Event types

All events are members of a discriminated union with a literal `type` field.

```ts
type StreamEvent =
  | { type: "text"; delta: string; cumulative: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_delta"; id: string; delta: string }
  | { type: "tool_use_end"; id: string; input: unknown }
  | { type: "thinking"; delta: string; cumulative: string }
  | { type: "citation"; text: string; source: string }
  | { type: "error"; error: Error; recoverable: boolean }
  | {
      type: "done";
      reason: "stop" | "length" | "tool_use" | "content_filter" | "error";
      usage?: { input_tokens: number; output_tokens: number };
    };
```

The `cumulative` field on `text` / `thinking` is computed by the library — you don't need to maintain your own buffer.

`tool_use_end.input` is the fully-parsed JSON for the tool call. The library accumulates `tool_use_delta` fragments per tool-call `id` and parses them when the call completes. If parsing fails, you get a recoverable `error` event and iteration continues.

## Provider support

| Provider  | Status (0.1.0) | Text | Tool use | Thinking | Citations |
|-----------|----------------|------|----------|----------|-----------|
| OpenAI    | ✅ shipped      | ✅   | ✅       | ✅ (o1)   | —         |
| Anthropic | ✅ shipped      | ✅   | ✅       | ✅       | ✅        |
| Google    | planned 0.2.0   | —    | —        | —        | —         |
| Mistral   | planned 0.3.0   | —    | —        | —        | —         |
| Cohere    | planned 0.3.0   | —    | —        | —        | —         |
| xAI       | planned 0.3.0   | —    | —        | —        | —         |

Auto-detection in 0.1.0 picks between OpenAI and Anthropic based on the first chunk.

## Bundle size

```bash
npm run size
```

The published ESM bundle is under 3KB minified + gzipped. Verified in CI; the build fails if it regresses past the limit.

## Error handling

- Network or runtime errors propagate as `error` events with `recoverable: false`, followed by a `done` event with `reason: "error"`. Iteration ends.
- Malformed JSON inside an SSE payload emits an `error` event with `recoverable: true`. Iteration continues.
- Aborting the `AbortController` ends iteration with `{ type: "done", reason: "error" }`.

The library never throws synchronously from the iterator — every failure flows through events.

## License

MIT — see [LICENSE](./LICENSE).

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on adding providers and capturing fixtures.
