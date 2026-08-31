import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateRoleHandoff } from "../src/role-gate.mjs";

const REPOSITORY_DIR = resolve(import.meta.dirname, "..", "..");
const FIXTURE_DIR = join(REPOSITORY_DIR, "tests", "fixtures", "handoffs");
const SCHEMA_PATH = join(REPOSITORY_DIR, "schema", "role-handoff.schema.json");

async function fixture(name) {
  return JSON.parse(await readFile(join(FIXTURE_DIR, name), "utf8"));
}

async function validateObject(value) {
  const root = await mkdtemp(join(tmpdir(), "role-gate-"));
  const handoffPath = join(root, "handoff.json");
  await writeFile(handoffPath, JSON.stringify(value), "utf8");
  try {
    return validateRoleHandoff({ handoffPath, schemaPath: SCHEMA_PATH });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const name of ["valid-po.json", "valid-ux.json", "valid-dev.json", "valid-review.json", "valid-qa.json"]) {
  test(`handoff válido: ${name}`, async () => {
    const result = await validateObject(await fixture(name));
    assert.equal(result.status, "PASS", JSON.stringify(result.diagnostics));
  });
}

test("PO inicial não pode pular UX/UI", async () => {
  const handoff = await fixture("valid-po.json");
  handoff.state.to = "ready_for_development";
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "PO_TRANSITION_INVALID"));
});

test("PO não conclui com pergunta material aberta", async () => {
  const handoff = await fixture("valid-po.json");
  handoff.deliverable.open_questions.push("Quem pode editar?");
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "PO_COMPLETED_WITH_OPEN_QUESTIONS"));
});

test("UX com frontend exige aprovação humana vigente", async () => {
  const handoff = await fixture("valid-ux.json");
  delete handoff.deliverable.human_approval.evidence_ref;
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "UX_APPROVAL_MISSING"));
});

test("UX não conclui frontend sem estados verificáveis", async () => {
  const handoff = await fixture("valid-ux.json");
  handoff.deliverable.states = [];
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "UX_SPEC_INCOMPLETE"));
});

test("DEV não conclui com teste falhando", async () => {
  const handoff = await fixture("valid-dev.json");
  handoff.deliverable.tests[0].result = "failed";
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "DEV_FAILED_EVIDENCE"));
});

test("DEV não substitui evidência aprovada por not_applicable", async () => {
  const handoff = await fixture("valid-dev.json");
  for (const item of handoff.deliverable.tests) item.result = "not_applicable";
  for (const item of handoff.deliverable.validations) item.result = "not_applicable";
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "DEV_PASSED_TEST_REQUIRED"));
  assert.ok(result.diagnostics.some((item) => item.code === "DEV_PASSED_VALIDATION_REQUIRED"));
});

test("DEV concluído exige checkpoint", async () => {
  const handoff = await fixture("valid-dev.json");
  delete handoff.deliverable.checkpoint;
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "ROLE_HANDOFF_SCHEMA_INVALID"));
});

test("DEV não pode incluir autoaprovação de review", async () => {
  const handoff = await fixture("valid-dev.json");
  handoff.deliverable.review_approved = true;
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "ROLE_HANDOFF_SCHEMA_INVALID"));
});

test("review reprovado exige achado acionável", async () => {
  const handoff = await fixture("valid-review.json");
  handoff.status = "return";
  handoff.state.to = "in_development";
  handoff.deliverable.verdict = "changes_required";
  handoff.blocker = { reason: "Correção técnica necessária.", requires_human: false, return_to: "pipeline-dev" };
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "REVIEW_FINDING_REQUIRED"));
});

test("review não aprova com achado alto", async () => {
  const handoff = await fixture("valid-review.json");
  handoff.deliverable.standards_findings.push({ severity: "high", path: "src/a.ts", message: "Falha de autorização." });
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "REVIEW_APPROVED_WITH_BLOCKER"));
});

test("QA não aprova cenário falho", async () => {
  const handoff = await fixture("valid-qa.json");
  handoff.deliverable.criteria_matrix[0].result = "failed";
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "QA_APPROVED_WITH_FAILURE"));
});

test("QA não reprova sem evidência de falha", async () => {
  const handoff = await fixture("valid-qa.json");
  handoff.status = "return";
  handoff.state.to = "in_development";
  handoff.deliverable.verdict = "rejected";
  handoff.blocker = { reason: "Cenário supostamente falhou.", requires_human: false, return_to: "pipeline-dev" };
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "QA_REJECTION_WITHOUT_FAILURE"));
});

test("release DEV exige todas as ações de integração Git", async () => {
  const handoff = await fixture("valid-dev.json");
  handoff.iteration_kind = "release"; handoff.state = { from: "ready_for_release", to: "ready_for_production" };
  handoff.deliverable = { mode: "release", production_approval_ref: "approval-1", fixed_commit_ref: "a".repeat(40), release_actions: ["push_confirmed"], validations: [{ kind: "compile", result: "passed", evidence_ref: "pr-1" }] };
  const result = await validateObject(handoff);
  assert.equal(result.status, "FAIL");
});

test("papel bloqueado não movimenta estado", async () => {
  const handoff = await fixture("valid-po.json");
  handoff.status = "blocked";
  handoff.blocker = { reason: "Decisão humana pendente.", requires_human: true };
  delete handoff.deliverable;
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "BLOCKED_TRANSITION_FORBIDDEN"));
});

test("papel bloqueado ainda precisa partir do estado correto", async () => {
  const handoff = await fixture("valid-po.json");
  handoff.status = "blocked";
  handoff.state = { from: "ux_ui", to: "ux_ui" };
  handoff.blocker = { reason: "Decisão humana pendente.", requires_human: true };
  delete handoff.deliverable;
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "ROLE_SOURCE_STATE_INVALID"));
});

test("handoff rejeita chave com aparência de segredo", async () => {
  const handoff = await fixture("valid-po.json");
  handoff.password = "não-exibir";
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "HANDOFF_SENSITIVE_KEY"));
});

test("handoff rejeita modelo diferente do perfil solicitado", async () => {
  const handoff = await fixture("valid-review.json");
  handoff.execution.request.model = "gpt-5.6-terra";
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "EXECUTION_REQUEST_MAPPING_MISMATCH"));
});

test("handoff rejeita execução não observável", async () => {
  const handoff = await fixture("valid-qa.json");
  handoff.execution.observation = {
    status: "not_observable",
    model: "not_observable",
    reasoning_effort: "not_observable",
    configuration_source: "not_observable",
    evidence_ref: "agent:telemetry-unavailable",
    fallback_used: false
  };
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "EXECUTION_CONFIGURATION_NOT_CONFIRMED"));
  assert.ok(result.diagnostics.some((item) => item.code === "EXECUTION_EFFECTIVE_MAPPING_MISMATCH"));
});

test("handoff rejeita configuração herdada", async () => {
  const handoff = await fixture("valid-po.json");
  handoff.execution.observation.configuration_source = "inherited";
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "EXECUTION_CONFIGURATION_SOURCE_INVALID"));
});

test("handoff rejeita fallback mesmo quando produz saída", async () => {
  const handoff = await fixture("valid-dev.json");
  handoff.execution.observation.fallback_used = true;
  handoff.execution.observation.fallback_reason = "Modelo solicitado indisponível.";
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "EXECUTION_FALLBACK_FORBIDDEN"));
});
