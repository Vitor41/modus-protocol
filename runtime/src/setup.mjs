#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(SOURCE_DIR, "..");
const PACKAGE = JSON.parse(readFileSync(join(RUNTIME_DIR, "package.json"), "utf8"));

function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "project";
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function detectPackageManager(projectRoot) {
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectRoot, "yarn.lock"))) return "yarn";
  if (existsSync(join(projectRoot, "package-lock.json"))) return "npm";
  return "npm";
}

function packageScriptCommand(manager, script) {
  if (manager === "yarn") return ["yarn", script];
  return [manager, "run", script];
}

function command(argv, timeoutSeconds) {
  return {
    working_directory: ".",
    argv,
    timeout_seconds: timeoutSeconds,
    expected_exit_codes: [0],
    output: "full-on-failure"
  };
}

function detectCommands(projectRoot, evidence, decisions) {
  const packageJsonPath = join(projectRoot, "package.json");
  const packageJson = existsSync(packageJsonPath) ? readJson(packageJsonPath) : undefined;
  if (packageJson?.scripts) {
    const manager = detectPackageManager(projectRoot);
    evidence.push("package.json");
    const testScript = packageJson.scripts.test ? "test" : undefined;
    if (testScript) {
      decisions.push({
        code: "COMMAND_CAPABILITIES_REVIEW_REQUIRED",
        path: "commands",
        question: "O mesmo script de teste pode representar baseline, teste direcionado e regressão completa?"
      });
      return {
        baseline: command(packageScriptCommand(manager, testScript), 600),
        test_targeted: command(packageScriptCommand(manager, testScript), 600),
        test_full: command(packageScriptCommand(manager, testScript), 600)
      };
    }
    decisions.push({
      code: "COMMANDS_UNRESOLVED",
      path: "commands",
      question: "Qual comando representa baseline, teste direcionado e regressão completa?"
    });
  }

  const pythonSignals = ["pyproject.toml", "requirements.txt", "pytest.ini", "manage.py"].filter((name) =>
    existsSync(join(projectRoot, name))
  );
  if (pythonSignals.length > 0 || existsSync(join(projectRoot, "tests"))) {
    evidence.push(...pythonSignals);
    const usesPytest =
      existsSync(join(projectRoot, "pytest.ini")) ||
      ["pyproject.toml", "requirements.txt"].some((name) => {
        const path = join(projectRoot, name);
        return existsSync(path) && /pytest/i.test(readFileSync(path, "utf8"));
      });
    const argv = usesPytest
      ? ["python", "-m", "pytest"]
      : ["python", "-m", "unittest", "discover", "-s", "tests"];
    return {
      baseline: command([...argv], 600),
      test_targeted: command([...argv], 600),
      test_full: command([...argv], 600)
    };
  }

  if (existsSync(join(projectRoot, "go.mod"))) {
    evidence.push("go.mod");
    return {
      baseline: command(["go", "test", "./..."], 600),
      test_targeted: command(["go", "test", "./..."], 600),
      test_full: command(["go", "test", "./..."], 600)
    };
  }

  if (readdirSync(projectRoot).some((name) => name.endsWith(".sln") || name.endsWith(".csproj"))) {
    evidence.push("*.sln|*.csproj");
    return {
      baseline: command(["dotnet", "test"], 600),
      test_targeted: command(["dotnet", "test"], 600),
      test_full: command(["dotnet", "test"], 600)
    };
  }

  decisions.push({
    code: "COMMANDS_UNRESOLVED",
    path: "commands",
    question: "Quais comandos seguros executam baseline, teste direcionado e regressão completa?"
  });
  return {
    baseline: command(["replace-with-project-command"], 600),
    test_targeted: command(["replace-with-project-command"], 600),
    test_full: command(["replace-with-project-command"], 600)
  };
}

