import assert from "node:assert/strict";
import test from "node:test";

import { resolveExecutionProfile } from "../src/execution-profiles.mjs";

const expected = {
  RAPIDO: ["gpt-6-luna", "low"],
  EQUILIBRADO: ["gpt-6-luna", "medium"],
  PROFUNDO: ["gpt-6.1-sol", "high"],
  MAXIMO: ["gpt-6.1-sol", "max"]
};

for (const [profile, [model, effort]] of Object.entries(expected)) {
  test(`resolve ${profile} de forma determinística`, () => {
    const result = resolveExecutionProfile(profile, "pipeline-dev");
    assert.equal(result.model, model);
    assert.equal(result.reasoning_effort, effort);
    assert.equal(result.mapping_version, "modus-model-map-0.3.7");
    assert.equal(result.fallback_policy, "block");
  });
}

test("Code Review e QA exigem agente independente", () => {
  const review = resolveExecutionProfile("PROFUNDO", "pipeline-code-review");
  assert.equal(review.agent_mode, "independent");
  assert.equal(review.model, "gpt-6.1-sol");
  assert.equal(review.reasoning_effort, "high");
  assert.equal(resolveExecutionProfile("PROFUNDO", "pipeline-dev").model, "gpt-6.1-sol");
  assert.equal(resolveExecutionProfile("EQUILIBRADO", "pipeline-qa").agent_mode, "independent");
});

test("PARALELO é modo de orquestração e não esforço ultra implícito", () => {
  const result = resolveExecutionProfile("PARALELO", "pipeline-dev");
  assert.equal(result.agent_mode, "parallel");
  assert.equal(result.model, "gpt-6.1-sol");
  assert.equal(result.reasoning_effort, "high");
});
