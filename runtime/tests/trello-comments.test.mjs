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
    const snapshot = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, ".pipeline", "tmp", "snapshot.json"), "utf8"));
    assert.deepEqual(snapshot.cards.map((card) => card.ref), ["active"]);
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
    const result = await executeTrelloComment({ action: "update-labels-readback", projectRoot: root, cardRef: "card-1", labelRefs: ["label-feature", "label-business"], fetchImpl: async (_url, options = {}) => {
      calls += 1;
      if (calls === 1) { assert.equal(options.body.get("idLabels"), "label-feature,label-business"); return new Response(JSON.stringify({ id: "card-1" })); }
      return new Response(JSON.stringify({ id: "card-1", idLabels: ["label-business", "label-feature"] }));
    }});
    assert.equal(result.readback_status, "confirmed");
    assert.equal(result.guarantees.labels_restricted_to_adapter, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recusa labels sem tipo único ou fora do adapter", async () => {
  const root = await projectFixture();
  try {
    await assert.rejects(() => executeTrelloComment({ action: "update-labels-readback", projectRoot: root, cardRef: "card-1", labelRefs: ["label-business"], fetchImpl: async () => new Response() }), /Exatamente uma/u);
    await assert.rejects(() => executeTrelloComment({ action: "update-labels-readback", projectRoot: root, cardRef: "card-1", labelRefs: ["label-feature", "label-business", "label-unknown"], fetchImpl: async () => new Response() }), /não pertence/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
