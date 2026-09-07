#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(SOURCE_DIR, "..");
const PACKAGE = JSON.parse(readFileSync(join(RUNTIME_DIR, "package.json"), "utf8"));

function semver(value) {
  const match = String(value ?? "").match(/^(\d+)\.(\d+)\.(\d+)/u);
  return match ? match.slice(1).map(Number) : undefined;
}

function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function findPluginRoot() {
  const candidate = resolve(RUNTIME_DIR, "..");
  return existsSync(join(candidate, ".codex-plugin", "plugin.json")) ? candidate : undefined;
}

function cacheVersions(pluginRoot) {
  if (!pluginRoot) return [];
  const pluginName = basename(dirname(pluginRoot));
  const cacheRoot = dirname(pluginRoot);
  if (!cacheRoot.toLowerCase().includes("plugins\\cache") || !existsSync(cacheRoot)) return [];
  return readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && semver(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => compare(semver(right), semver(left)) || right.localeCompare(left));
}

export function getVersionStatus(input = {}) {
  const projectRoot = resolve(input.projectRoot ?? process.cwd());
  const adapterPath = resolve(input.adapterPath ?? join(projectRoot, ".pipeline", "project.adapter.yaml"));
  const pluginRoot = findPluginRoot();
  const pluginManifestPath = pluginRoot && join(pluginRoot, ".codex-plugin", "plugin.json");
  const pluginManifest = pluginManifestPath && existsSync(pluginManifestPath)
    ? JSON.parse(readFileSync(pluginManifestPath, "utf8"))
    : undefined;
  const adapter = existsSync(adapterPath)
    ? YAML.parse(readFileSync(adapterPath, "utf8"))
    : undefined;
  const active = semver(PACKAGE.version);
  const installed = cacheVersions(pluginRoot);
  const diagnostics = [];
  return {
    contract_version: "0.1",
    tool: { name: "modus-version-status", version: PACKAGE.version },
    status: "PASS",
    active: {
      runtime_version: PACKAGE.version,
      plugin_version: pluginManifest?.version ?? null,
      runtime_root: RUNTIME_DIR,
      plugin_root: pluginRoot ?? null
    },
    project: { root: projectRoot, adapter: adapterPath },
    installed_cache_versions: installed,
    diagnostics
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Valor ausente para ${argument}`);
      if (argument === "--project-root") options.projectRoot = value;
      else if (argument === "--adapter") options.adapterPath = value;
      else if (argument === "--format") options.format = value;
      else throw new Error(`Argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

const invokedDirectly = process.argv[1] && basename(process.argv[1]) === "version-status.mjs" && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Uso: pipeline.ps1 status --project-root <projeto> [--format text|json]\n");
    } else {
      const result = getVersionStatus(options);
      if (options.format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        process.stdout.write(`Modus Protocol ${result.active.runtime_version} | ${result.status}\n`);
        process.stdout.write(`origem=${result.active.runtime_root}\n`);
        for (const diagnostic of result.diagnostics) process.stdout.write(`[ERROR] ${diagnostic.code} - ${diagnostic.message}\n`);
      }
      process.exitCode = result.status === "PASS" ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`modus-version-status: ${error.message}\n`);
    process.exitCode = 2;
  }
}
