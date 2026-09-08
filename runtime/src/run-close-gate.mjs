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

function parseData(path, label) {
  if (!existsSync(path)) throw new Error(`${label} não encontrado.`);
  const document = YAML.parseDocument(readFileSync(path, "utf8"), { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(`${label} possui YAML/JSON inválido.`);
  return document.toJS({ mapAsMap: false });
}

function diagnostic(diagnostics, code, path, message, action) {
  diagnostics.push({ code, severity: "error", path, message, action });
}

export function validateRunClose(input = {}) {
  if (!input.receiptPath) throw new Error("receiptPath é obrigatório.");
  const receipt = parseData(resolve(input.receiptPath), "Recibo de encerramento");
  const schema = parseData(resolve(input.schemaPath ?? join(REPOSITORY_DIR, "schema", "run-close-receipt.schema.json")), "Schema de encerramento");
  const diagnostics = [];
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

  if (!validate(receipt)) {
    for (const error of validate.errors ?? []) {
      diagnostic(diagnostics, "RUN_CLOSE_RECEIPT_SCHEMA_INVALID", error.instancePath || "$", `O recibo viola o schema: ${error.message}.`, "repair-close-receipt");
    }
  } else {
    const unfinished = receipt.jobs.filter((job) => ["queued", "running"].includes(job.status));
    if (unfinished.length > 0) {
      diagnostic(diagnostics, "RUN_JOBS_STILL_ACTIVE", "jobs", "Há agentes ainda em execução; aguarde e consuma seus resultados antes de responder.", "wait-active-jobs");
    }
    const unresolved = receipt.jobs.filter((job) => ["failed", "cancelled"].includes(job.status));
    if (unresolved.length > 0) {
      diagnostic(diagnostics, "RUN_JOBS_UNRESOLVED", "jobs", "Há execução técnica sem handoff terminal ou isolamento formal.", "recover-or-isolate-jobs");
    }
    if (receipt.final_plan.status === "READY" || receipt.final_plan.work_slots.length > 0) {
      diagnostic(diagnostics, "RUN_WORK_REMAINS", "final_plan", "O plano final ainda contém trabalho elegível.", "dispatch-and-continue");
    }
    if (receipt.final_plan.guarantees.all_actionable_cards_refreshed !== true) {
      diagnostic(diagnostics, "RUN_FINAL_REFRESH_MISSING", "final_plan.guarantees", "O plano final não comprova releitura de todos os cards acionáveis.", "refresh-snapshot-and-replan");
    }
    if (receipt.final_plan.guarantees.comment_content_reconciled !== true) {
      diagnostic(diagnostics, "RUN_FINAL_COMMENT_CONTENT_STALE", "final_plan.guarantees", "O plano final não comprova leitura e reconciliação do conteúdo dos comentários de todos os cards acionáveis.", "refresh-snapshot-and-replan");
    }
    const finalSnapshotAt = Date.parse(receipt.final_snapshot_observed_at);
    const lastJobEventAt = Date.parse(receipt.last_job_event_at);
    if (!Number.isFinite(finalSnapshotAt) || !Number.isFinite(lastJobEventAt) || finalSnapshotAt < lastJobEventAt) {
      diagnostic(diagnostics, "RUN_FINAL_SNAPSHOT_STALE", "final_snapshot_observed_at", "O snapshot final antecede o último evento dos agentes.", "refresh-snapshot-and-replan");
    }
  }

  const status = diagnostics.length === 0 ? "PASS" : "FAIL";
  return {
    contract_version: "0.1",
    tool: { name: "pipeline-run-close-gate", version: PACKAGE.version },
    status,
    authorization: status === "PASS" ? "FINAL_RESPONSE_GRANTED" : "CONTINUE_RUN",
    run_id: receipt.run_id,
    diagnostics,
    actions: [...new Set(diagnostics.map((item) => item.action))]
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
    if (options.help) process.stdout.write("Uso: node run-close-gate.mjs --receipt <arquivo> [--format text|json]\n");
    else {
      const result = validateRunClose(options);
      if ((options.format ?? "text") === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else process.stdout.write(`pipeline-run-close-gate ${result.tool.version} | ${result.status} | ${result.authorization}\n`);
      process.exitCode = result.status === "PASS" ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`pipeline-run-close-gate: ${error.message}\n`);
    process.exitCode = 2;
  }
}
