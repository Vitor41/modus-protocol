#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(SOURCE_DIR, "..");
const RUN_ID_PATTERN = /^RUN-[0-9]{8}-[A-Z0-9]{8}$/u;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_CHROME_PATHS = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
    ]
  : process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
let screenshotSequence = 0;

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help" || key === "-h") options.help = true;
    else {
      if (!key.startsWith("--")) throw new Error(`Argumento inesperado: ${key}`);
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Valor ausente para ${key}`);
      const name = key.slice(2).replaceAll(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
      if (Object.hasOwn(options, name)) throw new Error(`Argumento repetido: ${key}`);
      options[name] = value;
    }
  }
  return options;
}

function assertLocalUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("URL inválida; informe a URL local declarada pelo adapter."); }
  if (!["http:", "https:"].includes(url.protocol) || !LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("O navegador de QA aceita somente URLs HTTP(S) locais (localhost, 127.0.0.1 ou ::1).");
  }
  if (url.username || url.password || [...url.searchParams.keys()].some((key) => /token|secret|password|passwd|api[_-]?key|authorization|credential|session|jwt|^code$/iu.test(key))) {
    throw new Error("A URL local não pode conter credenciais nem parâmetros sensíveis.");
  }
  return url;
}

function resolveWithin(root, candidate) {
  const target = resolve(root, candidate);
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    if (rel === "") return target;
    throw new Error("O caminho solicitado precisa permanecer dentro do diretório de QA do RUN_ID.");
  }
  return target;
}

function chromeExecutable(configuredPath) {
  const candidates = [configuredPath, process.env.CHROME_PATH, ...DEFAULT_CHROME_PATHS].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function browserWorkspace(projectRoot, runId, route) {
  if (!RUN_ID_PATTERN.test(runId ?? "")) throw new Error("RUN_ID inválido para isolamento do navegador.");
  const root = resolve(projectRoot);
  const workspaceRoot = resolve(root, ".pipeline", "tmp", "qa-browser", runId);
  const routeRoot = resolveWithin(workspaceRoot, route);
  return { workspaceRoot, routeRoot, profilePath: join(routeRoot, "profile"), statePath: join(routeRoot, "session.json"), fixturesPath: join(routeRoot, "fixtures"), route };
}

async function resolveFixtureFile(paths, value) {
  if (typeof value !== "string" || !value.trim() || isAbsolute(value) || value.includes("\0")) {
    throw new Error("--file-path deve apontar para um arquivo sintético relativo ao diretório fixtures desta rota.");
  }
  const parts = value.split(/[\\/]+/u);
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("O arquivo de upload precisa permanecer dentro de fixtures do RUN_ID.");
  await mkdir(paths.fixturesPath, { recursive: true });
  const physicalFixtures = await realpath(paths.fixturesPath);
  const expectedFixtures = resolve(paths.fixturesPath);
  if (physicalFixtures !== expectedFixtures) throw new Error("O diretório fixtures não pode ser link simbólico ou sair da rota isolada.");
  let current = paths.fixturesPath;
  for (const part of parts) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("Arquivos de fixture QA não podem usar links simbólicos.");
  }
  const info = await lstat(current);
  if (!info.isFile()) throw new Error("O upload QA precisa apontar para um arquivo regular sintético.");
  const physicalFile = await realpath(current);
  const rel = relative(physicalFixtures, physicalFile);
  if (!rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new Error("O arquivo de upload saiu do diretório fixtures isolado; operação recusada.");
  }
  return physicalFile;
}

async function readState(paths, route, runId) {
  try {
    if ((await lstat(paths.statePath)).isSymbolicLink()) throw new Error("O arquivo de estado QA não pode ser um link simbólico.");
    const state = JSON.parse(await readFile(paths.statePath, "utf8"));
    if (state.contract_version !== "0.1" || state.run_id !== runId || state.route !== route) {
      throw new Error("O estado salvo do navegador não corresponde a este RUN_ID/rota.");
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function saveState(paths, state) {
  await mkdir(paths.routeRoot, { recursive: true });
  try {
    const existing = await lstat(paths.statePath);
    if (existing.isSymbolicLink()) throw new Error("O arquivo de estado QA não pode ser um link simbólico.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await writeFile(paths.statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "w" });
}

async function writeScreenshot(paths, name, bytes) {
  const requestedName = name || `evidence-${Date.now()}-${++screenshotSequence}.png`;
  const safeName = `${basename(requestedName, extname(requestedName))}.png`;
  if (safeName === ".png") throw new Error("Nome de evidência inválido.");
  const output = resolveWithin(paths.routeRoot, safeName);
  try {
    const existing = await lstat(output);
    if (existing.isSymbolicLink()) throw new Error("O arquivo de evidência não pode ser um link simbólico.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await writeFile(output, bytes, { flag: "wx" });
  return output;
}

function publicPageInfo(url, title, readyState, bodyText) {
  const parsed = new URL(url);
  return {
    url: `${parsed.origin}${parsed.pathname}`,
    title,
    ready_state: readyState,
    body_text: String(bodyText ?? "").slice(0, 18000)
  };
}

async function playwrightAction(options, paths, endpoint, state) {
  let browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
  } catch (error) {
    const detail = String(error?.message ?? error).replace(/wss?:\/\/[^\s)]+/gu, "<endpoint CDP local>");
    throw new Error(`Playwright não conectou ao Chrome QA via CDP: ${detail}. Confirme que este comando está usando execução local autorizada para loopback.`);
  }
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("O Chrome QA não expôs o contexto isolado esperado.");
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(10000);
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        try {
          if (!LOCAL_HOSTS.has(new URL(request.url()).hostname.toLowerCase())) return await route.abort("blockedbyclient");
        } catch { return await route.abort("blockedbyclient"); }
      }
      await route.continue();
    });
    if (options.action === "preflight" || options.action === "navigate") {
      const url = assertLocalUrl(options.url);
      const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.locator("body").waitFor({ state: "visible", timeout: 10000 });
      const screenshot = await page.screenshot({ fullPage: true, animations: "disabled" });
      const screenshotPath = await writeScreenshot(paths, options.output, screenshot);
      state.url = page.url();
      await saveState(paths, state);
      return {
        status: "PASS",
        route: "playwright",
        action: options.action,
        http_status: response?.status() ?? null,
        ...publicPageInfo(page.url(), await page.title(), await page.evaluate(() => document.readyState), await page.locator("body").innerText()),
        screenshot: screenshotPath,
        isolated_profile: paths.profilePath
      };
    }
    const targetUrl = options.url ?? state.url;
    if (!targetUrl) throw new Error("Página sem endereço ativo; execute primeiro o preflight com a URL local.");
    const localTargetUrl = assertLocalUrl(targetUrl).href;
    if (page.url() !== localTargetUrl) await page.goto(localTargetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    if (options.action === "inspect") {
      const result = await page.evaluate(() => ({
        title: document.title,
        ready_state: document.readyState,
        text: document.body?.innerText ?? "",
        controls: [...document.querySelectorAll("button,a,input,select,textarea,[role=button]")].slice(0, 200).map((el) => ({
          tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), text: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 300),
          type: el.getAttribute("type"), href: el.tagName === "A" ? el.getAttribute("href") : undefined,
          disabled: Boolean(el.disabled || el.getAttribute("aria-disabled") === "true")
        }))
      }));
      state.url = page.url();
      await saveState(paths, state);
      return { status: "PASS", route: "playwright", action: "inspect", ...publicPageInfo(page.url(), result.title, result.ready_state, result.text), controls: result.controls, isolated_profile: paths.profilePath };
    }
    if (options.action === "screenshot") {
      const output = await writeScreenshot(paths, options.output, await page.screenshot({ fullPage: true, animations: "disabled" }));
      state.url = page.url();
      await saveState(paths, state);
      return { status: "PASS", route: "playwright", action: "screenshot", screenshot: output, ...publicPageInfo(page.url(), await page.title(), await page.evaluate(() => document.readyState), "") };
    }
    if (options.action === "click") await page.locator(requireOption(options, "selector")).click();
    else if (options.action === "fill") {
      const value = inputValue(options);
      await page.locator(requireOption(options, "selector")).fill(value);
    } else if (options.action === "upload") {
      const filePath = await resolveFixtureFile(paths, requireOption(options, "filePath"));
      await page.locator(requireOption(options, "selector")).setInputFiles(filePath);
    } else if (options.action === "press") await page.locator(requireOption(options, "selector")).press(requireOption(options, "key"));
    else if (options.action === "viewport") await page.setViewportSize({ width: integer(options.width, "width"), height: integer(options.height, "height") });
    else throw new Error(`Ação Playwright não suportada: ${options.action}`);
    await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
    const screenshotPath = await writeScreenshot(paths, options.output, await page.screenshot({ fullPage: true, animations: "disabled" }));
    state.url = page.url();
    await saveState(paths, state);
    return { status: "PASS", route: "playwright", action: options.action, ...publicPageInfo(page.url(), await page.title(), await page.evaluate(() => document.readyState), await page.locator("body").innerText()), screenshot: screenshotPath };
  } finally { await browser.close(); }
}

function requireOption(options, key) {
  if (typeof options[key] !== "string" || !options[key]) throw new Error(`Argumento obrigatório ausente: --${key.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`);
  return options[key];
}

function integer(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) throw new Error(`--${name} precisa ser inteiro entre 1 e 10000.`);
  return parsed;
}

function inputValue(options) {
  if (options.valueEnv) {
    if (!Object.hasOwn(process.env, options.valueEnv)) throw new Error(`A variável de ambiente QA '${options.valueEnv}' não está definida.`);
    return process.env[options.valueEnv];
  }
  if (Object.hasOwn(options, "value")) return options.value;
  throw new Error("Informe --value-env <VARIAVEL>; o runtime não lê nem imprime credenciais automaticamente.");
}

function localCdpEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Chrome QA retornou um endpoint CDP inválido.");
  }
  if (url.protocol !== "ws:" || !LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Chrome QA retornou um endpoint CDP fora do loopback local; conexão recusada.");
  }
  // Chrome may publish localhost even when its debugging socket is bound to IPv4.
  // Pin the client connection to the same loopback family used by our HTTP probe.
  url.hostname = "127.0.0.1";
  return url.href;
}

function cdpClient(webSocketUrl) {
  const socket = new WebSocket(localCdpEndpoint(webSocketUrl));
  const pending = new Map();
  let nextId = 0;
  const events = [];
  let openedState = false;
  let openTimer;
  const rejectPending = (message) => {
    for (const [id, request] of pending) {
      clearTimeout(request.timer);
      pending.delete(id);
      request.reject(new Error(message));
    }
  };
  const opened = new Promise((resolveOpen, rejectOpen) => {
    const fail = (message) => {
      if (openedState) return;
      openedState = true;
      clearTimeout(openTimer);
      rejectOpen(new Error(message));
    };
    openTimer = setTimeout(() => {
      fail("Timeout de 5s ao abrir o WebSocket CDP local; verifique se o executor autorizou loopback para este comando.");
      socket.close();
    }, 5000);
    socket.addEventListener("open", () => {
      openedState = true;
      clearTimeout(openTimer);
      resolveOpen();
    }, { once: true });
    socket.addEventListener("error", () => {
      fail("Falha ao abrir o WebSocket CDP local; verifique a permissão de loopback do executor.");
      rejectPending("O transporte CDP local falhou durante uma operação.");
    });
    socket.addEventListener("close", () => {
      fail("O Chrome QA fechou o WebSocket CDP antes de aceitar comandos.");
      rejectPending("O Chrome QA fechou a conexão CDP durante uma operação.");
    });
  });
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.id && pending.has(message.id)) {
      const { resolve: resolveCall, reject: rejectCall, timer } = pending.get(message.id);
      clearTimeout(timer);
      pending.delete(message.id);
      if (message.error) rejectCall(new Error(`CDP ${message.error.code}: ${message.error.message}`));
      else resolveCall(message.result ?? {});
    } else events.push(message);
  });
  return {
    events,
    async ready() { await opened; },
    async send(method, params = {}, sessionId) {
      await opened;
      const id = ++nextId;
      const result = new Promise((resolveCall, rejectCall) => {
        const timer = setTimeout(() => {
          if (pending.delete(id)) rejectCall(new Error(`Timeout no comando CDP ${method}.`));
        }, 10000);
        pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
        try {
          socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          rejectCall(new Error(`Falha ao enviar comando CDP ${method}: ${error.message}`));
        }
      });
      return result;
    },
    close() { socket.close(); }
  };
}

async function launchCdp(paths, executable) {
  await mkdir(paths.routeRoot, { recursive: true });
  await mkdir(paths.profilePath, { recursive: true });
  const activePortFile = join(paths.profilePath, "DevToolsActivePort");
  const args = [
    "--remote-debugging-port=0", "--remote-allow-origins=*", `--user-data-dir=${paths.profilePath}`,
    "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-background-networking",
    "--disable-default-apps", "--disable-extensions", "--enable-automation", "--headless=new", "about:blank"
  ];
  const child = spawn(executable, args, { detached: false, stdio: "ignore", windowsHide: true });
  let launchError;
  child.once("error", (error) => { launchError = error; });
  const startedAt = Date.now();
  let port;
  while (Date.now() - startedAt < 15000) {
    if (launchError) throw new Error(`Não foi possível iniciar Chrome/Edge QA: ${launchError.message}`);
    if (child.exitCode !== null) throw new Error(`Chrome QA terminou antes de abrir (exit ${child.exitCode}).`);
    try {
      const [portText] = (await readFile(activePortFile, "utf8")).split(/\r?\n/u);
      port = Number(portText);
      if (Number.isInteger(port) && port > 0) break;
    } catch {}
    await delay(100);
  }
  if (!port) {
    child.kill();
    throw new Error("Chrome QA não publicou o endpoint CDP em 15 segundos.");
  }
  const state = { contract_version: "0.1", run_id: paths.runId, route: paths.route, pid: child.pid, port, executable, created_at: new Date().toISOString() };
  await saveState(paths, state);
  child.unref();
  return state;
}

async function getCdpState(options, paths, executable) {
  let state = await readState(paths, paths.route, options.runId);
  if (!state && options.action !== "preflight") throw new Error("Rota do navegador não iniciada; execute primeiro o preflight.");
  if (!state) state = await launchCdp({ ...paths, runId: options.runId }, executable);
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/json/version`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("Chrome QA local não respondeu ao endpoint CDP.");
    return { state, endpoint: localCdpEndpoint((await response.json()).webSocketDebuggerUrl) };
  } catch (error) {
    throw new Error(`Chrome QA isolado está indisponível; reconcilie e encerre o processo próprio antes de novo preflight: ${error.message}`);
  }
}

