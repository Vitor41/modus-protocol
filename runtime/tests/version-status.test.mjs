import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { getVersionStatus } from "../src/version-status.mjs";

async function project(kernel = { name: "unified-development-pipeline", distribution: "local-plugin" }) {
  const root = await mkdtemp(join(tmpdir(), "modus-version-"));
  await mkdir(join(root, ".pipeline"));
  await writeFile(join(root, ".pipeline", "project.adapter.yaml"), YAML.stringify({ kernel }));
  return root;
}

test("status comprova runtime ativo e origem antes do tracker", async () => {
  const root = await project();
  try {
    const result = getVersionStatus({ projectRoot: root });
    assert.equal(result.status, "PASS");
    assert.equal(result.active.runtime_version, "0.2.1");
    assert.match(result.active.runtime_root, /runtime$/u);
    assert.equal(result.project.required_kernel, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status não compara pinagem legada do adapter", async () => {
  const root = await project({ name: "unified-development-pipeline", distribution: "local-plugin", version: "9.9.9", update_policy: "pinned" });
  try {
    const result = getVersionStatus({ projectRoot: root });
    assert.equal(result.status, "PASS");
    assert.ok(!result.diagnostics.some((item) => item.code === "ACTIVE_RUNTIME_INCOMPATIBLE"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
