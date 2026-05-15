# llm-stream

> Zero-dependency, provider-agnostic SSE parser for LLM streaming responses. Browser + Node.js. TypeScript-first. Under 3KB minified+gzipped.

This document is the **complete specification** for the `llm-stream` library. An AI coding agent will implement it from this spec. No code is included here — only instructions, requirements, and architectural decisions.

-----

## 1. Problem statement

Every developer building with LLM APIs (OpenAI, Anthropic, Google Gemini, Mistral, Cohere, xAI, etc.) writes the same boilerplate:

1. Open a `fetch` stream
1. Decode UTF-8 bytes into text
1. Split on SSE delimiters (`data: ...\n\n`)
1. Parse JSON chunks
1. Extract the meaningful fields (text deltas, tool use, finish reasons)
1. Handle provider-specific differences

Existing solutions are either heavy (Vercel AI SDK is 50KB+ with framework dependencies), generic (`eventsource-parser` doesn’t understand LLM semantics), or locked into a single provider.

`llm-stream` solves exactly this: normalizes streaming responses from any LLM provider into a unified event stream of typed events.

-----

## 2. Non-goals

- Not an LLM client. Does not make HTTP requests. Does not handle auth.
- Not a framework. No React/Vue/Svelte integrations in the core package.
- Not a transformer. Does not rewrite, summarize, or modify content.
- Does not handle non-streaming responses.

-----

## 3. Core API surface

The library exports **one primary function** plus **typed event interfaces**.

### Primary function

A single function that accepts:

- A `Response` object (from `fetch`), OR a `ReadableStream<Uint8Array>`, OR an `AsyncIterable<Uint8Array>`
- An options object specifying the provider and optional callbacks

Returns: an `AsyncIterable` of normalized events. The caller iterates with `for await...of`.

Alternative callback-style API: same options object supports `onText`, `onToolUse`, `onThinking`, `onError`, `onDone` callbacks. When callbacks are provided, the function returns a `Promise<void>` that resolves on stream completion.

### Provider parameter

Required. Accepts string literals: `'openai'`, `'anthropic'`, `'google'`, `'mistral'`, `'cohere'`, `'xai'`, or `'auto'`.

When `'auto'` is set, the library inspects the first chunk to detect the provider format. Detection rules:

- Anthropic: chunks begin with `event:` lines
- OpenAI: chunks have `choices[0].delta` structure
- Google: chunks have `candidates[0].content.parts` structure
- Cohere: chunks have `event_type` field
- Default fallback: OpenAI format

### Normalized event types

All events conform to a discriminated union. Required event types:

1. **`text`** — A chunk of assistant text output.
- `delta`: the new text fragment
- `cumulative`: the full text so far (computed by the library)
1. **`tool_use_start`** — Beginning of a tool call.
- `id`: tool call identifier
- `name`: tool name
1. **`tool_use_delta`** — Streaming JSON arguments for the tool.
- `id`: tool call identifier
- `delta`: partial JSON string fragment
1. **`tool_use_end`** — Tool call complete.
- `id`: tool call identifier
- `input`: fully assembled parsed JSON arguments
1. **`thinking`** — Reasoning/thinking content (Anthropic extended thinking, OpenAI o1 reasoning).
- `delta`: thinking text fragment
- `cumulative`: full thinking text so far
1. **`citation`** — A citation block (when supported by provider).
- `text`: cited text
- `source`: source identifier or URL
1. **`error`** — Stream error.
- `error`: Error object
- `recoverable`: boolean indicating whether iteration should continue
1. **`done`** — Stream complete.
- `reason`: finish reason (`'stop'`, `'length'`, `'tool_use'`, `'content_filter'`, `'error'`)
- `usage`: optional token usage object if provider includes it (`input_tokens`, `output_tokens`)

-----

## 4. Implementation requirements

### File structure

The package must have this exact structure:

```
llm-stream/
├── src/
│   ├── index.ts              # Public API exports only
│   ├── parser.ts             # Main parseStream function + dispatch logic
│   ├── sse.ts                # Low-level SSE chunk decoder
│   ├── providers/
│   │   ├── openai.ts         # OpenAI chunk → normalized event mapper
│   │   ├── anthropic.ts      # Anthropic chunk → normalized event mapper
│   │   ├── google.ts         # Google chunk → normalized event mapper
│   │   ├── mistral.ts
│   │   ├── cohere.ts
│   │   └── xai.ts
│   ├── types.ts              # All public types and interfaces
│   └── detect.ts             # Auto-detection logic for 'auto' provider mode
├── test/
│   ├── fixtures/             # Real captured SSE responses from each provider
│   │   ├── openai-text.txt
│   │   ├── openai-tool-use.txt
│   │   ├── anthropic-text.txt
│   │   ├── anthropic-tool-use.txt
│   │   ├── anthropic-thinking.txt
│   │   ├── google-text.txt
│   │   └── (etc for each provider)
│   ├── parser.test.ts
│   ├── providers.test.ts
│   └── detect.test.ts
├── README.md
├── LICENSE                   # MIT
├── package.json
├── tsconfig.json
├── tsup.config.ts            # Build configuration
└── .github/
    └── workflows/
        ├── ci.yml            # Run tests on push
        └── publish.yml       # Publish to npm on tag
```

