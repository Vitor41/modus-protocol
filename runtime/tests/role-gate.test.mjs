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

async function validateObject(value, expected = {}) {
  const root = await mkdtemp(join(tmpdir(), "role-gate-"));
  const handoffPath = join(root, "handoff.json");
  await writeFile(handoffPath, JSON.stringify(value), "utf8");
  try {
    return validateRoleHandoff({ handoffPath, schemaPath: SCHEMA_PATH, ...expected });
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

test("bloqueio de grupo exige identificador do Delivery Group", async () => {
  const handoff = await fixture("valid-po.json");
  handoff.status = "blocked";
  handoff.state.to = "refinement";
  handoff.blocker = { reason: "Premissa compartilhada pendente.", requires_human: true, kind: "business_rule", scope: "delivery_group", return_to: "pipeline-po" };
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "ROLE_HANDOFF_SCHEMA_INVALID"));
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
  assert.equal(result.recovery.requires_human, false);
  assert.ok(result.recovery.actions.includes("return-to-specialist"));
});

test("UX frontend exige mock anexado e relido no RUN_ID atual", async () => {
  const handoff = await fixture("valid-ux.json");
  delete handoff.deliverable.attachments;
  const missing = await validateObject(handoff);
  assert.ok(missing.diagnostics.some((item) => item.code === "UX_VISUAL_ATTACHMENT_MISSING"));

  handoff.deliverable.attachments = [{ ref: "attachment-1", name: "mock.png", kind: "file", run_id: "RUN-20260828-OUTRO001", specification_version: "ux-v1", readback_status: "confirmed" }];
  const wrongRun = await validateObject(handoff);
  assert.ok(wrongRun.diagnostics.some((item) => item.code === "UX_VISUAL_ATTACHMENT_MISSING"));
});

test("UX preserva proveniência ao reutilizar mock aprovado de outro RUN_ID", async () => {
  const handoff = await fixture("valid-ux.json");
  handoff.iteration_kind = "return";
  handoff.deliverable.attachments = [{
    ref: "attachment-existing", name: "mock-existing.png", kind: "file",
    run_id: "RUN-20260827-SOURCE01", specification_version: "ux-v1", readback_status: "confirmed",
    reused: true, validated_in_run_id: handoff.run_id,
    approval_evidence_ref: handoff.deliverable.human_approval.evidence_ref
  }];
  assert.equal((await validateObject(handoff)).status, "PASS");

  handoff.deliverable.attachments[0].run_id = handoff.run_id;
  const falsifiedOrigin = await validateObject(handoff);
  assert.ok(falsifiedOrigin.diagnostics.some((item) => item.code === "UX_VISUAL_ATTACHMENT_MISSING"));
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

test("DEV inicial parte da fila real e correção permanece em desenvolvimento", async () => {
  const initial = await fixture("valid-dev.json");
  assert.equal((await validateObject(initial)).status, "PASS");

  const correction = structuredClone(initial);
  correction.iteration_kind = "return";
  correction.state = { from: "in_development", to: "in_development" };
  assert.equal((await validateObject(correction)).status, "PASS");

  const stale = structuredClone(initial);
  stale.state.from = "in_development";
  const result = await validateObject(stale);
  assert.ok(result.diagnostics.some((item) => item.code === "ROLE_SOURCE_STATE_INVALID"));
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
  handoff.blocker = { reason: "Decisão humana pendente.", requires_human: true, kind: "business_rule", decision_options: ["A", "B"], material_impact: "Altera o comportamento financeiro.", evidence_checked: ["card"] };
  delete handoff.deliverable;
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "BLOCKED_TRANSITION_FORBIDDEN"));
});

test("papel bloqueado ainda precisa partir do estado correto", async () => {
  const handoff = await fixture("valid-po.json");
  handoff.status = "blocked";
  handoff.state = { from: "ux_ui", to: "ux_ui" };
  handoff.blocker = { reason: "Decisão humana pendente.", requires_human: true, kind: "business_rule", decision_options: ["A", "B"], material_impact: "Altera o comportamento financeiro.", evidence_checked: ["card"] };
  delete handoff.deliverable;
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "ROLE_SOURCE_STATE_INVALID"));
});

