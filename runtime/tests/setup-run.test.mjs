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
  return {
    board_ref: adapter.tracker.board_ref,
    open_lists: order.map((state, index) => ({ ref: adapter.tracker.states[state], position: index + 1 })),
    cards,
    integration: {
      comments: {
        read: "verified",
        write: "verified",
        read_provider: adapter.tracker.comments.read_provider,
        write_provider: adapter.tracker.comments.write_provider,
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
    assert.equal(result.selected.continuation_policy.mode, "until-human-gate-or-blocker");
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
    assert.equal(result.deferred[0].key, "FX-001");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("planner preserva lote coeso definido pelo PO", async () => {
  const { root, adapter, adapterPath } = await createConsumerProject();
  try {
    adapter.batching = { mode: "cohesive-delivery", max_cards: 6 };
    await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
    const group = { id: "fx-101-102", cards: ["FX-101", "FX-102"], branch: "codex/fx-101-102", defined_by: "pipeline-po" };
    const snapshotPath = await writeSnapshot(root, trackerSnapshot(adapter, [
      { ref: "c1", key: "FX-101", title: "Parte um", list_ref: adapter.tracker.states.ready_for_development, position: 1, delivery_group: group },
      { ref: "c2", key: "FX-102", title: "Parte dois", list_ref: adapter.tracker.states.ready_for_development, position: 2, delivery_group: group }
    ]));
    const result = planRun({ projectRoot: root, adapterPath, trackerSnapshotPath: snapshotPath, schemaPath: SCHEMA_PATH, mode: "shadow", now: new Date("2026-08-29T00:00:00Z"), uuid: "11111111-2222-3333-4444-555555555555" });
    assert.equal(result.status, "READY");
    assert.equal(result.batch_policy, "cohesive-delivery-v0.1");
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

test("planner bloqueia retomada sem cápsula", async () => {
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
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "RESUME_CAPSULE_MISSING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
          loop_counts: { dev_qa: 3 }
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

test("modo live bloqueia avisos que seriam tolerados em shadow", async () => {
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
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "DOCTOR_WARNINGS_BLOCK_LIVE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
