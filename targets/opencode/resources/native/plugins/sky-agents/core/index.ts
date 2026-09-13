import { join } from "node:path"
import { createProfileStore, type ProfileStore } from "./profiles.js"
import { resolveGlobalSkynexRoots } from "./roots.js"
import type { Profile } from "./profiles.js"
import { createProfileApplyService, type ProfileApplyPlan, type ProfileApplyResult, type ProfileApplyRoots } from "./profile-apply.js"

export interface Preview { profile: Profile; current: Record<string, string>; digest: string }
export interface SkyAgentsDependencies { stateRoot: string; configRoot: string; readCurrentModels?: () => Promise<Record<string, string>> }
export interface SkyAgentsBackend {
  store: ProfileStore
  preview(profileId: string): Promise<Preview>
  previewApply(profileId: string, preference: "json" | "jsonc"): Promise<ProfileApplyPlan>
  authorizeProfileApply(planDigest: string): string
  applyProfile(plan: ProfileApplyPlan, confirmationToken: string): Promise<ProfileApplyResult>
}
export function createSkyAgentsBackend(deps: SkyAgentsDependencies): SkyAgentsBackend {
  const store = createProfileStore(join(deps.stateRoot, "profiles"))
  const applyService = createProfileApplyService({ scope: "global", targetRoot: deps.configRoot, stateRoot: deps.stateRoot }, store)
  return {
    store,
    async preview(profileId) { const profile = await store.get(profileId); if (!profile) throw new Error("Profile not found"); const current = await (deps.readCurrentModels?.() ?? Promise.resolve({})); const { createHash } = await import("node:crypto"); const digest = createHash("sha256").update(JSON.stringify({ profile, current })).digest("hex"); return { profile, current, digest } },
    previewApply: applyService.preview,
    authorizeProfileApply: applyService.authorize,
    applyProfile: applyService.apply,
  }
}
export function defaultDependencies(root?: string, configRoot?: string): SkyAgentsDependencies {
  const resolved = resolveGlobalSkynexRoots()
  return { stateRoot: root ?? resolved.stateRoot, configRoot: configRoot ?? resolved.configRoot }
}
export { createProfileStore, type Profile, type ProfileStore } from "./profiles.js"
export { SkyAgents } from "./rpc.js"
export { createProfileApplyService, type ProfileApplyPlan, type ProfileApplyResult, type ProfileApplyDependencies, type ProfileApplyRoots } from "./profile-apply.js"
export { resolveGlobalSkynexRoots, type GlobalSkynexRoots } from "./roots.js"
