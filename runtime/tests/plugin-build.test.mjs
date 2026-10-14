import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildPlugin } from "../scripts/build-plugin.mjs";

const REPOSITORY_DIR = resolve(import.meta.dirname, "..", "..");
const NODE = process.execPath;
const EXPECTED_SKILLS = [
  "pipeline-code-review",
  "pipeline-dev",
  "pipeline-doctor",
  "pipeline-po",
  "pipeline-qa",
  "pipeline-run",
  "pipeline-setup",
  "pipeline-ux-ui"
];

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const built = await buildPlugin();

test("artefato contém exatamente as oito Skills", async () => {
  const skills = (await readdir(join(built.targetRoot, "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(skills, EXPECTED_SKILLS);
});

test("Skills empacotadas são byte a byte iguais à fonte", async () => {
  for (const skill of EXPECTED_SKILLS) {
    for (const relativePath of ["SKILL.md", "agents/openai.yaml"]) {
      const source = await readFile(join(REPOSITORY_DIR, "skills", skill, relativePath));
      const artifact = await readFile(join(built.targetRoot, "skills", skill, relativePath));
      assert.equal(hash(artifact), hash(source), `${skill}/${relativePath}`);
    }
  }
});

test("Skill de Code Review fixa o contrato técnico de changes_required", async () => {
  const skill = await readFile(join(REPOSITORY_DIR, "skills", "pipeline-code-review", "SKILL.md"), "utf8");
  const verdictSection = skill.split("## Veredito", 2)[1]?.split("##", 1)[0] ?? "";
  for (const requiredInstruction of [
    "`changes_required`",
    "`status: return`",
    "`requires_human: false`",
    "`kind: technical`",
    "`scope: card`",
    "`return_to: pipeline-dev`"
  ]) {
    assert.ok(verdictSection.includes(requiredInstruction), requiredInstruction);
  }
});

test("Skill de execução exige subagente ORCHESTRATOR em todo gatilho", async () => {
  const skill = await readFile(join(REPOSITORY_DIR, "skills", "pipeline-run", "SKILL.md"), "utf8");
  assert.match(skill, /sempre abrir exatamente um subagente ORCHESTRATOR/u);
  assert.match(skill, /Nunca execute a fila no chat chamador/u);
  assert.match(skill, /solicite acesso externo elevado/u);
  assert.match(skill, /Nunca publique um bloqueio como se fosse saída do papel/u);
  assert.match(skill, /o plano deve classificar esse card como `TERMINAL_ROLE_BLOCK`/u);
});

test("QA documenta execução local segura e evidência real de frontend/backend", async () => {
  const skill = await readFile(join(REPOSITORY_DIR, "skills", "pipeline-qa", "SKILL.md"), "utf8");
  const localValidation = await readFile(join(REPOSITORY_DIR, "skills", "pipeline-qa", "references", "local-application-validation.md"), "utf8");
  const browserRouting = await readFile(join(REPOSITORY_DIR, "skills", "pipeline-qa", "references", "browser-routing.md"), "utf8");
  const adapterContract = await readFile(join(REPOSITORY_DIR, "docs", "PROJECT_ADAPTER.md"), "utf8");
  for (const requiredInstruction of ["references/local-application-validation.md", "backend e frontend"]) {
    assert.ok(skill.includes(requiredInstruction), requiredInstruction);
  }
  for (const requiredInstruction of ["portas declaradas", "ambiente local/não produtivo", "sem pedir autorização humana por etapa", "conta QA própria", "sessão pessoal compartilhada", "antes de encerrar QA", "deliverable.cleanup", "processo filho", "Job Object", "GetLastWin32Error"]) {
    assert.ok(localValidation.includes(requiredInstruction), requiredInstruction);
  }
  assert.match(adapterContract, /identidade de teste e limites de acesso ao banco/u);
  for (const requiredInstruction of ["Rota principal: navegador automatizado isolado", "Contingência: perfil QA dedicado no Chrome", "preflight sequencial", "Nunca execute ambas em paralelo", "perfil pessoal"]) {
    assert.ok(browserRouting.includes(requiredInstruction), requiredInstruction);
  }
  const packagedReference = await readFile(join(built.targetRoot, "skills", "pipeline-qa", "references", "local-application-validation.md"), "utf8");
  assert.equal(packagedReference, localValidation);
  const packagedBrowserRouting = await readFile(join(built.targetRoot, "skills", "pipeline-qa", "references", "browser-routing.md"), "utf8");
  assert.equal(packagedBrowserRouting, browserRouting);
});

test("DEV não conta verificações internas como retorno de loop entre papéis", async () => {
  const policy = await readFile(join(REPOSITORY_DIR, "docs", "AUTONOMY_POLICY.md"), "utf8");
  const dev = await readFile(join(REPOSITORY_DIR, "skills", "pipeline-dev", "SKILL.md"), "utf8");
  const deliveryLoop = await readFile(join(REPOSITORY_DIR, "skills", "pipeline-dev", "references", "delivery-loop.md"), "utf8");
  const evals = await readFile(join(REPOSITORY_DIR, "docs", "EVALS.md"), "utf8");
  assert.match(policy, /retornos confirmados entre papéis/u);
  assert.match(policy, /Repetições internas do mesmo papel.*não incrementam/u);
  assert.match(dev, /nunca devem ser classificadas como `loop_limit`/u);
  assert.match(dev, /não faça handoff de sucesso/u);
  assert.match(deliveryLoop, /não consome o contador de `loop_limit`/u);
  assert.match(evals, /EVAL-DEV-INTERNAL-ITERATION-001/u);
  const packagedDeliveryLoop = await readFile(join(built.targetRoot, "skills", "pipeline-dev", "references", "delivery-loop.md"), "utf8");
  assert.equal(hash(Buffer.from(packagedDeliveryLoop)), hash(Buffer.from(deliveryLoop)));
});

test("Skills do pipeline limitam releases em lote e exigem checkpoints recuperáveis", async () => {
  const run = await readFile(join(REPOSITORY_DIR, "skills", "pipeline-run", "SKILL.md"), "utf8");
  const dev = await readFile(join(REPOSITORY_DIR, "skills", "pipeline-dev", "SKILL.md"), "utf8");
  assert.match(run, /timeout.*3 horas/u);
  assert.match(run, /30 minutos/u);
  assert.match(run, /somente um checkpoint novo de release reinicia o watchdog/u);
  assert.match(run, /não repita o mesmo prompt/u);
  assert.match(run, /Contagens e eventos `item\.\*` indicam atividade da sessão, não conclusão de etapa/u);
  assert.match(dev, /release_queue\.progress_file/u);
  for (const checkpoint of ["preflight", "documentation", "branch", "push", "pull_request", "checks", "merge", "handoff"]) {
    assert.ok(dev.includes(`\`${checkpoint}\``), checkpoint);
  }
});

test("artefato inclui a política canônica de autonomia referenciada pelas Skills", async () => {
  const source = await readFile(join(REPOSITORY_DIR, "docs", "AUTONOMY_POLICY.md"));
  const artifact = await readFile(join(built.targetRoot, "docs", "AUTONOMY_POLICY.md"));
  assert.equal(hash(artifact), hash(source));
});

test("artefato inclui gate e schema de encerramento da execução", async () => {
  const gate = await readFile(join(built.targetRoot, "runtime", "src", "run-close-gate.mjs"));
  const schema = await readFile(join(built.targetRoot, "schema", "run-close-receipt.schema.json"));
  assert.ok(gate.length > 0);
  assert.ok(schema.length > 0);
});

test("runtime standalone executa doctor sem node_modules no plugin", () => {
  const result = spawnSync(
    NODE,
    [
      join(built.targetRoot, "runtime", "src", "doctor.mjs"),
      "--project-root",
      REPOSITORY_DIR,
      "--adapter",
      join(REPOSITORY_DIR, "tests", "fixtures", "adapters", "valid-minimal.json"),
      "--mode",
      "structural",
      "--format",
      "json"
    ],
    { cwd: REPOSITORY_DIR, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "PASS");
});

test("runtime standalone expõe status de versão antes do tracker", () => {
  const result = spawnSync(NODE, [join(built.targetRoot, "runtime", "src", "version-status.mjs"), "--project-root", REPOSITORY_DIR, "--adapter", join(REPOSITORY_DIR, "examples", "project.adapter.example.yaml"), "--format", "json"], { cwd: REPOSITORY_DIR, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.status, "PASS");
  assert.equal(status.active.runtime_version, "0.3.26");
});

test("Skill pipeline-run consolida recibos durante retentativas da mesma lane", async () => {
  const skill = await readFile(join(built.targetRoot, "skills", "pipeline-run", "references", "tracker-comment-protocol.md"), "utf8");
  assert.match(skill, /unidade de publicação é a \*\*lane do mesmo card, papel, estado e RUN_ID\*\*/u);
  assert.match(skill, /não publique outro lock ou cápsula só porque um agente foi relançado/u);
  assert.match(skill, /Publique imediatamente quando houver decisão humana, mudança de estado ou troca efetiva de papel/u);
});

test("planner empacotado não executa o CLI interno do doctor", () => {
  const result = spawnSync(NODE, [join(built.targetRoot, "runtime", "src", "run-planner.mjs"), "--help"], { cwd: REPOSITORY_DIR, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /pipeline-doctor/);
});

test("runtime standalone valida handoff DEV", () => {
  const result = spawnSync(
    NODE,
    [
      join(built.targetRoot, "runtime", "src", "role-gate.mjs"),
      "--handoff",
      join(REPOSITORY_DIR, "tests", "fixtures", "handoffs", "valid-dev.json"),
      "--format",
      "json"
    ],
    { cwd: REPOSITORY_DIR, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "PASS");
});

test("artefato inclui gate e schema de transição", async () => {
  const gate = await readFile(join(built.targetRoot, "runtime", "src", "transition-gate.mjs"), "utf8");
  const schema = JSON.parse(
    await readFile(join(built.targetRoot, "schema", "tracker-transition-receipt.schema.json"), "utf8")
  );
  assert.match(gate, /pipeline-transition-gate/);
  assert.match(schema.$id, /tracker-transition-receipt/);
});

test("artefato inclui cliente de comentários Trello", async () => {
  const client = await readFile(join(built.targetRoot, "runtime", "src", "trello-comments.mjs"), "utf8");
  assert.match(client, /pipeline-trello-comments/);
});

test("artefato inclui launcher determinístico", async () => {
  const launcher = await readFile(join(built.targetRoot, "runtime", "pipeline.ps1"), "utf8");
  assert.match(launcher, /codex-primary-runtime/);
  assert.match(launcher, /não crie scripts substitutos/);
  assert.match(launcher, /'status' = 'version-status\.mjs'/);
  assert.match(launcher, /'role-launch' = 'role-launcher\.mjs'/);
});

test("artefato inclui launcher alternativo de agentes", async () => {
  const launcher = await readFile(join(built.targetRoot, "runtime", "src", "role-launcher.mjs"), "utf8");
  assert.match(launcher, /pipeline-role-launcher/);
  assert.match(launcher, /explicit-codex-exec/);
});

test("artefato inclui executor oficial de comandos do adapter", async () => {
  const runner = await readFile(join(built.targetRoot, "runtime", "src", "command-runner.mjs"), "utf8");
  assert.match(runner, /pipeline-command/);
  assert.match(runner, /project-runtime/);
});

test("manifest, runtime e build-info compartilham a mesma versão", async () => {
  const manifest = JSON.parse(await readFile(join(built.targetRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const runtimePackage = JSON.parse(await readFile(join(built.targetRoot, "runtime", "package.json"), "utf8"));
  const buildInfo = JSON.parse(await readFile(join(built.targetRoot, ".codex-plugin", "build-info.json"), "utf8"));
  assert.equal(manifest.version, runtimePackage.version);
  assert.equal(buildInfo.plugin.version, manifest.version);
  assert.equal(buildInfo.source.runtime_version, manifest.version);
});
