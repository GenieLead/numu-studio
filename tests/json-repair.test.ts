import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonWithLocalRepair } from "../lib/json-repair.ts";

test("parses valid and fenced JSON", () => {
  assert.deepEqual(parseJsonWithLocalRepair('{"ok":true}'), { ok: true });
  assert.deepEqual(parseJsonWithLocalRepair('```json\n{"ok":true}\n```'), { ok: true });
});

test("repairs a missing comma between array strings", () => {
  const value = parseJsonWithLocalRepair('{"items":["one"\n"two"]}');
  assert.deepEqual(value, { items: ["one", "two"] });
});

test("repairs a missing comma between array objects", () => {
  const value = parseJsonWithLocalRepair('{"shots":[{"id":"S01"}\n{"id":"S02"}]}');
  assert.deepEqual(value, { shots: [{ id: "S01" }, { id: "S02" }] });
});

test("repairs trailing commas without inventing values", () => {
  const value = parseJsonWithLocalRepair('{"items":["one",],}');
  assert.deepEqual(value, { items: ["one"] });
});

test("rejects structurally incomplete content", () => {
  assert.throws(() => parseJsonWithLocalRepair('{"items":["one"'));
});
