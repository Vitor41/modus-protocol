import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import YAML from "yaml";

import { runDoctor } from "../src/doctor.mjs";

const REPOSITORY_DIR = resolve(import.meta.dirname, "..", "..");
const FIXTURE_PATH = join(REPOSITORY_DIR, "tests", "fixtures", "adapters", "valid-minimal.json");
const CASES_PATH = join(REPOSITORY_DIR, "tests", "fixtures", "adapters", "cases.json");
const SCHEMA_PATH = join(REPOSITORY_DIR, "schema", "project-adapter.schema.json");

function clone(value) {
  return structuredClone(value);
}

function applyOperation(target, operation) {
  const parts = operation.path.split(".");
  const key = parts.pop();
  let parent = target;
  for (const part of parts) parent = parent[part];
  if (operation.op === "delete") delete parent[key];
  else if (operation.op === "set") parent[key] = clone(operation.value);
  else throw new Error(`Operação desconhecida: ${operation.op}`);
}

async function createProject(adapter) {
  const root = await mkdtemp(join(tmpdir(), "pipeline-doctor-"));
  await mkdir(join(root, ".pipeline"), { recursive: true });
  await mkdir(join(root, "docs", "context"), { recursive: true });
  await writeFile(
    join(root, "AGENTS.md"),
    "Ao receber `Processe a fila do Trello.`, use exclusivamente $pipeline-run.\n",
    "utf8"
  );
  await writeFile(join(root, "docs", "context", "index.md"), "# Contexto\n", "utf8");
  const adapterPath = join(root, ".pipeline", "project.adapter.yaml");
  await writeFile(adapterPath, YAML.stringify(adapter), "utf8");
  return { root, adapterPath };
}

