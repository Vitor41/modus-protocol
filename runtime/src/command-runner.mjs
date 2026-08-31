#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE = JSON.parse(readFileSync(resolve(SOURCE_DIR, "..", "package.json"), "utf8"));

function contained(root, candidate, label) {
  const delta = relative(root, candidate);
  if (delta === ".." || delta.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error(`${label} fora da raiz do projeto.`);
  return candidate;
}

function loadAdapter(path) {
  const document = YAML.parseDocument(readFileSync(path, "utf8"), { uniqueKeys: true });
  if (document.errors.length) throw new Error("Adapter inválido.");
  return document.toJS({ mapAsMap: false });
}

function resolveExecutable(projectRoot, executable) {
  if (isAbsolute(executable) || /[\\/]/u.test(executable)) return contained(projectRoot, resolve(projectRoot, executable), "Executável");
  if (executable.toLowerCase() === "python") {
    const candidates = process.platform === "win32"
      ? [".codex_venv/Scripts/python.exe", ".venv/Scripts/python.exe", "venv/Scripts/python.exe"]
      : [".codex_venv/bin/python", ".venv/bin/python", "venv/bin/python"];
    const found = candidates.map((item) => resolve(projectRoot, item)).find(existsSync);
    if (found) return found;
  }
  return executable;
}

export function executeAdapterCommand(input = {}) {
  const projectRoot = resolve(input.projectRoot ?? process.cwd());
  const adapterPath = resolve(input.adapterPath ?? resolve(projectRoot, ".pipeline", "project.adapter.yaml"));
  const adapter = loadAdapter(adapterPath);
  const command = adapter.commands?.[input.name];
  if (!command) throw new Error(`Comando não declarado no adapter: ${input.name ?? "ausente"}.`);
  const cwd = contained(projectRoot, resolve(projectRoot, command.working_directory), "working_directory");
  const executable = resolveExecutable(projectRoot, command.argv[0]);
  const started = Date.now();
  const result = spawnSync(executable, command.argv.slice(1), { cwd, encoding: "utf8", timeout: command.timeout_seconds * 1000, windowsHide: true });
  const exitCode = result.status ?? (result.error ? 127 : 0);
  const passed = command.expected_exit_codes.includes(exitCode);
  return {
    contract_version: "0.1", tool: { name: "pipeline-command", version: PACKAGE.version }, status: passed ? "PASS" : "FAIL",
    command: input.name, executable_source: executable === command.argv[0] ? "adapter" : "project-runtime", exit_code: exitCode,
    duration_ms: Date.now() - started, stdout: passed ? undefined : result.stdout?.slice(-8000), stderr: result.stderr?.slice(-8000),
    guarantees: { shell_used: false, command_declared_by_adapter: true }
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else { const value = argv[++index]; if (!value) throw new Error(`Valor ausente para ${argument}`); if (argument === "--project-root") options.projectRoot = value; else if (argument === "--adapter") options.adapterPath = value; else if (argument === "--name") options.name = value; else throw new Error(`Argumento desconhecido: ${argument}`); }
  }
  return options;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try { const options = parseArguments(process.argv.slice(2)); if (options.help) process.stdout.write("Uso: pipeline.ps1 command --name <comando> --project-root <raiz>\n"); else { const result = executeAdapterCommand(options); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.status === "PASS" ? 0 : 1; } }
  catch (error) { process.stderr.write(`pipeline-command: ${error.message}\n`); process.exitCode = 2; }
}
