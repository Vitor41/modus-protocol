import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildCodexArguments, finalizeHandoff, launchRoles } from "../src/role-launcher.mjs";

const request = {
  mapping_version: "gpt-5.6-2026-08-28",
  profile: "PROFUNDO",
  model: "gpt-5.6-sol",
  reasoning_effort: "high",
  agent_mode: "delegated",
  configuration_source: "kernel-profile-map",
  fallback_policy: "block"
};

test("launcher fixa modelo, esforço, aprovação automática e tarefa efêmera", async () => {
  const root = await mkdtemp(join(tmpdir(), "role-launcher-"));
  const promptFile = join(root, "prompt.txt");
  await writeFile(promptFile, "Refine o card informado.", "utf8");
  try {
    const { args } = buildCodexArguments({ projectRoot: root, role: "pipeline-po", promptFile, handoffPath: join(root, "handoff.json"), request });
    assert.ok(args.includes("gpt-5.6-sol"));
    assert.ok(args.includes('model_reasoning_effort="high"'));
    assert.ok(args.includes("--approve-for-me"));
    assert.ok(args.includes("--ephemeral"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("launcher carimba recibo com thread real e sem fallback", () => {
  const result = finalizeHandoff({ handoff: { role: "pipeline-po", profile: "RAPIDO", execution: {} }, request, role: "pipeline-po", threadId: "01a07e2e-8af0-70f3-b763-3588c5f9df86" });
  assert.equal(result.profile, "PROFUNDO");
  assert.equal(result.execution.request, request);
  assert.deepEqual(result.execution.observation, {
    status: "confirmed",
    model: "gpt-5.6-sol",
    reasoning_effort: "high",
    configuration_source: "explicit-codex-exec",
    evidence_ref: "agent:codex-thread:01a07e2e-8af0-70f3-b763-3588c5f9df86",
    fallback_used: false
  });
});

test("launcher inicia lanes independentes antes de aguardar suas conclusões", async () => {
  const root = await mkdtemp(join(tmpdir(), "role-launcher-many-"));
  const manifestPath = join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ jobs: [
    { lane: "technical", role: "pipeline-dev", promptFile: "dev.txt", executionRequest: "dev-request.json", handoff: "dev-handoff.json" },
    { lane: "ux_ui", role: "pipeline-ux-ui", promptFile: "ux.txt", executionRequest: "ux-request.json", handoff: "ux-handoff.json" },
    { lane: "po", role: "pipeline-po", promptFile: "po.txt", executionRequest: "po-request.json", handoff: "po-handoff.json" }
  ] }), "utf8");
  const started = [];
  const pending = [];
  try {
    const execution = launchRoles({ projectRoot: root, manifest: "manifest.json" }, { launchAsync: (job) => {
      started.push(job.lane);
      return new Promise((resolve) => pending.push(() => resolve({ lane: job.lane, status: "PASS", job_status: "completed" })));
    }});
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ["technical", "ux_ui", "po"]);
    pending.forEach((complete) => complete());
    const result = await execution;
    assert.equal(result.status, "PASS");
    assert.equal(result.launch_strategy, "parallel");
    assert.equal(result.completion_barrier, "all-jobs-terminal");
    assert.equal(result.active_jobs, 0);
    assert.equal(result.jobs.length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("launcher preserva lane concluída quando outra falha e publica status terminal", async () => {
  const root = await mkdtemp(join(tmpdir(), "role-launcher-partial-"));
  const manifestPath = join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ jobs: [
    { lane: "technical", role: "pipeline-dev", promptFile: "dev.txt", executionRequest: "dev-request.json", handoff: "dev-handoff.json" },
    { lane: "ux_ui", role: "pipeline-ux-ui", promptFile: "ux.txt", executionRequest: "ux-request.json", handoff: "ux-handoff.json" }
  ] }), "utf8");
  try {
    const result = await launchRoles({ projectRoot: root, manifest: "manifest.json" }, { launchAsync: async (job) => {
      if (job.lane === "ux_ui") throw new Error("limite temporário do agente");
      return { lane: job.lane, role: job.role, status: "PASS", job_status: "completed", handoff: job.handoff };
    }});
    assert.equal(result.status, "PARTIAL");
    assert.equal(result.completion_barrier, "all-jobs-terminal");
    assert.equal(result.active_jobs, 0);
    assert.equal(result.jobs[0].job_status, "completed");
    assert.equal(result.jobs[1].job_status, "failed");
    const ledger = JSON.parse(await readFile(`${manifestPath}.status.json`, "utf8"));
    assert.equal(ledger.status, "PARTIAL");
    assert.equal(ledger.active_jobs, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
