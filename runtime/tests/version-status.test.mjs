import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { getVersionStatus } from "../src/version-status.mjs";

async function project(version, updatePolicy = "latest-compatible") {
  const root = await mkdtemp(join(tmpdir(), "modus-version-"));
  await mkdir(join(root, ".pipeline"));
  await writeFile(join(root, ".pipeline", "project.adapter.yaml"), YAML.stringify({ kernel: { version, update_policy: updatePolicy } }));
  return root;
}

test("status comprova runtime ativo e origem antes do tracker", async () => {
  const root = await project("0.1.12");
  try {
    const result = getVersionStatus({ projectRoot: root });
    assert.equal(result.status, "PASS");
    assert.equal(result.active.runtime_version, "0.1.12");
    assert.match(result.active.runtime_root, /runtime$/u);
    assert.equal(result.project.required_kernel, "0.1.12");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status bloqueia tarefa carregada abaixo do piso do projeto", async () => {
  const root = await project("0.1.13");
  try {
    const result = getVersionStatus({ projectRoot: root });
    assert.equal(result.status, "FAIL");
    assert.ok(result.diagnostics.some((item) => item.code === "ACTIVE_RUNTIME_INCOMPATIBLE"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("status respeita igualdade exata da política pinned", async () => {
  const root = await project("0.1.10", "pinned");
  try {
    const result = getVersionStatus({ projectRoot: root });
    assert.equal(result.status, "FAIL");
  } finally { await rm(root, { recursive: true, force: true }); }
});
