#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(SOURCE_DIR, "..");
const PACKAGE = JSON.parse(readFileSync(join(RUNTIME_DIR, "package.json"), "utf8"));
const ALLOWED_MODELS = new Set(["gpt-6-luna", "gpt-6.1-sol"]);
const ALLOWED_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const ALLOWED_ROLES = new Set(["pipeline-po", "pipeline-ux-ui", "pipeline-dev", "pipeline-code-review", "pipeline-qa"]);
const DEFAULT_ROLE_TIMEOUT_MS = 45 * 60 * 1000;
const DEFAULT_NO_PROGRESS_TIMEOUT_MS = 5 * 60 * 1000;
const RELEASE_BATCH_POLICY = "release-integration-batch-v0.3";
const RELEASE_MAX_ACTIVE_MS = 3 * 60 * 60 * 1000;
const RELEASE_MAX_NO_PROGRESS_MS = 30 * 60 * 1000;
const RELEASE_CHECKPOINTS = new Set(["preflight", "documentation", "branch", "push", "pull_request", "checks", "merge", "handoff"]);
const SAFE_ITEM_TYPES = new Set(["agentMessage", "commandExecution", "fileChange", "reasoning", "webSearch", "mcpToolCall"]);
const SAFE_ITEM_STATUSES = new Set(["inProgress", "completed", "failed", "cancelled"]);
const MAX_ERROR_EVENTS_WITHOUT_PROGRESS = 3;
const MAX_DIAGNOSTIC_EVENTS = 5;
const DIAGNOSTIC_BUFFER_LIMIT = 2000;
const SUBSTANTIVE_EVENT_TYPES = new Set(["item.started", "item.updated", "item.completed"]);
const TRACKED_EVENT_TYPES = new Set(["thread.started", "turn.started", "turn.completed", "turn.failed", ...SUBSTANTIVE_EVENT_TYPES, "error"]);

function parseJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} não encontrado.`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${label} não contém JSON válido.`);
  }
}

function validateReleaseJob(job, projectRoot) {
  if (job.unit_policy !== RELEASE_BATCH_POLICY) return;
  const runId = job.release_queue?.run_id;
  if (!/^RUN-[0-9]{8}-[A-Z0-9]{8}$/u.test(String(runId ?? ""))) {
    throw new Error("Release em lote exige o RUN_ID canônico em release_queue.run_id.");
  }
  if (!Number.isSafeInteger(job.timeout_ms) || job.timeout_ms > RELEASE_MAX_ACTIVE_MS) {
    throw new Error("Release em lote exige timeout_ms de no máximo 3 horas.");
  }
  if (!Number.isSafeInteger(job.no_progress_ms) || job.no_progress_ms > RELEASE_MAX_NO_PROGRESS_MS) {
    throw new Error("Release em lote exige no_progress_ms de no máximo 30 minutos.");
  }
  if (typeof job.progressFile !== "string" || !job.progressFile.trim()) {
    throw new Error("Release em lote exige progressFile para checkpoints recuperáveis.");
  }
  const expectedProgressFile = `.pipeline/tmp/${runId}-release-progress.json`;
  if (job.progressFile.replaceAll("\\", "/") !== expectedProgressFile) {
    throw new Error("Release em lote exige progressFile vinculado ao RUN_ID da fila.");
  }
  ensureInside(projectRoot, resolve(projectRoot, job.progressFile), "Release progress file");
}

function readReleaseCheckpoint(projectRoot, progressFile, expectedRunId) {
  if (typeof progressFile !== "string" || !progressFile.trim()) return undefined;
  const path = resolve(projectRoot, progressFile);
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, "utf8");
    if (Buffer.byteLength(raw, "utf8") > 32 * 1024) return { status: "invalid", reason: "too_large" };
    const value = JSON.parse(raw);
    if (value?.run_id !== expectedRunId || !RELEASE_CHECKPOINTS.has(value?.stage)) return { status: "invalid", reason: "schema_mismatch" };
    const completedStages = Array.isArray(value.completed_stages)
      ? value.completed_stages.filter((stage) => RELEASE_CHECKPOINTS.has(stage)).slice(0, RELEASE_CHECKPOINTS.size)
      : [];
    return {
      run_id: expectedRunId,
      stage: value.stage,
      completed_stages: completedStages,
      ...(typeof value.updated_at === "string" && Number.isFinite(Date.parse(value.updated_at)) ? { updated_at: value.updated_at } : {})
    };
  } catch {
    return { status: "invalid", reason: "unreadable" };
  }
}

