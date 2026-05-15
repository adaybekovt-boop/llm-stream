# Contributing to llm-stream

Thanks for your interest. This project keeps a tight scope: zero deps, under 3KB gzipped, no framework integrations in the core.

## Adding a provider

1. Capture a real SSE response from the provider as a `.txt` file in `test/fixtures/`. Include at minimum a text-only and a tool-use stream.
2. Implement a mapper in `src/providers/<name>.ts`. The mapper takes a parsed `SSEEvent` plus a mutable `ProviderState` and returns an array of normalized `StreamEvent` objects.
3. Register it in `src/parser.ts` and the auto-detect logic in `src/detect.ts`.
4. Add fixture-based tests that assert exact event sequences.
5. Keep the bundle under 3KB gzipped. Run `npm run size` to verify.

## Coding style

- TypeScript strict mode. No `any`. No `@ts-ignore`.
- Functions, not classes.
- Only Web Standard APIs (no `node:*` imports).
- Format with `npm run format`.

## Running tests

```bash
npm install
npm test
```
