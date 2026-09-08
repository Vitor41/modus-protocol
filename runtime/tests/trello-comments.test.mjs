import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import YAML from "yaml";

import { executeTrelloComment } from "../src/trello-comments.mjs";

async function projectFixture() {
  const root = await mkdtemp(join(tmpdir(), "trello-comments-"));
  await mkdir(join(root, ".pipeline"), { recursive: true });
  await mkdir(join(root, "trello_key"), { recursive: true });
  await mkdir(join(root, ".pipeline", "tmp"), { recursive: true });
  const adapter = {
    tracker: {
      provider: "trello",
      comments: { read_provider: "environment", write_provider: "environment" },
      environment: { credential_file: "trello_key/trello.env" },
      card_keys: [{ kind: "feature", pattern: "^FP-[0-9]{3}$" }],
      type_labels: { feature: "label-feature", bug: "label-bug" },
      domain_labels: { business: "label-business", technical: "label-technical" }
    }
  };
  await writeFile(join(root, ".pipeline", "project.adapter.yaml"), YAML.stringify(adapter), "utf8");
  await writeFile(join(root, "trello_key", "trello.env"), "TRELLO_API_KEY=secret-key\nTRELLO_TOKEN=secret-token\n", "utf8");
  return root;
}

test("lista comentários via environment sem expor credenciais", async () => {
  const root = await projectFixture();
  let requestedUrl;
  try {
    const result = await executeTrelloComment({
      action: "list",
      projectRoot: root,
      cardRef: "card-1",
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify([{ id: "comment-1", date: "2026-08-28T12:00:00Z", data: { card: { id: "card-1" }, text: "APROVADO PARA PRD" } }]), { status: 200 });
      }
    });
    assert.equal(result.status, "PASS");
    assert.equal(result.comments[0].text, "APROVADO PARA PRD");
    assert.equal(result.guarantees.secrets_exposed, false);
    assert.match(requestedUrl, /filter=commentCard/);
    assert.doesNotMatch(JSON.stringify(result), /secret-(key|token)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lista nomes de cards abertos e arquivados para numeração canônica", async () => {
  const root = await projectFixture();
  try {
    const result = await executeTrelloComment({ action: "list-card-names", projectRoot: root, fetchImpl: async (url) => {
      assert.match(String(url), /filter=all/u);
      return new Response(JSON.stringify([
        { id: "card-open", name: "FP-009 - Aberto", closed: false },
        { id: "card-closed", name: "FP-010 - Arquivado", closed: true }
      ]));
    }});
    assert.deepEqual(result.cards.map((card) => card.key), ["FP-009", "FP-010"]);
    assert.equal(result.guarantees.includes_closed_cards, true);
    assert.equal(result.guarantees.tracker_writes_performed, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("leituras idempotentes recuperam duas falhas transitórias sem trocar integração", async () => {
  const root = await projectFixture();
  let calls = 0;
  try {
    const result = await executeTrelloComment({ action: "list-card-names", projectRoot: root, fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("conexão reiniciada");
      if (calls === 2) return new Response("indisponível", { status: 503 });
      return new Response(JSON.stringify([{ id: "card-1", name: "FP-011 - Recuperado", closed: false }]));
    }});
    assert.equal(result.status, "PASS");
    assert.equal(result.cards[0].key, "FP-011");
    assert.equal(calls, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("escreve e relê exatamente o comentário UTF-8", async () => {
  const root = await projectFixture();
  const textPath = join(root, ".pipeline", "tmp", "comment.txt");
  const comment = "CODEX PO: informação, decisão e próxima ação.";
  await writeFile(textPath, comment, "utf8");
  let calls = 0;
  try {
    const result = await executeTrelloComment({
      action: "write-readback",
      projectRoot: root,
      cardRef: "card-1",
      textPath,
      now: "2026-08-28T12:00:05Z",
      fetchImpl: async (_url, options = {}) => {
        calls += 1;
        if (calls === 1) {
          assert.equal(options.method, "POST");
          assert.equal(options.body.get("text"), comment);
          return new Response(JSON.stringify({ id: "comment-1", date: "2026-08-28T12:00:00Z" }), { status: 200 });
        }
        return new Response(JSON.stringify({ id: "comment-1", date: "2026-08-28T12:00:00Z", data: { card: { id: "card-1" }, text: comment } }), { status: 200 });
      }
    });
    assert.equal(result.status, "PASS");
    assert.equal(result.readback_status, "confirmed");
    assert.equal(result.content_sha256.length, 64);
    assert.equal(calls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("releitura individual renova a evidência temporal sem nova escrita", async () => {
  const root = await projectFixture();
  try {
    const text = "RUN_ID: RUN-20260908-ABCDEF12\nEVENT: role_handoff, transition";
    const result = await executeTrelloComment({
      action: "read", projectRoot: root, cardRef: "card-1", commentRef: "comment-1", now: new Date("2026-09-08T12:00:05Z"),
      fetchImpl: async () => new Response(JSON.stringify({ id: "comment-1", date: "2026-09-08T11:00:00Z", data: { card: { id: "card-1" }, text } }), { status: 200 })
    });
    assert.equal(result.status, "PASS");
    assert.equal(result.written_at, "2026-09-08T11:00:00Z");
    assert.equal(result.read_at, "2026-09-08T12:00:05.000Z");
    assert.equal(result.readback_status, "confirmed");
    assert.equal(result.content_sha256, createHash("sha256").update(text, "utf8").digest("hex"));
    assert.equal(result.guarantees.tracker_writes_performed, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("nega releitura divergente depois da escrita", async () => {
  const root = await projectFixture();
  const textPath = join(root, ".pipeline", "tmp", "comment.txt");
  await writeFile(textPath, "Comentário esperado", "utf8");
  let calls = 0;
  try {
    const result = await executeTrelloComment({
      action: "write-readback",
      projectRoot: root,
      cardRef: "card-1",
      textPath,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify({ id: "comment-1", date: "2026-08-28T12:00:00Z" }), { status: 200 });
        return new Response(JSON.stringify({ id: "comment-1", data: { card: { id: "card-1" }, text: "Outro texto" } }), { status: 200 });
      }
    });
    assert.equal(result.status, "FAIL");
    assert.equal(result.diagnostic.code, "TRACKER_COMMENT_READBACK_FAILED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("não aceita credential_file fora do projeto", async () => {
  const root = await projectFixture();
  const adapterPath = join(root, ".pipeline", "project.adapter.yaml");
  await writeFile(adapterPath, YAML.stringify({ tracker: { provider: "trello", comments: { read_provider: "environment", write_provider: "environment" }, environment: { credential_file: "../trello.env" } } }), "utf8");
  try {
    await assert.rejects(
      executeTrelloComment({ action: "list", projectRoot: root, cardRef: "card-1", fetchImpl: async () => new Response("[]") }),
      /contido na raiz/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshot hidrata comentários apenas dos estados ativos", async () => {
  const root = await projectFixture();
  const adapterPath = join(root, ".pipeline", "project.adapter.yaml");
  const adapter = YAML.parse(await (await import("node:fs/promises")).readFile(adapterPath, "utf8"));
  adapter.tracker.board_ref = "board-1";
  adapter.tracker.states = { refinement: "list-active", ux_ui: "ux", ready_for_development: "dev-ready", in_development: "dev", ready_for_validation: "qa", ready_for_release: "release", ideas: "ideas", ready_for_production: "prd", done: "done" };
  adapter.tracker.card_keys = [{ kind: "feature", pattern: "^FP-[0-9]{3}$" }];
  adapter.tracker.human_gates = { production_approval: "APROVADO PARA PRD", screen_approval: "Tela aprovada", unblock_prefix: "BLOQUEIO RESOLVIDO:" };
  await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
  const urls = [];
  try {
    const result = await executeTrelloComment({ action: "snapshot", projectRoot: root, outputPath: ".pipeline/tmp/snapshot.json", fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes("/lists")) return new Response(JSON.stringify([{ id: "list-active", name: "REFINAMENTO", pos: 1 }, { id: "ideas", name: "IDEIAS", pos: 2 }]));
      if (String(url).includes("/cards?") || String(url).includes("/cards&")) return new Response(JSON.stringify([{ id: "active", name: "FP-109 Algo", idList: "list-active", pos: 1 }, { id: "ignored", name: "Ideia", idList: "ideas", pos: 2 }]));
      return new Response(JSON.stringify([{ id: "c1", date: "2026-08-28T12:00:00Z", data: { card: { id: "active" }, text: "Texto" } }]));
    }});
    assert.equal(result.counts.hydrated_cards, 1);
    assert.equal(urls.filter((url) => url.includes("/actions")).length, 1);
    assert.equal(urls.some((url) => url.includes("ignored/actions")), false);
    assert.equal(result.guarantees.full_board_comment_scan, false);
    assert.equal(result.guarantees.all_actionable_cards_refreshed, true);
    const snapshot = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, ".pipeline", "tmp", "snapshot.json"), "utf8"));
    assert.deepEqual(snapshot.cards.map((card) => card.ref), ["active"]);
    assert.deepEqual(snapshot.integration.comments.observation.card_refs, ["active"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("aprovação visual posterior resolve a espera humana no card de UX", async () => {
  const root = await projectFixture();
  const adapterPath = join(root, ".pipeline", "project.adapter.yaml");
  const adapter = YAML.parse(await (await import("node:fs/promises")).readFile(adapterPath, "utf8"));
  adapter.tracker.board_ref = "board-1";
  adapter.tracker.states = { refinement: "refinement", ux_ui: "ux", ready_for_development: "dev-ready", in_development: "dev", ready_for_validation: "qa", ready_for_release: "release", ideas: "ideas", ready_for_production: "prd", done: "done" };
  adapter.tracker.card_keys = [{ kind: "feature", pattern: "^FP-[0-9]{3}$" }];
  adapter.tracker.human_gates = { production_approval: "APROVADO PARA PRD", screen_approval: "Tela aprovada", unblock_prefix: "BLOQUEIO RESOLVIDO:" };
  await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
  try {
    await executeTrelloComment({ action: "snapshot", projectRoot: root, outputPath: ".pipeline/tmp/snapshot.json", now: new Date("2026-09-07T23:00:00Z"), fetchImpl: async (url) => {
      if (String(url).includes("/lists")) return new Response(JSON.stringify([{ id: "ux", name: "UX/UI", pos: 1 }]));
      if (String(url).includes("/cards?")) return new Response(JSON.stringify([{ id: "card-ux", name: "FP-214 Tela", idList: "ux", pos: 1 }]));
      if (String(url).includes("/actions/")) return new Response(JSON.stringify({ data: { card: { id: "verify-card" } } }));
      return new Response(JSON.stringify([
        { id: "blocked", date: "2026-09-07T20:00:00Z", data: { card: { id: "card-ux" }, text: "ROLE: pipeline-ux-ui\nSTATUS: blocked\nREQUIRES_HUMAN: true\nBLOCK_KIND: screen_approval" } },
        { id: "approved", date: "2026-09-07T21:00:00Z", data: { card: { id: "card-ux" }, text: "Tela aprovada" } }
      ]));
    }});
    const snapshot = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, ".pipeline", "tmp", "snapshot.json"), "utf8"));
    assert.equal(snapshot.cards[0].signals.awaiting_human, false);
    assert.equal(snapshot.cards[0].signals.screen_approval_valid, true);
    assert.equal(snapshot.integration.comments.observation.observed_at, "2026-09-07T23:00:00.000Z");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("snapshot deriva gates somente do estado atual e da revisão visual vigente", async () => {
  const root = await projectFixture();
  const adapterPath = join(root, ".pipeline", "project.adapter.yaml");
  const adapter = YAML.parse(await (await import("node:fs/promises")).readFile(adapterPath, "utf8"));
  adapter.tracker.board_ref = "board-1";
  adapter.tracker.states = { refinement: "refinement", ux_ui: "ux", ready_for_development: "dev-ready", in_development: "dev", ready_for_validation: "qa", ready_for_release: "release", ideas: "ideas", ready_for_production: "prd", done: "done" };
  adapter.tracker.human_gates = { production_approval: "APROVADO PARA PRD", screen_approval: "Tela aprovada", unblock_prefix: "BLOQUEIO RESOLVIDO:" };
  await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
  const cards = [
    { id: "card-dev", name: "FP-016 Desenvolvimento", idList: "dev-ready", pos: 1 },
    { id: "card-ux", name: "FP-017 UX", idList: "ux", pos: 2 },
    { id: "card-po", name: "FP-018 Refinamento", idList: "refinement", pos: 3 }
  ];
  try {
    await executeTrelloComment({ action: "snapshot", projectRoot: root, outputPath: ".pipeline/tmp/snapshot.json", now: new Date("2026-09-08T02:00:00Z"), fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("/lists")) return new Response(JSON.stringify([{ id: "dev-ready", pos: 1 }, { id: "ux", pos: 2 }, { id: "refinement", pos: 3 }]));
      if (value.includes("/boards/") && value.includes("/cards")) return new Response(JSON.stringify(cards));
      if (value.includes("card-dev/actions")) return new Response(JSON.stringify([
        { id: "move-16", type: "updateCard", date: "2026-09-08T01:08:00Z", data: { listAfter: { id: "dev-ready" } } },
        { id: "old-block-16", type: "commentCard", date: "2026-09-07T22:00:00Z", data: { card: { id: "card-dev" }, text: "STATUS: blocked\nREQUIRES_HUMAN: true" } }
      ]));
      if (value.includes("card-dev/attachments")) return new Response(JSON.stringify([]));
      if (value.includes("card-ux/actions")) return new Response(JSON.stringify([
        { id: "blocked-17", type: "commentCard", date: "2026-09-08T01:22:00Z", data: { card: { id: "card-ux" }, text: "CODEX UX/UI: ROLE HANDOFF + BLOQUEIO\nROLE: pipeline-ux-ui\nSTATUS: blocked\nEVENTS: role_handoff, blocker\nREQUIRES_HUMAN: true\nBLOCK_KIND: screen_approval" } },
        { id: "old-approval-17", type: "commentCard", date: "2026-09-08T00:30:00Z", data: { card: { id: "card-ux" }, text: "Tela aprovada" } },
        { id: "move-17", type: "updateCard", date: "2026-09-08T00:06:00Z", data: { listAfter: { id: "ux" } } }
      ]));
      if (value.includes("card-ux/attachments")) return new Response(JSON.stringify([{ id: "mock-v2", name: "UX v2.html", date: "2026-09-08T01:18:00Z" }]));
      if (value.includes("card-po/actions")) return new Response(JSON.stringify([
        { id: "unblock-18", type: "commentCard", date: "2026-09-08T00:41:00Z", data: { card: { id: "card-po" }, text: "BLOQUEIO RESOLVIDO: Opção B" } },
        { id: "blocked-18", type: "commentCard", date: "2026-09-08T00:02:00Z", data: { card: { id: "card-po" }, text: "STATUS: blocked\nEVENT: role_handoff, blocker\nREQUIRES_HUMAN: true" } }
      ]));
      if (value.includes("card-po/attachments")) return new Response(JSON.stringify([]));
      return new Response(JSON.stringify([]));
    }});
    const snapshot = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, ".pipeline", "tmp", "snapshot.json"), "utf8"));
    const byRef = new Map(snapshot.cards.map((card) => [card.ref, card]));
    assert.equal(byRef.get("card-dev").signals.awaiting_human, false);
    assert.equal(byRef.get("card-dev").signals.state_entered_at, "2026-09-08T01:08:00Z");
    assert.equal(byRef.get("card-ux").signals.awaiting_human, true);
    assert.equal(byRef.get("card-ux").signals.human_gate_kind, "screen_approval");
    assert.equal(byRef.get("card-ux").signals.screen_approval_valid, false);
    assert.equal(byRef.get("card-ux").signals.screen_approval_required, true);
    assert.equal(byRef.get("card-po").signals.awaiting_human, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("nome do papel e requires_human isolado não transformam falha técnica em gate humano", async () => {
  const root = await projectFixture();
  const adapterPath = join(root, ".pipeline", "project.adapter.yaml");
  const adapter = YAML.parse(await (await import("node:fs/promises")).readFile(adapterPath, "utf8"));
  adapter.tracker.board_ref = "board-1";
  adapter.tracker.states = { refinement: "refinement", ux_ui: "ux", ready_for_development: "dev-ready", in_development: "dev", ready_for_validation: "qa", ready_for_release: "release", ideas: "ideas", ready_for_production: "prd", done: "done" };
  adapter.tracker.human_gates = { production_approval: "APROVADO PARA PRD", screen_approval: "Tela aprovada", unblock_prefix: "BLOQUEIO RESOLVIDO:" };
  await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
  try {
    await executeTrelloComment({ action: "snapshot", projectRoot: root, outputPath: ".pipeline/tmp/snapshot.json", fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("/lists")) return new Response(JSON.stringify([{ id: "refinement", pos: 1 }]));
      if (value.includes("/boards/") && value.includes("/cards")) return new Response(JSON.stringify([{ id: "card-po", name: "Demanda", idList: "refinement", pos: 1 }]));
      if (value.includes("card-po/actions")) return new Response(JSON.stringify([{ id: "technical", type: "commentCard", date: "2026-09-08T12:00:00Z", data: { card: { id: "card-po" }, text: "ROLE: pipeline-po\nSTATUS: blocked\nREQUIRES_HUMAN: true\nCAUSE: arquivo temporário ausente" } }]));
      return new Response(JSON.stringify([]));
    }});
    const snapshot = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, ".pipeline", "tmp", "snapshot.json"), "utf8"));
    assert.equal(snapshot.cards[0].signals.awaiting_human, false);
    assert.equal(snapshot.cards[0].signals.human_gate_kind, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("snapshot preserva handoff DEV na fronteira da transição e ignora falso bloqueio técnico", async () => {
  const root = await projectFixture();
  const adapterPath = join(root, ".pipeline", "project.adapter.yaml");
  const adapter = YAML.parse(await (await import("node:fs/promises")).readFile(adapterPath, "utf8"));
  adapter.tracker.board_ref = "board-1";
  adapter.tracker.states = { refinement: "refinement", ux_ui: "ux", ready_for_development: "dev-ready", in_development: "dev", ready_for_validation: "qa", ready_for_release: "release", ideas: "ideas", ready_for_production: "prd", done: "done" };
  adapter.tracker.human_gates = { production_approval: "APROVADO PARA PRD", screen_approval: "Tela aprovada", unblock_prefix: "BLOQUEIO RESOLVIDO:" };
  await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
  try {
    await executeTrelloComment({ action: "snapshot", projectRoot: root, outputPath: ".pipeline/tmp/snapshot.json", now: new Date("2026-09-08T03:00:00Z"), fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("/lists")) return new Response(JSON.stringify([{ id: "dev", name: "EM DESENVOLVIMENTO", pos: 1 }]));
      if (value.includes("/boards/") && value.includes("/cards")) return new Response(JSON.stringify([{ id: "card-dev", name: "FP-016 Entrega", idList: "dev", pos: 1 }]));
      if (value.includes("card-dev/attachments")) return new Response(JSON.stringify([]));
      if (value.includes("card-dev/actions")) return new Response(JSON.stringify([
        { id: "false-block", type: "commentCard", date: "2026-09-08T02:39:51Z", data: { card: { id: "card-dev" }, text: "PIPELINE BLOCKER\nROLE: pipeline-run\nSTATUS: blocked\nREQUIRES_HUMAN: true\nCAUSE: sinal técnico não materializado" } },
        { id: "lock-review", type: "commentCard", date: "2026-09-08T02:38:03Z", data: { card: { id: "card-dev" }, text: "CODEX LOCK\nROLE: pipeline-code-review\nSTATUS: active" } },
        { id: "move-dev", type: "updateCard", date: "2026-09-08T02:37:20Z", data: { listAfter: { id: "dev" } } },
        { id: "dev-pass", type: "commentCard", date: "2026-09-08T02:37:02Z", data: { card: { id: "card-dev" }, text: "PIPELINE DEV HANDOFF / TRANSITION\nROLE: pipeline-dev\nVERDICT: PASS\nTRANSITION: ready_for_development -> in_development.\nNEXT STEP: Code Review independente." } }
      ]));
      return new Response(JSON.stringify([]));
    }});
    const snapshot = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, ".pipeline", "tmp", "snapshot.json"), "utf8"));
    assert.equal(snapshot.cards[0].signals.awaiting_human, false);
    assert.equal(snapshot.cards[0].signals.implementation_complete, true);
    assert.equal(snapshot.cards[0].signals.review_approved, false);
    assert.equal(snapshot.cards[0].signals.implementation_evidence_ref, "dev-pass");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("snapshot transforma retornos técnicos e transição PO pendente em ações recuperáveis", async () => {
  const root = await projectFixture();
  const adapterPath = join(root, ".pipeline", "project.adapter.yaml");
  const adapter = YAML.parse(await (await import("node:fs/promises")).readFile(adapterPath, "utf8"));
  adapter.tracker.board_ref = "board-1";
  adapter.tracker.states = { refinement: "refinement", ux_ui: "ux", ready_for_development: "dev-ready", in_development: "dev", ready_for_validation: "qa", ready_for_release: "release", ideas: "ideas", ready_for_production: "prd", done: "done" };
  adapter.tracker.human_gates = { production_approval: "APROVADO PARA PRD", screen_approval: "Tela aprovada", unblock_prefix: "BLOQUEIO RESOLVIDO:" };
  await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
  try {
    await executeTrelloComment({ action: "snapshot", projectRoot: root, outputPath: ".pipeline/tmp/snapshot.json", now: new Date("2026-09-08T12:00:00Z"), fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("/lists")) return new Response(JSON.stringify([{ id: "dev", pos: 1 }, { id: "qa", pos: 2 }, { id: "refinement", pos: 3 }]));
      if (value.includes("/boards/") && value.includes("/cards")) return new Response(JSON.stringify([
        { id: "card-dev", name: "FP-228 Corrigir", idList: "dev", pos: 1 },
        { id: "card-po", name: "FP-229 Refinado", idList: "refinement", pos: 2 },
        { id: "card-qa", name: "FP-230 Reprovado", idList: "qa", pos: 3 }
      ]));
      if (value.includes("/attachments")) return new Response(JSON.stringify([]));
      if (value.includes("card-dev/actions")) return new Response(JSON.stringify([
        { id: "review-return", type: "commentCard", date: "2026-09-08T11:04:00Z", data: { card: { id: "card-dev" }, text: "ROLE: pipeline-code-review\nSTATUS: return / changes_required\nSTATE_FROM: in_development\nSTATE_TO: in_development\nEVENT: role_handoff, blocker" } },
        { id: "move-dev", type: "updateCard", date: "2026-09-08T10:01:00Z", data: { listAfter: { id: "dev" } } },
        { id: "dev-pass", type: "commentCard", date: "2026-09-08T10:00:59Z", data: { card: { id: "card-dev" }, text: "ROLE: pipeline-dev\nVERDICT: PASS\nTRANSITION: ready_for_development -> in_development\nNEXT_ROLE: pipeline-code-review" } }
      ]));
      if (value.includes("card-po/actions")) return new Response(JSON.stringify([
        { id: "technical-note", type: "commentCard", date: "2026-09-08T11:02:00Z", data: { card: { id: "card-po" }, text: "CODEX BLOCKER\nCAUSE: diferença de relógio\nHUMAN ACTION: Não requerida." } },
        { id: "po-handoff", type: "commentCard", date: "2026-09-08T11:01:00Z", data: { card: { id: "card-po" }, text: "RUN_ID: RUN-20260908-ABCDEF12\nROLE: pipeline-po\nSTATUS: completed\nSTATE_FROM: refinement\nSTATE_TO: ux_ui\nEVENT: role_handoff, transition" } }
      ]));
      if (value.includes("card-qa/actions")) return new Response(JSON.stringify([
        { id: "qa-return", type: "commentCard", date: "2026-09-08T11:03:00Z", data: { card: { id: "card-qa" }, text: "RUN_ID: RUN-20260908-ABCDEF13\nROLE: pipeline-qa\nSTATUS: return / rejected\nSTATE_FROM: ready_for_validation\nSTATE_TO: in_development\nEVENT: role_handoff, transition" } }
      ]));
      return new Response(JSON.stringify([]));
    }});
    const snapshot = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, ".pipeline", "tmp", "snapshot.json"), "utf8"));
    const byRef = new Map(snapshot.cards.map((card) => [card.ref, card]));
    assert.equal(byRef.get("card-dev").signals.implementation_complete, false);
    assert.equal(byRef.get("card-dev").signals.review_evidence_ref, "review-return");
    assert.equal(byRef.get("card-dev").signals.awaiting_human, false);
    assert.equal(byRef.get("card-po").signals.pending_transition, true);
    assert.equal(byRef.get("card-po").signals.pending_transition_to, "ux_ui");
    assert.equal(byRef.get("card-po").signals.pending_transition_run_id, "RUN-20260908-ABCDEF12");
    assert.equal(byRef.get("card-po").signals.pending_transition_evidence_ref, "po-handoff");
    assert.equal(byRef.get("card-qa").signals.pending_transition, true);
    assert.equal(byRef.get("card-qa").signals.pending_transition_to, "in_development");
    assert.equal(byRef.get("card-qa").signals.pending_transition_evidence_ref, "qa-return");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("snapshot preserva Delivery Group da descrição e membro terminal para precedência", async () => {
  const root = await projectFixture();
  const adapterPath = join(root, ".pipeline", "project.adapter.yaml");
  const adapter = YAML.parse(await (await import("node:fs/promises")).readFile(adapterPath, "utf8"));
  adapter.tracker.board_ref = "board-1";
  adapter.tracker.states = { refinement: "refinement", ux_ui: "ux", ready_for_development: "dev-ready", in_development: "dev", ready_for_validation: "qa", ready_for_release: "release", ideas: "ideas", ready_for_production: "prd", done: "done" };
  adapter.tracker.human_gates = { production_approval: "APROVADO PARA PRD", screen_approval: "Tela aprovada", unblock_prefix: "BLOQUEIO RESOLVIDO:" };
  await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
  const group = "DELIVERY GROUP: fp-201-202\nCARDS: FP-201, FP-202\nGROUP MODE: optimization\nDEFINED BY: pipeline-po";
  try {
    await executeTrelloComment({ action: "snapshot", projectRoot: root, outputPath: ".pipeline/tmp/snapshot.json", fetchImpl: async (url) => {
      if (String(url).includes("/lists")) return new Response(JSON.stringify([{ id: "dev-ready", name: "PRONTO PARA DESENVOLVER", pos: 1 }, { id: "prd", name: "PRONTO PARA PRD", pos: 2 }]));
      if (String(url).includes("/cards?")) return new Response(JSON.stringify([
        { id: "active", name: "FP-201 - Ativo", desc: group, idList: "dev-ready", pos: 1 },
        { id: "terminal", name: "FP-202 - Terminal", desc: group, idList: "prd", pos: 2 }
      ]));
      return new Response(JSON.stringify([]));
    }});
    const snapshot = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, ".pipeline", "tmp", "snapshot.json"), "utf8"));
    assert.deepEqual(snapshot.cards.map((card) => card.key), ["FP-201", "FP-202"]);
    assert.equal(snapshot.cards[0].delivery_group.mode, "optimization");
    assert.deepEqual(snapshot.delivery_groups.map((item) => item.id), ["fp-201-202"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("anexa mock e confirma por releitura", async () => {
  const root = await projectFixture();
  await writeFile(join(root, ".pipeline", "tmp", "mock.png"), "png-fixture", "utf8");
  let calls = 0;
  try {
    const result = await executeTrelloComment({ action: "attach-file", projectRoot: root, cardRef: "card-1", filePath: ".pipeline/tmp/mock.png", fetchImpl: async (_url, options = {}) => {
      calls += 1;
      if (calls === 1) { assert.equal(options.method, "POST"); return new Response(JSON.stringify({ id: "att-1" })); }
      return new Response(JSON.stringify([{ id: "att-1", name: "mock.png", url: "https://trello.example/mock" }]));
    }});
    assert.equal(result.status, "PASS");
    assert.equal(result.readback_status, "confirmed");
    assert.equal(result.content_sha256.length, 64);
    assert.equal(calls, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("remove anexo somente do card informado e confirma ausência", async () => {
  const root = await projectFixture();
  let calls = 0;
  try {
    const result = await executeTrelloComment({ action: "delete-attachment-readback", projectRoot: root, cardRef: "card-1", attachmentRef: "att-1", expectedName: "mock.png", fetchImpl: async (_url, options = {}) => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify([{ id: "att-1", name: "mock.png" }]));
      if (calls === 2) { assert.equal(options.method, "DELETE"); return new Response(JSON.stringify({ _value: null })); }
      return new Response(JSON.stringify([]));
    }});
    assert.equal(result.readback_status, "confirmed_absent");
    assert.equal(result.deleted_name, "mock.png");
    assert.equal(calls, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("move card somente para estado canônico e confirma por releitura", async () => {
  const root = await projectFixture();
  const adapterPath = join(root, ".pipeline", "project.adapter.yaml");
  const adapter = YAML.parse(await (await import("node:fs/promises")).readFile(adapterPath, "utf8"));
  adapter.tracker.states = { refinement: "list-next" };
  await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
  let calls = 0;
  try {
    const result = await executeTrelloComment({ action: "move-readback", projectRoot: root, cardRef: "card-1", listRef: "list-next", fetchImpl: async (_url, options = {}) => {
      calls += 1;
      if (calls === 1) { assert.equal(options.method, "PUT"); assert.equal(options.body.get("idList"), "list-next"); return new Response(JSON.stringify({ id: "card-1" })); }
      return new Response(JSON.stringify({ id: "card-1", idList: "list-next" }));
    }});
    assert.equal(result.readback_status, "confirmed");
    assert.equal(calls, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("atualiza título canônico e descrição refinada com releitura", async () => {
  const root = await projectFixture();
  const namePath = join(root, ".pipeline", "tmp", "name.txt");
  const descriptionPath = join(root, ".pipeline", "tmp", "description.md");
  await writeFile(namePath, "FP-123 - Gastos casa e outros gastos\n", "utf8");
  await writeFile(descriptionPath, "## Contexto\nDescrição refinada.\n", "utf8");
  let calls = 0;
  try {
    const result = await executeTrelloComment({ action: "update-card-readback", projectRoot: root, cardRef: "card-1", namePath, descriptionPath, fetchImpl: async (_url, options = {}) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(options.method, "PUT");
        assert.equal(options.body.get("name"), "FP-123 - Gastos casa e outros gastos");
        assert.match(options.body.get("desc"), /Descrição refinada/u);
        return new Response(JSON.stringify({ id: "card-1" }));
      }
      return new Response(JSON.stringify({ id: "card-1", name: "FP-123 - Gastos casa e outros gastos", desc: "## Contexto\nDescrição refinada.", idList: "list-1" }));
    }});
    assert.equal(result.readback_status, "confirmed");
    assert.equal(result.title_sha256.length, 64);
    assert.equal(result.description_sha256.length, 64);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recusa título refinado sem chave aceita pelo adapter", async () => {
  const root = await projectFixture();
  const namePath = join(root, ".pipeline", "tmp", "name.txt");
  const descriptionPath = join(root, ".pipeline", "tmp", "description.md");
  await writeFile(namePath, "Título cru", "utf8");
  await writeFile(descriptionPath, "Descrição", "utf8");
  try {
    await assert.rejects(() => executeTrelloComment({ action: "update-card-readback", projectRoot: root, cardRef: "card-1", namePath, descriptionPath, fetchImpl: async () => { throw new Error("não deveria chamar"); } }), /chave canônica/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("exclui comentário somente após validar card e hash e confirma ausência", async () => {
  const root = await projectFixture();
  const text = "CODEX LOCK\nRUN_ID: RUN-1";
  const expectedSha256 = createHash("sha256").update(text, "utf8").digest("hex");
  let calls = 0;
  try {
    const result = await executeTrelloComment({ action: "delete-comment-readback", projectRoot: root, cardRef: "card-1", commentRef: "comment-1", expectedSha256, fetchImpl: async (_url, options = {}) => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ id: "comment-1", data: { card: { id: "card-1" }, text } }));
      if (calls === 2) { assert.equal(options.method, "DELETE"); return new Response(JSON.stringify({ _value: null })); }
      return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    }});
    assert.equal(result.readback_status, "confirmed_absent");
    assert.equal(calls, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("atualiza uma label de tipo e labels oficiais de domínio com releitura", async () => {
  const root = await projectFixture();
  let calls = 0;
  try {
    const result = await executeTrelloComment({ action: "update-labels-readback", projectRoot: root, cardRef: "card-1", labelRefs: ["label-feature", "label-business"], fetchImpl: async (url, options = {}) => {
      calls += 1;
      if (calls === 1) { assert.match(String(url), /\/labels/u); return new Response(JSON.stringify([{ id: "label-feature", name: "Melhoria" }, { id: "label-business", name: "Negócio" }])); }
      if (calls === 2) { assert.equal(options.body.get("idLabels"), "label-feature,label-business"); return new Response(JSON.stringify({ id: "card-1" })); }
      return new Response(JSON.stringify({ id: "card-1", idLabels: ["label-business", "label-feature"] }));
    }});
    assert.equal(result.readback_status, "confirmed");
    assert.equal(result.guarantees.labels_restricted_to_adapter, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("resolve label oficial por nome antes de gravar IDs no Trello", async () => {
  const root = await projectFixture();
  const adapterPath = join(root, ".pipeline", "project.adapter.yaml");
  const adapter = YAML.parse(await (await import("node:fs/promises")).readFile(adapterPath, "utf8"));
  adapter.tracker.board_ref = "board-1";
  adapter.tracker.type_labels.feature = "Melhoria";
  await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
  let calls = 0;
  try {
    const result = await executeTrelloComment({ action: "update-labels-readback", projectRoot: root, cardRef: "card-1", labelRefs: ["Melhoria", "label-business"], fetchImpl: async (_url, options = {}) => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify([{ id: "label-feature", name: "Melhoria" }, { id: "label-business", name: "Negócio" }]));
      if (calls === 2) { assert.equal(options.body.get("idLabels"), "label-feature,label-business"); return new Response(JSON.stringify({ id: "card-1" })); }
      return new Response(JSON.stringify({ id: "card-1", idLabels: ["label-feature", "label-business"] }));
    }});
    assert.equal(result.readback_status, "confirmed");
    assert.equal(result.guarantees.labels_resolved_from_adapter, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recusa labels sem tipo único ou fora do adapter", async () => {
  const root = await projectFixture();
  try {
    await assert.rejects(() => executeTrelloComment({ action: "update-labels-readback", projectRoot: root, cardRef: "card-1", labelRefs: ["label-business"], fetchImpl: async () => new Response() }), /Exatamente uma/u);
    await assert.rejects(() => executeTrelloComment({ action: "update-labels-readback", projectRoot: root, cardRef: "card-1", labelRefs: ["label-feature", "label-business", "label-unknown"], fetchImpl: async () => new Response() }), /não pertence/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