async function cdpTarget(client) {
  const { targetInfos } = await client.send("Target.getTargets");
  let target = targetInfos.find((item) => item.type === "page");
  if (!target) {
    const created = await client.send("Target.createTarget", { url: "about:blank" });
    target = { targetId: created.targetId };
  }
  const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("DOM.enable", {}, sessionId);
  return { sessionId, targetId: target.targetId };
}

async function cdpEvaluate(client, expression, sessionId) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error("A interação no navegador falhou ao avaliar o elemento solicitado.");
  return result.result?.value;
}

async function cdpAction(options, paths, executable) {
  const { state } = await getCdpState(options, paths, executable);
  const response = await fetch(`http://127.0.0.1:${state.port}/json/version`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("Chrome QA local não respondeu ao endpoint CDP.");
  const client = cdpClient(localCdpEndpoint((await response.json()).webSocketDebuggerUrl));
  try {
    await client.ready();
    const { sessionId } = await cdpTarget(client);
    if (options.action === "preflight" || options.action === "navigate") {
      const url = assertLocalUrl(options.url);
      await client.send("Page.navigate", { url: url.href }, sessionId);
      let ready = "loading";
      const until = Date.now() + 12000;
      while (Date.now() < until && ready === "loading") {
        await delay(100);
        ready = await cdpEvaluate(client, "document.readyState", sessionId);
      }
      if (ready === "loading") throw new Error("A página local não concluiu a navegação no preflight.");
    } else if (options.action === "click") {
      const selector = JSON.stringify(requireOption(options, "selector"));
      const result = await cdpEvaluate(client, `(() => { const e=document.querySelector(${selector}); if(!e) return 'not_found'; e.click(); return 'clicked'; })()`, sessionId);
      if (result !== "clicked") throw new Error("Seletor não encontrado no documento.");
    } else if (options.action === "fill") {
      const selector = JSON.stringify(requireOption(options, "selector"));
      const value = JSON.stringify(inputValue(options));
      const result = await cdpEvaluate(client, `(() => { const e=document.querySelector(${selector}); if(!e) return 'not_found'; e.focus(); const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set; if(setter) setter.call(e,${value}); else e.textContent=${value}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 'filled'; })()`, sessionId);
      if (result !== "filled") throw new Error("Seletor não encontrado no documento.");
    } else if (options.action === "upload") {
      const selector = requireOption(options, "selector");
      const filePath = await resolveFixtureFile(paths, requireOption(options, "filePath"));
      const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true }, sessionId);
      const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector }, sessionId);
      if (!nodeId) throw new Error("Seletor do campo de arquivo não encontrado no documento.");
      await client.send("DOM.setFileInputFiles", { files: [filePath], nodeId }, sessionId);
    } else if (options.action === "press") {
      const key = requireOption(options, "key");
      const allowed = new Set(["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Backspace", "Delete", "Space"]);
      if (!allowed.has(key)) throw new Error("Tecla não permitida pela interface CDP; use Enter, Tab, Escape, setas, Backspace, Delete ou Space.");
      await client.send("Input.dispatchKeyEvent", { type: "keyDown", key }, sessionId);
      await client.send("Input.dispatchKeyEvent", { type: "keyUp", key }, sessionId);
    } else if (options.action === "viewport") {
      await client.send("Emulation.setDeviceMetricsOverride", { width: integer(options.width, "width"), height: integer(options.height, "height"), deviceScaleFactor: 1, mobile: false }, sessionId);
    } else if (options.action !== "inspect" && options.action !== "screenshot") {
      throw new Error(`Ação CDP não suportada: ${options.action}`);
    }
    const page = await cdpEvaluate(client, "({url:location.href,title:document.title,readyState:document.readyState,text:document.body?.innerText||'',controls:[...document.querySelectorAll('button,a,input,select,textarea,[role=button]')].slice(0,200).map(e=>({tag:e.tagName.toLowerCase(),role:e.getAttribute('role'),text:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').trim().slice(0,300),type:e.getAttribute('type'),disabled:Boolean(e.disabled||e.getAttribute('aria-disabled')==='true')}))})", sessionId);
    if (!page || !LOCAL_HOSTS.has(new URL(page.url).hostname.toLowerCase())) throw new Error("O navegador saiu da origem local permitida; navegação externa foi interrompida.");
    state.url = page.url;
    await saveState(paths, state);
    const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
    const screenshotPath = await writeScreenshot(paths, options.output, Buffer.from(screenshot.data, "base64"));
    return {
      status: "PASS", route: "cdp", action: options.action, ...publicPageInfo(page.url, page.title, page.readyState, page.text),
      controls: page.controls, screenshot: screenshotPath, isolated_profile: paths.profilePath
    };
  } finally { client.close(); }
}

