#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(SOURCE_DIR, "..");
const REPOSITORY_DIR = resolve(RUNTIME_DIR, "..");
const PACKAGE = JSON.parse(readFileSync(join(RUNTIME_DIR, "package.json"), "utf8"));
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_MS = 5 * 1000;

function parseData(path, label) {
  if (!existsSync(path)) throw new Error(`${label} não encontrado.`);
  const document = YAML.parseDocument(readFileSync(path, "utf8"), { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(`${label} possui YAML/JSON inválido.`);
  return document.toJS({ mapAsMap: false });
}

function diagnostic(diagnostics, code, path, message) {
  diagnostics.push({ code, severity: "error", path, message });
}

export function validateTransitionReceipt(input = {}) {
  if (!input.receiptPath) throw new Error("receiptPath é obrigatório.");
  if (!input.adapterPath) throw new Error("adapterPath é obrigatório.");
  const receiptPath = resolve(input.receiptPath);
  const adapterPath = resolve(input.adapterPath);
  const schemaPath = resolve(
    input.schemaPath ?? join(REPOSITORY_DIR, "schema", "tracker-transition-receipt.schema.json")
  );
  const receipt = parseData(receiptPath, "Recibo de transição");
  const adapter = parseData(adapterPath, "Adapter");
  const schema = parseData(schemaPath, "Schema de recibo de transição");
  const diagnostics = [];
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

  if (!validate(receipt)) {
    for (const error of validate.errors ?? []) {
      diagnostic(
        diagnostics,
        "TRANSITION_RECEIPT_SCHEMA_INVALID",
        error.instancePath || "$",
        `O recibo viola o schema: ${error.message}.`
      );
    }
  } else {
    if (receipt.role_gate_status !== "PASS") {
      diagnostic(diagnostics, "TRANSITION_ROLE_GATE_NOT_PASS", "role_gate_status", "O handoff não possui gate PASS.");
    }
    if (receipt.comment.readback_status !== "confirmed") {
      diagnostic(
        diagnostics,
        "TRANSITION_COMMENT_READBACK_UNCONFIRMED",
        "comment.readback_status",
        "O comentário não foi relido e confirmado."
      );
    }
    if (receipt.run_id !== receipt.comment.run_id || receipt.card_ref !== receipt.comment.card_ref) {
      diagnostic(
        diagnostics,
        "TRANSITION_COMMENT_LINK_MISMATCH",
        "comment",
        "O comentário não pertence ao mesmo RUN_ID e card do recibo."
      );
    }
    if (
      receipt.comment.read_provider !== adapter.tracker?.comments?.read_provider ||
      receipt.comment.write_provider !== adapter.tracker?.comments?.write_provider
    ) {
      diagnostic(
        diagnostics,
        "TRANSITION_COMMENT_PROVIDER_MISMATCH",
        "comment",
        "Os providers observados não correspondem aos declarados no adapter."
      );
    }
    if (receipt.transition.from === receipt.transition.to) {
      diagnostic(
        diagnostics,
        "TRANSITION_STATE_UNCHANGED",
        "transition",
        "Uma autorização de movimento exige estados de origem e destino diferentes."
      );
    }
    if (receipt.transition.from === "ready_for_release" && receipt.transition.to === "ready_for_production") {
      const git = receipt.git_integration;
      if (!git || git.checks_status !== "passed" || !["absent", "resolved"].includes(git.conflicts_status) || git.merge_status !== "merged") {
        diagnostic(diagnostics, "RELEASE_GIT_INTEGRATION_INCOMPLETE", "git_integration", "PRONTO PARA PRD exige push, PR, checks, conflitos tratados e merge confirmados.");
      }
    }

    const writtenAt = Date.parse(receipt.comment.written_at);
    const readAt = Date.parse(receipt.comment.read_at);
    const now = input.now instanceof Date ? input.now.getTime() : Date.now();
    const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const maxClockSkewMs = input.maxClockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
    const clockSkewMs = Number.isFinite(writtenAt) && Number.isFinite(readAt) ? Math.max(0, writtenAt - readAt) : undefined;
    if (!Number.isFinite(writtenAt) || !Number.isFinite(readAt) || clockSkewMs > maxClockSkewMs) {
      diagnostic(
        diagnostics,
        "TRANSITION_COMMENT_TIMESTAMPS_INVALID",
        "comment",
        "Os timestamps de escrita e releitura são inválidos ou estão fora de ordem."
      );
    } else if (Math.max(writtenAt, readAt) > now + maxClockSkewMs || now - Math.max(writtenAt, readAt) > maxAgeMs) {
      diagnostic(
        diagnostics,
        "TRANSITION_COMMENT_RECEIPT_STALE",
        "comment.read_at",
        "A confirmação do comentário está fora da janela válida para movimentação."
      );
    }
  }

  const status = diagnostics.length === 0 ? "PASS" : "FAIL";
  return {
    contract_version: "0.1",
    tool: { name: "pipeline-transition-gate", version: PACKAGE.version },
    status,
    authorization: status === "PASS" ? "GRANTED" : "DENIED",
    run_id: receipt.run_id,
    card_ref: receipt.card_ref,
    comment_ref: receipt.comment?.ref,
    transition: receipt.transition,
    diagnostics,
    guarantees: {
      tracker_writes_performed: false,
      ...(receipt.comment && Number.isFinite(Date.parse(receipt.comment.written_at)) && Number.isFinite(Date.parse(receipt.comment.read_at)) && Date.parse(receipt.comment.read_at) < Date.parse(receipt.comment.written_at)
        ? { clock_skew_reconciled: true, clock_skew_ms: Date.parse(receipt.comment.written_at) - Date.parse(receipt.comment.read_at) }
        : { clock_skew_reconciled: false })
    }
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
      if (argument === "--receipt") options.receiptPath = value;
      else if (argument === "--adapter") options.adapterPath = value;
      else if (argument === "--schema") options.schemaPath = value;
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
      process.stdout.write("Uso: node transition-gate.mjs --receipt <arquivo> --adapter <arquivo> [--format text|json]\n");
    } else {
      const result = validateTransitionReceipt(options);
      if ((options.format ?? "text") === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else process.stdout.write(`pipeline-transition-gate ${result.tool.version} | ${result.status} | ${result.authorization}\n`);
      process.exitCode = result.status === "PASS" ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`pipeline-transition-gate: ${error.message}\n`);
    process.exitCode = 2;
  }
}
