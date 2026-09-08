#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(SCRIPT_DIR, "..");
const REPOSITORY_DIR = resolve(RUNTIME_DIR, "..");
const PLUGIN_NAME = "unified-development-pipeline";
const TARGET_ROOT = resolve(REPOSITORY_DIR, "local-marketplace", "plugins", PLUGIN_NAME);
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
const RUNTIME_ENTRIES = ["version-status.mjs", "doctor.mjs", "setup.mjs", "run-planner.mjs", "role-launcher.mjs", "role-gate.mjs", "transition-gate.mjs", "run-close-gate.mjs", "trello-comments.mjs", "command-runner.mjs"];
const SCHEMAS = [
  "project-adapter.schema.json",
  "tracker-snapshot.schema.json",
  "role-handoff.schema.json",
  "tracker-transition-receipt.schema.json",
  "run-close-receipt.schema.json"
];
const DOCUMENTS = ["AUTONOMY_POLICY.md"];

function assertSafeTarget() {
  const allowedRoot = resolve(REPOSITORY_DIR, "local-marketplace", "plugins");
  const delta = relative(allowedRoot, TARGET_ROOT);
  if (!delta || delta.startsWith("..") || resolve(TARGET_ROOT) !== resolve(allowedRoot, PLUGIN_NAME)) {
    throw new Error("Destino de build não passou na verificação de segurança.");
  }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function collectSkillHashes() {
  const hashes = {};
  for (const skill of EXPECTED_SKILLS) {
    for (const relativePath of ["SKILL.md", "agents/openai.yaml"]) {
      const key = `${skill}/${relativePath}`;
      hashes[key] = await sha256(join(REPOSITORY_DIR, "skills", key));
    }
  }
  return hashes;
}

export async function buildPlugin() {
  assertSafeTarget();
  const actualSkills = (await readdir(join(REPOSITORY_DIR, "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(actualSkills) !== JSON.stringify(EXPECTED_SKILLS)) {
    throw new Error(`Catálogo de Skills divergente: ${actualSkills.join(", ")}`);
  }

  await rm(TARGET_ROOT, { recursive: true, force: true });
  await mkdir(join(TARGET_ROOT, ".codex-plugin"), { recursive: true });
  await mkdir(join(TARGET_ROOT, "runtime", "src"), { recursive: true });
  await mkdir(join(TARGET_ROOT, "schema"), { recursive: true });
  await mkdir(join(TARGET_ROOT, "docs"), { recursive: true });
  await cp(join(REPOSITORY_DIR, "skills"), join(TARGET_ROOT, "skills"), { recursive: true });
  await cp(join(REPOSITORY_DIR, "packaging", "plugin.json"), join(TARGET_ROOT, ".codex-plugin", "plugin.json"));
  await cp(join(RUNTIME_DIR, "pipeline.ps1"), join(TARGET_ROOT, "runtime", "pipeline.ps1"));

  const runtimePackage = JSON.parse(await readFile(join(RUNTIME_DIR, "package.json"), "utf8"));
  await writeFile(
    join(TARGET_ROOT, "runtime", "package.json"),
    `${JSON.stringify(
      {
        name: runtimePackage.name,
        version: runtimePackage.version,
        private: true,
        type: "module",
        engines: runtimePackage.engines
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  for (const schema of SCHEMAS) {
    await cp(join(REPOSITORY_DIR, "schema", schema), join(TARGET_ROOT, "schema", schema));
  }
  for (const document of DOCUMENTS) {
    await cp(join(REPOSITORY_DIR, "docs", document), join(TARGET_ROOT, "docs", document));
  }
  for (const entry of RUNTIME_ENTRIES) {
    await build({
      entryPoints: [join(RUNTIME_DIR, "src", entry)],
      outfile: join(TARGET_ROOT, "runtime", "src", entry),
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
      },
      legalComments: "none",
      sourcemap: false,
      logLevel: "silent"
    });
  }

  const manifest = JSON.parse(await readFile(join(REPOSITORY_DIR, "packaging", "plugin.json"), "utf8"));
  const buildInfo = {
    contract_version: "0.1",
    plugin: { name: manifest.name, version: manifest.version },
    source: { runtime_version: runtimePackage.version, skill_hashes: await collectSkillHashes() },
    contents: { skills: EXPECTED_SKILLS, runtime_entries: RUNTIME_ENTRIES, launcher: "runtime/pipeline.ps1", schemas: SCHEMAS, documents: DOCUMENTS }
  };
  await writeFile(
    join(TARGET_ROOT, ".codex-plugin", "build-info.json"),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
    "utf8"
  );
  return { targetRoot: TARGET_ROOT, buildInfo };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const result = await buildPlugin();
    process.stdout.write(`Plugin gerado em ${result.targetRoot}\n`);
  } catch (error) {
    process.stderr.write(`build-plugin: ${error.message}\n`);
    process.exitCode = 1;
  }
}