### Build & tooling

- TypeScript strict mode. No `any`. No `@ts-ignore`.
- Build with `tsup` to produce both ESM and CJS outputs.
- Output `.d.ts` type declarations.
- Target: ES2022.
- Test runner: `vitest`.
- Linter: `biome` (zero config beyond defaults).
- Package manager: any (npm, pnpm, bun work).
- Node.js minimum version: 18 (for native `fetch` and `ReadableStream`).

### Zero dependencies

The `dependencies` field in `package.json` must be empty. `devDependencies` may include only: `typescript`, `tsup`, `vitest`, `@biomejs/biome`, `@types/node`.

### Bundle size constraint

The published ESM bundle must be **under 3KB minified+gzipped**. Verify with `tsup --minify` and `gzip-size`.

### Browser + Node.js compatibility

The library must work identically in:

- Modern browsers (Chrome 100+, Firefox 100+, Safari 16+)
- Node.js 18+
- Deno
- Bun
- Cloudflare Workers (no `Buffer`, no `process`, no Node-only APIs)

Use only Web Standard APIs: `TextDecoder`, `ReadableStream`, `fetch`, `Response`. Never import from `node:*` modules.

-----

## 5. SSE parser specifics

The low-level SSE parser must handle:

1. Chunks split across network packets (a single event may arrive in multiple `Uint8Array` chunks).
1. Multiple events in a single chunk.
1. UTF-8 characters split across chunks (use `TextDecoder` with `{ stream: true }`).
1. Both `\n\n` and `\r\n\r\n` event delimiters.
1. Multi-line `data:` fields (concatenate with `\n`).
1. Comment lines starting with `:` (must be ignored).
1. `event:` lines specifying the event type (Anthropic uses these).
1. `[DONE]` sentinel (OpenAI convention) — emit `done` event and end iteration.

The parser must be **incremental**: it processes chunks as they arrive without buffering the entire stream.

-----

## 6. Provider mapping rules

Each provider mapper takes a parsed SSE event (with `event` name and `data` payload) and yields zero or more normalized events.

### OpenAI

- `choices[0].delta.content` → `text` event
- `choices[0].delta.tool_calls[].function.name` → `tool_use_start`
- `choices[0].delta.tool_calls[].function.arguments` → `tool_use_delta`
- `choices[0].finish_reason` non-null → emit final `tool_use_end` for any in-progress tool calls, then `done`
- `choices[0].delta.reasoning_content` (o1, o3 models) → `thinking` event
- `usage` field on final chunk → include in `done` event

### Anthropic

- `event: message_start` → ignore (just tracks start)
- `event: content_block_start` with `tool_use` type → `tool_use_start`
- `event: content_block_start` with `thinking` type → mark thinking active
- `event: content_block_delta` with `text_delta` → `text` event
- `event: content_block_delta` with `input_json_delta` → `tool_use_delta`
- `event: content_block_delta` with `thinking_delta` → `thinking` event
- `event: content_block_delta` with `citations_delta` → `citation` event
- `event: content_block_stop` for a tool_use block → `tool_use_end` with parsed accumulated JSON
- `event: message_delta` with `stop_reason` → store for done event
- `event: message_stop` → emit `done` event
- `event: error` → emit `error` event

### Google Gemini

- `candidates[0].content.parts[].text` → `text` event
- `candidates[0].content.parts[].functionCall` → emit `tool_use_start`, `tool_use_delta` (full args), and `tool_use_end` in sequence (Google doesn’t stream args incrementally)
- `candidates[0].finishReason` → `done` event
- `usageMetadata` → include in `done` event

### Mistral, Cohere, xAI

Follow the same pattern. Use real captured SSE fixtures as the source of truth for chunk formats.

-----

## 7. Tool use JSON accumulation

For providers that stream tool arguments as JSON fragments (OpenAI, Anthropic), the library accumulates fragments per tool call ID. On `tool_use_end`:

- Concatenate all `tool_use_delta` strings for that ID
- Parse the result as JSON
- Include the parsed object in the `tool_use_end` event’s `input` field