async function stopBrowser(paths, route, state) {
  let browserClosed = !state?.pid;
  let processVerified = false;
  if (state?.pid) {
    try {
      const response = await fetch(`http://127.0.0.1:${state.port}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const client = cdpClient((await response.json()).webSocketDebuggerUrl);
        try {
          await client.ready();
          const commandLine = await client.send("Browser.getBrowserCommandLine");
          const expectedArg = `--user-data-dir=${paths.profilePath}`.toLowerCase();
          const normalizedProfile = resolve(paths.profilePath).replaceAll("/", "\\").toLowerCase();
          processVerified = commandLine.arguments?.some((argument) => argument.toLowerCase().includes("--user-data-dir") && resolve(argument.replaceAll('"', "").split("=", 2)[1] ?? "").replaceAll("/", "\\").toLowerCase() === normalizedProfile) === true;
          if (!processVerified) await client.send("Browser.close").catch(() => {});
        } finally { client.close(); }
      }
    } catch {}
    if (processVerified && process.platform === "win32") {
      const terminated = spawnSync("taskkill.exe", ["/PID", String(state.pid), "/T", "/F"], { encoding: "utf8", windowsHide: true });
      if (terminated.status !== 0) processVerified = false;
    } else if (processVerified) {
      try { process.kill(state.pid, "SIGTERM"); } catch {}
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await fetch(`http://127.0.0.1:${state.port}/json/version`, { signal: AbortSignal.timeout(300) });
        await delay(100);
      } catch { browserClosed = true; break; }
    }
    if (!processVerified) throw new Error("O processo Chrome não apresentou a prova CDP do perfil deste RUN_ID; o runtime preservou o perfil e não encerrou processo incerto.");
    if (!browserClosed) throw new Error("O navegador QA ainda está ativo; o runtime preservou o perfil para não apagar arquivos em uso.");
  }
  await rm(paths.profilePath, { recursive: true, force: true });
  await rm(paths.fixturesPath, { recursive: true, force: true });
  await rm(paths.statePath, { force: true });
  if (existsSync(paths.profilePath) || existsSync(paths.fixturesPath) || existsSync(paths.statePath)) throw new Error("O perfil QA ou as fixtures ainda contêm arquivos em uso; o runtime não registrou a limpeza como concluída.");
  return { status: "PASS", action: "stop", route, profile_removed: true, process_tree_stopped: Boolean(state?.pid), evidence_preserved: true };
}

