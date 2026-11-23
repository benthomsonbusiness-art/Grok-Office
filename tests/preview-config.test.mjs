import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWranglerConfig() {
  const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const json = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(json);
}

test("preview builds bind the same office Durable Object as production", () => {
  const config = readWranglerConfig();
  assert.deepEqual(config.previews?.durable_objects?.bindings, config.durable_objects.bindings);
  assert.equal(config.previews.durable_objects.bindings[0].class_name, "OfficeHub");
  assert.ok(config.migrations.some((migration) => migration.new_sqlite_classes?.includes("OfficeHub")));
});
