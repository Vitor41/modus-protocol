#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(SOURCE_DIR, "..");
const REPOSITORY_DIR = resolve(RUNTIME_DIR, "..");
const PACKAGE = JSON.parse(readFileSync(join(RUNTIME_DIR, "package.json"), "utf8"));
const CONTRACT_VERSION = "0.1";
const STATE_ORDER = [
  "ideas",
  "refinement",
  "ux_ui",
  "ready_for_development",
  "in_development",
  "ready_for_validation",
  "ready_for_release",
  "ready_for_production",
  "done"
];
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
const SENSITIVE_KEYS = new Set([
  "api_key",
  "token",
  "password",
  "secret",
  "cookie",
  "connection_string"
]);

function addDiagnostic(diagnostics, code, severity, path, message, hint) {
  diagnostics.push({ code, severity, path, message, hint });
}

function normalizeAjvPath(error) {
  const suffix = error.params?.missingProperty
    ? `${error.instancePath}/${error.params.missingProperty}`
    : error.instancePath;
  return suffix ? suffix.replace(/^\//, "").replaceAll("/", ".") : "$";
}

function isWithin(root, candidate) {
  const delta = relative(resolve(root), resolve(candidate));
  return delta === "" || (!delta.startsWith("..") && !isAbsolute(delta));
}

function discoverProjectRoot(start) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: start,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return resolve(start);
  }
}

function parseYamlFile(path, diagnostics, code) {
  if (!existsSync(path)) {
    addDiagnostic(
      diagnostics,
      code,
      "error",
      path,
      "Arquivo não encontrado.",
      "Confirme o caminho informado e tente novamente."
    );
    return undefined;
  }

  try {
    const document = YAML.parseDocument(readFileSync(path, "utf8"), { uniqueKeys: true });
    if (document.errors.length > 0) {
      throw new Error(document.errors.map((item) => item.message).join("; "));
    }
    return document.toJS({ mapAsMap: false });
  } catch {
    addDiagnostic(
      diagnostics,
      code,
      "error",
      path,
      "Não foi possível interpretar o YAML/JSON.",
      "Corrija a sintaxe sem incluir credenciais no arquivo."
    );
    return undefined;
  }
}

function checkSensitiveKeys(value, diagnostics, currentPath = "$", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    const path = currentPath === "$" ? key : `${currentPath}.${key}`;
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      addDiagnostic(
        diagnostics,
        "INLINE_SECRET_KEY",
        "error",
        path,
        "O adapter contém uma chave normalmente usada para segredo embutido.",
        "Mantenha somente referências externas a segredos. O valor não foi exibido."
      );
    }
    checkSensitiveKeys(child, diagnostics, path, seen);
  }
}

function checkProjectPath(projectRoot, item, diagnostics, label) {
  const declared = item.path;
  const target = resolve(projectRoot, declared);
  if (!isWithin(projectRoot, target)) {
    addDiagnostic(
      diagnostics,
      "CONTEXT_PATH_OUTSIDE_PROJECT",
      "error",
      label,
      "O caminho resolve para fora da raiz do projeto.",
      "Use um caminho relativo contido no projeto consumidor."
    );
    return;
  }

  if (!existsSync(target)) {
    addDiagnostic(
      diagnostics,
      item.optional === true ? "OPTIONAL_CONTEXT_MISSING" : "REQUIRED_CONTEXT_MISSING",
      item.optional === true ? "warning" : "error",
      label,
      `O caminho declarado não existe: ${declared}`,
      item.optional === true
        ? "Crie o conteúdo quando ele passar a fazer parte do contexto do projeto."
        : "Crie o arquivo/diretório ou ajuste o adapter antes do cutover."
    );
    return;
  }

}