export async function runQaBrowser(input) {
  const action = requireOption(input, "action");
  const route = requireOption(input, "route");
  if (!["preflight", "navigate", "inspect", "screenshot", "click", "fill", "upload", "press", "viewport", "stop"].includes(action)) throw new Error(`Ação não suportada: ${action}`);
  if (!["playwright", "cdp"].includes(route)) throw new Error("--route deve ser playwright ou cdp.");
  const projectRoot = resolve(requireOption(input, "projectRoot"));
  const runId = requireOption(input, "runId");
  if (action === "preflight" || action === "navigate") assertLocalUrl(requireOption(input, "url"));
  const paths = browserWorkspace(projectRoot, runId, route);
  paths.runId = runId;
  await mkdir(paths.routeRoot, { recursive: true });
  const physicalRoot = await realpath(projectRoot);
  const physicalRoute = await realpath(paths.routeRoot);
  const physicalRelative = relative(physicalRoot, physicalRoute);
  if (!physicalRelative || physicalRelative === ".." || physicalRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(physicalRelative)) {
    throw new Error("O diretório físico de QA saiu da raiz do projeto; operação recusada.");
  }
  await mkdir(paths.profilePath, { recursive: true });
  if ((await lstat(paths.profilePath)).isSymbolicLink()) throw new Error("O perfil QA não pode ser um link simbólico.");
  const physicalProfile = await realpath(paths.profilePath);
  const profileRelative = relative(physicalRoute, physicalProfile);
  if (!profileRelative || profileRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(profileRelative)) {
    throw new Error("O perfil físico do navegador saiu do diretório isolado do run; operação recusada.");
  }
  const state = await readState(paths, route, runId);
  if (action === "stop") return stopBrowser(paths, route, state);
  const executable = chromeExecutable(input.executablePath);
  if (!executable) throw new Error("Chrome/Edge está indisponível; configure CHROME_PATH ou --executable-path com o navegador local do QA.");
  const active = await getCdpState(input, paths, executable);
  if (route === "playwright") return playwrightAction(input, paths, active.endpoint, active.state);
  return cdpAction(input, paths, executable);
}

