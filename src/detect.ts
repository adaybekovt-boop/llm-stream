import type { Provider } from "./types.js";

export function detectProvider(firstChunk: string): Exclude<Provider, "auto"> {
  return firstChunk.includes("event:") ? "anthropic" : "openai";
}
