import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

test("manifest is a narrowly scoped Chromium MV3 extension", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://api.deepseek.com/*"]);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://x.com/*", "https://*.x.com/*"]);
});

test("manifest references files that form the runtime boundary", () => {
  assert.equal(manifest.background.service_worker, "service-worker.js");
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.options_page, "options.html");
});