function checkAdapterSemantics(adapter, projectRoot, diagnostics) {
  const stateEntries = Object.entries(adapter.tracker.states);
  const refs = stateEntries.map(([, ref]) => ref);
  for (const ref of new Set(refs)) {
    if (refs.filter((item) => item === ref).length > 1) {
      addDiagnostic(
        diagnostics,
        "TRACKER_STATE_REF_DUPLICATE",
        "error",
        "tracker.states",
        `A referência ${ref} foi atribuída a mais de um estado.`,
        "Cada estado canônico deve apontar para uma lista distinta."
      );
    }
  }

  checkProjectPath(
    projectRoot,
    { path: adapter.context.agents, optional: false },
    diagnostics,
    "context.agents"
  );
  checkProjectPath(
    projectRoot,
    { path: adapter.context.index, optional: false },
    diagnostics,
    "context.index"
  );
  for (const [index, item] of adapter.context.references.entries()) {
    checkProjectPath(projectRoot, item, diagnostics, `context.references.${index}.path`);
  }

  if (adapter.tracker.environment?.credential_file) {
    const credentialPath = resolve(projectRoot, adapter.tracker.environment.credential_file);
    if (!isWithin(projectRoot, credentialPath)) {
      addDiagnostic(
        diagnostics,
        "TRACKER_CREDENTIAL_PATH_OUTSIDE_PROJECT",
        "error",
        "tracker.environment.credential_file",
        "O arquivo de credenciais resolve para fora da raiz do projeto.",
        "Use um caminho relativo contido no projeto consumidor."
      );
    } else if (!existsSync(credentialPath) || !statSync(credentialPath).isFile()) {
      addDiagnostic(
        diagnostics,
        "TRACKER_CREDENTIAL_FILE_MISSING",
        "error",
        "tracker.environment.credential_file",
        "O arquivo externo de credenciais do tracker não foi encontrado.",
        "Provisione o arquivo local sem versionar seus valores."
      );
    }
  }

  for (const [name, command] of Object.entries(adapter.commands)) {
    const target = resolve(projectRoot, command.working_directory);
    if (!isWithin(projectRoot, target)) {
      addDiagnostic(
        diagnostics,
        "COMMAND_PATH_OUTSIDE_PROJECT",
        "error",
        `commands.${name}.working_directory`,
        "O diretório de execução resolve para fora do projeto.",
        "Use um diretório relativo contido no projeto."
      );
    } else if (!existsSync(target) || !statSync(target).isDirectory()) {
      addDiagnostic(
        diagnostics,
        "COMMAND_WORKDIR_MISSING",
        "error",
        `commands.${name}.working_directory`,
        `O diretório de execução não existe: ${command.working_directory}`,
        "Crie o diretório ou ajuste o adapter."
      );
    }
  }

  const cardKinds = new Set();
  for (const [index, pattern] of adapter.tracker.card_keys.entries()) {
    if (cardKinds.has(pattern.kind)) {
      addDiagnostic(
        diagnostics,
        "CARD_KEY_KIND_DUPLICATE",
        "error",
        `tracker.card_keys.${index}.kind`,
        `O tipo ${pattern.kind} aparece mais de uma vez.`,
        "Mantenha um único padrão por tipo de card."
      );
    }
    cardKinds.add(pattern.kind);
    try {
      new RegExp(pattern.pattern);
    } catch {
      addDiagnostic(
        diagnostics,
        "CARD_KEY_REGEX_INVALID",
        "error",
        `tracker.card_keys.${index}.pattern`,
        "A expressão regular do identificador de card é inválida.",
        "Corrija a expressão regular antes de processar a fila."
      );
    }
  }

  for (const [index, environment] of (adapter.environments ?? []).entries()) {
    if (!Object.hasOwn(adapter.commands, environment.start_command)) {
      addDiagnostic(
        diagnostics,
        "ENVIRONMENT_COMMAND_UNKNOWN",
        "error",
        `environments.${index}.start_command`,
        `O comando ${environment.start_command} não está declarado em commands.`,
        "Declare o comando ou ajuste a referência do ambiente."
      );
    }
  }

  if (adapter.profiles?.default && !adapter.profiles.allowed?.includes(adapter.profiles.default)) {
    addDiagnostic(
      diagnostics,
      "PROFILE_DEFAULT_NOT_ALLOWED",
      "error",
      "profiles.default",
      "O perfil padrão não consta entre os perfis permitidos.",
      "Inclua o perfil na lista allowed ou escolha outro padrão."
    );
  }

}

