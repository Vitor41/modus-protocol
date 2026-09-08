#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";

import { resolveExecutionProfile } from "./execution-profiles.mjs";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(SOURCE_DIR, "..");
const REPOSITORY_DIR = resolve(RUNTIME_DIR, "..");
const PACKAGE = JSON.parse(readFileSync(join(RUNTIME_DIR, "package.json"), "utf8"));
const SENSITIVE_KEYS = new Set(["api_key", "token", "password", "secret", "cookie", "connection_string"]);

function parseData(path, label) {
  if (!existsSync(path)) throw new Error(`${label} não encontrado.`);
  const document = YAML.parseDocument(readFileSync(path, "utf8"), { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(`${label} possui YAML/JSON inválido.`);
  return document.toJS({ mapAsMap: false });
}

function diagnostic(diagnostics, code, path, message) {
  diagnostics.push({ code, severity: "error", path, message });
}

function recoveryAction(code) {
  if (/^(?:ROLE_SOURCE_STATE_INVALID|BLOCKED_TRANSITION_FORBIDDEN|PO_TRANSITION_INVALID|UX_SOURCE_STATE_INVALID|UX_TRANSITION_INVALID|DEV_(?:RELEASE_)?TRANSITION_INVALID|REVIEW_SOURCE_STATE_INVALID|REVIEW_TRANSITION_INVALID|QA_SOURCE_STATE_INVALID|QA_TRANSITION_INVALID)$/u.test(code)) {
    return "refresh-state-and-replan";
  }
  if (/^EXECUTION_/u.test(code)) return "relaunch-or-restamp-execution";
  if (/^(?:UX_VISUAL_ATTACHMENT_MISSING|UX_SPEC_INCOMPLETE|DEV_FAILED_EVIDENCE|DEV_PASSED_TEST_REQUIRED|DEV_PASSED_VALIDATION_REQUIRED|REVIEW_|QA_)/u.test(code)) {
    return "return-to-specialist";
  }
  return "repair-handoff";
}

function recoveryPlan(diagnostics) {
  const actions = [...new Set(diagnostics.map((item) => recoveryAction(item.code)))];
  return {
    required: diagnostics.length > 0,
    requires_human: false,
    disposition: diagnostics.length > 0 ? "auto-repair" : "none",
    max_repair_attempts: diagnostics.length > 0 ? 1 : 0,
    actions
  };
}

function findSensitiveKeys(value, diagnostics, path = "$", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "$" ? key : `${path}.${key}`;
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      diagnostic(diagnostics, "HANDOFF_SENSITIVE_KEY", childPath, "O handoff contém uma chave reservada a segredo.");
    }
    findSensitiveKeys(child, diagnostics, childPath, seen);
  }
}

