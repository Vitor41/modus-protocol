import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const browserEntry = process.env.MODUS_QA_BROWSER_ENTRY
  ? pathToFileURL(process.env.MODUS_QA_BROWSER_ENTRY).href
  : new URL("../src/qa-browser.mjs", import.meta.url).href;
const { runQaBrowser } = await import(browserEntry);
const runBrowserTests = process.env.MODUS_RUN_BROWSER_TESTS === "1";

const RUN_ID = "RUN-20261014-ABCD1234";

async function fixtureServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>QA browser fixture</title></head><body>
      <main><label for="qa-name">Nome QA</label><input id="qa-name" name="name">
      <button id="continue" onclick="document.querySelector('h1').textContent='Fluxo concluído: '+document.querySelector('#qa-name').value">Continuar</button>
      <h1>Início do fluxo</h1></main></body></html>`);
  });
  await new Promise((resolveListen, rejectListen) => server.listen(0, "127.0.0.1", (error) => error ? rejectListen(error) : resolveListen()));
  return { server, url: `http://127.0.0.1:${server.address().port}/home` };
}

test("qa-browser recusa origem externa antes de iniciar navegador", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "modus-qa-browser-origin-"));
  try {
    await assert.rejects(
      runQaBrowser({ action: "preflight", route: "playwright", projectRoot, runId: RUN_ID, url: "https://example.com" }),
      /somente URLs HTTP\(S\) locais/u
    );
  } finally { await rm(projectRoot, { recursive: true, force: true }); }
});

for (const route of ["playwright", "cdp"]) {
  test(`qa-browser ${route}: preflight, login-form interaction, leitura, screenshot e limpeza`, { skip: !runBrowserTests }, async (t) => {
    const projectRoot = await mkdtemp(join(tmpdir(), `modus-qa-browser-${route}-`));
    const { server, url } = await fixtureServer();
    const passwordEnv = `MODUS_QA_TEST_VALUE_${route.toUpperCase()}`;
    process.env[passwordEnv] = "Identidade QA Sintética";
    t.after(async () => {
      delete process.env[passwordEnv];
      await new Promise((resolveClose) => server.close(resolveClose));
      await rm(projectRoot, { recursive: true, force: true });
    });
    try {
      const preflight = await runQaBrowser({ action: "preflight", route, projectRoot, runId: RUN_ID, url, output: "preflight.png" });
      assert.equal(preflight.status, "PASS");
      assert.equal(preflight.http_status ?? 200, 200);
      assert.equal(preflight.title, "QA browser fixture");
      assert.ok((await readFile(preflight.screenshot)).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));

      const before = await runQaBrowser({ action: "inspect", route, projectRoot, runId: RUN_ID });
      assert.match(before.body_text, /Início do fluxo/u);
      assert.ok(before.controls.some((control) => control.text === "Continuar"));

      const fill = await runQaBrowser({ action: "fill", route, projectRoot, runId: RUN_ID, selector: "#qa-name", valueEnv: passwordEnv });
      assert.equal(fill.status, "PASS");
      const clicked = await runQaBrowser({ action: "click", route, projectRoot, runId: RUN_ID, selector: "#continue" });
      assert.equal(clicked.status, "PASS");
      const after = await runQaBrowser({ action: "inspect", route, projectRoot, runId: RUN_ID });
      assert.match(after.body_text, /Fluxo concluído: Identidade QA Sintética/u);

      const mobile = await runQaBrowser({ action: "viewport", route, projectRoot, runId: RUN_ID, width: "390", height: "844" });
      assert.equal(mobile.status, "PASS");
      assert.ok(await readFile(mobile.screenshot));
      const stopped = await runQaBrowser({ action: "stop", route, projectRoot, runId: RUN_ID });
      assert.equal(stopped.profile_removed, true);
      assert.equal(stopped.evidence_preserved, true);
      assert.ok(await readFile(mobile.screenshot));
    } finally {
      await runQaBrowser({ action: "stop", route, projectRoot, runId: RUN_ID });
    }
  });

  test(`qa-browser sessão persistente ${route}: navegador continua disponível entre comandos do processo CLI`, { skip: !runBrowserTests }, async (t) => {
    const projectRoot = await mkdtemp(join(tmpdir(), `modus-qa-browser-session-${route}-`));
    const { server, url } = await fixtureServer();
    const child = spawn(process.execPath, [fileURLToPath(browserEntry), "--action", "serve", "--route", route, "--project-root", projectRoot, "--run-id", RUN_ID], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const responses = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const responseIterator = responses[Symbol.asyncIterator]();
    const stderr = [];
    child.stderr.setEncoding("utf8").on("data", (chunk) => stderr.push(chunk));
    let sequence = 0;
    let sessionClosed = false;
    const send = async (request) => {
      const id = `session-${++sequence}`;
      child.stdin.write(`${JSON.stringify({ ...request, id })}\n`);
      const next = await responseIterator.next();
      assert.equal(next.done, false, `Sessão CLI encerrou antes da resposta: ${stderr.join("")}`);
      const response = JSON.parse(next.value);
      assert.equal(response.id, id);
      return response;
    };
    t.after(async () => {
      if (!sessionClosed && child.exitCode === null && !child.killed) {
        try { await send({ action: "shutdown" }); } catch {}
        child.stdin.end();
        if (child.exitCode === null) await new Promise((resolveExit) => child.once("exit", resolveExit));
      }
      responses.close();
      await new Promise((resolveClose) => server.close(resolveClose));
      await rm(projectRoot, { recursive: true, force: true });
    });

    const preflight = await send({ action: "preflight", url, output: "session-preflight.png" });
    assert.equal(preflight.status, "PASS");
    assert.ok((await readFile(preflight.screenshot)).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    assert.equal((await send({ action: "inspect" })).status, "PASS");
    assert.equal((await send({ action: "fill", selector: "#qa-name", value: "Sessão persistente" })).status, "PASS");
    assert.equal((await send({ action: "click", selector: "#continue" })).status, "PASS");
    const after = await send({ action: "inspect" });
    assert.match(after.body_text, /Fluxo concluído: Sessão persistente/u);
    const shutdown = await send({ action: "shutdown" });
    assert.equal(shutdown.action, "shutdown");
    assert.equal(shutdown.cleanup.profile_removed, true);
    sessionClosed = true;
    child.stdin.end();
    const exitCode = child.exitCode ?? await new Promise((resolveExit) => child.once("exit", resolveExit));
    assert.equal(exitCode, 0, stderr.join(""));
  });
}