function checkTrackerSnapshot(adapter, snapshotPath, mode, diagnostics) {
  if (!snapshotPath) {
    if (mode !== "structural") {
      addDiagnostic(
        diagnostics,
        "TRACKER_NOT_CHECKED",
        mode === "cutover" ? "error" : "warning",
        "tracker",
        "O estado real do tracker não foi fornecido para validação.",
        "Gere um snapshot somente leitura das listas abertas e execute o doctor novamente."
      );
    }
    return;
  }

  const snapshot = parseYamlFile(snapshotPath, diagnostics, "TRACKER_SNAPSHOT_INVALID");
  if (!snapshot) return;

  const commentCapability = snapshot.integration?.comments;
  const commentsVerified =
    commentCapability?.read === "verified" &&
    commentCapability?.write === "verified" &&
    commentCapability?.read_provider === adapter.tracker.comments.read_provider &&
    commentCapability?.write_provider === adapter.tracker.comments.write_provider &&
    typeof commentCapability?.evidence_ref === "string" &&
    commentCapability.evidence_ref.length > 0 &&
    typeof commentCapability?.verified_at === "string" &&
    commentCapability.verified_at.length > 0;
  if (!commentsVerified) {
    addDiagnostic(
      diagnostics,
      "TRACKER_COMMENT_CAPABILITY_UNVERIFIED",
      mode === "cutover" ? "error" : "warning",
      "tracker.integration.comments",
      "A integração não comprovou leitura e escrita pelos providers declarados, com releitura persistida.",
      "Publique um comentário diagnóstico pelos providers do adapter, releia-o por referência e registre providers, evidence_ref e verified_at no snapshot."
    );
  }

  if (snapshot.board_ref !== adapter.tracker.board_ref) {
    addDiagnostic(
      diagnostics,
      "TRACKER_BOARD_MISMATCH",
      "error",
      "tracker.board_ref",
      "O snapshot pertence a outro board.",
      "Capture novamente o board configurado no adapter."
    );
  }

  const openLists = Array.isArray(snapshot.open_lists) ? snapshot.open_lists : [];
  if (openLists.length !== STATE_ORDER.length) {
    addDiagnostic(
      diagnostics,
      "TRACKER_OPEN_LIST_COUNT_MISMATCH",
      "error",
      "tracker.open_lists",
      `Foram encontradas ${openLists.length} listas abertas; o contrato exige ${STATE_ORDER.length}.`,
      "Arquive listas legadas ou restaure estados canônicos antes do cutover."
    );
  }

  const expectedRefs = STATE_ORDER.map((state) => adapter.tracker.states[state]);
  const actualRefs = openLists
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((list) => list.ref);
  if (expectedRefs.length !== actualRefs.length || expectedRefs.some((ref, index) => ref !== actualRefs[index])) {
    addDiagnostic(
      diagnostics,
      "TRACKER_STATE_ORDER_MISMATCH",
      "error",
      "tracker.open_lists",
      "As listas abertas não correspondem aos estados e à ordem definidos no adapter.",
      "Ajuste referências/ordem no board ou no adapter após revisão humana."
    );
  }
}