function detectStack(projectRoot, evidence) {
  const languages = [];
  const frameworks = [];
  const databases = [];
  const packageJson = readJson(join(projectRoot, "package.json"));

  if (packageJson) {
    languages.push("JavaScript/TypeScript");
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    for (const [dependency, label] of [
      ["next", "Next.js"],
      ["react", "React"],
      ["vue", "Vue"],
      ["@angular/core", "Angular"],
      ["express", "Express"]
    ]) {
      if (dependencies[dependency]) frameworks.push(label);
    }
    if (dependencies.pg || dependencies.postgres) databases.push("PostgreSQL");
    if (dependencies.mysql || dependencies.mysql2) databases.push("MySQL");
    if (dependencies.sqlite3 || dependencies["better-sqlite3"]) databases.push("SQLite");
  }

  if (["pyproject.toml", "requirements.txt", "manage.py"].some((name) => existsSync(join(projectRoot, name)))) {
    languages.push("Python");
    const dependencyText = ["pyproject.toml", "requirements.txt"]
      .filter((name) => existsSync(join(projectRoot, name)))
      .map((name) => readFileSync(join(projectRoot, name), "utf8"))
      .join("\n");
    if (/django/i.test(dependencyText) || existsSync(join(projectRoot, "manage.py"))) frameworks.push("Django");
    if (/fastapi/i.test(dependencyText)) frameworks.push("FastAPI");
    if (/flask/i.test(dependencyText)) frameworks.push("Flask");
    if (/postgres|psycopg/i.test(dependencyText)) databases.push("PostgreSQL");
    if (/sqlite/i.test(dependencyText)) databases.push("SQLite");
  }

  if (existsSync(join(projectRoot, "go.mod"))) languages.push("Go");
  if (existsSync(join(projectRoot, "Cargo.toml"))) languages.push("Rust");
  if (readdirSync(projectRoot).some((name) => name.endsWith(".sln") || name.endsWith(".csproj"))) {
    languages.push("C#");
  }

  if (languages.length > 0) evidence.push("stack-detected-from-manifests");
  return {
    ...(languages.length > 0 ? { languages: [...new Set(languages)] } : {}),
    ...(frameworks.length > 0 ? { frameworks: [...new Set(frameworks)] } : {}),
    ...(databases.length > 0 ? { databases: [...new Set(databases)] } : {})
  };
}

