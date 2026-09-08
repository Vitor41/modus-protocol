import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateRunClose } from "../src/run-close-gate.mjs";

async function validate(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "run-close-gate-"));
  const receipt = {
    contract_version: "0.1",
    run_id: "RUN-20260908-ABCDEF12",
    jobs: [{ evidence_ref: "agent:review-1", role: "pipeline-code-review", status: "completed" }],
    last_job_event_at: "2026-09-08T14:00:00Z",
    final_snapshot_observed_at: "2026-09-08T14:00:01Z",
    final_plan: { status: "EMPTY", work_slots: [], guarantees: { all_actionable_cards_refreshed: true } },
    ...overrides
  };
  const path = join(root, "receipt.json");
  await writeFile(path, JSON.stringify(receipt), "utf8");
  try { return validateRunClose({ receiptPath: path }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("autoriza resposta final somente depois de jobs e fila drenados", async () => {
  const result = await validate();
  assert.equal(result.status, "PASS");
  assert.equal(result.authorization, "FINAL_RESPONSE_GRANTED");
});

test("agente de review em andamento obriga o orquestrador a esperar", async () => {
  const result = await validate({ jobs: [{ evidence_ref: "agent:review-1", role: "pipeline-code-review", status: "running" }] });
  assert.equal(result.status, "FAIL");
  assert.equal(result.authorization, "CONTINUE_RUN");
  assert.ok(result.actions.includes("wait-active-jobs"));
});

test("plano com QA elegível impede encerramento prematuro", async () => {
  const result = await validate({ final_plan: { status: "READY", work_slots: [{ role: "pipeline-qa" }], guarantees: { all_actionable_cards_refreshed: true } } });
  assert.equal(result.status, "FAIL");
  assert.ok(result.actions.includes("dispatch-and-continue"));
});

test("snapshot anterior ao resultado do agente exige nova leitura", async () => {
  const result = await validate({ final_snapshot_observed_at: "2026-09-08T13:59:59Z" });
  assert.equal(result.status, "FAIL");
  assert.ok(result.actions.includes("refresh-snapshot-and-replan"));
});