test("fixture mínima atende ao schema no modo estrutural", async () => {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const { root, adapterPath } = await createProject(fixture);
  try {
    const result = runDoctor({ projectRoot: root, adapterPath, schemaPath: SCHEMA_PATH, mode: "structural" });
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.diagnostics, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor valida existência do arquivo externo do provider environment sem ler segredos", async () => {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  fixture.tracker.credential_provider = "environment";
  fixture.tracker.comments.read_provider = "environment";
  fixture.tracker.comments.write_provider = "environment";
  fixture.tracker.environment = { credential_file: "trello_key/trello.env" };
  const { root, adapterPath } = await createProject(fixture);
  try {
    const missing = runDoctor({ projectRoot: root, adapterPath, schemaPath: SCHEMA_PATH, mode: "shadow" });
    assert.ok(
      missing.diagnostics.some((item) => item.code === "TRACKER_CREDENTIAL_FILE_MISSING"),
      JSON.stringify(missing.diagnostics)
    );
    await mkdir(join(root, "trello_key"), { recursive: true });
    await writeFile(join(root, "trello_key", "trello.env"), "conteúdo não lido pelo doctor", "utf8");
    const present = runDoctor({ projectRoot: root, adapterPath, schemaPath: SCHEMA_PATH, mode: "shadow" });
    assert.ok(!present.diagnostics.some((item) => item.code === "TRACKER_CREDENTIAL_FILE_MISSING"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exemplo YAML público atende ao schema", () => {
  const result = runDoctor({
    projectRoot: REPOSITORY_DIR,
    adapterPath: join(REPOSITORY_DIR, "examples", "project.adapter.example.yaml"),
    schemaPath: SCHEMA_PATH,
    mode: "structural"
  });
  assert.equal(result.status, "PASS");
});

test("modo shadow avisa quando o tracker não foi consultado", async () => {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const { root, adapterPath } = await createProject(fixture);
  try {
    const result = runDoctor({ projectRoot: root, adapterPath, schemaPath: SCHEMA_PATH, mode: "shadow" });
    assert.equal(result.status, "WARN");
    assert.ok(result.diagnostics.some((item) => item.code === "TRACKER_NOT_CHECKED"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shadow identifica roteamento legado antes do cutover", async () => {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const { root, adapterPath } = await createProject(fixture);
  const snapshotPath = join(root, "tracker-snapshot.json");
  const stateOrder = [
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
  await writeFile(
    join(root, "AGENTS.md"),
    [
      "Ao receber `Processe a fila do Trello.`, use a esteira local:",
      "- $financial-product-po",
      "- $financial-product-fullstack-dev",
      "- $financial-product-qa"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    snapshotPath,
    JSON.stringify({
      board_ref: fixture.tracker.board_ref,
      open_lists: stateOrder.map((state, index) => ({ ref: fixture.tracker.states[state], position: index + 1 })),
      cards: [],
      integration: {
        comments: {
          read: "verified",
          write: "verified",
          read_provider: fixture.tracker.comments.read_provider,
          write_provider: fixture.tracker.comments.write_provider,
          evidence_ref: "trello-comment-test-fixture",
          verified_at: "2026-08-28T12:00:00Z"
        }
      }
    }),
    "utf8"
  );

  try {
    const shadow = runDoctor({
      projectRoot: root,
      adapterPath,
      schemaPath: SCHEMA_PATH,
      trackerSnapshotPath: snapshotPath,
      mode: "shadow"
    });
    const shadowCodes = new Set(shadow.diagnostics.map((item) => item.code));
    assert.equal(shadow.status, "WARN");
    assert.ok(shadowCodes.has("UNIFIED_ROUTER_PENDING"));
    assert.ok(shadowCodes.has("LEGACY_ROUTER_CONFLICT"));
    assert.ok(shadow.diagnostics.every((item) => item.severity === "warning"));

    const cutover = runDoctor({
      projectRoot: root,
      adapterPath,
      schemaPath: SCHEMA_PATH,
      trackerSnapshotPath: snapshotPath,
      mode: "cutover"
    });
    const cutoverCodes = new Set(cutover.diagnostics.map((item) => item.code));
    assert.equal(cutover.status, "FAIL");
    assert.ok(cutoverCodes.has("UNIFIED_ROUTER_MISSING"));
    assert.ok(cutoverCodes.has("LEGACY_ROUTER_CONFLICT"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cutover válido exige snapshot e roteamento unificado", async () => {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const { root, adapterPath } = await createProject(fixture);
  const snapshotPath = join(root, "tracker-snapshot.json");
  const stateOrder = [
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
  await writeFile(
    snapshotPath,
    JSON.stringify({
      board_ref: fixture.tracker.board_ref,
      open_lists: stateOrder.map((state, index) => ({ ref: fixture.tracker.states[state], position: index + 1 })),
      cards: [],
      integration: {
        comments: {
          read: "verified",
          write: "verified",
          read_provider: fixture.tracker.comments.read_provider,
          write_provider: fixture.tracker.comments.write_provider,
          evidence_ref: "trello-comment-test-fixture",
          verified_at: "2026-08-28T12:00:00Z"
        }
      }
    }),
    "utf8"
  );
  try {
    const result = runDoctor({
      projectRoot: root,
      adapterPath,
      schemaPath: SCHEMA_PATH,
      trackerSnapshotPath: snapshotPath,
      mode: "cutover"
    });
    assert.equal(result.status, "PASS");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rollback isolado alterna bootstrap sem manter dois roteadores ativos", async () => {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const { root, adapterPath } = await createProject(fixture);
  const snapshotPath = join(root, "tracker-snapshot.json");
  const stateOrder = [
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
  await writeFile(
    snapshotPath,
    JSON.stringify({
      board_ref: fixture.tracker.board_ref,
      open_lists: stateOrder.map((state, index) => ({ ref: fixture.tracker.states[state], position: index + 1 })),
      cards: [],
      integration: {
        comments: {
          read: "verified",
          write: "verified",
          read_provider: fixture.tracker.comments.read_provider,
          write_provider: fixture.tracker.comments.write_provider,
          evidence_ref: "sanitized-rollback-fixture",
          verified_at: "2026-08-31T12:00:00Z"
        }
      }
    }),
    "utf8"
  );

  try {
    const options = { projectRoot: root, adapterPath, schemaPath: SCHEMA_PATH, trackerSnapshotPath: snapshotPath, mode: "cutover" };
    assert.equal(runDoctor(options).status, "PASS");

    await writeFile(join(root, "AGENTS.md"), "Ao receber `Processe a fila do Trello.`, use somente $legacy-pipeline.\n", "utf8");
    const rolledBack = runDoctor(options);
    assert.equal(rolledBack.status, "FAIL");
    assert.ok(rolledBack.diagnostics.some((item) => item.code === "UNIFIED_ROUTER_MISSING"));

    await writeFile(join(root, "AGENTS.md"), "Ao receber `Processe a fila do Trello.`, use exclusivamente $pipeline-run.\n", "utf8");
    assert.equal(runDoctor(options).status, "PASS");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cutover bloqueia capacidade de comentário não verificada", async () => {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const { root, adapterPath } = await createProject(fixture);
  const snapshotPath = join(root, "tracker-snapshot.json");
  const stateOrder = [
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
  await writeFile(
    snapshotPath,
    JSON.stringify({
      board_ref: fixture.tracker.board_ref,
      open_lists: stateOrder.map((state, index) => ({ ref: fixture.tracker.states[state], position: index + 1 })),
      cards: [],
      integration: {
        comments: {
          read: "verified",
          write: "not_tested",
          read_provider: fixture.tracker.comments.read_provider,
          write_provider: fixture.tracker.comments.write_provider
        }
      }
    }),
    "utf8"
  );
  try {
    const result = runDoctor({
      projectRoot: root,
      adapterPath,
      schemaPath: SCHEMA_PATH,
      trackerSnapshotPath: snapshotPath,
      mode: "cutover"
    });
    assert.equal(result.status, "FAIL");
    assert.ok(result.diagnostics.some((item) => item.code === "TRACKER_COMMENT_CAPABILITY_UNVERIFIED"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const cases = JSON.parse(await readFile(CASES_PATH, "utf8"));
for (const fixtureCase of cases) {
  test(`fixture negativa: ${fixtureCase.name}`, async () => {
    const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
    for (const operation of fixtureCase.operations) applyOperation(fixture, operation);
    const { root, adapterPath } = await createProject(fixture);
    try {
      const result = runDoctor({ projectRoot: root, adapterPath, schemaPath: SCHEMA_PATH, mode: "shadow" });
      const actualCodes = new Set(result.diagnostics.map((item) => item.code));
      for (const expectedCode of fixtureCase.expected_codes) {
        assert.ok(actualCodes.has(expectedCode), `${fixtureCase.name} deveria produzir ${expectedCode}`);
      }
      assert.equal(result.status, "FAIL");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