If JSON parsing fails, emit an `error` event with `recoverable: true` and include the raw string in the error message.

-----

## 8. Error handling philosophy

- Network errors: propagate as `error` events with `recoverable: false`. Iteration ends.
- Malformed JSON in SSE payload: emit `error` event with `recoverable: true`. Iteration continues with the next chunk.
- Unknown event types from provider: silently skip (log via optional `debug` callback if provided).
- Aborted streams (caller calls `AbortController.abort()`): emit `done` event with `reason: 'error'` and end iteration cleanly.

The library must **never throw synchronously** from the iterator. All errors flow through `error` events.

-----

## 9. Tests

Tests must cover:

1. **Fixture-based tests**: For each provider, capture real SSE responses (text-only, tool-use, thinking, multi-tool, errors). Store them as `.txt` files in `test/fixtures/`. Tests feed them through the parser and assert exact event sequences.
1. **Chunking robustness**: Take a fixture, split it into 1-byte, 5-byte, 100-byte chunks and feed them progressively. Output must be identical regardless of chunk boundaries.
1. **UTF-8 across chunks**: Verify multi-byte characters split across `Uint8Array` boundaries are decoded correctly.
1. **Auto-detection**: Each provider’s fixture must be correctly identified by `provider: 'auto'`.
1. **Error recovery**: Inject malformed chunks mid-stream. Verify recoverable errors don’t end iteration.
1. **Abort handling**: Verify `AbortController.abort()` produces a clean `done` event.
1. **Bundle size**: A CI step measures the gzipped bundle and fails if it exceeds 3KB.

Target: 95%+ line coverage. 100% on the provider mappers.

-----

## 10. README requirements

The README must include, in this order:

1. One-sentence description + bundle size badge + npm version badge
1. Side-by-side comparison table showing how many lines of boilerplate `llm-stream` replaces vs raw `fetch` for each provider
1. Installation (`npm i llm-stream`)
1. Quickstart example using `for await...of` syntax — OpenAI
1. Same quickstart for Anthropic, Google
1. Callback-style API example
1. Full event type reference with TypeScript signatures
1. Provider support matrix (features × providers)
1. Bundle size verification command
1. License (MIT)
1. Contributing section pointing to `CONTRIBUTING.md`

No emojis except in the comparison table for visual delta. No “passionate” language. No marketing fluff. Code examples must be copy-pasteable and runnable.

-----

## 11. Publishing & versioning

- Use **changesets** (`@changesets/cli`) to manage versions.
- Initial published version: `0.1.0`.
- Stay below `1.0.0` until at least 3 production users confirm stability.
- Publish via GitHub Action triggered on git tag `v*`.
- npm package name: `llm-stream`.
- Set `"sideEffects": false` in package.json for tree-shaking.
- Include `"exports"` field with `import`, `require`, and `types` conditions.

-----

## 12. License

MIT. Single contributor copyright line: the maintainer.

-----

## 13. Release strategy

1. Publish 0.1.0 with OpenAI + Anthropic support only (most common, fastest validation)
1. Post launch tweet/HN: “Zero-dep SSE parser for LLM streaming. Under 3KB. OpenAI + Anthropic out of the box.”
1. Get to 5+ GitHub stars and 1+ external PR before adding more providers
1. Add Google Gemini in 0.2.0
1. Add remaining providers in 0.3.0
1. 1.0.0 when API has been stable for 3 months and 3+ real apps use it in production

-----

## 14. What the agent must NOT do

- Do not add framework integrations (React hooks, Vue composables) to the core package. These go in separate packages later.
- Do not depend on any runtime libraries. Zero deps is non-negotiable.
- Do not use class-based APIs. Prefer functions returning async iterables.
- Do not hand-roll a JSON parser. Use native `JSON.parse`.
- Do not implement retry logic. That’s the caller’s concern.
- Do not add telemetry, analytics, or “first run” prompts.
- Do not write code in `index.ts` beyond re-exports.
- Do not skip writing tests. The fixture-based test suite is the primary correctness contract.

-----

## 15. Definition of done

The library is ready for 0.1.0 publication when:

- [ ] All OpenAI and Anthropic fixture tests pass
- [ ] Bundle size verified under 3KB gzipped
- [ ] README is complete per section 10
- [ ] CI passes on Node 18, 20, 22
- [ ] Type declarations resolve correctly when consumed from a separate TypeScript project
- [ ] Manual smoke test: works in a Cloudflare Worker
- [ ] Manual smoke test: works in a Vite + React browser app
- [ ] LICENSE file present
- [ ] `npm publish --dry-run` shows only `dist/`, `README.md`, `LICENSE`, `package.json`