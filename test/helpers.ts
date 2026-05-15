import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

export function loadFixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf-8");
}

export function stringToStream(text: string, chunkSize?: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const size = chunkSize ?? bytes.length;
  let pos = 0;
  return new ReadableStream({
    pull(controller) {
      if (pos >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(pos + size, bytes.length);
      controller.enqueue(bytes.slice(pos, end));
      pos = end;
    },
  });
}

export function bytesToStream(bytes: Uint8Array, chunkSize?: number): ReadableStream<Uint8Array> {
  const size = chunkSize ?? bytes.length;
  let pos = 0;
  return new ReadableStream({
    pull(controller) {
      if (pos >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(pos + size, bytes.length);
      controller.enqueue(bytes.slice(pos, end));
      pos = end;
    },
  });
}