export function createSetupProposal(input = {}) {
  const projectRoot = resolve(input.projectRoot ?? process.cwd());
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    throw new Error("A raiz do projeto não existe ou não é um diretório.");
  }

  const projectName = input.projectName ?? basename(projectRoot);
  const evidence = [];
  const decisions = [];
  const agentsExists = existsSync(join(projectRoot, "AGENTS.md"));
  const indexCandidates = ["docs/context/index.md", "docs/README.md", "README.md"];
  const contextIndex = indexCandidates.find((path) => existsSync(join(projectRoot, path))) ?? "docs/context/index.md";

  if (agentsExists) evidence.push("AGENTS.md");
  else {
    decisions.push({
      code: "AGENTS_MISSING",
      path: "context.agents",
      question: "Qual bootstrap fino deverá ser criado em AGENTS.md durante a instalação autorizada?"
    });
  }
  if (existsSync(join(projectRoot, contextIndex))) evidence.push(contextIndex);
  else {
    decisions.push({
      code: "CONTEXT_INDEX_MISSING",
      path: "context.index",
      question: "Qual índice de contexto será adotado pelo projeto?"
    });
  }

  const commands = detectCommands(projectRoot, evidence, decisions);
  const stack = detectStack(projectRoot, evidence);
  decisions.push({
    code: "TRACKER_MAPPING_REQUIRED",
    path: "tracker",
    question: "Quais são as referências do board e das nove listas canônicas do Trello?"
  });
  decisions.push({
    code: "CARD_KEY_PATTERN_REQUIRED",
    path: "tracker.card_keys",
    question: "Qual padrão identifica features e bugs neste projeto?"
  });
  decisions.push({
    code: "GIT_POLICY_REVIEW_REQUIRED",
    path: "git",
    question: "Qual é a branch padrão e quais padrões de branch o projeto adota?"
  });

  const adapterCandidate = {
    schema_version: "0.1",
    kernel: {
      name: "unified-development-pipeline",
      version: PACKAGE.version,
      distribution: "source"
    },
    project: { id: slugify(projectName), name: projectName, root: "." },
    tracker: {
      provider: "trello",
      board_ref: "REVIEW_REQUIRED_BOARD_REF",
      credential_provider: "codex-connector",
      comments: {
        read_provider: "codex-connector",
        write_provider: "codex-connector",
        required_events: ["lock", "capsule", "role_handoff", "blocker", "transition"],
        verify_after_write: true,
        transition_requires_verified_comment: true,
        encoding: "utf-8"
      },
      states: {
        ideas: "REVIEW_REQUIRED_IDEAS_REF",
        refinement: "REVIEW_REQUIRED_REFINEMENT_REF",
        ux_ui: "REVIEW_REQUIRED_UX_UI_REF",
        ready_for_development: "REVIEW_REQUIRED_READY_FOR_DEVELOPMENT_REF",
        in_development: "REVIEW_REQUIRED_IN_DEVELOPMENT_REF",
        ready_for_validation: "REVIEW_REQUIRED_READY_FOR_VALIDATION_REF",
        ready_for_release: "REVIEW_REQUIRED_READY_FOR_RELEASE_REF",
        ready_for_production: "REVIEW_REQUIRED_READY_FOR_PRODUCTION_REF",
        done: "REVIEW_REQUIRED_DONE_REF"
      },
      card_keys: [{ kind: "feature", pattern: "^REVIEW_REQUIRED-[0-9]+$" }],
      type_labels: { feature: "REVIEW_REQUIRED_FEATURE_LABEL_REF", bug: "REVIEW_REQUIRED_BUG_LABEL_REF" },
      domain_labels: { business: "REVIEW_REQUIRED_DOMAIN_LABEL_REF" }
    },
    trigger: { process_queue: "Processe a fila do Trello.", skill: "pipeline-run" },
    context: { agents: "AGENTS.md", index: contextIndex, references: [] },
    ...(Object.keys(stack).length > 0 ? { stack } : {}),
    commands,
    git: {
      default_branch: "REVIEW_REQUIRED_DEFAULT_BRANCH",
      branch_patterns: { feature: "feature/{card_key}", bug: "fix/{card_key}" },
      release_gate: "APROVADO PARA PRD"
    },
    qa: { data_prefix: "QA_{card_key}_{timestamp}", evidence_channels: ["test"], cleanup: "own-data-only" },
    safety: {
      production_access: "forbidden",
      secrets: "external-provider-only",
      destructive_actions: "explicit-human-approval",
      external_writes: "workflow-scoped"
    },
    profiles: { default: "EQUILIBRADO", allowed: ["RAPIDO", "EQUILIBRADO", "PROFUNDO", "MAXIMO"] }
  };

  return {
    contract_version: "0.1",
    tool: { name: "pipeline-setup", version: PACKAGE.version },
    status: decisions.length > 0 ? "REVIEW_REQUIRED" : "READY_FOR_REVIEW",
    project_root: projectRoot,
    inventory: { evidence: [...new Set(evidence)].sort() },
    decisions,
    adapter_candidate: adapterCandidate,
    guarantees: {
      project_files_written: false,
      commands_executed: false,
      external_services_contacted: false
    }
  };
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
      else if (argument === "--project-name") options.projectName = value;
      else if (argument === "--format") options.format = value;
      else throw new Error(`Argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write("Uso: node runtime/src/setup.mjs [--project-root <path>] [--project-name <nome>] [--format json|yaml]\n");
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) printHelp();
    else {
      const format = options.format ?? "yaml";
      if (!["json", "yaml"].includes(format)) throw new Error(`Formato inválido: ${format}`);
      const result = createSetupProposal(options);
      process.stdout.write(format === "json" ? `${JSON.stringify(result, null, 2)}\n` : YAML.stringify(result));
    }
  } catch (error) {
    process.stderr.write(`pipeline-setup: ${error.message}\n`);
    process.exitCode = 2;
  }
}
