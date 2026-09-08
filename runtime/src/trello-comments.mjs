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
const IDEMPOTENT_READ_ATTEMPTS = 3;
const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const HUMAN_GATE_KINDS = new Set([
  "business_rule",
  "screen_approval",
  "production_approval",
  "loop_limit",
  "structural_scope",
  "systemic_risk",
  "external_authorization"
]);

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
  const method = String(options?.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? IDEMPOTENT_READ_ATTEMPTS : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, options);
      if (attempt < attempts && TRANSIENT_HTTP_STATUS.has(response.status)) continue;
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
  }
  const cause = String(lastError?.message ?? lastError ?? "causa não informada").replace(/[\r\n]+/gu, " ").slice(0, 240);
  throw new Error(`Falha de acesso ao Trello durante ${operation} após ${attempts} tentativas de leitura: ${cause}`);
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

function chronological(values) {
  return [...values].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function after(values, instant) {
  return instant ? values.filter((value) => String(value.date) >= instant) : values;
}

function latestDate(values, predicate = () => true) {
  return chronological(values).filter(predicate).at(-1)?.date;
}

function latestExactDate(comments, exact) {
  return latestDate(comments, (comment) => String(comment.text ?? "").trim() === exact);
}

function latestCommentObservation(comments, gate) {
  const latest = chronological(comments).at(-1);
  if (!latest) return {};
  const text = String(latest.text ?? "").trim();
  const role = structuredField(text, "ROLE")?.toLowerCase();
  let humanSignal;
  if (text === (gate.screen_approval ?? "Tela aprovada")) humanSignal = "screen_approval";
  else if (text === (gate.production_approval ?? "APROVADO PARA PRD")) humanSignal = "production_approval";
  else if (gate.unblock_prefix && text.startsWith(gate.unblock_prefix)) humanSignal = "block_resolved";
  return {
    latest_comment_ref: latest.ref,
    latest_comment_at: latest.date,
    latest_comment_actor: role?.startsWith("pipeline-") ? "pipeline" : "human_candidate",
    ...(humanSignal ? { latest_human_signal: humanSignal } : {})
  };
}

function stateEntryDate(actions, listRef) {
  return latestDate(actions, (action) => action.type === "updateCard" && action.data?.listAfter?.id === listRef);
}

function structuredField(text, name) {
  return text.match(new RegExp(`^${name}:\\s*(.+)$`, "imu"))?.[1]?.trim();
}

function lockState(comments, enteredAt) {
  const phaseComments = chronological(after(comments, enteredAt));
  const locks = phaseComments.filter((comment) => /^CODEX LOCK(?:\s|\u2014|-|$)/iu.test(String(comment.text ?? "").trim()));
  const latest = locks.at(-1);
  if (!latest) return undefined;

  const text = String(latest.text ?? "");
  const runId = structuredField(text, "RUN_ID");
  const rawStatus = structuredField(text, "STATUS")?.toLowerCase();
  if (!runId || !["active", "released", "blocked", "completed"].includes(rawStatus)) return undefined;

  let status = rawStatus === "completed" ? "released" : rawStatus;
  let updatedAt = latest.date;
  if (status === "active") {
    const role = structuredField(text, "ROLE")?.toLowerCase();
    const terminal = phaseComments.find((comment) => {
      if (String(comment.date) <= String(latest.date)) return false;
      const terminalText = String(comment.text ?? "");
      if (structuredField(terminalText, "RUN_ID") !== runId) return false;
      if (role && structuredField(terminalText, "ROLE")?.toLowerCase() !== role) return false;
      return /^(?:VERDICT|STATUS):\s*(?:PASS|APPROVED|COMPLETED|RETURN|REJECTED|CHANGES_REQUIRED|BLOCKED)\b/imu.test(terminalText);
    });
    if (terminal) {
      status = /^(?:VERDICT|STATUS):\s*BLOCKED\b/imu.test(String(terminal.text ?? "")) ? "blocked" : "released";
      updatedAt = terminal.date;
    }
  }

  return {
    run_id: runId,
    status,
    ...(structuredField(text, "ROLE") ? { role: structuredField(text, "ROLE").toLowerCase() } : {}),
    ...(structuredField(text, "STATE") ? { state: structuredField(text, "STATE").toLowerCase() } : {}),
    ...(updatedAt ? { updated_at: updatedAt } : {})
  };
}

function structuredHumanBlock(text, state) {
  if (!/^STATUS:\s*blocked\s*$/imu.test(text) || !/^REQUIRES_HUMAN:\s*true\s*$/imu.test(text)) return undefined;
  const role = structuredField(text, "ROLE")?.toLowerCase();
  const kind = structuredField(text, "(?:BLOCKER_KIND|BLOCK_KIND|HUMAN_GATE)")?.toLowerCase().replaceAll("-", "_");
  if (HUMAN_GATE_KINDS.has(kind)) return kind;

  // Compatibilidade apenas para comentários antigos semanticamente explícitos.
  // O nome do papel, sozinho, nunca transforma uma falha técnica em decisão humana.
  if (role === "pipeline-po" && state === "refinement" && /\b(?:regra de neg[oó]cio|decis[aã]o de neg[oó]cio|pergunta ao usu[aá]rio)\b/iu.test(text)) return "business_rule";
  if (role === "pipeline-ux-ui" && state === "ux_ui" && /\b(?:tela aprovada|aprova[cç][aã]o visual)\b/iu.test(text)) return "screen_approval";
  return undefined;
}

function humanWaitState(comments, { state, unblockPrefix, exactResolutions = [], exactResolutionKind } = {}) {
  let value = false;
  let kind;
  let waitAt;
  let resolutionAt;
  for (const comment of chronological(comments)) {
    const text = String(comment.text ?? "").trim();
    const blockKind = structuredHumanBlock(text, state);
    if (blockKind) {
      value = true;
      kind = blockKind;
      waitAt = comment.date;
    }
    const exactResolutionMatches = exactResolutions.includes(text) && (!kind || kind === exactResolutionKind);
    if ((unblockPrefix && text.startsWith(unblockPrefix)) || exactResolutionMatches) {
      value = false;
      kind = undefined;
      resolutionAt = comment.date;
    }
  }
  return { value, kind, waitAt, resolutionAt };
}

function transitionBoundaryComments(comments, enteredAt, windowMinutes = 15) {
  if (!enteredAt) return comments;
  const boundary = new Date(enteredAt).getTime() - windowMinutes * 60 * 1000;
  return comments.filter((comment) => new Date(comment.date).getTime() >= boundary);
}

function roleIs(text, role) {
  return structuredField(text, "ROLE")?.toLowerCase() === role;
}

function positiveVerdict(text) {
  return /^(?:VERDICT|STATUS):\s*(?:PASS|APPROVED|COMPLETED)\s*$/imu.test(text);
}

function transitionReadyVerdict(text) {
  return positiveVerdict(text) || /^STATUS:.*\b(?:RETURN|REJECTED|CHANGES_REQUIRED)\b.*$/imu.test(text);
}

function technicalProgress(comments, enteredAt, state) {
  if (state !== "in_development") return {};
  const boundaryComments = chronological(transitionBoundaryComments(comments, enteredAt));
  const devPasses = boundaryComments.filter((comment) => {
    const text = String(comment.text ?? "");
    const from = structuredField(text, "STATE_FROM")?.toLowerCase();
    const to = structuredField(text, "STATE_TO")?.toLowerCase();
    const events = structuredField(text, "(?:EVENT|EVENTS)")?.toLowerCase() ?? "";
    const structuredTransition = ["ready_for_development", "in_development"].includes(from) && to === "in_development" &&
      events.includes("role_handoff") && (from === "in_development" || events.includes("transition"));
    return roleIs(text, "pipeline-dev") && positiveVerdict(text) &&
      (structuredTransition ||
       /^TRANSITION:\s*ready_for_development\s*->\s*in_development\.?\s*$/imu.test(text) ||
       /^NEXT STEP:\s*Code Review independente\.?\s*$/imu.test(text) ||
       /^NEXT_ROLE:\s*pipeline-code-review\s*$/imu.test(text));
  });
  const devPass = devPasses.at(-1);
  if (!devPass) return { implementation_complete: false, review_approved: false };
  const reviews = boundaryComments.filter((comment) => {
    const text = String(comment.text ?? "");
    const hasVerdict = positiveVerdict(text) || /^(?:VERDICT|STATUS):.*\b(?:FAIL|REJECTED|CHANGES_REQUIRED|BLOCKED|RETURN)\b.*$/imu.test(text);
    return String(comment.date) >= String(devPass.date) && roleIs(text, "pipeline-code-review") && hasVerdict;
  });
  const review = reviews.at(-1);
  const reviewApproved = review ? positiveVerdict(String(review.text ?? "")) : false;
  const reviewRejected = review ? /^(?:VERDICT|STATUS):.*\b(?:FAIL|REJECTED|CHANGES_REQUIRED|BLOCKED|RETURN)\b.*$/imu.test(String(review.text ?? "")) : false;
  return {
    implementation_complete: !reviewRejected,
    review_approved: reviewApproved,
    implementation_evidence_ref: devPass.ref,
    ...(review ? { review_evidence_ref: review.ref } : {})
  };
}

function pendingTransition(comments, state) {
  const handoffs = chronological(comments).filter((comment) => {
    const text = String(comment.text ?? "");
    const from = structuredField(text, "STATE_FROM")?.toLowerCase();
    const to = structuredField(text, "STATE_TO")?.toLowerCase();
    const role = structuredField(text, "ROLE")?.toLowerCase();
    return from === state && to && to !== state && ["pipeline-po", "pipeline-ux-ui", "pipeline-dev", "pipeline-code-review", "pipeline-qa"].includes(role) &&
      /^(?:EVENT|EVENTS):.*\btransition\b.*$/imu.test(text) && transitionReadyVerdict(text);
  });
  const handoff = handoffs.at(-1);
  if (!handoff) return {};
  const text = String(handoff.text ?? "");
  return {
    pending_transition: true,
    pending_transition_from: structuredField(text, "STATE_FROM").toLowerCase(),
    pending_transition_to: structuredField(text, "STATE_TO").toLowerCase(),
    pending_transition_role: structuredField(text, "ROLE").toLowerCase(),
    ...(structuredField(text, "RUN_ID") ? { pending_transition_run_id: structuredField(text, "RUN_ID") } : {}),
    pending_transition_evidence_ref: handoff.ref
  };
}

function visualAttachment(attachment) {
  const extension = extname(String(attachment.name ?? "")).toLowerCase();
  return [".html", ".png", ".jpg", ".jpeg", ".webp", ".pdf"].includes(extension);
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
    const eventEntries = await Promise.all(activeCards.map(async (card) => {
      const [actions, attachments] = await Promise.all([
        getJson(fetchImpl, credentials, `/cards/${encodeURIComponent(card.id)}/actions`, { filter: "commentCard,updateCard", limit: input.limit ?? 1000, memberCreator_fields: "fullName,username" }, "a leitura pontual do histórico do card"),
        getJson(fetchImpl, credentials, `/cards/${encodeURIComponent(card.id)}/attachments`, {}, "a leitura pontual dos anexos")
      ]);
      return [card.id, { actions, attachments }];
    }));
    const eventsByCard = new Map(eventEntries);
    const gate = adapter.tracker.human_gates ?? {};
    const observedAt = (input.now ?? new Date()).toISOString();
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
      const { actions = [], attachments = [] } = eventsByCard.get(card.id) ?? {};
      const enteredAt = stateEntryDate(actions, card.idList);
      const allComments = actions.filter((action) => action.type === "commentCard" || action.data?.text).map(publicComment);
      const comments = after(allComments, enteredAt);
      const phaseAttachments = after(attachments, enteredAt);
      const item = { ref: card.id, title: card.name, list_ref: card.idList, position: card.pos };
      const key = cardKey(card.name, adapter.tracker.card_keys);
      if (key) item.key = key;
      const group = deliveryGroup(comments, card.desc);
      if (group) {
        item.delivery_group = group;
        groupByCard.set(card.id, group);
      }
      const exactResolutions = [];
      const state = Object.entries(adapter.tracker.states).find(([, ref]) => ref === card.idList)?.[0];
      const exactResolutionKind = state === "ux_ui" ? "screen_approval" : state === "ready_for_release" ? "production_approval" : undefined;
      if (exactResolutionKind === "screen_approval") exactResolutions.push(gate.screen_approval ?? "Tela aprovada");
      if (exactResolutionKind === "production_approval") exactResolutions.push(gate.production_approval ?? "APROVADO PARA PRD");
      const wait = humanWaitState(comments, { state, unblockPrefix: gate.unblock_prefix, exactResolutions, exactResolutionKind });
      const progress = technicalProgress(allComments, enteredAt, state);
      const transition = pendingTransition(comments, state);
      const lock = lockState(allComments, enteredAt);
      const screenEvidenceAt = latestDate(phaseAttachments, visualAttachment);
      const screenApprovalAt = latestExactDate(comments, gate.screen_approval ?? "Tela aprovada");
      const productionApprovalAt = latestExactDate(comments, gate.production_approval ?? "APROVADO PARA PRD");
      const screenApprovalValid = Boolean(screenApprovalAt && (!screenEvidenceAt || screenApprovalAt > screenEvidenceAt));
      item.signals = {
        observed_list_ref: card.idList,
        observed_at: observedAt,
        ...(enteredAt ? { state_entered_at: enteredAt } : {}),
        awaiting_human: wait.value,
        ...(wait.kind ? { human_gate_kind: wait.kind } : {}),
        ...(wait.waitAt ? { human_wait_at: wait.waitAt } : {}),
        ...(wait.resolutionAt ? { human_resolution_at: wait.resolutionAt } : {}),
        screen_evidence_present: Boolean(screenEvidenceAt),
        screen_approval_required: card.idList === adapter.tracker.states.ux_ui && Boolean(screenEvidenceAt) && !screenApprovalValid,
        screen_approval_valid: screenApprovalValid,
        production_approval_valid: Boolean(productionApprovalAt),
        comment_content_reconciled: true,
        ...latestCommentObservation(comments, gate),
        ...progress,
        ...transition,
        ...(screenEvidenceAt ? { screen_evidence_at: screenEvidenceAt } : {}),
        ...(screenApprovalAt ? { screen_approval_at: screenApprovalAt } : {}),
        ...(productionApprovalAt ? { production_approval_at: productionApprovalAt } : {})
      };
      if (lock) item.lock = lock;
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
        observation: { scope: "all-actionable-cards", observed_at: observedAt, card_refs: activeCards.map((card) => card.id), content_read_card_refs: activeCards.map((card) => card.id) },
        ...(verified ? { evidence_ref: verification.comment_ref, verified_at: verification.verified_at } : {})
      }}
    };
    writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    return { contract_version: "0.1", tool: { name: "pipeline-trello", version: PACKAGE.version }, status: "PASS", action, board_ref: adapter.tracker.board_ref, output: relative(projectRoot, outputPath), counts: { lists: lists.length, cards: cards.length, hydrated_cards: activeCards.length, comments: eventEntries.reduce((sum, [, value]) => sum + value.actions.filter((action) => action.type === "commentCard" || action.data?.text).length, 0), attachments: eventEntries.reduce((sum, [, value]) => sum + value.attachments.length, 0) }, guarantees: { tracker_writes_performed: false, secrets_exposed: false, full_board_comment_scan: false, all_actionable_cards_refreshed: true, comment_content_reconciled: true, state_scoped_signals: true, observed_at: observedAt } };
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
    const persistedText = persisted.data?.text ?? "";
    return {
      contract_version: "0.1",
      tool: { name: "pipeline-trello-comments", version: PACKAGE.version },
      status: "PASS",
      action,
      provider: "environment",
      card_ref: input.cardRef,
      comment: publicComment(persisted),
      written_at: persisted.date,
      read_at: new Date(input.now ?? Date.now()).toISOString(),
      content_sha256: createHash("sha256").update(persistedText, "utf8").digest("hex"),
      readback_status: "confirmed",
      encoding: "utf-8",
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
