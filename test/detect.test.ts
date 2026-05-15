import { describe, expect, it } from "vitest";
import { parseStream } from "../src/index.js";
import type { StreamEvent } from "../src/index.js";
import { loadFixture, stringToStream } from "./helpers.js";

async function collectAuto(text: string): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const ev of parseStream(stringToStream(text), {
    provider: "auto",
  })) {
    events.push(ev);
  }
  return events;
}

describe("detect: auto provider (0.1.0 supports OpenAI + Anthropic)", () => {
  it("detects Anthropic via event: header", async () => {
    const text = loadFixture("anthropic-text.txt");
    const events = await collectAuto(text);
    const out = events
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.delta : ""))
      .join("");
    expect(out).toBe("Hello, world!");
  });

  it("detects OpenAI via JSON shape", async () => {
    const text = loadFixture("openai-text.txt");
    const events = await collectAuto(text);
    const out = events
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.delta : ""))
      .join("");
    expect(out).toBe("Hello, world!");
  });
});
