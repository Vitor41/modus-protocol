import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildPlugin } from "../scripts/build-plugin.mjs";

const REPOSITORY_DIR = resolve(import.meta.dirname, "..", "..");
const NODE = process.execPath;
const EXPECTED_SKILLS = [
  "pipeline-code-review",
  "pipeline-dev",
  "pipeline-doctor",
  "pipeline-po",
  "pipeline-qa",
  "pipeline-run",
  "pipeline-setup",
  "pipeline-ux-ui"
];

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const built = await buildPlugin();

test("artefato contém exatamente as oito Skills", async () => {
  const skills = (await readdir(join(built.targetRoot, "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(skills, EXPECTED_SKILLS);
});

test("Skills empacotadas são byte a byte iguais à fonte", async () => {
  for (const skill of EXPECTED_SKILLS) {
    for (const relativePath of ["SKILL.md", "agents/openai.yaml"]) {
      const source = await readFile(join(REPOSITORY_DIR, "skills", skill, relativePath));
      const artifact = await readFile(join(built.targetRoot, "skills", skill, relativePath));
      assert.equal(hash(artifact), hash(source), `${skill}/${relativePath}`);
    }
  }
});

test("runtime standalone executa doctor sem node_modules no plugin", () => {
  const result = spawnSync(
    NODE,
    [
      join(built.targetRoot, "runtime", "src", "doctor.mjs"),
      "--project-root",
      REPOSITORY_DIR,
      "--adapter",
      join(REPOSITORY_DIR, "tests", "fixtures", "adapters", "valid-minimal.json"),
      "--mode",
      "structural",
      "--format",
      "json"
    ],
    { cwd: REPOSITORY_DIR, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "PASS");
});

test("runtime standalone expõe status de versão antes do tracker", () => {
  const result = spawnSync(NODE, [join(built.targetRoot, "runtime", "src", "version-status.mjs"), "--project-root", REPOSITORY_DIR, "--adapter", join(REPOSITORY_DIR, "examples", "project.adapter.example.yaml"), "--format", "json"], { cwd: REPOSITORY_DIR, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.status, "PASS");
  assert.equal(status.active.runtime_version, "0.1.16");
});

test("planner empacotado não executa o CLI interno do doctor", () => {
  const result = spawnSync(NODE, [join(built.targetRoot, "runtime", "src", "run-planner.mjs"), "--help"], { cwd: REPOSITORY_DIR, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /pipeline-doctor/);
});

test("runtime standalone valida handoff DEV", () => {
  const result = spawnSync(
    NODE,
    [
      join(built.targetRoot, "runtime", "src", "role-gate.mjs"),
      "--handoff",
      join(REPOSITORY_DIR, "tests", "fixtures", "handoffs", "valid-dev.json"),
      "--format",
      "json"
    ],
    { cwd: REPOSITORY_DIR, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "PASS");
});

test("artefato inclui gate e schema de transição", async () => {
  const gate = await readFile(join(built.targetRoot, "runtime", "src", "transition-gate.mjs"), "utf8");
  const schema = JSON.parse(
    await readFile(join(built.targetRoot, "schema", "tracker-transition-receipt.schema.json"), "utf8")
  );
  assert.match(gate, /pipeline-transition-gate/);
  assert.match(schema.$id, /tracker-transition-receipt/);
});

test("artefato inclui cliente de comentários Trello", async () => {
  const client = await readFile(join(built.targetRoot, "runtime", "src", "trello-comments.mjs"), "utf8");
  assert.match(client, /pipeline-trello-comments/);
});

test("artefato inclui launcher determinístico", async () => {
  const launcher = await readFile(join(built.targetRoot, "runtime", "pipeline.ps1"), "utf8");
  assert.match(launcher, /codex-primary-runtime/);
  assert.match(launcher, /não crie scripts substitutos/);
  assert.match(launcher, /'status' = 'version-status\.mjs'/);
});

test("artefato inclui executor oficial de comandos do adapter", async () => {
  const runner = await readFile(join(built.targetRoot, "runtime", "src", "command-runner.mjs"), "utf8");
  assert.match(runner, /pipeline-command/);
  assert.match(runner, /project-runtime/);
});

test("manifest, runtime e build-info compartilham a mesma versão", async () => {
  const manifest = JSON.parse(await readFile(join(built.targetRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const runtimePackage = JSON.parse(await readFile(join(built.targetRoot, "runtime", "package.json"), "utf8"));
  const buildInfo = JSON.parse(await readFile(join(built.targetRoot, ".codex-plugin", "build-info.json"), "utf8"));
  assert.equal(manifest.version, runtimePackage.version);
  assert.equal(buildInfo.plugin.version, manifest.version);
  assert.equal(buildInfo.source.runtime_version, manifest.version);
});