function checkRouting(adapter, projectRoot, mode, diagnostics) {
  const agentsPath = resolve(projectRoot, adapter.context.agents);
  if (!isWithin(projectRoot, agentsPath) || !existsSync(agentsPath)) return;

  const severity = mode === "cutover" ? "error" : "warning";
  const missingCode = mode === "cutover" ? "UNIFIED_ROUTER_MISSING" : "UNIFIED_ROUTER_PENDING";

  const lines = readFileSync(agentsPath, "utf8").split(/\r?\n/);
  const trigger = adapter.trigger.process_queue;
  const triggerIndexes = lines
    .map((line, index) => (line.includes(trigger) ? index : -1))
    .filter((index) => index >= 0);

  if (triggerIndexes.length === 0) {
    addDiagnostic(
      diagnostics,
      missingCode,
      severity,
      "context.agents",
      "O AGENTS.md não associa o gatilho canônico ao roteador unificado.",
      "Adicione uma regra explícita que encaminhe o gatilho para $pipeline-run."
    );
  } else {
    const nearby = triggerIndexes.flatMap((index) => lines.slice(Math.max(0, index - 12), index + 13));
    const skills = new Set(
      nearby.flatMap((line) => [...line.matchAll(/\$([a-z0-9]+(?:-[a-z0-9]+)*)/gi)].map((match) => match[1]))
    );
    if (!skills.has("pipeline-run")) {
      addDiagnostic(
        diagnostics,
        missingCode,
        severity,
        "context.agents",
        "O gatilho canônico existe, mas não referencia $pipeline-run nas linhas próximas.",
        "Aponte o gatilho exclusivamente para o roteador unificado."
      );
    }
    const legacy = [...skills].filter((skill) => skill !== "pipeline-run");
    if (legacy.length > 0) {
      addDiagnostic(
        diagnostics,
        "LEGACY_ROUTER_CONFLICT",
        severity,
        "context.agents",
        `O gatilho também referencia roteadores potencialmente legados: ${legacy.join(", ")}.`,
        "Remova a rota concorrente somente durante o cutover aprovado."
      );
    }
  }

  const pipelineDir = join(projectRoot, ".pipeline");
  if (existsSync(pipelineDir) && statSync(pipelineDir).isDirectory()) {
    const adapters = readdirSync(pipelineDir).filter((name) => /\.adapter\.ya?ml$/i.test(name));
    if (adapters.length > 1) {
      addDiagnostic(
        diagnostics,
        "MULTIPLE_PROJECT_ADAPTERS",
        severity,
        ".pipeline",
        `Foram encontrados ${adapters.length} adapters de projeto.`,
        "Mantenha um único project.adapter.yaml como fonte ativa."
      );
    }
  }
}

function finalize(diagnostics, options) {
  diagnostics.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      left.code.localeCompare(right.code) ||
      left.path.localeCompare(right.path)
  );
  const summary = {
    errors: diagnostics.filter((item) => item.severity === "error").length,
    warnings: diagnostics.filter((item) => item.severity === "warning").length,
    info: diagnostics.filter((item) => item.severity === "info").length
  };
  const status = summary.errors > 0 ? "FAIL" : summary.warnings > 0 ? "WARN" : "PASS";
  return {
    contract_version: CONTRACT_VERSION,
    tool: { name: "pipeline-doctor", version: PACKAGE.version },
    mode: options.mode,
    target: { project_root: options.projectRoot, adapter: options.adapterPath },
    status,
    summary,
    diagnostics
  };
}