test("PO não pode transformar detalhe implementável em bloqueio humano sem prova material", async () => {
  const handoff = await fixture("valid-po.json");
  handoff.status = "blocked";
  handoff.state.to = "refinement";
  handoff.blocker = { reason: "Definir status inicial.", requires_human: true, kind: "business_rule", scope: "card" };
  delete handoff.deliverable;
  const result = await validateObject(handoff);
  assert.equal(result.status, "FAIL");
  assert.ok(result.diagnostics.some((item) => item.code === "ROLE_HANDOFF_SCHEMA_INVALID"));
});

test("PO pode bloquear decisão de negócio material depois de investigar alternativas", async () => {
  const handoff = await fixture("valid-po.json");
  handoff.status = "blocked";
  handoff.state.to = "refinement";
  handoff.blocker = {
    reason: "Regra financeira não definida.", requires_human: true, kind: "business_rule", scope: "card",
    decision_options: ["Reconhecer por competência", "Reconhecer por caixa"],
    material_impact: "A escolha altera saldos e período contábil exibido.",
    evidence_checked: ["Descrição do card", "Regra financeira existente"]
  };
  delete handoff.deliverable;
  const result = await validateObject(handoff);
  assert.equal(result.status, "PASS");
});

test("handoff rejeita chave com aparência de segredo", async () => {
  const handoff = await fixture("valid-po.json");
  handoff.password = "não-exibir";
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "HANDOFF_SENSITIVE_KEY"));
});

test("bloqueio humano exige categoria grande ou gate canônico", async () => {
  const handoff = await fixture("valid-dev.json");
  handoff.status = "blocked";
  handoff.state.to = "in_development";
  handoff.blocker = { reason: "Um teste local falhou.", requires_human: true, kind: "technical", return_to: "pipeline-dev" };
  delete handoff.deliverable;
  const result = await validateObject(handoff);
  assert.equal(result.status, "FAIL");
  assert.ok(result.diagnostics.some((item) => item.code === "ROLE_HANDOFF_SCHEMA_INVALID"));
  assert.equal(result.recovery.disposition, "auto-repair");
  assert.equal(result.recovery.requires_human, false);
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

test("handoff aceita lançamento explícito pelo Codex CLI", async () => {
  const handoff = await fixture("valid-po.json");
  handoff.execution.observation.configuration_source = "explicit-codex-exec";
  handoff.execution.observation.evidence_ref = "agent:codex-thread:01a07e2e-8af0-70f3-b763-3588c5f9df86";
  const result = await validateObject(handoff);
  assert.equal(result.status, "PASS", JSON.stringify(result.diagnostics));
});

test("handoff rejeita fallback mesmo quando produz saída", async () => {
  const handoff = await fixture("valid-dev.json");
  handoff.execution.observation.fallback_used = true;
  handoff.execution.observation.fallback_reason = "Modelo solicitado indisponível.";
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "EXECUTION_FALLBACK_FORBIDDEN"));
});

test("handoff rejeita placeholder como evidência do agente", async () => {
  const handoff = await fixture("valid-ux.json");
  handoff.execution.observation.evidence_ref = "agent:placeholder-agent-id";
  const result = await validateObject(handoff);
  assert.ok(result.diagnostics.some((item) => item.code === "EXECUTION_EVIDENCE_PLACEHOLDER"));
});

test("handoff precisa pertencer ao card, RUN_ID e papel esperados pelo plano", async () => {
  const handoff = await fixture("valid-dev.json");
  const result = await validateObject(handoff, {
    expectedCardRef: "card-real-do-tracker",
    expectedRunId: "RUN-20260828-OUTRO001",
    expectedRole: "pipeline-qa"
  });
  assert.ok(result.diagnostics.some((item) => item.code === "HANDOFF_CARD_REF_MISMATCH"));
  assert.ok(result.diagnostics.some((item) => item.code === "HANDOFF_RUN_ID_MISMATCH"));
  assert.ok(result.diagnostics.some((item) => item.code === "HANDOFF_ROLE_MISMATCH"));
});
