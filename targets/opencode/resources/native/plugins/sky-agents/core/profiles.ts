import { join } from "node:path"
import { atomicWrite, readFileSafe, safeDirectory } from "./storage.js"

export const MAX_PROFILE_BYTES = 64 * 1024
export const MAX_PROFILES = 100
export const APPROVED_AGENT_IDS = ["coder", "diagnostic-researcher", "infrastructure-engineer", "mentor", "pr-reviewer", "security", "skill-validator", "thalam", "task-classifier", "tech-planner", "test-engineer", "test-reviewer", "verifier"] as const
export interface Profile { name: string; created_at: string; updated_at: string; models: Record<string, string>; [key: string]: unknown }
export interface ProfileStore { list(): Promise<Profile[]>; get(id: string): Promise<Profile | null>; save(profile: Profile): Promise<void>; update(profile: Profile): Promise<void>; remove(id: string): Promise<void> }
export function validateProfileName(name: string): void {
  if (typeof name !== "string" || !/^[a-z0-9-]{1,32}$/.test(name) || name === "default") throw new Error("Invalid profile name")
}
export function validateProfile(profile: Profile): void {
  validateProfileName(profile.name)
  if (!Number.isFinite(Date.parse(profile.created_at)) || !Number.isFinite(Date.parse(profile.updated_at))) throw new Error("Invalid profile dates")
  if (!profile.models || Array.isArray(profile.models) || Object.getPrototypeOf(profile.models) !== Object.prototype) throw new Error("Invalid profile models")
  const ids = Object.keys(profile.models).sort()
  if (ids.length !== APPROVED_AGENT_IDS.length || ids.some((id, index) => id !== [...APPROVED_AGENT_IDS].sort()[index])) throw new Error("Profile must contain exactly the approved 13 agents")
  for (const [agent, model] of Object.entries(profile.models)) {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(agent) || typeof model !== "string" || !/^[a-zA-Z0-9._-]{1,64}\/[a-zA-Z0-9._-]{1,128}(?:#[a-zA-Z0-9._-]{1,64})?$/.test(model)) throw new Error("Invalid profile model reference")
  }
}
export function normalizeProfileAgentIdentity(profile: Profile): { profile: Profile; migrated: boolean } {
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || !profile.models || typeof profile.models !== "object" || Array.isArray(profile.models)) throw new Error("Invalid profile")
  const old = Object.hasOwn(profile.models, "skynex-orchestrator"), current = Object.hasOwn(profile.models, "thalam")
  if (old && current) throw new Error("Profile agent identity conflict: both skynex-orchestrator and thalam are present")
  const models = { ...profile.models }
  if (old) { models.thalam = models["skynex-orchestrator"]!; delete models["skynex-orchestrator"] }
  return { profile: { ...profile, models }, migrated: old }
}
function decode(text: string, name: string): Profile { const value: unknown = JSON.parse(text); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid profile"); const profile = normalizeProfileAgentIdentity(value as Profile).profile; if (profile.name !== name) throw new Error("Invalid profile name"); validateProfile(profile); return profile }
export function createProfileStore(root: string): ProfileStore {
  const file = (name: string) => join(root, `${name}.json`)
  return {
    async list() {
      if (!await safeDirectory(root)) return []
      const { readdir } = await import("node:fs/promises")
      const names = (await readdir(root, { withFileTypes: true })).filter((e) => e.name.endsWith(".json")).map((e) => e.name.slice(0, -5)).sort()
      if (names.length > MAX_PROFILES) throw new Error("Too many profiles")
      return Promise.all(names.map(async (name) => { validateProfileName(name); const text = await readFileSafe(file(name), MAX_PROFILE_BYTES); if (text === undefined) throw new Error("Profile disappeared"); return decode(text, name) }))
    },
    async get(name) { validateProfileName(name); const text = await readFileSafe(file(name), MAX_PROFILE_BYTES); return text === undefined ? null : decode(text, name) },
    async save(profile) { validateProfile(profile); const path = file(profile.name); if (await readFileSafe(path, MAX_PROFILE_BYTES) !== undefined) throw new Error("Profile already exists"); const text = JSON.stringify(profile, null, 2) + "\n"; if (Buffer.byteLength(text) > MAX_PROFILE_BYTES) throw new Error("Profile too large"); await atomicWrite(path, text) },
    async update(profile) { validateProfile(profile); const path = file(profile.name); if (await readFileSafe(path, MAX_PROFILE_BYTES) === undefined) throw new Error("Profile not found"); const text = JSON.stringify(profile, null, 2) + "\n"; if (Buffer.byteLength(text) > MAX_PROFILE_BYTES) throw new Error("Profile too large"); await atomicWrite(path, text) },
    async remove(name) { validateProfileName(name); const { unlink } = await import("node:fs/promises"); const text = await readFileSafe(file(name), MAX_PROFILE_BYTES); if (text === undefined) throw new Error("Profile not found"); await unlink(file(name)) },
  }
}
