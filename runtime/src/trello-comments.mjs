#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(SOURCE_DIR, "..");
const PACKAGE = JSON.parse(readFileSync(resolve(RUNTIME_DIR, "package.json"), "utf8"));
const API_ROOT = "https://api.trello.com/1";

function parseData(path, label) {
  if (!existsSync(path)) throw new Error(`${label} não encontrado.`);
  const document = YAML.parseDocument(readFileSync(path, "utf8"), { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(`${label} possui YAML/JSON inválido.`);
  return document.toJS({ mapAsMap: false });
}

function containedPath(root, candidate, label) {
  const delta = relative(root, candidate);
  if (delta === "" || delta === ".." || delta.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`${label} precisa estar contido na raiz do projeto.`);
  }
  return candidate;
}

function parseEnvironmentFile(path) {
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  const key = values.TRELLO_API_KEY;
  const token = values.TRELLO_TOKEN;
  if (!key || !token) throw new Error("Credenciais Trello obrigatórias não foram encontradas.");
  return { key, token };
}

function endpoint(path, credentials, query = {}) {
  const url = new URL(`${API_ROOT}${path}`);
  url.searchParams.set("key", credentials.key);
  url.searchParams.set("token", credentials.token);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
  return url;
}

function unsafeEncoding(text) {
  return text.includes("\uFFFD") || /Ã[\u0080-\u00BF]/u.test(text);
}

async function responseJson(response, operation) {
  if (!response.ok) throw new Error(`Trello recusou ${operation} com HTTP ${response.status}.`);
  return response.json();
}

async function safeFetch(fetchImpl, url, options, operation) {
  try {
    return await fetchImpl(url, options);
  } catch {
    throw new Error(`Falha de rede durante ${operation}.`);
  }
}

function publicComment(action) {
  return {
    ref: action.id,
    card_ref: action.data?.card?.id,
    text: action.data?.text,
    date: action.date,
    member_ref: action.idMemberCreator,
    member: action.memberCreator
      ? { username: action.memberCreator.username, full_name: action.memberCreator.fullName }
      : undefined
  };
}

function cardKey(title, patterns = []) {
  for (const item of patterns) {
    const match = title.match(new RegExp(item.pattern.replace(/\$$/u, ""), "u"));
    if (match?.[0]) return match[0];
  }
  return undefined;
}

function latestSignal(comments, exact, prefix) {
  const chronological = [...comments].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let value = false;
  for (const comment of chronological) {
    const text = String(comment.text ?? "").trim();
    if (text === exact) value = true;
    if (prefix && text.startsWith(prefix)) value = false;
  }
  return value;
}

function awaitingHuman(comments, unblockPrefix) {
  const chronological = [...comments].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let value = false;
  for (const comment of chronological) {
    const text = String(comment.text ?? "").trim();
    if (text === "Aguardando resposta humana" || (/^CODEX LOCK$/mu.test(text) && /^STATUS:\s*blocked\s*$/imu.test(text) && /^REQUIRES_HUMAN:\s*true\s*$/imu.test(text))) value = true;
    if (unblockPrefix && text.startsWith(unblockPrefix)) value = false;
  }
  return value;
}

function parseDeliveryGroup(text) {
  const id = text.match(/^DELIVERY GROUP:\s*([a-z0-9-]+)\s*$/imu)?.[1];
  const cards = text.match(/^CARDS:\s*(.+)$/imu)?.[1]?.split(",").map((value) => value.trim()).filter(Boolean);
  if (!id || !cards || cards.length < 2 || !/^DEFINED BY:\s*pipeline-po\s*$/imu.test(text)) return undefined;
  const branch = text.match(/^BRANCH:\s*(.+)$/imu)?.[1]?.trim();
  const mode = text.match(/^GROUP MODE:\s*(optimization|dependency)\s*$/imu)?.[1]?.toLowerCase() ?? "optimization";
  const dependencies = text.match(/^DEPENDS ON:\s*(.+)$/imu)?.[1]
    ?.split(",").map((value) => value.trim()).filter(Boolean);
  return { id, cards, ...(branch ? { branch } : {}), mode, ...(dependencies?.length ? { depends_on: dependencies } : {}), defined_by: "pipeline-po" };
}

function deliveryGroup(comments, description) {
  for (const comment of [...comments].sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
    const parsed = parseDeliveryGroup(String(comment.text ?? ""));
    if (parsed) return parsed;
  }
  return parseDeliveryGroup(String(description ?? ""));
}

async function getJson(fetchImpl, credentials, path, query, operation) {
  return responseJson(await safeFetch(fetchImpl, endpoint(path, credentials, query), undefined, operation), operation);
}

function labelLookupKey(value) {
  return String(value ?? "").trim().toLocaleLowerCase("pt-BR");
}

async function resolveLabelRefs(fetchImpl, credentials, adapter, configuredRefs) {
  const labels = await getJson(
    fetchImpl,
    credentials,
    `/boards/${encodeURIComponent(adapter.tracker.board_ref)}/labels`,
    { fields: "name,color" },
    "a resolução das labels oficiais"
  );
  const byId = new Map(labels.map((label) => [String(label.id), String(label.id)]));
  const byName = new Map();
  for (const label of labels) {
    const key = labelLookupKey(label.name);
    if (!key) continue;
    const matches = byName.get(key) ?? [];
    matches.push(String(label.id));
    byName.set(key, matches);
  }
  return configuredRefs.map((reference) => {
    const direct = byId.get(String(reference));
    if (direct) return direct;
    const matches = byName.get(labelLookupKey(reference)) ?? [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`A label oficial '${reference}' é ambígua no board; use o ID no adapter.`);
    throw new Error(`A label oficial '${reference}' não foi encontrada no board declarado pelo adapter.`);
  });
}

function publicAttachment(value, cardRef) {
  return { ref: value.id, card_ref: value.idCard ?? cardRef, name: value.name, url: value.url, bytes: value.bytes, mime_type: value.mimeType, date: value.date, previews: value.previews?.length ?? 0 };
}

export async function executeTrelloComment(input = {}) {
  const projectRoot = resolve(input.projectRoot ?? process.cwd());
  const adapterPath = resolve(input.adapterPath ?? resolve(projectRoot, ".pipeline", "project.adapter.yaml"));
  const adapter = parseData(adapterPath, "Adapter");
  if (adapter.tracker?.provider !== "trello") throw new Error("O cliente suporta somente tracker Trello.");
  const providers = [adapter.tracker?.comments?.read_provider, adapter.tracker?.comments?.write_provider];
  if (!providers.includes("environment")) throw new Error("O adapter não declara comentários pelo provider environment.");
  const credentialRelative = adapter.tracker?.environment?.credential_file;
  if (!credentialRelative) throw new Error("tracker.environment.credential_file é obrigatório.");
  const credentialPath = containedPath(projectRoot, resolve(projectRoot, credentialRelative), "credential_file");
  const credentials = parseEnvironmentFile(credentialPath);
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch não está disponível.");
  const action = input.action;

  if (action === "list-card-names") {
    const cards = await getJson(fetchImpl, credentials, `/boards/${encodeURIComponent(adapter.tracker.board_ref)}/cards`, { filter: "all", fields: "name,closed" }, "a leitura das chaves históricas do board");
    return {
      contract_version: "0.1", tool: { name: "pipeline-trello", version: PACKAGE.version }, status: "PASS", action,
      provider: "environment", board_ref: adapter.tracker.board_ref,
      cards: cards.map((card) => ({ ref: card.id, title: card.name, key: cardKey(card.name, adapter.tracker.card_keys), closed: card.closed })),
      guarantees: { tracker_writes_performed: false, secrets_exposed: false, includes_closed_cards: true }
    };
  }

  if (action === "snapshot") {
    if (!input.outputPath) throw new Error("outputPath é obrigatório para snapshot.");
    const outputPath = containedPath(projectRoot, resolve(projectRoot, input.outputPath), "outputPath");
    const lists = await getJson(fetchImpl, credentials, `/boards/${encodeURIComponent(adapter.tracker.board_ref)}/lists`, { filter: "open", fields: "name,pos" }, "a leitura das listas");
    const cards = await getJson(fetchImpl, credentials, `/boards/${encodeURIComponent(adapter.tracker.board_ref)}/cards`, { filter: "open", fields: "name,desc,idList,pos,labels" }, "a leitura dos cards");
    const activeRefs = new Set(["refinement", "ux_ui", "ready_for_development", "in_development", "ready_for_validation", "ready_for_release"].map((state) => adapter.tracker.states[state]));
    const activeCards = cards.filter((card) => activeRefs.has(card.idList));
    const commentEntries = await Promise.all(activeCards.map(async (card) => {
      const actions = await getJson(fetchImpl, credentials, `/cards/${encodeURIComponent(card.id)}/actions`, { filter: "commentCard", limit: input.limit ?? 100, memberCreator_fields: "fullName,username" }, "a leitura pontual de comentários");
      return [card.id, actions.map(publicComment)];
    }));
    const commentsByCard = new Map(commentEntries);
    const gate = adapter.tracker.human_gates ?? {};
    const verification = adapter.tracker.comments?.verification;
    let verified = false;
    if (verification?.comment_ref && verification?.card_ref) {
      const evidence = await getJson(fetchImpl, credentials, `/actions/${encodeURIComponent(verification.comment_ref)}`, {}, "a verificação da integração");
      verified = evidence.data?.card?.id === verification.card_ref;
    }
    const groupByCard = new Map();
    for (const card of cards) {
      const group = deliveryGroup([], card.desc);
      if (group) groupByCard.set(card.id, group);
    }
    const snapshotCards = activeCards.map((card) => {
      const comments = commentsByCard.get(card.id) ?? [];
      const item = { ref: card.id, title: card.name, list_ref: card.idList, position: card.pos };
      const key = cardKey(card.name, adapter.tracker.card_keys);
      if (key) item.key = key;
      const group = deliveryGroup(comments, card.desc);
      if (group) {
        item.delivery_group = group;
        groupByCard.set(card.id, group);
      }
      item.signals = {
        awaiting_human: awaitingHuman(comments, gate.unblock_prefix),
        screen_approval_valid: latestSignal(comments, gate.screen_approval ?? "Tela aprovada"),
        production_approval_valid: latestSignal(comments, gate.production_approval ?? "APROVADO PARA PRD")
      };
      return item;
    });
    for (const card of cards.filter((card) => !activeRefs.has(card.idList) && groupByCard.has(card.id))) {
      const item = { ref: card.id, title: card.name, list_ref: card.idList, position: card.pos, delivery_group: groupByCard.get(card.id) };
      const key = cardKey(card.name, adapter.tracker.card_keys);
      if (key) item.key = key;
      snapshotCards.push(item);
    }
    const groups = [...new Map([...groupByCard.values()].map((group) => [group.id, group])).values()];
    const snapshot = {
      board_ref: adapter.tracker.board_ref,
      open_lists: lists.map((list) => ({ ref: list.id, name: list.name, position: list.pos })),
      cards: snapshotCards,
      ...(groups.length ? { delivery_groups: groups } : {}),
      integration: { comments: {
        read: verified ? "verified" : "not_tested", write: verified ? "verified" : "not_tested",
        read_provider: "environment", write_provider: "environment",
        ...(verified ? { evidence_ref: verification.comment_ref, verified_at: verification.verified_at } : {})
      }}
    };
    writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    return { contract_version: "0.1", tool: { name: "pipeline-trello", version: PACKAGE.version }, status: "PASS", action, board_ref: adapter.tracker.board_ref, output: relative(projectRoot, outputPath), counts: { lists: lists.length, cards: cards.length, hydrated_cards: activeCards.length, comments: commentEntries.reduce((sum, [, values]) => sum + values.length, 0) }, guarantees: { tracker_writes_performed: false, secrets_exposed: false, full_board_comment_scan: false } };
  }

  if (!input.cardRef) throw new Error("cardRef é obrigatório.");

  if (action === "list-attachments") {
    const attachments = await getJson(fetchImpl, credentials, `/cards/${encodeURIComponent(input.cardRef)}/attachments`, {}, "a leitura dos anexos");
    return {
      contract_version: "0.1", tool: { name: "pipeline-trello", version: PACKAGE.version }, status: "PASS", action,
      provider: "environment", card_ref: input.cardRef, attachments: attachments.map((item) => publicAttachment(item, input.cardRef)),
      guarantees: { tracker_writes_performed: false, secrets_exposed: false }
    };
  }

  if (action === "read-card") {
    const persisted = await getJson(fetchImpl, credentials, `/cards/${encodeURIComponent(input.cardRef)}`, { fields: "name,desc,idList,idLabels,closed" }, "a leitura do card");
    return {
      contract_version: "0.1", tool: { name: "pipeline-trello", version: PACKAGE.version }, status: "PASS", action,
      provider: "environment", card: { ref: persisted.id, title: persisted.name, description: persisted.desc, list_ref: persisted.idList, label_refs: persisted.idLabels ?? [], closed: persisted.closed },
      guarantees: { tracker_writes_performed: false, secrets_exposed: false }
    };
  }

  if (action === "update-card-readback") {
    if (!input.namePath || !input.descriptionPath) throw new Error("namePath e descriptionPath são obrigatórios.");
    const namePath = containedPath(projectRoot, resolve(projectRoot, input.namePath), "namePath");
    const descriptionPath = containedPath(projectRoot, resolve(projectRoot, input.descriptionPath), "descriptionPath");
    const name = readFileSync(namePath, "utf8").trim();
    const description = readFileSync(descriptionPath, "utf8").trim();
    if (!name || !description) throw new Error("Título e descrição refinada não podem ser vazios.");
    if (unsafeEncoding(name) || unsafeEncoding(description)) throw new Error("Título ou descrição contém sinais de codificação corrompida.");
    if (!cardKey(name, adapter.tracker.card_keys)) throw new Error("O título não contém uma chave canônica aceita pelo adapter.");
    const body = new URLSearchParams({ key: credentials.key, token: credentials.token, name, desc: description });
    await responseJson(await safeFetch(fetchImpl, `${API_ROOT}/cards/${encodeURIComponent(input.cardRef)}`, {
      method: "PUT", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }, body
    }, "a atualização do card"), "a atualização do card");
    const persisted = await getJson(fetchImpl, credentials, `/cards/${encodeURIComponent(input.cardRef)}`, { fields: "name,desc,idList" }, "a releitura do card");
    if (persisted.name !== name || persisted.desc !== description) throw new Error("A releitura do card divergiu do título ou descrição refinada.");
    return {
      contract_version: "0.1", tool: { name: "pipeline-trello", version: PACKAGE.version }, status: "PASS", action,
      provider: "environment", card_ref: persisted.id, title: persisted.name, list_ref: persisted.idList,
      title_sha256: createHash("sha256").update(name, "utf8").digest("hex"), description_sha256: createHash("sha256").update(description, "utf8").digest("hex"),
      readback_status: "confirmed", guarantees: { tracker_writes_performed: true, secrets_exposed: false }
    };
  }

  if (action === "update-labels-readback") {
    const requested = [...new Set(input.labelRefs ?? [])];
    const typeRefs = new Set(Object.values(adapter.tracker.type_labels ?? {}));
    const domainRefs = new Set(Object.values(adapter.tracker.domain_labels ?? {}));
    const allowed = new Set([...typeRefs, ...domainRefs]);
    if (requested.filter((ref) => typeRefs.has(ref)).length !== 1) throw new Error("Exatamente uma label de tipo é obrigatória.");
    if (requested.filter((ref) => domainRefs.has(ref)).length < 1) throw new Error("Ao menos uma label oficial de domínio é obrigatória.");
    if (requested.some((ref) => !allowed.has(ref))) throw new Error("Uma label solicitada não pertence ao adapter.");
    const resolved = await resolveLabelRefs(fetchImpl, credentials, adapter, requested);
    const body = new URLSearchParams({ key: credentials.key, token: credentials.token, idLabels: resolved.join(",") });
    await responseJson(await safeFetch(fetchImpl, `${API_ROOT}/cards/${encodeURIComponent(input.cardRef)}`, {
      method: "PUT", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }, body
    }, "a atualização das labels"), "a atualização das labels");
    const persisted = await getJson(fetchImpl, credentials, `/cards/${encodeURIComponent(input.cardRef)}`, { fields: "idLabels" }, "a releitura das labels");
    if (JSON.stringify([...(persisted.idLabels ?? [])].sort()) !== JSON.stringify([...resolved].sort())) throw new Error("A releitura das labels divergiu da classificação solicitada.");
    return {
      contract_version: "0.1", tool: { name: "pipeline-trello", version: PACKAGE.version }, status: "PASS", action,
      provider: "environment", card_ref: persisted.id, label_refs: persisted.idLabels, configured_label_refs: requested, readback_status: "confirmed",
      guarantees: { tracker_writes_performed: true, secrets_exposed: false, labels_restricted_to_adapter: true, labels_resolved_from_adapter: true }
    };
  }

  if (action === "attach-file" || action === "attach-url") {
    const form = new FormData();
    form.set("key", credentials.key); form.set("token", credentials.token);
    if (input.name) form.set("name", input.name);
    if (input.setCover) form.set("setCover", "true");
    let contentSha256;
    if (action === "attach-file") {
      if (!input.filePath) throw new Error("filePath é obrigatório.");
      const filePath = containedPath(projectRoot, resolve(projectRoot, input.filePath), "filePath");
      const allowed = new Set((adapter.tracker.attachments?.allowed_extensions ?? ["png", "jpg", "jpeg", "webp", "pdf", "html"]).map((value) => `.${value.toLowerCase()}`));
      if (!allowed.has(extname(filePath).toLowerCase())) throw new Error("Tipo de anexo não permitido.");
      const maxBytes = adapter.tracker.attachments?.max_bytes ?? 10485760;
      if (statSync(filePath).size > maxBytes) throw new Error("Anexo excede o limite configurado.");
      const buffer = readFileSync(filePath);
      contentSha256 = createHash("sha256").update(buffer).digest("hex");
      form.set("file", new Blob([buffer]), input.name ?? basename(filePath));
    } else {
      if (!input.url || !/^https?:\/\//u.test(input.url)) throw new Error("URL HTTP(S) é obrigatória.");
      form.set("url", input.url);
    }
    const written = await responseJson(await safeFetch(fetchImpl, `${API_ROOT}/cards/${encodeURIComponent(input.cardRef)}/attachments`, { method: "POST", body: form }, "o envio do anexo"), "o envio do anexo");
    const attachments = await getJson(fetchImpl, credentials, `/cards/${encodeURIComponent(input.cardRef)}/attachments`, {}, "a releitura dos anexos do card");
    const persisted = attachments.find((item) => item.id === written.id);
    if (!persisted) throw new Error("A releitura dos anexos do card não encontrou o item enviado.");
    return { contract_version: "0.1", tool: { name: "pipeline-trello", version: PACKAGE.version }, status: "PASS", action, provider: "environment", attachment: publicAttachment(persisted, input.cardRef), ...(contentSha256 ? { content_sha256: contentSha256 } : {}), readback_status: "confirmed", guarantees: { tracker_writes_performed: true, secrets_exposed: false } };
  }

  if (action === "delete-attachment-readback") {
    if (!input.attachmentRef) throw new Error("attachmentRef é obrigatório.");
    const before = await getJson(fetchImpl, credentials, `/cards/${encodeURIComponent(input.cardRef)}/attachments`, {}, "a validação prévia do anexo");
    const existing = before.find((item) => item.id === input.attachmentRef);
    if (!existing) throw new Error("O anexo não pertence ao card ou já foi removido.");
    if (input.expectedName && existing.name !== input.expectedName) throw new Error("O nome do anexo mudou; exclusão recusada.");
    await responseJson(await safeFetch(fetchImpl, endpoint(`/cards/${encodeURIComponent(input.cardRef)}/attachments/${encodeURIComponent(input.attachmentRef)}`, credentials), { method: "DELETE" }, "a exclusão do anexo"), "a exclusão do anexo");
    const after = await getJson(fetchImpl, credentials, `/cards/${encodeURIComponent(input.cardRef)}/attachments`, {}, "a confirmação da exclusão do anexo");
    if (after.some((item) => item.id === input.attachmentRef)) throw new Error("A releitura não confirmou a exclusão do anexo.");
    return {
      contract_version: "0.1", tool: { name: "pipeline-trello", version: PACKAGE.version }, status: "PASS", action,
      provider: "environment", card_ref: input.cardRef, attachment_ref: input.attachmentRef, deleted_name: existing.name,
      readback_status: "confirmed_absent", guarantees: { tracker_writes_performed: true, secrets_exposed: false }
    };
  }

  if (action === "move-readback") {
    if (!input.listRef || !Object.values(adapter.tracker.states ?? {}).includes(input.listRef)) throw new Error("listRef não pertence aos estados canônicos do adapter.");
    const body = new URLSearchParams({ key: credentials.key, token: credentials.token, idList: input.listRef });
    await responseJson(await safeFetch(fetchImpl, `${API_ROOT}/cards/${encodeURIComponent(input.cardRef)}`, { method: "PUT", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }, body }, "a movimentação do card"), "a movimentação do card");
    const persisted = await getJson(fetchImpl, credentials, `/cards/${encodeURIComponent(input.cardRef)}`, { fields: "idList,name" }, "a releitura do card");
    if (persisted.idList !== input.listRef) throw new Error("A releitura do card divergiu da coluna solicitada.");
    return { contract_version: "0.1", tool: { name: "pipeline-trello", version: PACKAGE.version }, status: "PASS", action, provider: "environment", card_ref: input.cardRef, list_ref: persisted.idList, readback_status: "confirmed", guarantees: { tracker_writes_performed: true, secrets_exposed: false } };
  }

  if (action === "list") {
    const response = await safeFetch(fetchImpl,
      endpoint(`/cards/${encodeURIComponent(input.cardRef)}/actions`, credentials, {
        filter: "commentCard",
        limit: input.limit ?? 100,
        memberCreator_fields: "fullName,username"
      }),
      undefined,
      "a leitura de comentários"
    );
    const actions = await responseJson(response, "a leitura de comentários");
    return {
      contract_version: "0.1",
      tool: { name: "pipeline-trello-comments", version: PACKAGE.version },
      status: "PASS",
      action,
      provider: "environment",
      card_ref: input.cardRef,
      comments: actions.map(publicComment),
      guarantees: { tracker_writes_performed: false, secrets_exposed: false }
    };
  }

  if (action === "read") {
    if (!input.commentRef) throw new Error("commentRef é obrigatório para leitura individual.");
    const response = await safeFetch(fetchImpl, endpoint(`/actions/${encodeURIComponent(input.commentRef)}`, credentials), undefined, "a releitura do comentário");
    const persisted = await responseJson(response, "a releitura do comentário");
    if (persisted.data?.card?.id !== input.cardRef) throw new Error("O comentário relido pertence a outro card.");
    return {
      contract_version: "0.1",
      tool: { name: "pipeline-trello-comments", version: PACKAGE.version },
      status: "PASS",
      action,
      provider: "environment",
      card_ref: input.cardRef,
      comment: publicComment(persisted),
      guarantees: { tracker_writes_performed: false, secrets_exposed: false }
    };
  }

  if (action === "delete-comment-readback") {
    if (!input.commentRef || !input.expectedSha256) throw new Error("commentRef e expectedSha256 são obrigatórios para exclusão segura.");
    const existing = await getJson(fetchImpl, credentials, `/actions/${encodeURIComponent(input.commentRef)}`, {}, "a validação prévia do comentário");
    const text = String(existing.data?.text ?? "");
    if (existing.data?.card?.id !== input.cardRef) throw new Error("O comentário pertence a outro card.");
    if (createHash("sha256").update(text, "utf8").digest("hex") !== input.expectedSha256) throw new Error("O conteúdo do comentário mudou; exclusão recusada.");
    await responseJson(await safeFetch(fetchImpl, endpoint(`/actions/${encodeURIComponent(input.commentRef)}`, credentials), { method: "DELETE" }, "a exclusão do comentário"), "a exclusão do comentário");
    const readback = await safeFetch(fetchImpl, endpoint(`/actions/${encodeURIComponent(input.commentRef)}`, credentials), undefined, "a confirmação da exclusão");
    if (readback.status !== 404) throw new Error("A releitura não confirmou a exclusão do comentário.");
    return {
      contract_version: "0.1", tool: { name: "pipeline-trello-comments", version: PACKAGE.version }, status: "PASS", action,
      provider: "environment", card_ref: input.cardRef, comment_ref: input.commentRef, deleted_content_sha256: input.expectedSha256,
      readback_status: "confirmed_absent", guarantees: { tracker_writes_performed: true, secrets_exposed: false }
    };
  }

  if (action === "write-readback") {
    if (!input.textPath) throw new Error("textPath é obrigatório para escrita.");
    const textPath = containedPath(projectRoot, resolve(projectRoot, input.textPath), "textPath");
    const text = readFileSync(textPath, "utf8");
    if (!text.trim()) throw new Error("O comentário não pode ser vazio.");
    if (unsafeEncoding(text)) throw new Error("O comentário contém sinais de codificação corrompida.");
    const body = new URLSearchParams({ key: credentials.key, token: credentials.token, text });
    const writeResponse = await safeFetch(fetchImpl, `${API_ROOT}/cards/${encodeURIComponent(input.cardRef)}/actions/comments`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body
    }, "a escrita do comentário");
    const written = await responseJson(writeResponse, "a escrita do comentário");
    const readResponse = await safeFetch(fetchImpl, endpoint(`/actions/${encodeURIComponent(written.id)}`, credentials), undefined, "a releitura do comentário");
    const persisted = await responseJson(readResponse, "a releitura do comentário");
    const persistedText = persisted.data?.text;
    if (persisted.data?.card?.id !== input.cardRef || persistedText !== text || unsafeEncoding(persistedText ?? "")) {
      return {
        contract_version: "0.1",
        tool: { name: "pipeline-trello-comments", version: PACKAGE.version },
        status: "FAIL",
        action,
        provider: "environment",
        card_ref: input.cardRef,
        comment_ref: written.id,
        diagnostic: { code: "TRACKER_COMMENT_READBACK_FAILED" },
        guarantees: { tracker_writes_performed: true, secrets_exposed: false }
      };
    }
    return {
      contract_version: "0.1",
      tool: { name: "pipeline-trello-comments", version: PACKAGE.version },
      status: "PASS",
      action,
      provider: "environment",
      card_ref: input.cardRef,
      comment_ref: persisted.id,
      written_at: written.date,
      read_at: new Date(input.now ?? Date.now()).toISOString(),
      content_sha256: createHash("sha256").update(text, "utf8").digest("hex"),
      readback_status: "confirmed",
      encoding: "utf-8",
      guarantees: { tracker_writes_performed: true, secrets_exposed: false }
    };
  }

  throw new Error(`Ação inválida: ${action ?? "ausente"}.`);
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
      if (argument === "--action") options.action = value;
      else if (argument === "--project-root") options.projectRoot = value;
      else if (argument === "--adapter") options.adapterPath = value;
      else if (argument === "--card-ref") options.cardRef = value;
      else if (argument === "--comment-ref") options.commentRef = value;
      else if (argument === "--attachment-ref") options.attachmentRef = value;
      else if (argument === "--expected-name") options.expectedName = value;
      else if (argument === "--list-ref") options.listRef = value;
      else if (argument === "--text-file") options.textPath = value;
      else if (argument === "--name-file") options.namePath = value;
      else if (argument === "--description-file") options.descriptionPath = value;
      else if (argument === "--expected-sha256") options.expectedSha256 = value;
      else if (argument === "--label-refs") options.labelRefs = value.split(",").map((item) => item.trim()).filter(Boolean);
      else if (argument === "--output") options.outputPath = value;
      else if (argument === "--file") options.filePath = value;
      else if (argument === "--url") options.url = value;
      else if (argument === "--name") options.name = value;
      else if (argument === "--set-cover") options.setCover = value === "true";
      else if (argument === "--limit") options.limit = Number(value);
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
    if (options.help) {
      process.stdout.write("Uso: pipeline.ps1 trello --action snapshot|list-card-names|list|read|read-card|update-card-readback|update-labels-readback|write-readback|delete-comment-readback|move-readback|list-attachments|attach-file|attach-url|delete-attachment-readback --project-root <path> [opções]\n");
    } else {
      const result = await executeTrelloComment(options);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.status === "PASS" ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`pipeline-trello-comments: ${error.message}\n`);
    process.exitCode = 2;
  }
}