function validateTransition(handoff, diagnostics) {
  const { role, status, iteration_kind: iteration, state, deliverable } = handoff;
  const expectedSource = {
    "pipeline-po": "refinement",
    "pipeline-ux-ui": "ux_ui",
    "pipeline-dev": iteration === "release" ? "ready_for_release" : iteration === "initial" ? "ready_for_development" : "in_development",
    "pipeline-code-review": "in_development",
    "pipeline-qa": "ready_for_validation"
  }[role];
  if (state.from !== expectedSource) {
    diagnostic(
      diagnostics,
      "ROLE_SOURCE_STATE_INVALID",
      "state.from",
      `${role} deveria atuar a partir de ${expectedSource}.`
    );
  }
  if (status === "blocked") {
    if (state.from !== state.to) {
      diagnostic(diagnostics, "BLOCKED_TRANSITION_FORBIDDEN", "state", "Um papel bloqueado deve permanecer no estado atual.");
    }
    return;
  }

  if (role === "pipeline-po") {
    if (status === "completed" && (deliverable?.open_questions?.length ?? 0) > 0) {
      diagnostic(diagnostics, "PO_COMPLETED_WITH_OPEN_QUESTIONS", "deliverable.open_questions", "PO não pode concluir com decisão material ainda aberta.");
    }
    const expected =
      status === "completed"
        ? iteration === "return" && deliverable?.ux_required === false
          ? "ready_for_development"
          : "ux_ui"
        : "refinement";
    if (state.from !== "refinement" || state.to !== expected) {
      diagnostic(diagnostics, "PO_TRANSITION_INVALID", "state", `O handoff de PO deveria terminar em ${expected}.`);
    }
  }

  if (role === "pipeline-ux-ui") {
    if (state.from !== "ux_ui") {
      diagnostic(diagnostics, "UX_SOURCE_STATE_INVALID", "state.from", "UX/UI deve atuar a partir de ux_ui.");
    }
    const frontend = deliverable?.classification === "frontend";
    const approval = deliverable?.human_approval;
    const validVisualAttachment = (item) => {
      if (item.readback_status !== "confirmed") return false;
      if (item.run_id === handoff.run_id) return item.reused !== true;
      return handoff.iteration_kind === "return" && handoff.context?.capsule_reused === true && item.reused === true &&
        item.validated_in_run_id === handoff.run_id && item.approval_evidence_ref === approval?.evidence_ref;
    };
    if (frontend && (!deliverable?.attachments?.length || deliverable.attachments.some((item) => !validVisualAttachment(item)))) {
      diagnostic(diagnostics, "UX_VISUAL_ATTACHMENT_MISSING", "deliverable.attachments", "Frontend exige mock anexado e relido no run de origem, ou reúso explícito com aprovação vigente e revalidação no RUN_ID atual.");
    }
    if (status === "completed" && frontend && (!approval?.required || !approval?.evidence_ref)) {
      diagnostic(diagnostics, "UX_APPROVAL_MISSING", "deliverable.human_approval", "Frontend não pode avançar sem aprovação humana vigente.");
    }
    if (
      status === "completed" &&
      frontend &&
      [deliverable?.flows, deliverable?.states, deliverable?.accessibility, deliverable?.responsiveness].some(
        (items) => !items || items.length === 0
      )
    ) {
      diagnostic(diagnostics, "UX_SPEC_INCOMPLETE", "deliverable", "Frontend concluído exige fluxo, estados, acessibilidade e responsividade explícitos.");
    }
    const expected = status === "completed" ? "ready_for_development" : status === "return" ? "refinement" : "ux_ui";
    if (state.to !== expected) {
      diagnostic(diagnostics, "UX_TRANSITION_INVALID", "state.to", `O handoff de UX/UI deveria terminar em ${expected}.`);
    }
  }

  if (role === "pipeline-dev") {
    if (deliverable?.mode === "release") {
      if (status !== "completed" || state.from !== "ready_for_release" || state.to !== "ready_for_production") {
        diagnostic(diagnostics, "DEV_RELEASE_TRANSITION_INVALID", "state", "Release aprovada deve ir de ready_for_release para ready_for_production.");
      }
    } else {
      const expected = status === "return" ? "refinement" : "in_development";
      const expectedDevSource = iteration === "initial" ? "ready_for_development" : "in_development";
      if (state.from !== expectedDevSource || state.to !== expected) {
        diagnostic(diagnostics, "DEV_TRANSITION_INVALID", "state", `O handoff de DEV deveria terminar em ${expected}.`);
      }
      if (status === "completed") {
        const failed = [...(deliverable?.tests ?? []), ...(deliverable?.validations ?? [])].some(
          (item) => item.result === "failed"
        );
        if (failed) diagnostic(diagnostics, "DEV_FAILED_EVIDENCE", "deliverable", "DEV não pode concluir com teste ou validação falhando.");
        if (!(deliverable?.tests ?? []).some((item) => item.result === "passed")) {
          diagnostic(diagnostics, "DEV_PASSED_TEST_REQUIRED", "deliverable.tests", "DEV concluído exige ao menos um teste aprovado.");
        }
        if (!(deliverable?.validations ?? []).some((item) => item.result === "passed")) {
          diagnostic(diagnostics, "DEV_PASSED_VALIDATION_REQUIRED", "deliverable.validations", "DEV concluído exige ao menos uma validação aprovada.");
        }
      }
    }
  }

  if (role === "pipeline-code-review") {
    if (state.from !== "in_development") {
      diagnostic(diagnostics, "REVIEW_SOURCE_STATE_INVALID", "state.from", "Code Review deve ocorrer em in_development.");
    }
    if (status === "return" && !deliverable) {
      diagnostic(diagnostics, "REVIEW_DELIVERABLE_REQUIRED", "deliverable", "Retorno de review exige veredito e achados.");
    }
    if (deliverable?.verdict === "approved" && status !== "completed") {
      diagnostic(diagnostics, "REVIEW_STATUS_MISMATCH", "status", "Review aprovado deve usar status completed.");
    }
    if (deliverable?.verdict === "changes_required" && status !== "return") {
      diagnostic(diagnostics, "REVIEW_STATUS_MISMATCH", "status", "Review com mudanças deve usar status return.");
    }
    const findings = [...(deliverable?.spec_findings ?? []), ...(deliverable?.standards_findings ?? [])];
    if (deliverable?.verdict === "changes_required" && findings.length === 0) {
      diagnostic(diagnostics, "REVIEW_FINDING_REQUIRED", "deliverable", "Reprovação de review exige ao menos um achado acionável.");
    }
    if (deliverable?.verdict === "approved" && findings.some((item) => ["critical", "high"].includes(item.severity))) {
      diagnostic(diagnostics, "REVIEW_APPROVED_WITH_BLOCKER", "deliverable", "Review não pode aprovar com achado crítico ou alto.");
    }
    if (deliverable?.verdict === "approved" && (deliverable.tests_observed?.length ?? 0) === 0) {
      diagnostic(diagnostics, "REVIEW_TEST_EVIDENCE_REQUIRED", "deliverable.tests_observed", "Review aprovado deve registrar os testes observados.");
    }
    const expected = deliverable?.verdict === "approved" && status === "completed" ? "ready_for_validation" : "in_development";
    if (state.to !== expected) {
      diagnostic(diagnostics, "REVIEW_TRANSITION_INVALID", "state.to", `Code Review deveria terminar em ${expected}.`);
    }
  }

  if (role === "pipeline-qa") {
    if (state.from !== "ready_for_validation") {
      diagnostic(diagnostics, "QA_SOURCE_STATE_INVALID", "state.from", "QA deve atuar a partir de ready_for_validation.");
    }
    if (status === "return" && !deliverable) {
      diagnostic(diagnostics, "QA_DELIVERABLE_REQUIRED", "deliverable", "Retorno de QA exige matriz e veredito.");
    }
    const expectedStatus = { approved: "completed", rejected: "return", blocked: "blocked" }[deliverable?.verdict];
    if (expectedStatus && status !== expectedStatus) {
      diagnostic(diagnostics, "QA_STATUS_MISMATCH", "status", `O veredito ${deliverable.verdict} exige status ${expectedStatus}.`);
    }
    const results = (deliverable?.criteria_matrix ?? []).map((item) => item.result);
    if (deliverable?.verdict === "approved" && results.some((result) => result !== "passed")) {
      diagnostic(diagnostics, "QA_APPROVED_WITH_FAILURE", "deliverable.criteria_matrix", "QA só pode aprovar quando todos os cenários passam.");
    }
    if (deliverable?.verdict === "rejected" && !results.includes("failed")) {
      diagnostic(diagnostics, "QA_REJECTION_WITHOUT_FAILURE", "deliverable.criteria_matrix", "Reprovação de QA exige cenário falho.");
    }
    const expected = deliverable?.verdict === "approved" && status === "completed" ? "ready_for_release" : "in_development";
    if (state.to !== expected) {
      diagnostic(diagnostics, "QA_TRANSITION_INVALID", "state.to", `QA deveria terminar em ${expected}.`);
    }
  }
}