export function runDoctor(input = {}) {
  const mode = input.mode ?? "shadow";
  if (!["structural", "shadow", "cutover"].includes(mode)) {
    throw new Error(`Modo inválido: ${mode}`);
  }

  const adapterArgument = input.adapterPath ? resolve(input.adapterPath) : undefined;
  const startingPoint = input.projectRoot
    ? resolve(input.projectRoot)
    : adapterArgument
      ? dirname(adapterArgument)
      : process.cwd();
  const projectRoot = input.projectRoot ? resolve(input.projectRoot) : discoverProjectRoot(startingPoint);
  const adapterPath = adapterArgument ?? join(projectRoot, ".pipeline", "project.adapter.yaml");
  const schemaPath = resolve(input.schemaPath ?? join(REPOSITORY_DIR, "schema", "project-adapter.schema.json"));
  const trackerSnapshotPath = input.trackerSnapshotPath ? resolve(input.trackerSnapshotPath) : undefined;
  const diagnostics = [];
  const options = { mode, projectRoot, adapterPath };

  if (!isWithin(projectRoot, adapterPath)) {
    addDiagnostic(
      diagnostics,
      "ADAPTER_OUTSIDE_PROJECT",
      "error",
      "adapter",
      "O adapter resolve para fora da raiz do projeto consumidor.",
      "Use o adapter repo-scoped do próprio projeto."
    );
    return finalize(diagnostics, options);
  }
  if (mode === "cutover" && resolve(adapterPath) !== resolve(projectRoot, ".pipeline", "project.adapter.yaml")) {
    addDiagnostic(
      diagnostics,
      "ADAPTER_LOCATION_NONCANONICAL",
      "error",
      "adapter",
      "O cutover exige o adapter na localização canônica.",
      "Versione o arquivo como .pipeline/project.adapter.yaml antes do cutover."
    );
    return finalize(diagnostics, options);
  }

  const adapter = parseYamlFile(adapterPath, diagnostics, "ADAPTER_NOT_READABLE");
  const schema = parseYamlFile(schemaPath, diagnostics, "SCHEMA_NOT_READABLE");
  if (!adapter || !schema) return finalize(diagnostics, options);

  checkSensitiveKeys(adapter, diagnostics);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(adapter)) {
    for (const error of validate.errors ?? []) {
      addDiagnostic(
        diagnostics,
        "ADAPTER_SCHEMA_INVALID",
        "error",
        normalizeAjvPath(error),
        `O adapter viola o schema: ${error.message}.`,
        "Compare o campo com schema/project-adapter.schema.json."
      );
    }
  }

  if (diagnostics.some((item) => item.severity === "error")) {
    return finalize(diagnostics, options);
  }

  if (mode !== "structural") {
    checkAdapterSemantics(adapter, projectRoot, diagnostics);
  }
  checkTrackerSnapshot(adapter, trackerSnapshotPath, mode, diagnostics);
  if (mode !== "structural") {
    checkRouting(adapter, projectRoot, mode, diagnostics);
  }

  return finalize(diagnostics, options);
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Valor ausente para ${argument}`);
    index += 1;
    if (argument === "--adapter") options.adapterPath = value;
    else if (argument === "--project-root") options.projectRoot = value;
    else if (argument === "--schema") options.schemaPath = value;
    else if (argument === "--tracker-snapshot") options.trackerSnapshotPath = value;
    else if (argument === "--mode") options.mode = value;
    else if (argument === "--format") options.format = value;
    else throw new Error(`Argumento desconhecido: ${argument}`);
  }
  return options;
}

function printHelp() {
  process.stdout.write(`pipeline-doctor ${PACKAGE.version}\n\n`);
  process.stdout.write("Uso: node runtime/src/doctor.mjs [opções]\n\n");
  process.stdout.write("  --project-root <path>       raiz do projeto consumidor\n");
  process.stdout.write("  --adapter <path>            adapter; padrão .pipeline/project.adapter.yaml\n");
  process.stdout.write("  --schema <path>             schema alternativo\n");
  process.stdout.write("  --tracker-snapshot <path>   snapshot somente leitura do tracker\n");
  process.stdout.write("  --mode <mode>               structural, shadow ou cutover\n");
  process.stdout.write("  --format <format>           text ou json\n");
}

function printText(result) {
  process.stdout.write(`pipeline-doctor ${result.tool.version} | ${result.mode} | ${result.status}\n`);
  process.stdout.write(
    `erros=${result.summary.errors} avisos=${result.summary.warnings} informações=${result.summary.info}\n`
  );
  for (const item of result.diagnostics) {
    process.stdout.write(
      `[${item.severity.toUpperCase()}] ${item.code} ${item.path} - ${item.message} ${item.hint}\n`
    );
  }
}

const invokedDirectly = process.argv[1] && basename(process.argv[1]) === "doctor.mjs" && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      printHelp();
      process.exitCode = 0;
    } else {
      if (options.format && !["text", "json"].includes(options.format)) {
        throw new Error(`Formato inválido: ${options.format}`);
      }
      const result = runDoctor(options);
      if (options.format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else printText(result);
      process.exitCode = result.status === "FAIL" ? 1 : 0;
    }
  } catch (error) {
    process.stderr.write(`pipeline-doctor: ${error.message}\n`);
    process.exitCode = 2;
  }
}
