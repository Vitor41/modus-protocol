#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";
import Ajv2020 from "ajv/dist/2020.js";

import { runDoctor } from "./doctor.mjs";
import { resolveExecutionProfile } from "./execution-profiles.mjs";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(SOURCE_DIR, "..");
const PACKAGE = JSON.parse(readFileSync(join(RUNTIME_DIR, "package.json"), "utf8"));
const REPOSITORY_DIR = resolve(RUNTIME_DIR, "..");
const STATE_PRIORITY = {
  ready_for_release: 0,
  ready_for_validation: 1,
  in_development: 2,
  ready_for_development: 3,
  ux_ui: 4,
  refinement: 5
};
const HUMAN_GATE_KINDS = new Set([
  "business_rule",
  "screen_approval",
  "production_approval",
  "loop_limit",
  "structural_scope",
  "systemic_risk",
  "external_authorization"
]);
const RECOVERY_POLICY = {
  mode: "specialist-autonomy-v0.2",
  tracker_read_attempts: 3,
  role_launch_attempts: 2,
  handoff_repair_attempts: 1,
  technical_failures_require_human: false,
  continue_independent_lanes: true,
  human_gate_kinds: [...HUMAN_GATE_KINDS]
};

function parseDataFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} não encontrado: ${path}`);
  const document = YAML.parseDocument(readFileSync(path, "utf8"), { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(`${label} possui YAML/JSON inválido.`);
  return document.toJS({ mapAsMap: false });
}

function runId(now, uuid) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `RUN-${date}-${uuid.slice(0, 8).toUpperCase()}`;
}

function validRunId(value) {
  return /^RUN-[0-9]{8}-[A-Z0-9]{8}$/u.test(String(value ?? ""));
}

function matchesCardKey(adapter, key) {
  return adapter.tracker.card_keys.some((item) => new RegExp(item.pattern).test(key));
}

function routeCard(state, signals = {}) {
  if (signals.pending_transition === true && signals.pending_transition_from === state) {
    return {
      skill: "pipeline-run",
      action: "reconcile-transition",
      profile: "RAPIDO",
      execution_kind: "operational",
      transition_evidence_ref: signals.pending_transition_evidence_ref,
      transition_run_id: signals.pending_transition_run_id,
      transition_role: signals.pending_transition_role,
      target_state: signals.pending_transition_to
    };
  }
  if (state === "refinement") return { skill: "pipeline-po", action: "refine", profile: "PROFUNDO" };
  if (state === "ux_ui") {
    return {
      skill: "pipeline-ux-ui",
      action: signals.screen_approval_valid === true ? "handoff-approved-design" : "classify-or-design",
      profile: "PROFUNDO"
    };
  }
  if (state === "ready_for_development") {
    return { skill: "pipeline-dev", action: "implement", profile: "EQUILIBRADO" };
  }
  if (state === "in_development") {
    if (signals.business_question === true) {
      return { skill: "pipeline-po", action: "resolve-business-question", profile: "PROFUNDO" };
    }
    if (signals.implementation_complete === true && signals.review_approved !== true) {
      return { skill: "pipeline-code-review", action: "review", profile: "PROFUNDO" };
    }
    if (signals.implementation_complete === true && signals.review_approved === true) {
      return { skill: "pipeline-dev", action: "handoff-to-validation", profile: "RAPIDO" };
    }
    return { skill: "pipeline-dev", action: "implement-or-correct", profile: "EQUILIBRADO" };
  }
  if (state === "ready_for_validation") {
    return { skill: "pipeline-qa", action: "validate", profile: "EQUILIBRADO" };
  }
  if (state === "ready_for_release" && signals.production_approval_valid === true) {
    return { skill: "pipeline-dev", action: "prepare-release", profile: "EQUILIBRADO" };
  }
  return undefined;
}

function withExecutionRequest(route) {
  return route.execution_kind === "operational" ? route : { ...route, execution_request: resolveExecutionProfile(route.profile, route.skill) };
}

function blockedReason(card, state, { ignoredLockRunId } = {}) {
  const gateResolved =
    (state === "ux_ui" && card.signals?.screen_approval_valid === true) ||
    (state === "ready_for_release" && card.signals?.production_approval_valid === true);
  if (state === "ux_ui" && card.signals?.screen_approval_required === true) return "SCREEN_APPROVAL_REQUIRED";
  if (card.signals?.awaiting_human === true && !gateResolved && HUMAN_GATE_KINDS.has(card.signals?.human_gate_kind)) {
    return `HUMAN_GATE_${card.signals.human_gate_kind.toUpperCase()}`;
  }
  if (card.lock?.status === "active" && card.lock.run_id !== ignoredLockRunId && (!card.lock.state || card.lock.state === state)) return "ACTIVE_LOCK";
  if (card.loop_state === state && Object.values(card.loop_counts ?? {}).some((count) => Number(count) >= 3)) return "LOOP_LIMIT_REACHED";
  if (state === "ideas") return "HUMAN_TRIAGE_REQUIRED";
  if (state === "ready_for_release" && card.signals?.production_approval_valid !== true) {
    return "PRODUCTION_APPROVAL_REQUIRED";
  }
  if (state === "ready_for_production" || state === "done") return "OUTSIDE_DEVELOPMENT_AUTOMATION";
  return undefined;
}

function isTerminalState(state) {
  return state === "ready_for_production" || state === "done";
}

function deliveryGroups(snapshot, cardsByKey) {
  const groups = new Map();
  for (const group of snapshot.delivery_groups ?? []) groups.set(group.id, group);
  for (const card of cardsByKey.values()) {
    if (card.delivery_group) groups.set(card.delivery_group.id, card.delivery_group);
  }
  return groups;
}

function groupBlockers(groups, cardsByKey, baseBlocked) {
  const blocked = new Map();
  for (const group of groups.values()) {
    const members = group.cards.map((key) => cardsByKey.get(key));
    if (members.some((member) => !member)) {
      blocked.set(group.id, { reason: "DELIVERY_GROUP_INCOMPLETE", scope: "delivery_group" });
      continue;
    }
    for (const dependencyId of group.depends_on ?? []) {
      const dependency = groups.get(dependencyId);
      const dependencyMembers = dependency?.cards.map((key) => cardsByKey.get(key));
      if (!dependency || dependencyMembers.some((member) => !member)) {
        blocked.set(group.id, { reason: "DELIVERY_GROUP_DEPENDENCY_UNKNOWN", scope: "dependency_group", dependency_group_id: dependencyId });
        break;
      }
      if (!dependencyMembers.every((member) => isTerminalState(member.state))) {
        blocked.set(group.id, { reason: "DELIVERY_GROUP_DEPENDENCY_PENDING", scope: "dependency_group", dependency_group_id: dependencyId });
        break;
      }
    }
    if (blocked.has(group.id)) continue;
    if (group.mode === "dependency") {
      const source = members.find((member) => baseBlocked.has(member.card_ref));
      if (source) blocked.set(group.id, { reason: "DELIVERY_GROUP_MEMBER_BLOCKED", scope: "delivery_group", blocked_card_ref: source.card_ref });
    }
  }
  return blocked;
}

export function planRun(input = {}) {
  const projectRoot = resolve(input.projectRoot ?? process.cwd());
  const adapterPath = resolve(input.adapterPath ?? join(projectRoot, ".pipeline", "project.adapter.yaml"));
  if (!input.trackerSnapshotPath) throw new Error("trackerSnapshotPath é obrigatório.");
  const trackerSnapshotPath = resolve(input.trackerSnapshotPath);
  const trackerSchemaPath = resolve(
    input.trackerSchemaPath ?? join(REPOSITORY_DIR, "schema", "tracker-snapshot.schema.json")
  );
  const mode = input.mode ?? "shadow";
  if (!["shadow", "live"].includes(mode)) throw new Error(`Modo inválido: ${mode}`);
  if (input.continueRunId && !validRunId(input.continueRunId)) throw new Error("continueRunId possui formato inválido.");

  const doctor = runDoctor({
    projectRoot,
    adapterPath,
    trackerSnapshotPath,
    schemaPath: input.schemaPath,
    mode: mode === "live" ? "cutover" : "shadow"
  });
  const guarantees = {
    project_files_written: false,
    commands_executed: false,
    tracker_writes_performed: false,
    role_executed: false,
    transition_gate_required: true
  };
  if (doctor.status === "FAIL") {
    return {
      contract_version: "0.1",
      tool: { name: "pipeline-run-planner", version: PACKAGE.version },
      mode,
      status: "BLOCKED",
      reason: "DOCTOR_FAILED",
      doctor,
      recovery_policy: RECOVERY_POLICY,
      guarantees
    };
  }

  const adapter = parseDataFile(adapterPath, "Adapter");
  const snapshot = parseDataFile(trackerSnapshotPath, "Snapshot do tracker");
  const trackerSchema = parseDataFile(trackerSchemaPath, "Schema do snapshot");
  const validateSnapshot = new Ajv2020({ allErrors: true, strict: false }).compile(trackerSchema);
  if (!validateSnapshot(snapshot)) {
    return {
      contract_version: "0.1",
      tool: { name: "pipeline-run-planner", version: PACKAGE.version },
      mode,
      status: "BLOCKED",
      reason: "TRACKER_SNAPSHOT_SCHEMA_INVALID",
      snapshot_errors: (validateSnapshot.errors ?? []).map((error) => ({
        path: error.instancePath || "$",
        message: error.message
      })),
      doctor,
      recovery_policy: RECOVERY_POLICY,
      guarantees
    };
  }
  const commentGate = {
    required_events: adapter.tracker.comments.required_events,
    verify_after_write: adapter.tracker.comments.verify_after_write,
    transition_requires_verified_comment: adapter.tracker.comments.transition_requires_verified_comment,
    read_provider: snapshot.integration.comments.read_provider,
    write_provider: snapshot.integration.comments.write_provider,
    capability_evidence_ref: snapshot.integration.comments.evidence_ref,
    capability_verified_at: snapshot.integration.comments.verified_at
  };
  const actionableListRefs = new Set(["refinement", "ux_ui", "ready_for_development", "in_development", "ready_for_validation", "ready_for_release"].map((state) => adapter.tracker.states[state]));
  const expectedObservedRefs = (snapshot.cards ?? []).filter((card) => actionableListRefs.has(card.list_ref)).map((card) => card.ref).sort();
  const observation = snapshot.integration.comments.observation;
  const actualObservedRefs = [...(observation?.card_refs ?? [])].sort();
  const contentReadRefs = [...(observation?.content_read_card_refs ?? [])].sort();
  const observationComplete =
    observation?.scope === "all-actionable-cards" &&
    expectedObservedRefs.length === actualObservedRefs.length &&
    expectedObservedRefs.every((ref, index) => ref === actualObservedRefs[index]) &&
    expectedObservedRefs.length === contentReadRefs.length &&
    expectedObservedRefs.every((ref, index) => ref === contentReadRefs[index]) &&
    (snapshot.cards ?? []).filter((card) => actionableListRefs.has(card.list_ref))
      .every((card) => card.signals?.observed_list_ref === card.list_ref && card.signals?.observed_at === observation.observed_at && card.signals?.comment_content_reconciled === true);
  guarantees.all_actionable_cards_refreshed = observationComplete;
  guarantees.comment_content_reconciled = observationComplete;
  if (observation?.observed_at) guarantees.snapshot_observed_at = observation.observed_at;
  if (mode === "live" && !observationComplete) {
    return {
      contract_version: "0.1",
      tool: { name: "pipeline-run-planner", version: PACKAGE.version },
      mode,
      status: "BLOCKED",
      reason: "TRACKER_SNAPSHOT_COVERAGE_INCOMPLETE",
      expected_card_refs: expectedObservedRefs,
      observed_card_refs: actualObservedRefs,
      doctor,
      recovery_policy: RECOVERY_POLICY,
      guarantees
    };
  }
  if (snapshot.active_execution?.status === "active" && snapshot.active_execution.architecture === "legacy") {
    return {
      contract_version: "0.1",
      tool: { name: "pipeline-run-planner", version: PACKAGE.version },
      mode,
      status: "BLOCKED",
      reason: "LEGACY_EXECUTION_ACTIVE",
      doctor,
      recovery_policy: RECOVERY_POLICY,
      guarantees
    };
  }

  const stateByList = new Map(Object.entries(adapter.tracker.states).map(([state, ref]) => [ref, state]));
  const activeExecution = snapshot.active_execution?.status === "active" ? snapshot.active_execution : undefined;
  let ignoredLockRunId;
  let continuationRunId = input.continueRunId;
  let resumableCardRef;
  if (activeExecution?.architecture === "unified") {
    const activeCard = snapshot.cards.find((card) => card.ref === activeExecution.card_ref);
    const activeState = activeCard ? stateByList.get(activeCard.list_ref) : undefined;
    const activeRouteCandidate = activeState ? routeCard(activeState, activeCard.signals) : undefined;
    const activeRoute = activeRouteCandidate ? withExecutionRequest(activeRouteCandidate) : undefined;
    const resumeConsistent =
      activeExecution.capsule_present === true &&
      activeCard?.lock?.status === "active" &&
      activeCard.lock.run_id === activeExecution.run_id &&
      activeState === activeExecution.state &&
      activeRoute?.skill === activeExecution.role;
    continuationRunId ??= activeExecution.run_id;
    ignoredLockRunId = activeExecution.run_id;
    if (resumeConsistent) resumableCardRef = activeCard.ref;
    guarantees.stale_execution_reconciled = true;
  }

  const candidates = [];
  const blocked = [];
  const baseBlocked = new Map();
  const cardsByKey = new Map();
  for (const [index, card] of (snapshot.cards ?? []).entries()) {
    const state = stateByList.get(card.list_ref);
    if (!state) {
      blocked.push({ card_ref: card.ref, key: card.key, reason: "CARD_LIST_UNKNOWN" });
      continue;
    }
    if (!card.ref || !Number.isFinite(card.position)) {
      blocked.push({ card_ref: card.ref, key: card.key, reason: "CARD_SNAPSHOT_INCOMPLETE" });
      continue;
    }
    if (state !== "refinement" && !card.key) {
      blocked.push({ card_ref: card.ref, reason: "CARD_KEY_MISSING" });
      continue;
    }
    if (state !== "refinement" && !matchesCardKey(adapter, card.key)) {
      blocked.push({ card_ref: card.ref, key: card.key, reason: "CARD_KEY_INVALID" });
      continue;
    }
    const candidate = {
      card_ref: card.ref,
      key: card.key,
      title: card.title ?? basename(card.ref),
      position: card.position,
      snapshot_index: index,
      state,
      ...(card.delivery_group ? { delivery_group: card.delivery_group } : {})
    };
    if (candidate.key) cardsByKey.set(candidate.key, candidate);
    const reason = blockedReason(card, state, { ignoredLockRunId });
    if (reason) {
      baseBlocked.set(candidate.card_ref, reason);
      continue;
    }
    const routeCandidate = routeCard(state, card.signals);
    const route = routeCandidate ? withExecutionRequest(routeCandidate) : undefined;
    if (!route) {
      baseBlocked.set(candidate.card_ref, "NO_AUTOMATIC_ROUTE");
      continue;
    }
    candidates.push({ ...candidate, ...route });
  }

  const groups = deliveryGroups(snapshot, cardsByKey);
  const groupBlocked = groupBlockers(groups, cardsByKey, baseBlocked);
  const eligible = [];
  for (const candidate of candidates) {
    const groupBlock = candidate.delivery_group ? groupBlocked.get(candidate.delivery_group.id) : undefined;
    const reason = groupBlock?.reason ?? baseBlocked.get(candidate.card_ref);
    if (reason) {
      blocked.push({
        card_ref: candidate.card_ref,
        key: candidate.key,
        state: candidate.state,
        reason,
        ...(groupBlock ? { block_scope: groupBlock.scope, delivery_group_id: candidate.delivery_group.id, ...(groupBlock.dependency_group_id ? { dependency_group_id: groupBlock.dependency_group_id } : {}) } : { block_scope: "card" })
      });
      continue;
    }
    eligible.push(candidate);
  }
  for (const [cardRef, reason] of baseBlocked) {
    const card = [...cardsByKey.values()].find((item) => item.card_ref === cardRef);
    const groupBlock = card?.delivery_group ? groupBlocked.get(card.delivery_group.id) : undefined;
    if (card && !blocked.some((item) => item.card_ref === cardRef)) {
      blocked.push({
        card_ref: cardRef,
        key: card.key,
        state: card.state,
        reason: groupBlock?.reason ?? reason,
        ...(groupBlock
          ? { block_scope: groupBlock.scope, delivery_group_id: card.delivery_group.id, ...(groupBlock.dependency_group_id ? { dependency_group_id: groupBlock.dependency_group_id } : {}) }
          : { block_scope: "card" })
      });
    }
  }

  eligible.sort(
    (left, right) =>
      STATE_PRIORITY[left.state] - STATE_PRIORITY[right.state] ||
      left.position - right.position ||
      (left.key ?? left.card_ref).localeCompare(right.key ?? right.card_ref)
  );

  if (eligible.length === 0) {
    return {
      contract_version: "0.1",
      tool: { name: "pipeline-run-planner", version: PACKAGE.version },
      mode,
      status: "EMPTY",
      batch_policy: "single-card-v0.2",
      doctor,
      blocked,
      recovery_policy: RECOVERY_POLICY,
      guarantees
    };
  }

  const id = continuationRunId ?? runId(input.now ?? new Date(), input.uuid ?? randomUUID());
  const allByKey = new Map([...cardsByKey.values()].map((card) => [card.key, card]));
  const eligibleByKey = new Map(eligible.map((card) => [card.key, card]));
  const continuationPolicy = {
    mode: "drain-independent-work-v0.2",
    preserve_run_id: true,
    continue_after_role_handoff: true,
    defer_on: ["human_decision", "screen_approval", "production_approval", "loop_limit", "external_lock", "gate_failure", "tool_failure"],
    stop_on: ["queue_complete"]
  };
  function materializeJob(seed, lane) {
    const declaredGroup = adapter.batching?.mode === "cohesive-delivery" ? seed.delivery_group : undefined;
    let batchMembers = [seed];
    if (lane === "po" && seed.execution_kind !== "operational") batchMembers = eligible.filter((card) => card.state === "refinement" && card.execution_kind !== "operational");
    else if (declaredGroup) {
      if (declaredGroup.defined_by !== "pipeline-po") return { error: { reason: "DELIVERY_GROUP_AUTHORITY_INVALID", delivery_group: declaredGroup.id } };
      if (declaredGroup.cards.length > adapter.batching.max_cards) return { error: { reason: "DELIVERY_GROUP_TOO_LARGE", delivery_group: declaredGroup.id } };
      const missing = declaredGroup.cards.filter((key) => !allByKey.has(key));
      const inconsistent = declaredGroup.cards.map((key) => allByKey.get(key)).filter(Boolean).filter((card) => card.delivery_group?.id !== declaredGroup.id || card.delivery_group?.defined_by !== "pipeline-po" || JSON.stringify(card.delivery_group.cards) !== JSON.stringify(declaredGroup.cards));
      if (missing.length || inconsistent.length) return { error: { reason: "DELIVERY_GROUP_INCOMPLETE", delivery_group: declaredGroup.id, missing_cards: missing, inconsistent_cards: inconsistent.map((card) => card.key) } };
      const sameWork = declaredGroup.cards.map((key) => eligibleByKey.get(key)).filter((card) => card && card.state === seed.state && card.skill === seed.skill && card.action === seed.action);
      if (declaredGroup.mode === "dependency" && sameWork.length !== declaredGroup.cards.length) return { error: { reason: "DELIVERY_GROUP_STATE_DIVERGED", delivery_group: declaredGroup.id } };
      if (sameWork.length >= 2) batchMembers = sameWork;
    }
    const cleanMembers = batchMembers.map(({ snapshot_index, ...card }) => card);
    const resumable = batchMembers.some((card) => card.card_ref === resumableCardRef);
    const unitPolicy = seed.execution_kind === "operational" ? "operational-reconciliation-v0.2" : lane === "po" ? "refinement-queue-v0.2" : declaredGroup && batchMembers.length >= 2 ? "cohesive-delivery-v0.2" : "single-card-v0.2";
    const job = {
      lane,
      unit_policy: unitPolicy,
      ...seed,
      continuation_policy: continuationPolicy,
      ...(lane === "po" && seed.execution_kind !== "operational" ? {
        refinement_queue: { scope: "all-eligible-refinement-cards", cards: cleanMembers, blocked_cards: blocked.filter((card) => card.state === "refinement") }
      } : {}),
      ...(declaredGroup ? {
        delivery_group: { id: declaredGroup.id, branch: declaredGroup.branch, mode: declaredGroup.mode, ...(declaredGroup.depends_on?.length ? { depends_on: declaredGroup.depends_on } : {}), cards: cleanMembers },
        card_refs: batchMembers.map((card) => card.card_ref)
      } : lane === "po" ? { card_refs: batchMembers.map((card) => card.card_ref) } : {}),
      comment_gate: commentGate,
      ...(seed.execution_kind === "operational" ? {
        capsule_action: "reuse-existing-evidence"
      } : { lock_proposal: resumable && seed.card_ref === resumableCardRef
        ? { ...snapshot.cards.find((card) => card.ref === seed.card_ref)?.lock }
        : { run_id: id, card_ref: seed.card_ref, state: seed.state, role: seed.skill, status: "active" },
        lock_proposals: batchMembers.map((card) => ({ run_id: id, card_ref: card.card_ref, state: card.state, role: card.skill, status: "active" })),
        capsule_action: resumable ? "resume-existing" : "create",
        capsule_seed: {
        run_id: id,
        cards: batchMembers.map((card) => card.key ?? card.card_ref),
        state: seed.state,
        role: seed.skill,
        objective: seed.title,
        decisions: [], evidence: [], risks: [], next_step: seed.action,
        sources: ["project.adapter.yaml", "tracker-snapshot"]
      } })
    };
    return { job, memberRefs: batchMembers.map((card) => card.card_ref) };
  }

  const technicalInFlightStates = new Set(["in_development", "ready_for_validation", "ready_for_release"]);
  const technicalOccupied = snapshot.cards.some((card) => technicalInFlightStates.has(stateByList.get(card.list_ref)));
  const technicalSeed = technicalOccupied
    ? eligible.find((card) => technicalInFlightStates.has(card.state))
    : eligible.find((card) => card.state === "ready_for_development");
  const uxSeed = eligible.find((card) => card.state === "ux_ui");
  const poSeed = technicalSeed?.skill === "pipeline-po" ? undefined : eligible.find((card) => card.state === "refinement");
  const seeds = [["technical", technicalSeed], ["ux_ui", uxSeed], ["po", poSeed]].filter(([, seed]) => seed);
  const workSlots = [];
  const scheduledRefs = new Set();
  for (const [lane, seed] of seeds) {
    const materialized = materializeJob(seed, lane === "ux_ui" ? "ux_ui" : lane);
    if (materialized.error) return { contract_version: "0.2", tool: { name: "pipeline-run-planner", version: PACKAGE.version }, mode, status: "BLOCKED", ...materialized.error, doctor, blocked, recovery_policy: RECOVERY_POLICY, guarantees };
    workSlots.push(materialized.job);
    for (const ref of materialized.memberRefs) scheduledRefs.add(ref);
  }
  if (workSlots.length === 0) {
    const deferred = eligible.map(({ snapshot_index, ...card }) => ({ ...card, reason: card.state === "ready_for_development" && technicalOccupied ? "TECHNICAL_WIP_LIMIT" : "LANE_CAPACITY" }));
    return {
      contract_version: "0.2", tool: { name: "pipeline-run-planner", version: PACKAGE.version }, mode,
      status: "EMPTY", batch_policy: "upstream-concurrency-technical-wip1-v0.2", doctor, blocked, deferred, recovery_policy: RECOVERY_POLICY, guarantees
    };
  }
  const selected = workSlots[0];
  const deferred = eligible.filter((card) => !scheduledRefs.has(card.card_ref)).map(({ snapshot_index, ...card }) => ({
    ...card,
    reason: card.state === "ready_for_development" && technicalOccupied ? "TECHNICAL_WIP_LIMIT" : "LANE_CAPACITY"
  }));
  return {
    contract_version: "0.2",
    tool: { name: "pipeline-run-planner", version: PACKAGE.version },
    mode,
    status: "READY",
    batch_policy: "upstream-concurrency-technical-wip1-v0.2",
    schedule: {
      policy: "upstream-concurrency-technical-wip1-v0.2",
      launch_strategy: "parallel-when-independent",
      capacities: { po: 1, ux_ui: 1, technical: 1 },
      technical_wip: { limit: 1, states: ["ready_for_development", "in_development", "ready_for_validation", "ready_for_release"] },
      completion: "drain-all-eligible-work-before-stop"
    },
    recovery_policy: RECOVERY_POLICY,
    doctor,
    run_id: id,
    continuing: Boolean(continuationRunId),
    resuming: Boolean(resumableCardRef),
    selected,
    work_slots: workSlots,
    deferred,
    blocked,
    apply_required: mode === "live",
    guarantees
  };
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
      if (argument === "--project-root") options.projectRoot = value;
      else if (argument === "--adapter") options.adapterPath = value;
      else if (argument === "--tracker-snapshot") options.trackerSnapshotPath = value;
      else if (argument === "--continue-run-id") options.continueRunId = value;
      else if (argument === "--schema") options.schemaPath = value;
      else if (argument === "--tracker-schema") options.trackerSchemaPath = value;
      else if (argument === "--mode") options.mode = value;
      else if (argument === "--format") options.format = value;
      else throw new Error(`Argumento desconhecido: ${argument}`);
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write(
    "Uso: node runtime/src/run-planner.mjs --project-root <path> --tracker-snapshot <path> [--continue-run-id <RUN_ID>] [--mode shadow|live] [--format text|json]\n"
  );
}

function printText(result) {
  process.stdout.write(`pipeline-run-planner ${result.tool.version} | ${result.mode} | ${result.status}\n`);
  if (result.reason) process.stdout.write(`motivo=${result.reason}\n`);
  if (result.selected) {
    process.stdout.write(
      `run_id=${result.run_id} cards=${result.selected.delivery_group?.cards?.map((card) => card.key).join(",") ?? result.selected.key} estado=${result.selected.state} skill=${result.selected.skill} ação=${result.selected.action}\n` +
        (result.selected.execution_request
          ? `perfil=${result.selected.profile} modelo=${result.selected.execution_request.model} esforço=${result.selected.execution_request.reasoning_effort} modo_agente=${result.selected.execution_request.agent_mode}\n`
          : `tipo_execução=${result.selected.execution_kind}\n`)
    );
  }
  process.stdout.write(`bloqueados=${result.blocked?.length ?? 0} adiados=${result.deferred?.length ?? 0}\n`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) printHelp();
    else {
      if (!options.trackerSnapshotPath) throw new Error("--tracker-snapshot é obrigatório.");
      const format = options.format ?? "text";
      if (!["text", "json"].includes(format)) throw new Error(`Formato inválido: ${format}`);
      const result = planRun(options);
      if (format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else printText(result);
      process.exitCode = result.status === "BLOCKED" ? 1 : 0;
    }
  } catch (error) {
    process.stderr.write(`pipeline-run-planner: ${error.message}\n`);
    process.exitCode = 2;
  }
}