function validateExecutionReceipt(handoff, diagnostics) {
  const expected = resolveExecutionProfile(handoff.profile, handoff.role);
  const request = handoff.execution.request;
  const observation = handoff.execution.observation;
  for (const field of [
    "mapping_version",
    "profile",
    "model",
    "reasoning_effort",
    "agent_mode",
    "configuration_source",
    "fallback_policy"
  ]) {
    if (request[field] !== expected[field]) {
      diagnostic(
        diagnostics,
        "EXECUTION_REQUEST_MAPPING_MISMATCH",
        `execution.request.${field}`,
        `A solicitação deveria usar ${field}=${expected[field]}.`
      );
    }
  }
  if (observation.status !== "confirmed") {
    diagnostic(
      diagnostics,
      "EXECUTION_CONFIGURATION_NOT_CONFIRMED",
      "execution.observation.status",
      "Execução ao vivo exige confirmação observável do modelo e do esforço."
    );
  }
  if (!["explicit-agent-launch", "explicit-codex-exec"].includes(observation.configuration_source)) {
    diagnostic(
      diagnostics,
      "EXECUTION_CONFIGURATION_SOURCE_INVALID",
      "execution.observation.configuration_source",
      "O recibo deve vir de um lançamento explícito e identificável do agente de papel."
    );
  }
  if (/(placeholder|todo|pending|replace|agent-id|unknown|temp)/iu.test(observation.evidence_ref ?? "")) {
    diagnostic(
      diagnostics,
      "EXECUTION_EVIDENCE_PLACEHOLDER",
      "execution.observation.evidence_ref",
      "A evidência deve conter o identificador real retornado pelo lançamento do agente."
    );
  }
  if (observation.model !== expected.model || observation.reasoning_effort !== expected.reasoning_effort) {
    diagnostic(
      diagnostics,
      "EXECUTION_EFFECTIVE_MAPPING_MISMATCH",
      "execution.observation",
      `A execução observada deveria usar ${expected.model}/${expected.reasoning_effort}.`
    );
  }
  if (observation.fallback_used === true) {
    diagnostic(
      diagnostics,
      "EXECUTION_FALLBACK_FORBIDDEN",
      "execution.observation.fallback_used",
      "Fallback de modelo ou esforço não pode atravessar o gate ao vivo."
    );
  }
}

