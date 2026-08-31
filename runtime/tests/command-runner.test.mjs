import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { executeAdapterCommand } from "../src/command-runner.mjs";

test("resolve python para o venv oficial do projeto", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-command-"));
  const scripts = process.platform === "win32" ? join(root, ".codex_venv", "Scripts") : join(root, ".codex_venv", "bin");
  const executable = process.platform === "win32" ? join(scripts, "python.exe") : join(scripts, "python");
  try {
    await mkdir(join(root, ".pipeline"), { recursive: true }); await mkdir(scripts, { recursive: true });
    await writeFile(executable, process.platform === "win32" ? "invalid" : "#!/bin/sh\nexit 0\n");
    if (process.platform !== "win32") await chmod(executable, 0o755);
    const adapter = { commands: { baseline: { working_directory: ".", argv: ["python", "--version"], timeout_seconds: 5, expected_exit_codes: [process.platform === "win32" ? 127 : 0] } } };
    await writeFile(join(root, ".pipeline", "project.adapter.yaml"), YAML.stringify(adapter));
    const result = executeAdapterCommand({ projectRoot: root, name: "baseline" });
    assert.equal(result.executable_source, "project-runtime");
    assert.equal(result.guarantees.shell_used, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
