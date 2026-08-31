import assert from "node:assert/strict";
import test from "node:test";

import { resolveExecutionProfile } from "../src/execution-profiles.mjs";

const expected = {
  RAPIDO: ["gpt-5.6-luna", "low"],
  EQUILIBRADO: ["gpt-5.6-terra", "medium"],
  PROFUNDO: ["gpt-5.6-sol", "high"],
  MAXIMO: ["gpt-5.6-sol", "max"]
};

for (const [profile, [model, effort]] of Object.entries(expected)) {
  test(`resolve ${profile} de forma determinística`, () => {
    const result = resolveExecutionProfile(profile, "pipeline-dev");
    assert.equal(result.model, model);
    assert.equal(result.reasoning_effort, effort);
    assert.equal(result.fallback_policy, "block");
  });
}

test("Code Review e QA exigem agente independente", () => {
  assert.equal(resolveExecutionProfile("PROFUNDO", "pipeline-code-review").agent_mode, "independent");
  assert.equal(resolveExecutionProfile("EQUILIBRADO", "pipeline-qa").agent_mode, "independent");
});

test("PARALELO é modo de orquestração e não esforço ultra implícito", () => {
  const result = resolveExecutionProfile("PARALELO", "pipeline-dev");
  assert.equal(result.agent_mode, "parallel");
  assert.equal(result.model, "gpt-5.6-sol");
  assert.equal(result.reasoning_effort, "high");
});