export async function serveQaBrowserSession(sessionOptions, input = process.stdin, output = process.stdout) {
  const route = requireOption(sessionOptions, "route");
  if (!["playwright", "cdp"].includes(route)) throw new Error("--route deve ser playwright ou cdp.");
  const projectRoot = resolve(requireOption(sessionOptions, "projectRoot"));
  const runId = requireOption(sessionOptions, "runId");
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("--run-id inválido.");

  const lines = createInterface({ input, crlfDelay: Infinity });
  let stopped = false;
  let stopPromise;
  const stop = async () => {
    if (stopPromise) return stopPromise;
    stopped = true;
    stopPromise = runQaBrowser({ action: "stop", route, projectRoot, runId }).catch((error) => ({
      status: "FAIL",
      action: "stop",
      route,
      diagnostic: { message: error.message }
    }));
    return stopPromise;
  };
  const write = (payload) => output.write(`${JSON.stringify(payload)}\n`);

  for await (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
      if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Cada linha precisa ser um objeto JSON.");
      if (request.route !== undefined && request.route !== route) throw new Error("A rota não pode mudar durante uma sessão do navegador.");
      if (request.projectRoot !== undefined && resolve(request.projectRoot) !== projectRoot) throw new Error("A raiz do projeto não pode mudar durante uma sessão do navegador.");
      if (request.runId !== undefined && request.runId !== runId) throw new Error("O RUN_ID não pode mudar durante uma sessão do navegador.");
      if (request.action === "shutdown") {
        const result = await stop();
        write({ id: request.id ?? null, status: result.status, action: "shutdown", route, cleanup: result });
        break;
      }
      if (stopped) throw new Error("A sessão do navegador já foi encerrada.");
      const result = await runQaBrowser({ ...sessionOptions, ...request, route, projectRoot, runId });
      if (request.action === "stop") stopped = true;
      write({ id: request.id ?? null, ...result });
    } catch (error) {
      write({ id: request?.id ?? null, status: "FAIL", action: request?.action ?? null, route, diagnostic: { message: error.message } });
    }
  }
  if (!stopped) await stop();
}

const invokedDirectly = process.argv[1] && basename(process.argv[1]) === "qa-browser.mjs" && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write("Uso: pipeline.ps1 qa-browser --action <preflight|navigate|inspect|screenshot|click|fill|upload|press|viewport|stop|serve> --route <playwright|cdp> --project-root <raiz> --run-id <RUN_ID> [opções]\nUpload aceita apenas arquivo sintético relativo a .pipeline/tmp/qa-browser/<RUN_ID>/<rota>/fixtures/.\nQuando action=serve, envie um objeto JSON por linha pela entrada padrão; use {\"action\":\"shutdown\"} para encerrar.\n");
    else if (options.action === "serve") await serveQaBrowserSession(options);
    else {
      const result = await runQaBrowser(options);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`pipeline-qa-browser: ${error.message}\n`);
    process.exitCode = 1;
  }
}
