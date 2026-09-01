import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("declares the current HAYK studio metadata", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const layout = await readFile(`${root}/app/layout.tsx`, "utf8");
  assert.match(layout, /title:\s*["']HAYK — NUMU Creative Director["']/);
  assert.match(layout, /icon:\s*["']\/favicon\.svg["']/);
});
