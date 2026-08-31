const MAPPING_VERSION = "gpt-5.6-2026-08-28";

const PROFILES = Object.freeze({
  RAPIDO: Object.freeze({ model: "gpt-5.6-luna", reasoning_effort: "low" }),
  EQUILIBRADO: Object.freeze({ model: "gpt-5.6-terra", reasoning_effort: "medium" }),
  PROFUNDO: Object.freeze({ model: "gpt-5.6-sol", reasoning_effort: "high" }),
  MAXIMO: Object.freeze({ model: "gpt-5.6-sol", reasoning_effort: "max" }),
  PARALELO: Object.freeze({ model: "gpt-5.6-sol", reasoning_effort: "high" })
});

const INDEPENDENT_ROLES = new Set(["pipeline-code-review", "pipeline-qa"]);

export function resolveExecutionProfile(profile, role) {
  const selected = PROFILES[profile];
  if (!selected) throw new Error(`Perfil de execução desconhecido: ${profile}`);
  return {
    mapping_version: MAPPING_VERSION,
    profile,
    model: selected.model,
    reasoning_effort: selected.reasoning_effort,
    agent_mode:
      profile === "PARALELO" ? "parallel" : INDEPENDENT_ROLES.has(role) ? "independent" : "delegated",
    configuration_source: "kernel-profile-map",
    fallback_policy: "block"
  };
}

export const EXECUTION_PROFILE_MAPPING = PROFILES;