function ensureInside(root, path, label) {
  const delta = relative(root, path);
  if (delta.startsWith("..") || resolve(root, delta) !== path) throw new Error(`${label} deve permanecer dentro da raiz do projeto.`);
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Valor ausente para ${argument}`);
      index += 1;
      if (argument === "--project-root") options.projectRoot = value;
      else if (argument === "--role") options.role = value;
      else if (argument === "--prompt-file") options.promptFile = value;
      else if (argument === "--execution-request") options.executionRequest = value;
      else if (argument === "--handoff") options.handoff = value;
      else if (argument === "--manifest") options.manifest = value;
      else if (argument === "--format") options.format = value;
      else throw new Error(`Argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

export function buildCodexArguments({ projectRoot, role, promptFile, handoffPath, request, promptText }) {
  if (!ALLOWED_ROLES.has(role)) throw new Error("Papel não suportado pelo launcher.");
  if (!ALLOWED_MODELS.has(request?.model)) throw new Error("Modelo solicitado não é suportado pelo contrato.");
  if (!ALLOWED_EFFORTS.has(request?.reasoning_effort)) throw new Error("Esforço solicitado não é suportado pelo contrato.");
  const sourcePrompt = promptText ?? readFileSync(promptFile, "utf8");
  const canonicalHandoff = relative(projectRoot, handoffPath).replaceAll("\\", "/");
  const prompt = `${sourcePrompt.trim()}\n\nUse explicitamente $${role}. Entregue somente um objeto JSON válido do handoff conforme schema/role-handoff.schema.json, sem cerca Markdown nem texto adicional. O caminho canônico e exclusivo da saída é \`${canonicalHandoff}\`; não escreva handoff em outro local. Os campos execution serão carimbados pelo launcher com a configuração realmente solicitada.`;
  return {
    prompt,
    args: [
      "exec", "--json", "--ephemeral", "--model", request.model,
      "-c", `model_reasoning_effort=\"${request.reasoning_effort}\"`,
      "--approve-for-me", "--cd", projectRoot,
      "--output-last-message", handoffPath,
      prompt
    ]
  };
}

export function finalizeHandoff({ handoff, request, role, threadId }) {
  if (!threadId) throw new Error("O Codex não retornou o identificador real da tarefa de papel.");
  if (handoff?.role !== role) throw new Error("O papel retornado diverge do papel solicitado.");
  return {
    ...handoff,
    profile: request.profile,
    execution: {
      ...(handoff.execution ?? {}),
      request,
      observation: {
        status: "confirmed",
        model: request.model,
        reasoning_effort: request.reasoning_effort,
        configuration_source: "explicit-codex-exec",
        evidence_ref: `agent:codex-thread:${threadId}`,
        fallback_used: false
      }
    }
  };
}

function diagnosticExcerpt(value) {
  return String(value ?? "")
    .replace(/(["']?(?:token|secret|password|api[_-]?key|authorization|cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/giu, "$1<redacted>")
    .trim()
    .slice(-DIAGNOSTIC_BUFFER_LIMIT);
}

function sanitizeDiagnosticValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return diagnosticExcerpt(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => [
      key,
      /token|secret|password|api[_-]?key|authorization|cookie/iu.test(key) ? "<redacted>" : sanitizeDiagnosticValue(item, depth + 1)
    ]));
  }
  return String(value);
}

function sanitizeErrorEvent(event) {
  const safeFields = ["type", "message", "code", "error", "error_code", "detail", "details", "status", "request_id", "kind"];
  return sanitizeDiagnosticValue(Object.fromEntries(safeFields
    .filter((field) => Object.hasOwn(event, field))
    .map((field) => [field, event[field]])));
}

function promptHandoffReferences(prompt, projectRoot) {
  const matches = String(prompt ?? "").matchAll(/[^\s"'`<>]*handoff[^\s"'`<>]*\.json\b/giu);
  const references = [];
  for (const match of matches) {
    const raw = match[0].replace(/[),.;:]+$/u, "");
    if (/^schema[/\\]role-handoff\.schema\.json$/iu.test(raw)) continue;
    const absolute = resolve(projectRoot, raw);
    references.push({ raw, absolute });
  }
  return references;
}

export function prepareRolePrompt({ projectRoot, promptFile, handoffPath, recovery = false }) {
  let prompt = readFileSync(promptFile, "utf8");
  const expected = resolve(handoffPath);
  const references = promptHandoffReferences(prompt, projectRoot);
  const mismatches = references.filter((reference) => reference.absolute !== expected);
  if (mismatches.length && recovery) {
    const canonical = relative(projectRoot, expected).replaceAll("\\", "/");
    for (const mismatch of mismatches) prompt = prompt.replaceAll(mismatch.raw, canonical);
  }
  const unresolved = promptHandoffReferences(prompt, projectRoot).filter((reference) => reference.absolute !== expected);
  if (unresolved.length) {
    throw new Error(`Prompt declara handoff divergente de job.handoff: ${unresolved.map((reference) => reference.raw).join(", ")}.`);
  }
  return prompt;
}

function makeLaunchError(message, { failureKind = "launcher_error", diagnostics } = {}) {
  const error = new Error(message);
  error.failure_kind = failureKind;
  error.diagnostics = diagnostics;
  return error;
}

function terminalDiagnostics({ stdout, stderr, errorEvents, eventCount, substantiveEventCount, noProgressReason }) {
  return {
    event_count: eventCount,
    substantive_event_count: substantiveEventCount,
    ...(noProgressReason ? { no_progress_reason: noProgressReason } : {}),
    ...(errorEvents.length ? { recent_error_events: errorEvents } : {}),
    ...(diagnosticExcerpt(stdout) ? { stdout_tail: diagnosticExcerpt(stdout) } : {}),
    ...(diagnosticExcerpt(stderr) ? { stderr_tail: diagnosticExcerpt(stderr) } : {})
  };
}

function rolePaths(input = {}) {
  const projectRoot = resolve(input.projectRoot ?? "");
  const promptFile = resolve(projectRoot, input.promptFile ?? "");
  const requestPath = resolve(projectRoot, input.executionRequest ?? "");
  const handoffPath = resolve(projectRoot, input.handoff ?? "");
  if (!existsSync(projectRoot)) throw new Error("Raiz do projeto não encontrada.");
  for (const [path, label] of [[promptFile, "Prompt"], [requestPath, "Execution request"], [handoffPath, "Handoff"]]) ensureInside(projectRoot, path, label);
  const request = parseJson(requestPath, "Execution request");
  const promptText = input.preparedPrompt ?? prepareRolePrompt({ projectRoot, promptFile, handoffPath, recovery: input.recovery === true || Number(input.recovery?.attempt) >= 2 });
  return { projectRoot, promptFile, requestPath, handoffPath, request, promptText };
}

export function launchRole(input = {}, dependencies = {}) {
  const { projectRoot, promptFile, handoffPath, request, promptText } = rolePaths(input);
  const { args } = buildCodexArguments({ projectRoot, role: input.role, promptFile, handoffPath, request, promptText });
  mkdirSync(dirname(handoffPath), { recursive: true });
  const spawn = dependencies.spawnSync ?? spawnSync;
  const result = spawn(dependencies.codexCommand ?? "codex", args, {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw new Error(`Falha ao iniciar o Codex: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = diagnosticExcerpt(`${result.stderr ?? ""}\n${result.stdout ?? ""}`);
    throw new Error(`O agente de papel encerrou com código ${result.status}${detail ? `: ${detail}` : "."}`);
  }
  const events = String(result.stdout ?? "").split(/\r?\n/u).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const threadId = events.find((event) => event.type === "thread.started")?.thread_id;
  const handoff = parseJson(handoffPath, "Handoff retornado");
  const finalized = finalizeHandoff({ handoff, request, role: input.role, threadId });
  writeFileSync(handoffPath, `${JSON.stringify(finalized, null, 2)}\n`, "utf8");
  return {
    contract_version: "0.1",
    tool: { name: "pipeline-role-launcher", version: PACKAGE.version },
    status: "PASS",
    job_status: "completed",
    completion_barrier: "terminal-handoff-consumed",
    role: input.role,
    model: request.model,
    reasoning_effort: request.reasoning_effort,
    configuration_source: "explicit-codex-exec",
    evidence_ref: `agent:codex-thread:${threadId}`,
    handoff: relative(projectRoot, handoffPath).replaceAll("\\", "/"),
    fallback_used: false
  };
}

async function launchRoleAsync(input = {}, dependencies = {}) {
  const { projectRoot, promptFile, handoffPath, request, promptText } = rolePaths(input);
  const { args } = buildCodexArguments({ projectRoot, role: input.role, promptFile, handoffPath, request, promptText });
  const timeoutMs = Number(input.timeout_ms ?? DEFAULT_ROLE_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 3 * 60 * 60 * 1000) throw new Error("timeout_ms do papel deve estar entre 60000 e 10800000.");
  const noProgressMs = Number(input.no_progress_ms ?? DEFAULT_NO_PROGRESS_TIMEOUT_MS);
  if (!Number.isSafeInteger(noProgressMs) || noProgressMs < 60_000 || noProgressMs > timeoutMs) throw new Error("no_progress_ms do papel deve estar entre 60000 e o timeout terminal.");
  mkdirSync(dirname(handoffPath), { recursive: true });
  const spawnImpl = dependencies.spawn ?? spawn;
  let threadId;
  const processResult = await new Promise((resolveProcess) => {
    const child = spawnImpl(dependencies.codexCommand ?? "codex", args, { cwd: projectRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let pendingLine = "";
    let discardingLine = false;
    let eventCount = 0;
    let substantiveEventCount = 0;
    let consecutiveErrors = 0;
    const errorEvents = [];
    let lastReleaseCheckpoint;
    let settled = false;
    let timeout;
    let noProgressWatchdog;
    const diagnostics = (noProgressReason) => ({
      ...terminalDiagnostics({ stdout, stderr, errorEvents, eventCount, substantiveEventCount, noProgressReason }),
      ...(lastReleaseCheckpoint ? { release_checkpoint: lastReleaseCheckpoint } : {})
    });
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(noProgressWatchdog);
      resolveProcess(result);
    };
    const abortForNoProgress = (reason) => {
      try { child.kill?.(); } catch { /* terminal state is recorded below */ }
      settle({ status: null, no_progress: true, no_progress_reason: reason, diagnostics: diagnostics(reason) });
    };
    const refreshNoProgressWatchdog = () => {
      clearTimeout(noProgressWatchdog);
      noProgressWatchdog = setTimeout(() => abortForNoProgress("no_substantive_work_event"), noProgressMs);
    };
    const consumeLine = (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (!event || typeof event !== "object") return;
      if (event.type === "thread.started" && /^[0-9a-f-]{36}$/iu.test(event.thread_id ?? "")) threadId = event.thread_id;
      if (!TRACKED_EVENT_TYPES.has(event.type)) return;
      eventCount += 1;
      if (SUBSTANTIVE_EVENT_TYPES.has(event.type)) {
        substantiveEventCount += 1;
        consecutiveErrors = 0;
        refreshNoProgressWatchdog();
      }
      if (event.type === "error") {
        consecutiveErrors += 1;
        errorEvents.push(sanitizeErrorEvent(event));
        if (errorEvents.length > MAX_DIAGNOSTIC_EVENTS) errorEvents.shift();
      }
      input.onProgress?.({
        event_count: eventCount,
        last_event_type: event.type,
        last_event_at: new Date().toISOString(),
        ...(event.type === "error" ? { last_error: errorEvents.at(-1), recent_error_events: errorEvents } : {}),
        progress_state: { substantive_event_count: substantiveEventCount, consecutive_errors_without_progress: consecutiveErrors },
        ...(SAFE_ITEM_TYPES.has(event.item?.type) ? { last_item_type: event.item.type } : {}),
        ...(SAFE_ITEM_STATUSES.has(event.item?.status) ? { last_item_status: event.item.status } : {}),
        ...(input.unit_policy === RELEASE_BATCH_POLICY && (lastReleaseCheckpoint = readReleaseCheckpoint(projectRoot, input.progressFile, input.release_queue?.run_id)) ? { release_checkpoint: lastReleaseCheckpoint } : {}),
        ...(threadId ? { evidence_ref: `agent:codex-thread:${threadId}` } : {})
      });
      if (event.type === "error" && consecutiveErrors >= MAX_ERROR_EVENTS_WITHOUT_PROGRESS) abortForNoProgress("repeated_error_without_substantive_work");
    };
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout = (stdout + text).slice(-2000);
      const lines = text.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (!discardingLine) {
          pendingLine += lines[index];
          if (pendingLine.length > 1024 * 1024) { pendingLine = ""; discardingLine = true; }
        }
        if (index < lines.length - 1) {
          if (!discardingLine) consumeLine(pendingLine);
          pendingLine = "";
          discardingLine = false;
        }
      }
    });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-2000); });
    timeout = setTimeout(() => {
      try { child.kill?.(); } catch { /* close event still materializes terminal status */ }
      settle({ status: null, timed_out: true, diagnostics: diagnostics("timeout") });
    }, timeoutMs);
    refreshNoProgressWatchdog();
    child.on("error", (error) => settle({ status: null, spawn_error: error, diagnostics: diagnostics("spawn_error") }));
    child.on("close", (status) => {
      if (!discardingLine && pendingLine) consumeLine(pendingLine);
      settle({ status, stdout, stderr, diagnostics: diagnostics() });
    });
  });
  if (processResult.no_progress) throw makeLaunchError(`O agente de papel foi interrompido por falta de progresso observável: ${processResult.no_progress_reason}.`, { failureKind: "no_progress", diagnostics: processResult.diagnostics });
  if (processResult.timed_out) throw makeLaunchError(`O agente de papel excedeu timeout terminal de ${timeoutMs}ms sem handoff consumível.`, { failureKind: "timeout", diagnostics: processResult.diagnostics });
  if (processResult.spawn_error) throw makeLaunchError(`Falha ao iniciar o Codex: ${diagnosticExcerpt(processResult.spawn_error.message)}`, { diagnostics: processResult.diagnostics });
  if (processResult.status !== 0) {
    const detail = diagnosticExcerpt(`${processResult.stderr}\n${processResult.stdout}`);
    throw makeLaunchError(`O agente de papel encerrou com código ${processResult.status}${detail ? `: ${detail}` : "."}`, { diagnostics: processResult.diagnostics });
  }
  if (!existsSync(handoffPath)) throw makeLaunchError("Handoff retornado não encontrado.", { failureKind: "missing_handoff", diagnostics: processResult.diagnostics });
  let handoff;
  try { handoff = parseJson(handoffPath, "Handoff retornado"); }
  catch (error) { throw makeLaunchError(error.message, { failureKind: "missing_handoff", diagnostics: processResult.diagnostics }); }
  const finalized = finalizeHandoff({ handoff, request, role: input.role, threadId });
  writeFileSync(handoffPath, `${JSON.stringify(finalized, null, 2)}\n`, "utf8");
  return {
    contract_version: "0.2", tool: { name: "pipeline-role-launcher", version: PACKAGE.version }, status: "PASS",
    job_status: "completed", completion_barrier: "terminal-handoff-consumed",
    lane: input.lane, role: input.role, model: request.model, reasoning_effort: request.reasoning_effort,
    configuration_source: "explicit-codex-exec", evidence_ref: `agent:codex-thread:${threadId}`,
    handoff: relative(projectRoot, handoffPath).replaceAll("\\", "/"), fallback_used: false
  };
}

export async function launchRoles(input = {}, dependencies = {}) {
  const projectRoot = resolve(input.projectRoot ?? "");
  const manifestPath = resolve(projectRoot, input.manifest ?? "");
  ensureInside(projectRoot, manifestPath, "Manifest");
  const manifest = parseJson(manifestPath, "Manifest de papéis");
  if (!Array.isArray(manifest.jobs) || manifest.jobs.length < 1 || manifest.jobs.length > 3) throw new Error("Manifest deve declarar de um a três papéis.");
  const lanes = manifest.jobs.map((job) => job.lane);
  if (new Set(lanes).size !== lanes.length || lanes.some((lane) => !["po", "ux_ui", "technical"].includes(lane))) throw new Error("Cada job precisa ocupar uma lane canônica distinta.");
  const roles = manifest.jobs.map((job) => job.role);
  if (new Set(roles).size !== roles.length) throw new Error("O mesmo papel não pode executar simultaneamente em duas lanes.");
  for (const field of ["promptFile", "executionRequest", "handoff"]) {
    const paths = manifest.jobs.map((job) => job[field]);
    if (paths.some((path) => typeof path !== "string" || !path.trim()) || new Set(paths).size !== paths.length) throw new Error(`Cada job precisa de ${field} próprio.`);
  }
  for (const job of manifest.jobs) {
    const compatible = job.lane === "po" ? job.role === "pipeline-po" : job.lane === "ux_ui" ? job.role === "pipeline-ux-ui" : ["pipeline-dev", "pipeline-code-review", "pipeline-qa", "pipeline-po"].includes(job.role);
    if (!compatible) throw new Error(`Papel ${job.role} incompatível com a lane ${job.lane}.`);
    validateReleaseJob(job, projectRoot);
  }
  const jobs = manifest.jobs.map((job) => ({
    ...job,
    ...(dependencies.launchAsync ? {} : { preparedPrompt: rolePaths({ projectRoot, ...job }).promptText })
  }));
  const launch = dependencies.launchAsync ?? launchRoleAsync;
  const statusPath = `${manifestPath}.status.json`;
  const status = {
    contract_version: "0.2",
    tool: { name: "pipeline-role-launcher", version: PACKAGE.version },
    status: "RUNNING",
    launch_strategy: "parallel",
    completion_barrier: "pending",
    active_jobs: jobs.length,
    jobs: jobs.map((job) => ({
      lane: job.lane,
      role: job.role,
      handoff: job.handoff,
      job_status: "queued",
      ...(job.unit_policy === RELEASE_BATCH_POLICY ? {
        unit_policy: job.unit_policy,
        timeout_ms: job.timeout_ms,
        no_progress_ms: job.no_progress_ms,
        progress_file: job.progressFile
      } : {})
    }))
  };
  const persistStatus = () => writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  persistStatus();
  const executions = jobs.map(async (job, index) => {
    status.jobs[index].job_status = "running";
    persistStatus();
    try {
      const result = await launch({ projectRoot, ...job, onProgress: (progress) => {
        status.jobs[index] = { ...status.jobs[index], ...progress };
        persistStatus();
      } }, dependencies);
      status.jobs[index] = { ...status.jobs[index], ...result };
      return status.jobs[index];
    } catch (error) {
      const failure = {
        ...status.jobs[index],
        contract_version: "0.2",
        status: "FAIL",
        job_status: "failed",
        completion_barrier: "terminal-failure",
        failure_kind: error?.failure_kind ?? (/timeout terminal/iu.test(String(error?.message ?? "")) ? "timeout" : /Handoff retornado/iu.test(String(error?.message ?? "")) ? "missing_handoff" : "launcher_error"),
        terminal_reason: diagnosticExcerpt(error?.message),
        lane: job.lane,
        role: job.role,
        handoff: job.handoff,
        error: diagnosticExcerpt(error?.message ?? error),
        ...(error?.diagnostics ? { diagnostics: error.diagnostics } : {})
      };
      status.jobs[index] = failure;
      return failure;
    } finally {
      status.active_jobs -= 1;
      persistStatus();
    }
  });
  const results = await Promise.all(executions);
  const completed = results.filter((result) => result.status === "PASS" && result.job_status === "completed").length;
  status.status = completed === results.length ? "PASS" : completed > 0 ? "PARTIAL" : "FAIL";
  status.completion_barrier = "all-jobs-terminal";
  status.active_jobs = 0;
  status.jobs = results;
  persistStatus();
  return {
    ...status,
    status_ref: relative(projectRoot, statusPath).replaceAll("\\", "/")
  };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write("Uso: node runtime/src/role-launcher.mjs --project-root <raiz> (--manifest <json> | --role <papel> --prompt-file <arquivo> --execution-request <json> --handoff <json>) [--format text|json]\n");
    else {
      const result = options.manifest ? await launchRoles(options) : launchRole(options);
      process.stdout.write((options.format ?? "text") === "json" ? `${JSON.stringify(result, null, 2)}\n` : options.manifest ? `pipeline-role-launcher ${result.tool.version} | ${result.jobs.length} papéis | ${result.status}\n` : `pipeline-role-launcher ${result.tool.version} | ${result.role} | ${result.status} | ${result.evidence_ref}\n`);
    }
  } catch (error) {
    process.stderr.write(`pipeline-role-launcher: ${error.message}\n`);
    process.exitCode = 2;
  }
}