export function validateRoleHandoff(input = {}) {
  if (!input.handoffPath) throw new Error("handoffPath é obrigatório.");
  const handoffPath = resolve(input.handoffPath);
  const schemaPath = resolve(input.schemaPath ?? join(REPOSITORY_DIR, "schema", "role-handoff.schema.json"));
  const handoff = parseData(handoffPath, "Handoff");
  const schema = parseData(schemaPath, "Schema de handoff");
  const diagnostics = [];
  findSensitiveKeys(handoff, diagnostics);
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  if (!validate(handoff)) {
    for (const error of validate.errors ?? []) {
      diagnostic(
        diagnostics,
        "ROLE_HANDOFF_SCHEMA_INVALID",
        error.instancePath || "$",
        `O handoff viola o schema: ${error.message}.`
      );
    }
  } else {
    if (input.expectedCardRef && handoff.card.ref !== input.expectedCardRef) {
      diagnostic(diagnostics, "HANDOFF_CARD_REF_MISMATCH", "card.ref", `O handoff deveria pertencer ao card ${input.expectedCardRef}.`);
    }
    if (input.expectedRunId && handoff.run_id !== input.expectedRunId) {
      diagnostic(diagnostics, "HANDOFF_RUN_ID_MISMATCH", "run_id", `O handoff deveria pertencer ao RUN_ID ${input.expectedRunId}.`);
    }
    if (input.expectedRole && handoff.role !== input.expectedRole) {
      diagnostic(diagnostics, "HANDOFF_ROLE_MISMATCH", "role", `O handoff deveria pertencer ao papel ${input.expectedRole}.`);
    }
    validateExecutionReceipt(handoff, diagnostics);
    validateTransition(handoff, diagnostics);
  }
  diagnostics.sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path));
  return {
    contract_version: "0.1",
    tool: { name: "pipeline-role-gate", version: PACKAGE.version },
    status: diagnostics.length > 0 ? "FAIL" : "PASS",
    role: handoff.role,
    run_id: handoff.run_id,
    diagnostics,
    recovery: recoveryPlan(diagnostics)
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
      if (argument === "--handoff") options.handoffPath = value;
      else if (argument === "--schema") options.schemaPath = value;
      else if (argument === "--expected-card-ref") options.expectedCardRef = value;
      else if (argument === "--expected-run-id") options.expectedRunId = value;
      else if (argument === "--expected-role") options.expectedRole = value;
      else if (argument === "--format") options.format = value;
      else throw new Error(`Argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write("Uso: node runtime/src/role-gate.mjs --handoff <arquivo> [--expected-card-ref <ref> --expected-run-id <RUN_ID> --expected-role <papel>] [--format text|json]\n");
    else {
      const result = validateRoleHandoff(options);
      if ((options.format ?? "text") === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        process.stdout.write(`pipeline-role-gate ${result.tool.version} | ${result.role} | ${result.status}\n`);
        for (const item of result.diagnostics) process.stdout.write(`[ERROR] ${item.code} ${item.path} - ${item.message}\n`);
      }
      process.exitCode = result.status === "PASS" ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`pipeline-role-gate: ${error.message}\n`);
    process.exitCode = 2;
  }
}
