// Plain JSON Schema only: this file is copied into an isolated native plugin.
const string = { type: "string" } as const
const model = { type: "string" } as const
const name = { type: "string" } as const
const agentIds = ["coder", "diagnostic-researcher", "infrastructure-engineer", "mentor", "pr-reviewer", "security", "skill-validator", "thalam", "task-classifier", "tech-planner", "test-engineer", "test-reviewer", "verifier"] as const
const models = Object.fromEntries(agentIds.map((id) => [id, model]))
const profile = { type: "object", additionalProperties: false, required: ["name", "created_at", "updated_at", "models"], properties: { name, created_at: string, updated_at: string, models: { type: "object", additionalProperties: false, required: [...agentIds], properties: models } } } as const
const nullableModels = Object.fromEntries(agentIds.map((id) => [id, { anyOf: [string, { type: "null" }] }]))
const plan = { type: "object", additionalProperties: false, required: ["profile", "configPath", "sourceDigest", "planDigest", "current", "desired", "changes"], properties: { profile, configPath: string, sourceDigest: string, planDigest: string, current: { type: "object", additionalProperties: false, required: [...agentIds], properties: nullableModels }, desired: { type: "object", additionalProperties: false, required: [...agentIds], properties: models }, changes: { type: "array", items: { type: "object", additionalProperties: false, required: ["agent", "from", "to"], properties: { agent: string, from: { anyOf: [string, { type: "null" }] }, to: model } } } } } as const
const input = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", additionalProperties: false, properties, required })
const method = (inputSchema: unknown, output: unknown) => ({ input: inputSchema, output, errors: {} })
const mutationResult = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } } as const
export const SkyAgents = { id: "skynex.sky-agents", events: {}, methods: {
  listProfiles: method({ type: "object", additionalProperties: false, properties: {}, required: [] }, { type: "array", items: profile }),
  getProfile: method(input({ name }, ["name"]), { anyOf: [profile, { type: "null" }] }),
  saveProfile: method(input({ profile }, ["profile"]), mutationResult), updateProfile: method(input({ profile }, ["profile"]), mutationResult), deleteProfile: method(input({ name }, ["name"]), mutationResult),
  previewProfileApply: method(input({ name, config: { enum: ["json", "jsonc"] } }, ["name", "config"]), plan),
} } as const
