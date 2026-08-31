import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateTransitionReceipt } from "../src/transition-gate.mjs";

const REPOSITORY_DIR = resolve(import.meta.dirname, "..", "..");
const ADAPTER_FIXTURE = join(REPOSITORY_DIR, "tests", "fixtures", "adapters", "valid-minimal.json");

function validReceipt(adapter) {
  return {
    contract_version: "0.1",
    run_id: "RUN-20260828-ABCDEF12",
    card_ref: "card-1",
    role: "pipeline-dev",
    handoff_ref: "handoff-pass-1",
    role_gate_status: "PASS",
    comment: {
      ref: "comment-1",
      run_id: "RUN-20260828-ABCDEF12",
      card_ref: "card-1",
      events: ["role_handoff", "transition"],
      read_provider: adapter.tracker.comments.read_provider,
      write_provider: adapter.tracker.comments.write_provider,
      written_at: "2026-08-28T12:00:00Z",
      read_at: "2026-08-28T12:00:05Z",
      readback_status: "confirmed",
      encoding: "utf-8",
      content_sha256: "a".repeat(64)
    },
    transition: { from: "in_development", to: "ready_for_validation" }
  };
}

async function validateObject(mutator = () => {}) {
  const root = await mkdtemp(join(tmpdir(), "transition-gate-"));
  const adapter = JSON.parse(await readFile(ADAPTER_FIXTURE, "utf8"));
  const receipt = validReceipt(adapter);
  mutator(receipt, adapter);
  const receiptPath = join(root, "receipt.json");
  const adapterPath = join(root, "adapter.json");
  await writeFile(receiptPath, JSON.stringify(receipt), "utf8");
  await writeFile(adapterPath, JSON.stringify(adapter), "utf8");
  try {
    return validateTransitionReceipt({
      receiptPath,
      adapterPath,
      now: new Date("2026-08-28T12:01:00Z")
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("comentário persistido e relido libera a transição sem escrever no tracker", async () => {
  const result = await validateObject();
  assert.equal(result.status, "PASS", JSON.stringify(result.diagnostics));
  assert.equal(result.authorization, "GRANTED");
  assert.equal(result.guarantees.tracker_writes_performed, false);
});

test("falha na releitura bloqueia a movimentação", async () => {
  const result = await validateObject((receipt) => {
    receipt.comment.readback_status = "failed";
  });
  assert.equal(result.authorization, "DENIED");
  assert.ok(result.diagnostics.some((item) => item.code === "TRANSITION_COMMENT_READBACK_UNCONFIRMED"));
});

test("provider diferente do adapter bloqueia a movimentação", async () => {
  const result = await validateObject((receipt) => {
    receipt.comment.write_provider = "environment";
  });
  assert.ok(result.diagnostics.some((item) => item.code === "TRANSITION_COMMENT_PROVIDER_MISMATCH"));
});

test("comentário de outro RUN_ID ou card bloqueia a movimentação", async () => {
  const result = await validateObject((receipt) => {
    receipt.comment.run_id = "RUN-20260828-FFFFFFFF";
    receipt.comment.card_ref = "card-2";
  });
  assert.ok(result.diagnostics.some((item) => item.code === "TRANSITION_COMMENT_LINK_MISMATCH"));
});

test("confirmação antiga demais bloqueia a movimentação", async () => {
  const result = await validateObject((receipt) => {
    receipt.comment.written_at = "2026-08-28T11:30:00Z";
    receipt.comment.read_at = "2026-08-28T11:30:05Z";
  });
  assert.ok(result.diagnostics.some((item) => item.code === "TRANSITION_COMMENT_RECEIPT_STALE"));
});

test("handoff sem aprovação do role gate bloqueia a movimentação", async () => {
  const result = await validateObject((receipt) => {
    receipt.role_gate_status = "FAIL";
  });
  assert.ok(result.diagnostics.some((item) => item.code === "TRANSITION_ROLE_GATE_NOT_PASS"));
});

test("timestamps inválidos ou fora de ordem bloqueiam a movimentação", async () => {
  const result = await validateObject((receipt) => {
    receipt.comment.written_at = "2026-08-28T12:00:10Z";
    receipt.comment.read_at = "2026-08-28T12:00:05Z";
  });
  assert.ok(result.diagnostics.some((item) => item.code === "TRANSITION_COMMENT_TIMESTAMPS_INVALID"));
});

test("release sem integração Git confirmada não pode ir para PRD", async () => {
  const result = await validateObject((receipt) => { receipt.transition = { from: "ready_for_release", to: "ready_for_production" }; });
  assert.equal(result.authorization, "DENIED");
  assert.ok(result.diagnostics.some((item) => item.code === "TRANSITION_RECEIPT_SCHEMA_INVALID"));
});

test("release com push, PR, checks, conflitos e merge confirmados pode ir para PRD", async () => {
  const result = await validateObject((receipt) => {
    receipt.transition = { from: "ready_for_release", to: "ready_for_production" };
    receipt.git_integration = { remote: "origin", base_branch: "main", head_branch: "feature/fx", pushed_commit: "a".repeat(40), pr_url: "https://github.com/example/repo/pull/1", checks_status: "passed", conflicts_status: "absent", merge_status: "merged", merged_commit: "b".repeat(40) };
  });
  assert.equal(result.authorization, "GRANTED", JSON.stringify(result.diagnostics));
});
