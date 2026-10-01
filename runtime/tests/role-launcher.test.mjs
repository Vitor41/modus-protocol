import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EventEmitter } from "node:events";

import { buildCodexArguments, finalizeHandoff, launchRoles, prepareRolePrompt } from "../src/role-launcher.mjs";

const request = {
  mapping_version: "modus-model-map-0.3.6",
  profile: "PROFUNDO",
  model: "gpt-5.6-sol",
  reasoning_effort: "high",
  agent_mode: "delegated",
  configuration_source: "kernel-profile-map",
  fallback_policy: "block"
};

test("launcher publica progresso seguro antes do terminal e aguarda close mesmo após turn.completed", async () => {
  const root = await mkdtemp(join(tmpdir(), "role-progress-"));
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const handoffPath = join(root, "handoff.json");
  const manifestPath = join(root, "manifest.json");
  await writeFile(join(root, "prompt.txt"), "Refine o card.");
  await writeFile(join(root, "request.json"), JSON.stringify(request));
  await writeFile(manifestPath, JSON.stringify({ jobs: [{ lane: "po", role: "pipeline-po", promptFile: "prompt.txt", executionRequest: "request.json", handoff: "handoff.json" }] }));
  try {
    const pending = launchRoles({ projectRoot: root, manifest: "manifest.json" }, { spawn: () => child });
    const threadId = "01a07e2e-8af0-70f3-b763-3588c5f9df86";
    const start = JSON.stringify({ type: "thread.started", thread_id: threadId });
    child.stdout.emit("data", start.slice(0, 17));
    child.stdout.emit("data", start.slice(17) + "\n");
    child.stdout.emit("data", JSON.stringify({ type: "item.completed", item: { text: "PRIVATE_SENTINEL" } }) + "\n");
    child.stdout.emit("data", "x".repeat(1024 * 1024 + 1));
    child.stdout.emit("data", '\ninvalid-json\n{"type":"turn.completed"}\n');
    const running = JSON.parse(await readFile(`${manifestPath}.status.json`, "utf8"));
    assert.equal(running.status, "RUNNING");
    assert.equal(running.active_jobs, 1);
    assert.equal(running.completion_barrier, "pending");
    assert.equal(running.jobs[0].evidence_ref, `agent:codex-thread:${threadId}`);
    assert.equal(running.jobs[0].event_count, 3);
    assert.equal(running.jobs[0].last_event_type, "turn.completed");
    assert.ok(Number.isFinite(Date.parse(running.jobs[0].last_event_at)));
    assert.ok(!JSON.stringify(running).includes("PRIVATE_SENTINEL"));
    await writeFile(handoffPath, JSON.stringify({ role: "pipeline-po" }));
    child.emit("close", 0);
    const completed = await pending;
    assert.equal(completed.status, "PASS");
    assert.equal(completed.active_jobs, 0);
    assert.equal(completed.jobs[0].event_count, 3);
    assert.equal(completed.jobs[0].completion_barrier, "terminal-handoff-consumed");
    const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
    assert.equal(handoff.execution.observation.evidence_ref, `agent:codex-thread:${threadId}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

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

test("launcher aceita GPT-6 Luna com esforço médio para a lane equilibrada", async () => {
  const root = await mkdtemp(join(tmpdir(), "role-launcher-gpt6-luna-"));
  const promptFile = join(root, "prompt.txt");
  await writeFile(promptFile, "Implemente a correção aprovada.", "utf8");
  try {
    const balancedRequest = {
      ...request,
      mapping_version: "modus-model-map-0.3.6",
      profile: "EQUILIBRADO",
      model: "gpt-6-luna",
      reasoning_effort: "medium"
    };
    const { args } = buildCodexArguments({ projectRoot: root, role: "pipeline-dev", promptFile, handoffPath: join(root, "handoff.json"), request: balancedRequest });
    assert.ok(args.includes("gpt-6-luna"));
    assert.ok(args.includes('model_reasoning_effort="medium"'));
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
    assert.equal(result.jobs[1].failure_kind, "launcher_error");
    assert.match(result.jobs[1].terminal_reason, /limite temporário/u);
    const ledger = JSON.parse(await readFile(`${manifestPath}.status.json`, "utf8"));
    assert.equal(ledger.status, "PARTIAL");
    assert.equal(ledger.active_jobs, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("launcher materializa ausência de handoff como falha terminal estruturada", async () => {
  const root = await mkdtemp(join(tmpdir(), "role-launcher-missing-handoff-"));
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const manifestPath = join(root, "manifest.json");
  await writeFile(join(root, "prompt.txt"), "Refine o card.");
  await writeFile(join(root, "request.json"), JSON.stringify(request));
  await writeFile(manifestPath, JSON.stringify({ jobs: [{ lane: "po", role: "pipeline-po", promptFile: "prompt.txt", executionRequest: "request.json", handoff: "handoff.json" }] }));
  try {
    const pending = launchRoles({ projectRoot: root, manifest: "manifest.json" }, { spawn: () => child });
    child.emit("close", 0);
    const result = await pending;
    assert.equal(result.status, "FAIL");
    assert.equal(result.jobs[0].job_status, "failed");
    assert.equal(result.jobs[0].failure_kind, "missing_handoff");
    assert.match(result.jobs[0].terminal_reason, /Handoff retornado/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("launcher rejeita antes do spawn um prompt que aponta para handoff diferente", async () => {
  const root = await mkdtemp(join(tmpdir(), "role-launcher-handoff-path-"));
  const manifestPath = join(root, "manifest.json");
  await writeFile(join(root, "prompt.txt"), "Escreva o resultado em .pipeline/tmp/run-dev-handoff.json.");
  await writeFile(join(root, "request.json"), JSON.stringify(request));
  await writeFile(manifestPath, JSON.stringify({ jobs: [{ lane: "po", role: "pipeline-po", promptFile: "prompt.txt", executionRequest: "request.json", handoff: ".pipeline/tmp/run-dev-r2-handoff.json" }] }));
  try {
    await assert.rejects(() => launchRoles({ projectRoot: root, manifest: "manifest.json" }, { spawn: () => { throw new Error("não deveria iniciar"); } }), /handoff divergente/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("prompt de recuperação é regenerado para o handoff exclusivo do job", async () => {
  const root = await mkdtemp(join(tmpdir(), "role-launcher-recovery-prompt-"));
  const promptPath = join(root, "prompt.txt");
  const expected = join(root, ".pipeline", "tmp", "run-dev-r2-handoff.json");
  await writeFile(promptPath, "Use .pipeline/tmp/run-dev-handoff.json como handoff.");
  try {
    const prompt = prepareRolePrompt({ projectRoot: root, promptFile: promptPath, handoffPath: expected, recovery: true });
    assert.match(prompt, /run-dev-r2-handoff\.json/u);
    assert.doesNotMatch(prompt, /run-dev-handoff\.json/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("launcher encerra erros repetidos sem trabalho com diagnóstico sanitizado", async () => {
  const root = await mkdtemp(join(tmpdir(), "role-launcher-no-progress-"));
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  const manifestPath = join(root, "manifest.json");
  await writeFile(join(root, "prompt.txt"), "Refine o card.");
  await writeFile(join(root, "request.json"), JSON.stringify(request));
  await writeFile(manifestPath, JSON.stringify({ jobs: [{ lane: "po", role: "pipeline-po", promptFile: "prompt.txt", executionRequest: "request.json", handoff: "handoff.json" }] }));
  try {
    const pending = launchRoles({ projectRoot: root, manifest: "manifest.json" }, { spawn: () => child });
    await new Promise((resolve) => setImmediate(resolve));
    child.stderr.emit("data", "stderr final com code=E_AGENT\n");
    for (let index = 0; index < 3; index += 1) child.stdout.emit("data", `${JSON.stringify({ type: "error", code: "E_AGENT", message: "serviço indisponível", details: { authorization: "private-value" } })}\n`);
    const result = await pending;
    assert.equal(result.status, "FAIL");
    assert.equal(result.jobs[0].failure_kind, "no_progress");
    assert.equal(result.jobs[0].diagnostics.no_progress_reason, "repeated_error_without_substantive_work");
    assert.equal(result.jobs[0].diagnostics.recent_error_events.length, 3);
    assert.equal(result.jobs[0].diagnostics.recent_error_events[0].details.authorization, "<redacted>");
    assert.match(result.jobs[0].diagnostics.stderr_tail, /E_AGENT/u);
    assert.doesNotMatch(result.jobs[0].diagnostics.stdout_tail, /private-value/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
