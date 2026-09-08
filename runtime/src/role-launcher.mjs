#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(SOURCE_DIR, "..");
const PACKAGE = JSON.parse(readFileSync(join(RUNTIME_DIR, "package.json"), "utf8"));
const ALLOWED_MODELS = new Set(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
const ALLOWED_EFFORTS = new Set(["low", "medium", "high", "max"]);
const ALLOWED_ROLES = new Set(["pipeline-po", "pipeline-ux-ui", "pipeline-dev", "pipeline-code-review", "pipeline-qa"]);

function parseJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} não encontrado.`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${label} não contém JSON válido.`);
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

export function buildCodexArguments({ projectRoot, role, promptFile, handoffPath, request }) {
  if (!ALLOWED_ROLES.has(role)) throw new Error("Papel não suportado pelo launcher.");
  if (!ALLOWED_MODELS.has(request?.model)) throw new Error("Modelo solicitado não é suportado pelo contrato.");
  if (!ALLOWED_EFFORTS.has(request?.reasoning_effort)) throw new Error("Esforço solicitado não é suportado pelo contrato.");
  const prompt = `${readFileSync(promptFile, "utf8").trim()}\n\nUse explicitamente $${role}. Entregue somente um objeto JSON válido do handoff conforme schema/role-handoff.schema.json, sem cerca Markdown nem texto adicional. Os campos execution serão carimbados pelo launcher com a configuração realmente solicitada.`;
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
    .replace(/(token|secret|password|api[_-]?key)\s*[:=]\s*\S+/giu, "$1=<redacted>")
    .trim()
    .slice(-2000);
}

export function launchRole(input = {}, dependencies = {}) {
  const projectRoot = resolve(input.projectRoot ?? "");
  const promptFile = resolve(projectRoot, input.promptFile ?? "");
  const requestPath = resolve(projectRoot, input.executionRequest ?? "");
  const handoffPath = resolve(projectRoot, input.handoff ?? "");
  if (!existsSync(projectRoot)) throw new Error("Raiz do projeto não encontrada.");
  for (const [path, label] of [[promptFile, "Prompt"], [requestPath, "Execution request"], [handoffPath, "Handoff"]]) ensureInside(projectRoot, path, label);
  const request = parseJson(requestPath, "Execution request");
  const { args } = buildCodexArguments({ projectRoot, role: input.role, promptFile, handoffPath, request });
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
  const projectRoot = resolve(input.projectRoot ?? "");
  const promptFile = resolve(projectRoot, input.promptFile ?? "");
  const requestPath = resolve(projectRoot, input.executionRequest ?? "");
  const handoffPath = resolve(projectRoot, input.handoff ?? "");
  if (!existsSync(projectRoot)) throw new Error("Raiz do projeto não encontrada.");
  for (const [path, label] of [[promptFile, "Prompt"], [requestPath, "Execution request"], [handoffPath, "Handoff"]]) ensureInside(projectRoot, path, label);
  const request = parseJson(requestPath, "Execution request");
  const { args } = buildCodexArguments({ projectRoot, role: input.role, promptFile, handoffPath, request });
  mkdirSync(dirname(handoffPath), { recursive: true });
  const spawnImpl = dependencies.spawn ?? spawn;
  const processResult = await new Promise((resolveProcess, rejectProcess) => {
    const child = spawnImpl(dependencies.codexCommand ?? "codex", args, { cwd: projectRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", rejectProcess);
    child.on("close", (status) => resolveProcess({ status, stdout, stderr }));
  });
  if (processResult.status !== 0) {
    const detail = diagnosticExcerpt(`${processResult.stderr}\n${processResult.stdout}`);
    throw new Error(`O agente de papel encerrou com código ${processResult.status}${detail ? `: ${detail}` : "."}`);
  }
  const events = processResult.stdout.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const threadId = events.find((event) => event.type === "thread.started")?.thread_id;
  const handoff = parseJson(handoffPath, "Handoff retornado");
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
  }
  const launch = dependencies.launchAsync ?? launchRoleAsync;
  const jobs = manifest.jobs.map((job) => launch({ projectRoot, ...job }, dependencies));
  const results = await Promise.all(jobs);
  if (results.some((result) => result.status !== "PASS" || result.job_status !== "completed")) {
    throw new Error("O launcher recebeu resultado não terminal de uma lane.");
  }
  return {
    contract_version: "0.2",
    tool: { name: "pipeline-role-launcher", version: PACKAGE.version },
    status: "PASS",
    launch_strategy: "parallel",
    completion_barrier: "all-jobs-terminal",
    active_jobs: 0,
    jobs: results
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
