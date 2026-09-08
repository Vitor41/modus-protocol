import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import YAML from "yaml";

import { runDoctor } from "../src/doctor.mjs";
import { planRun } from "../src/run-planner.mjs";
import { createSetupProposal } from "../src/setup.mjs";

const REPOSITORY_DIR = resolve(import.meta.dirname, "..", "..");
const FIXTURE_PATH = join(REPOSITORY_DIR, "tests", "fixtures", "adapters", "valid-minimal.json");
const SCHEMA_PATH = join(REPOSITORY_DIR, "schema", "project-adapter.schema.json");

async function createConsumerProject() {
  const root = await mkdtemp(join(tmpdir(), "pipeline-run-"));
  await mkdir(join(root, ".pipeline"), { recursive: true });
  await mkdir(join(root, "docs", "context"), { recursive: true });
  await writeFile(
    join(root, "AGENTS.md"),
    "Ao receber `Processe a fila do Trello.`, use exclusivamente $pipeline-run.\n",
    "utf8"
  );
  await writeFile(join(root, "docs", "context", "index.md"), "# Contexto\n", "utf8");
  const adapter = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const adapterPath = join(root, ".pipeline", "project.adapter.yaml");
  await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
  return { root, adapter, adapterPath };
}

function trackerSnapshot(adapter, cards, extra = {}) {
  const order = [
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
  const actionableRefs = new Set(order.slice(1, 7).map((state) => adapter.tracker.states[state]));
  const observedAt = "2026-08-28T12:00:00Z";
  const observedCards = cards.map((card) => actionableRefs.has(card.list_ref)
    ? { ...card, signals: { ...card.signals, observed_list_ref: card.list_ref, observed_at: observedAt, comment_content_reconciled: true } }
    : card);
  return {
    board_ref: adapter.tracker.board_ref,
    open_lists: order.map((state, index) => ({ ref: adapter.tracker.states[state], position: index + 1 })),
    cards: observedCards,
    integration: {
      comments: {
        read: "verified",
        write: "verified",
        read_provider: adapter.tracker.comments.read_provider,
        write_provider: adapter.tracker.comments.write_provider,
        observation: {
          scope: "all-actionable-cards",
          observed_at: observedAt,
          card_refs: observedCards.filter((card) => actionableRefs.has(card.list_ref)).map((card) => card.ref),
          content_read_card_refs: observedCards.filter((card) => actionableRefs.has(card.list_ref)).map((card) => card.ref)
        },
        evidence_ref: "trello-comment-test-fixture",
        verified_at: "2026-08-28T12:00:00Z"
      }
    },
    ...extra
  };
}

async function writeSnapshot(root, snapshot) {
  const path = join(root, "tracker-snapshot.json");
  await writeFile(path, JSON.stringify(snapshot), "utf8");
  return path;
}

test("setup inventaria um projeto Node sem escrever nele", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-setup-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node --test" }, dependencies: { react: "1.0.0" } }),
      "utf8"
    );
    await writeFile(join(root, "README.md"), "# Projeto\n", "utf8");
    const before = await readdir(root);
    const result = createSetupProposal({ projectRoot: root, projectName: "Projeto Exemplo" });
    const after = await readdir(root);

    assert.deepEqual(after.sort(), before.sort());
    assert.equal(result.guarantees.project_files_written, false);
    assert.deepEqual(result.adapter_candidate.stack.languages, ["JavaScript/TypeScript"]);
    assert.deepEqual(result.adapter_candidate.stack.frameworks, ["React"]);
    assert.deepEqual(result.adapter_candidate.commands.test_full.argv, ["npm", "run", "test"]);
    assert.ok(result.decisions.some((item) => item.code === "TRACKER_MAPPING_REQUIRED"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adapter candidato do setup permanece estruturalmente válido", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-setup-schema-"));
  try {
    await writeFile(join(root, "AGENTS.md"), "# Agentes\n", "utf8");
    await writeFile(join(root, "README.md"), "# Contexto\n", "utf8");
    const proposal = createSetupProposal({ projectRoot: root });
    const adapterPath = join(root, "proposal.yaml");
    await writeFile(adapterPath, YAML.stringify(proposal.adapter_candidate), "utf8");
    const result = runDoctor({ projectRoot: root, adapterPath, schemaPath: SCHEMA_PATH, mode: "structural" });
    assert.equal(result.status, "PASS");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planner prioriza QA de trabalho em andamento sobre novo refinamento", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(
      root,
      trackerSnapshot(adapter, [
        { ref: "card-refinement", key: "FX-001", title: "Nova demanda", list_ref: adapter.tracker.states.refinement, position: 1 },
        { ref: "card-qa", key: "FX-002", title: "Validar entrega", list_ref: adapter.tracker.states.ready_for_validation, position: 2 }
      ])
    );
    const result = planRun({
      projectRoot: root,
      adapterPath,
      trackerSnapshotPath: snapshotPath,
      schemaPath: SCHEMA_PATH,
      mode: "shadow",
      now: new Date("2026-08-28T12:00:00Z"),
      uuid: "12345678-1234-1234-1234-123456789abc"
    });
    assert.equal(result.status, "READY");
    assert.equal(result.selected.key, "FX-002");
    assert.equal(result.selected.skill, "pipeline-qa");
    assert.equal(result.selected.continuation_policy.mode, "drain-independent-work-v0.2");
    assert.equal(result.selected.continuation_policy.continue_after_role_handoff, true);
    assert.equal(result.selected.continuation_policy.preserve_run_id, true);
    assert.equal(result.selected.profile, "EQUILIBRADO");
    assert.deepEqual(result.selected.execution_request, {
      mapping_version: "gpt-5.6-2026-08-28",
      profile: "EQUILIBRADO",
      model: "gpt-5.6-terra",
      reasoning_effort: "medium",
      agent_mode: "independent",
      configuration_source: "kernel-profile-map",
      fallback_policy: "block"
    });
    assert.equal(result.run_id, "RUN-20260828-12345678");
    assert.deepEqual(result.work_slots.map((slot) => slot.lane), ["technical", "po"]);
    assert.equal(result.work_slots[1].key, "FX-001");
    assert.equal(result.deferred.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planner preserva lote coeso definido pelo PO", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    adapter.batching = { mode: "cohesive-delivery", max_cards: 6 };
    await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
    const group = { id: "fx-101-102", cards: ["FX-101", "FX-102"], branch: "codex/fx-101-102", mode: "optimization", defined_by: "pipeline-po" };
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "c1", key: "FX-101", title: "Parte um", list_ref: adapter.tracker.states.ready_for_development, position: 1, delivery_group: group },
      { ref: "c2", key: "FX-102", title: "Parte dois", list_ref: adapter.tracker.states.ready_for_development, position: 2, delivery_group: group }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, schemaPath: SCHEMA_PATH, mode: "shadow", now: new Date("2026-08-29T00:00:00Z"), uuid: "11111111-2222-3333-4444-555555555555" });
    assert.equal(result.status, "READY");
    assert.equal(result.batch_policy, "upstream-concurrency-technical-wip1-v0.2");
    assert.equal(result.selected.unit_policy, "cohesive-delivery-v0.2");
    assert.deepEqual(result.selected.capsule_seed.cards, ["FX-101", "FX-102"]);
    assert.equal(result.selected.lock_proposals.length, 2);
    assert.equal(result.deferred.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("planner aceita card bruto sem chave em REFINAMENTO e o encaminha ao PO", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(
      root,
      trackerSnapshot(adapter, [
        {
          ref: "card-raw-refinement",
          title: "Alguns PDFs de extrato têm senha",
          list_ref: adapter.tracker.states.refinement,
          position: 1
        }
      ])
    );
    const result = planRun({
      projectRoot: root,
      adapterPath,
      trackerSnapshotPath: snapshotPath,
      schemaPath: SCHEMA_PATH,
      mode: "live",
      now: new Date("2026-08-28T12:00:00Z"),
      uuid: "87654321-1234-1234-1234-123456789abc"
    });
    assert.equal(result.status, "READY", JSON.stringify(result.doctor.diagnostics));
    assert.equal(result.selected.card_ref, "card-raw-refinement");
    assert.equal(result.selected.key, undefined);
    assert.equal(result.selected.skill, "pipeline-po");
    assert.deepEqual(result.selected.capsule_seed.cards, ["card-raw-refinement"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PO recebe toda a fila elegível de refinamento na mesma execução", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "r1", title: "Demanda um", list_ref: adapter.tracker.states.refinement, position: 1 },
      { ref: "r2", title: "Demanda dois", list_ref: adapter.tracker.states.refinement, position: 2 },
      { ref: "r3", title: "Demanda três", list_ref: adapter.tracker.states.refinement, position: 3 }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "live" });
    assert.equal(result.status, "READY");
    assert.equal(result.batch_policy, "upstream-concurrency-technical-wip1-v0.2");
    assert.equal(result.selected.unit_policy, "refinement-queue-v0.2");
    assert.equal(result.selected.refinement_queue.scope, "all-eligible-refinement-cards");
    assert.deepEqual(result.selected.refinement_queue.cards.map((card) => card.card_ref), ["r1", "r2", "r3"]);
    assert.deepEqual(result.selected.continuation_policy.defer_on.slice(0, 3), ["human_decision", "screen_approval", "production_approval"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("bloqueio individual não paralisa card independente do grupo de otimização", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    adapter.batching = { mode: "cohesive-delivery", max_cards: 6 };
    await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
    const group = { id: "fx-201-202", cards: ["FX-201", "FX-202"], mode: "optimization", defined_by: "pipeline-po" };
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "c1", key: "FX-201", title: "Bloqueado", list_ref: adapter.tracker.states.ready_for_development, position: 1, delivery_group: group, signals: { awaiting_human: true, human_gate_kind: "structural_scope" } },
      { ref: "c2", key: "FX-202", title: "Independente", list_ref: adapter.tracker.states.ready_for_development, position: 2, delivery_group: group }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "shadow" });
    assert.equal(result.status, "READY");
    assert.equal(result.selected.key, "FX-202");
    assert.ok(result.blocked.some((item) => item.key === "FX-201" && item.reason === "HUMAN_GATE_STRUCTURAL_SCOPE" && item.block_scope === "card"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("sinal requires_human sem categoria canônica não bloqueia especialista", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "technical-noise", key: "FX-209", title: "Recuperar falha local", list_ref: adapter.tracker.states.in_development, position: 1, signals: { awaiting_human: true } }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "live" });
    assert.equal(result.status, "READY");
    assert.equal(result.selected.skill, "pipeline-dev");
    assert.equal(result.selected.action, "implement-or-correct");
    assert.equal(result.blocked.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("aprovação visual atual torna card de UX elegível mesmo com sinal antigo de espera", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "card-ux-approved", key: "FX-211", title: "Tela aprovada", list_ref: adapter.tracker.states.ux_ui, position: 1, signals: { awaiting_human: true, screen_approval_valid: true } }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "live" });
    assert.equal(result.status, "READY");
    assert.equal(result.selected.key, "FX-211");
    assert.equal(result.selected.skill, "pipeline-ux-ui");
    assert.equal(result.selected.action, "handoff-approved-design");
    assert.equal(result.guarantees.all_actionable_cards_refreshed, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("planner avança desenvolvimento, bloqueia somente UX pendente e mantém PO elegível", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const cards = [
      { ref: "card-dev", key: "FX-216", title: "Desenvolver", list_ref: adapter.tracker.states.ready_for_development, position: 1, signals: { awaiting_human: false } },
      { ref: "card-ux", key: "FX-217", title: "Aguardar tela", list_ref: adapter.tracker.states.ux_ui, position: 2, signals: { awaiting_human: true, screen_evidence_present: true, screen_approval_required: true, screen_approval_valid: false } },
      { ref: "card-po", key: "FX-218", title: "Refinar", list_ref: adapter.tracker.states.refinement, position: 3, signals: { awaiting_human: false } }
    ];
    const firstPath = await writeSnapshot(root, trackerSnapshot(adapter, cards));
    const first = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: firstPath, mode: "live", continueRunId: "RUN-20260908-ABCDEF12" });
    assert.equal(first.status, "READY");
    assert.equal(first.selected.key, "FX-216");
    assert.equal(first.selected.skill, "pipeline-dev");
    assert.ok(first.blocked.some((item) => item.key === "FX-217" && item.reason === "SCREEN_APPROVAL_REQUIRED"));
    assert.deepEqual(first.work_slots.map((slot) => slot.lane), ["technical", "po"]);
    assert.equal(first.work_slots[1].key, "FX-218");
    assert.equal(first.deferred.length, 0);

    const secondSnapshot = trackerSnapshot(adapter, cards.filter((card) => card.ref !== "card-dev"));
    const secondPath = await writeSnapshot(root, secondSnapshot);
    const second = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: secondPath, mode: "live", continueRunId: first.run_id });
    assert.equal(second.status, "READY");
    assert.equal(second.selected.key, "FX-218");
    assert.equal(second.selected.skill, "pipeline-po");
    assert.equal(second.run_id, first.run_id);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("planner agenda PO, UX e uma única faixa técnica na mesma execução", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "review", key: "FX-221", title: "Revisar", list_ref: adapter.tracker.states.in_development, position: 1, signals: { implementation_complete: true } },
      { ref: "next-dev", key: "FX-222", title: "Próxima implementação", list_ref: adapter.tracker.states.ready_for_development, position: 2 },
      { ref: "ux", key: "FX-223", title: "Desenhar", list_ref: adapter.tracker.states.ux_ui, position: 3 },
      { ref: "po-one", title: "Refinar um", list_ref: adapter.tracker.states.refinement, position: 4 },
      { ref: "po-two", title: "Refinar dois", list_ref: adapter.tracker.states.refinement, position: 5 }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "live" });
    assert.equal(result.status, "READY");
    assert.deepEqual(result.work_slots.map((slot) => slot.lane), ["technical", "ux_ui", "po"]);
    assert.equal(result.work_slots[0].skill, "pipeline-code-review");
    assert.equal(result.work_slots[1].skill, "pipeline-ux-ui");
    assert.deepEqual(result.work_slots[2].refinement_queue.cards.map((card) => card.card_ref), ["po-one", "po-two"]);
    assert.ok(result.deferred.some((item) => item.key === "FX-222" && item.reason === "TECHNICAL_WIP_LIMIT"));
    assert.deepEqual(result.schedule.capacities, { po: 1, ux_ui: 1, technical: 1 });
    assert.equal(result.recovery_policy.mode, "specialist-autonomy-v0.2");
    assert.equal(result.recovery_policy.technical_failures_require_human, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("review devolvido vai ao DEV enquanto handoff pendente é reconciliado sem repetir PO", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "dev-return", key: "FX-228", title: "Corrigir review", list_ref: adapter.tracker.states.in_development, position: 1, signals: { implementation_complete: false, review_approved: false, review_evidence_ref: "review-return" } },
      { ref: "po-transition", key: "FX-229", title: "Mover para UX", list_ref: adapter.tracker.states.refinement, position: 2, signals: { pending_transition: true, pending_transition_from: "refinement", pending_transition_to: "ux_ui", pending_transition_role: "pipeline-po", pending_transition_run_id: "RUN-20260908-ABCDEF12", pending_transition_evidence_ref: "po-handoff" } }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "live" });
    assert.equal(result.status, "READY");
    assert.deepEqual(result.work_slots.map((slot) => slot.lane), ["technical", "po"]);
    assert.equal(result.work_slots[0].skill, "pipeline-dev");
    assert.equal(result.work_slots[0].action, "implement-or-correct");
    assert.equal(result.work_slots[1].skill, "pipeline-run");
    assert.equal(result.work_slots[1].execution_kind, "operational");
    assert.equal(result.work_slots[1].action, "reconcile-transition");
    assert.equal(result.work_slots[1].transition_run_id, "RUN-20260908-ABCDEF12");
    assert.equal(result.work_slots[1].execution_request, undefined);
    assert.equal(result.work_slots[1].capsule_action, "reuse-existing-evidence");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("gate humano na faixa técnica preserva WIP um sem paralisar PO e UX", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "release", key: "FX-224", title: "Aguardar produção", list_ref: adapter.tracker.states.ready_for_release, position: 1, signals: { awaiting_human: true, human_gate_kind: "production_approval", production_approval_valid: false } },
      { ref: "next-dev", key: "FX-225", title: "Não abrir segunda branch", list_ref: adapter.tracker.states.ready_for_development, position: 2 },
      { ref: "ux", key: "FX-226", title: "Desenhar", list_ref: adapter.tracker.states.ux_ui, position: 3 },
      { ref: "po", title: "Refinar", list_ref: adapter.tracker.states.refinement, position: 4 }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "live" });
    assert.equal(result.status, "READY");
    assert.deepEqual(result.work_slots.map((slot) => slot.lane), ["ux_ui", "po"]);
    assert.ok(result.blocked.some((item) => item.key === "FX-224" && item.reason === "HUMAN_GATE_PRODUCTION_APPROVAL"));
    assert.ok(result.deferred.some((item) => item.key === "FX-225" && item.reason === "TECHNICAL_WIP_LIMIT"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("card técnico inválido ainda ocupa WIP e impede uma segunda branch", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "qa-without-key", title: "Estado técnico inconsistente", list_ref: adapter.tracker.states.ready_for_validation, position: 1 },
      { ref: "next-dev", key: "FX-227", title: "Não abrir", list_ref: adapter.tracker.states.ready_for_development, position: 2 }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "live" });
    assert.equal(result.status, "EMPTY");
    assert.ok(result.blocked.some((item) => item.card_ref === "qa-without-key" && item.reason === "CARD_KEY_MISSING"));
    assert.ok(result.deferred.some((item) => item.key === "FX-227" && item.reason === "TECHNICAL_WIP_LIMIT"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("live bloqueia snapshot que não comprova releitura de todos os cards acionáveis", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshot = trackerSnapshot(adapter, [
      { ref: "card-one", key: "FX-212", title: "Um", list_ref: adapter.tracker.states.refinement, position: 1 },
      { ref: "card-two", key: "FX-213", title: "Dois", list_ref: adapter.tracker.states.ux_ui, position: 2 }
    ]);
    snapshot.integration.comments.observation.card_refs = ["card-one"];
    const snapshotPath = await writeSnapshot(root, snapshot);
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "live" });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "TRACKER_SNAPSHOT_COVERAGE_INCOMPLETE");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("bloqueio em grupo de dependência impede todos os membros", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    adapter.batching = { mode: "cohesive-delivery", max_cards: 6 };
    await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
    const group = { id: "fx-301-302", cards: ["FX-301", "FX-302"], mode: "dependency", defined_by: "pipeline-po" };
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "c1", key: "FX-301", title: "Premissa bloqueada", list_ref: adapter.tracker.states.ready_for_development, position: 1, delivery_group: group, signals: { awaiting_human: true, human_gate_kind: "business_rule" } },
      { ref: "c2", key: "FX-302", title: "Depende da premissa", list_ref: adapter.tracker.states.ready_for_development, position: 2, delivery_group: group }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "shadow" });
    assert.equal(result.status, "EMPTY");
    assert.ok(result.blocked.some((item) => item.key === "FX-301" && item.reason === "DELIVERY_GROUP_MEMBER_BLOCKED" && item.block_scope === "delivery_group"));
    assert.ok(result.blocked.some((item) => item.key === "FX-302" && item.reason === "DELIVERY_GROUP_MEMBER_BLOCKED" && item.block_scope === "delivery_group"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("dependência entre grupos mantém somente o grupo dependente aguardando", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    adapter.batching = { mode: "cohesive-delivery", max_cards: 6 };
    await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
    const upstream = { id: "fx-401-402", cards: ["FX-401", "FX-402"], mode: "optimization", defined_by: "pipeline-po" };
    const downstream = { id: "fx-403-404", cards: ["FX-403", "FX-404"], mode: "optimization", depends_on: ["fx-401-402"], defined_by: "pipeline-po" };
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "c1", key: "FX-401", title: "Origem um", list_ref: adapter.tracker.states.ready_for_development, position: 1, delivery_group: upstream },
      { ref: "c2", key: "FX-402", title: "Origem dois", list_ref: adapter.tracker.states.ready_for_development, position: 2, delivery_group: upstream },
      { ref: "c3", key: "FX-403", title: "Dependente um", list_ref: adapter.tracker.states.ready_for_development, position: 3, delivery_group: downstream },
      { ref: "c4", key: "FX-404", title: "Dependente dois", list_ref: adapter.tracker.states.ready_for_development, position: 4, delivery_group: downstream }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "shadow" });
    assert.equal(result.status, "READY");
    assert.equal(result.selected.delivery_group.id, "fx-401-402");
    assert.ok(result.blocked.some((item) => item.key === "FX-403" && item.reason === "DELIVERY_GROUP_DEPENDENCY_PENDING" && item.dependency_group_id === "fx-401-402"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("replanejamento técnico preserva RUN_ID explicitamente informado", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "card-ux", key: "FX-012", title: "Desenhar fluxo", list_ref: adapter.tracker.states.ux_ui, position: 1 }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "live", continueRunId: "RUN-20260831-ABCDEF12" });
    assert.equal(result.status, "READY");
    assert.equal(result.run_id, "RUN-20260831-ABCDEF12");
    assert.equal(result.continuing, true);
    assert.equal(result.selected.lock_proposal.run_id, "RUN-20260831-ABCDEF12");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("replanejamento recusa RUN_ID de continuação inválido", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, []));
    assert.throws(() => planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, continueRunId: "RUN-placeholder" }), /formato inválido/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("planner continua exigindo chave válida depois de REFINAMENTO", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(
      root,
      trackerSnapshot(adapter, [
        { ref: "card-no-key", title: "Implementar", list_ref: adapter.tracker.states.ready_for_development, position: 1 }
      ])
    );
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, schemaPath: SCHEMA_PATH });
    assert.equal(result.status, "EMPTY");
    assert.equal(result.blocked[0].reason, "CARD_KEY_MISSING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planner encaminha implementação concluída para code review sem mover coluna", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(
      root,
      trackerSnapshot(adapter, [
        {
          ref: "card-review",
          key: "FX-003",
          title: "Revisar",
          list_ref: adapter.tracker.states.in_development,
          position: 1,
          signals: { implementation_complete: true }
        }
      ])
    );
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, schemaPath: SCHEMA_PATH });
    assert.equal(result.selected.skill, "pipeline-code-review");
    assert.equal(result.selected.execution_request.model, "gpt-5.6-sol");
    assert.equal(result.selected.execution_request.reasoning_effort, "high");
    assert.equal(result.selected.execution_request.agent_mode, "independent");
    assert.equal(result.selected.state, "in_development");
    assert.equal(result.guarantees.tracker_writes_performed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planner bloqueia projeto com execução legada ativa", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(
      root,
      trackerSnapshot(
        adapter,
        [{ ref: "card", key: "FX-004", list_ref: adapter.tracker.states.refinement, position: 1 }],
        { active_execution: { architecture: "legacy", status: "active", run_id: "legacy-1" } }
      )
    );
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, schemaPath: SCHEMA_PATH });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "LEGACY_EXECUTION_ACTIVE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planner bloqueia snapshot sem contrato completo em vez de declarar fila vazia", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshot = trackerSnapshot(adapter, []);
    delete snapshot.cards;
    const snapshotPath = await writeSnapshot(root, snapshot);
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, schemaPath: SCHEMA_PATH });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "TRACKER_SNAPSHOT_SCHEMA_INVALID");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planner retoma execução unificada somente com lock e cápsula consistentes", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(
      root,
      trackerSnapshot(
        adapter,
        [
          {
            ref: "card-resume",
            key: "FX-008",
            title: "Retomar implementação",
            list_ref: adapter.tracker.states.in_development,
            position: 1,
            lock: { run_id: "RUN-EXISTING", status: "active", role: "pipeline-dev", state: "in_development" }
          }
        ],
        {
          active_execution: {
            architecture: "unified",
            status: "active",
            run_id: "RUN-EXISTING",
            card_ref: "card-resume",
            role: "pipeline-dev",
            state: "in_development",
            capsule_present: true
          }
        }
      )
    );
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, schemaPath: SCHEMA_PATH });
    assert.equal(result.status, "READY");
    assert.equal(result.resuming, true);
    assert.equal(result.run_id, "RUN-EXISTING");
    assert.equal(result.selected.capsule_action, "resume-existing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planner reconcilia retomada sem cápsula a partir do tracker fresco", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(
      root,
      trackerSnapshot(
        adapter,
        [
          {
            ref: "card-resume",
            key: "FX-009",
            list_ref: adapter.tracker.states.in_development,
            position: 1,
            lock: { run_id: "RUN-EXISTING", status: "active" }
          }
        ],
        {
          active_execution: {
            architecture: "unified",
            status: "active",
            run_id: "RUN-EXISTING",
            card_ref: "card-resume",
            role: "pipeline-dev",
            state: "in_development",
            capsule_present: false
          }
        }
      )
    );
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, schemaPath: SCHEMA_PATH });
    assert.equal(result.status, "READY");
    assert.equal(result.run_id, "RUN-EXISTING");
    assert.equal(result.continuing, true);
    assert.equal(result.guarantees.stale_execution_reconciled, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planner supera execução UX antiga após transição e preserva RUN_ID no DEV", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [{
      ref: "card-transitioned",
      key: "FX-219",
      title: "Desenvolver após UX",
      list_ref: adapter.tracker.states.ready_for_development,
      position: 1,
      lock: { run_id: "RUN-20260908-ABCDEF19", status: "active", role: "pipeline-ux-ui", state: "ux_ui" }
    }], { active_execution: {
      architecture: "unified", status: "active", run_id: "RUN-20260908-ABCDEF19", card_ref: "card-transitioned",
      role: "pipeline-ux-ui", state: "ux_ui", capsule_present: true
    }}));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "live" });
    assert.equal(result.status, "READY");
    assert.equal(result.selected.skill, "pipeline-dev");
    assert.equal(result.run_id, "RUN-20260908-ABCDEF19");
    assert.equal(result.guarantees.stale_execution_reconciled, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("execução UX ativa não atravessa evidência visual sem nova aprovação", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [{
      ref: "card-ux-wait",
      key: "FX-220",
      title: "Aguardar nova tela",
      list_ref: adapter.tracker.states.ux_ui,
      position: 1,
      signals: { awaiting_human: true, screen_evidence_present: true, screen_approval_required: true, screen_approval_valid: false },
      lock: { run_id: "RUN-20260908-ABCDEF20", status: "active", role: "pipeline-ux-ui", state: "ux_ui" }
    }], { active_execution: {
      architecture: "unified", status: "active", run_id: "RUN-20260908-ABCDEF20", card_ref: "card-ux-wait",
      role: "pipeline-ux-ui", state: "ux_ui", capsule_present: true
    }}));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, mode: "live" });
    assert.equal(result.status, "EMPTY");
    assert.ok(result.blocked.some((item) => item.key === "FX-220" && item.reason === "SCREEN_APPROVAL_REQUIRED"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("planner não cria quarto ciclo automático", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(
      root,
      trackerSnapshot(adapter, [
        {
          ref: "card-loop",
          key: "FX-005",
          list_ref: adapter.tracker.states.in_development,
          position: 1,
          loop_counts: { dev_qa: 3 },
          loop_state: "in_development"
        }
      ])
    );
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, schemaPath: SCHEMA_PATH });
    assert.equal(result.status, "EMPTY");
    assert.equal(result.blocked[0].reason, "LOOP_LIMIT_REACHED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planner bloqueia card com lock ativo sem expirá-lo", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(
      root,
      trackerSnapshot(adapter, [
        {
          ref: "card-lock",
          key: "FX-006",
          list_ref: adapter.tracker.states.ready_for_development,
          position: 1,
          lock: { run_id: "RUN-OLD", status: "active" }
        }
      ])
    );
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, schemaPath: SCHEMA_PATH });
    assert.equal(result.status, "EMPTY");
    assert.equal(result.blocked[0].reason, "ACTIVE_LOCK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("modo live exige doctor de cutover e apenas propõe aplicação", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(
      root,
      trackerSnapshot(adapter, [
        { ref: "card-live", key: "FX-007", title: "Implementar", list_ref: adapter.tracker.states.ready_for_development, position: 1 }
      ])
    );
    const result = planRun({
      projectRoot: root,
      adapterPath,
      trackerSnapshotPath: snapshotPath,
      schemaPath: SCHEMA_PATH,
      mode: "live"
    });
    assert.equal(result.status, "READY");
    assert.equal(result.doctor.mode, "cutover");
    assert.equal(result.apply_required, true);
    assert.equal(result.selected.comment_gate.transition_requires_verified_comment, true);
    assert.equal(result.selected.comment_gate.capability_evidence_ref, "trello-comment-test-fixture");
    assert.equal(result.guarantees.tracker_writes_performed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("modo live bloqueia quando comentários não possuem escrita e releitura verificadas", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    const snapshotPath = await writeSnapshot(
      root,
      trackerSnapshot(
        adapter,
        [
          {
            ref: "card-live-comment",
            key: "FX-011",
            list_ref: adapter.tracker.states.ready_for_development,
            position: 1
          }
        ],
        {
          integration: {
            comments: {
              read: "verified",
              write: "unavailable",
              read_provider: adapter.tracker.comments.read_provider,
              write_provider: adapter.tracker.comments.write_provider
            }
          }
        }
      )
    );
    const result = planRun({
      projectRoot: root,
      adapterPath,
      trackerSnapshotPath: snapshotPath,
      schemaPath: SCHEMA_PATH,
      mode: "live"
    });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "DOCTOR_FAILED");
    assert.ok(
      result.doctor.diagnostics.some((item) => item.code === "TRACKER_COMMENT_CAPABILITY_UNVERIFIED")
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("modo live mantém avisos não estruturais sem bloquear especialistas", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    adapter.context.references.push({ path: "docs/context/optional.md", read_when: "Quando existir.", optional: true });
    await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
    const snapshotPath = await writeSnapshot(
      root,
      trackerSnapshot(adapter, [
        { ref: "card-live", key: "FX-010", list_ref: adapter.tracker.states.ready_for_development, position: 1 }
      ])
    );
    const result = planRun({
      projectRoot: root,
      adapterPath,
      trackerSnapshotPath: snapshotPath,
      schemaPath: SCHEMA_PATH,
      mode: "live"
    });
    assert.equal(result.status, "READY");
    assert.equal(result.doctor.status, "WARN");
    assert.ok(result.doctor.diagnostics.some((item) => item.code === "OPTIONAL_CONTEXT_MISSING"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
