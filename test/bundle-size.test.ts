import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const BUNDLE = "dist/index.js";
const LIMIT = 3072;

describe("bundle size", () => {
  it("is under 3KB gzipped", () => {
    if (!existsSync(BUNDLE)) {
      execSync("npx tsup", { stdio: "inherit" });
    }
    const bytes = readFileSync(BUNDLE);
    const gzipped = gzipSync(bytes);
    const size = gzipped.length;
    console.log(`bundle: ${statSync(BUNDLE).size}b raw, ${size}b gzipped (limit ${LIMIT})`);
    expect(size).toBeLessThan(LIMIT);
  });

  it("imports no node:* modules", () => {
    if (!existsSync(BUNDLE)) {
      execSync("npx tsup", { stdio: "inherit" });
    }
    const code = readFileSync(BUNDLE, "utf-8");
    expect(code).not.toMatch(/from\s+["']node:/);
    expect(code).not.toMatch(/require\(["']node:/);
  });
});
