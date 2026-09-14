// This descriptor deliberately contains plain JSON Schema.  The host loads this
// file as a plugin resource, so it must not depend on the package graph.
const string = { type: "string" } as const
const model = { type: "string" } as const
const name = { type: "string" } as const
const profile = {
  type: "object", additionalProperties: false,
  required: ["name", "created_at", "updated_at", "models"],
  properties: { name, created_at: string, updated_at: string, models: {
    type: "object", additionalProperties: false,
    required: ["coder", "diagnostic-researcher", "infrastructure-engineer", "mentor", "pr-reviewer", "security", "skill-validator", "thalam", "task-classifier", "tech-planner", "test-engineer", "test-reviewer", "verifier"],
    properties: { coder: model, "diagnostic-researcher": model, "infrastructure-engineer": model, mentor: model, "pr-reviewer": model, security: model, "skill-validator": model, thalam: model, "task-classifier": model, "tech-planner": model, "test-engineer": model, "test-reviewer": model, verifier: model },
  } },
} as const
const plan = {
  type: "object", additionalProperties: false,
  required: ["profile", "configPath", "sourceDigest", "planDigest", "current", "desired", "changes"],
  properties: {
    profile, configPath: string, sourceDigest: string, planDigest: string,
    current: { type: "object", additionalProperties: false, required: ["coder", "diagnostic-researcher", "infrastructure-engineer", "mentor", "pr-reviewer", "security", "skill-validator", "thalam", "task-classifier", "tech-planner", "test-engineer", "test-reviewer", "verifier"], properties: { coder: { anyOf: [string, { type: "null" }] }, "diagnostic-researcher": { anyOf: [string, { type: "null" }] }, "infrastructure-engineer": { anyOf: [string, { type: "null" }] }, mentor: { anyOf: [string, { type: "null" }] }, "pr-reviewer": { anyOf: [string, { type: "null" }] }, security: { anyOf: [string, { type: "null" }] }, "skill-validator": { anyOf: [string, { type: "null" }] }, thalam: { anyOf: [string, { type: "null" }] }, "task-classifier": { anyOf: [string, { type: "null" }] }, "tech-planner": { anyOf: [string, { type: "null" }] }, "test-engineer": { anyOf: [string, { type: "null" }] }, "test-reviewer": { anyOf: [string, { type: "null" }] }, verifier: { anyOf: [string, { type: "null" }] } } },
    desired: { type: "object", additionalProperties: false, required: ["coder", "diagnostic-researcher", "infrastructure-engineer", "mentor", "pr-reviewer", "security", "skill-validator", "thalam", "task-classifier", "tech-planner", "test-engineer", "test-reviewer", "verifier"], properties: { coder: model, "diagnostic-researcher": model, "infrastructure-engineer": model, mentor: model, "pr-reviewer": model, security: model, "skill-validator": model, thalam: model, "task-classifier": model, "tech-planner": model, "test-engineer": model, "test-reviewer": model, verifier: model } },
    changes: { type: "array", items: { type: "object", additionalProperties: false, required: ["agent", "from", "to"], properties: { agent: string, from: { anyOf: [string, { type: "null" }] }, to: model } } },
  },
} as const
const objectInput = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", additionalProperties: false, properties, required })
const method = (input: unknown, output: unknown) => ({ input, output, errors: {} })
const mutationResult = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } } as const
export const SkyAgents = {
  id: "skynex.sky-agents", events: {}, methods: {
    listProfiles: method({ type: "object", additionalProperties: false, properties: {}, required: [] }, { type: "array", items: profile }),
    getProfile: method(objectInput({ name }, ["name"]), { anyOf: [profile, { type: "null" }] }),
    saveProfile: method(objectInput({ profile }, ["profile"]), mutationResult),
    updateProfile: method(objectInput({ profile }, ["profile"]), mutationResult),
    deleteProfile: method(objectInput({ name }, ["name"]), mutationResult),
     previewProfile: method(objectInput({ name }, ["name"]), { type: "object", additionalProperties: false, required: ["profile", "current", "digest"], properties: { profile, current: { type: "object" }, digest: string } }),
    previewProfileApply: method(objectInput({ name, config: { enum: ["json", "jsonc"] } }, ["name", "config"]), plan),
  },
} as const
