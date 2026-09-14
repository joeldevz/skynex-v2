import { lstat, realpath } from "node:fs/promises"
import { relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { createSkyAgentsBackend, defaultDependencies, resolveGlobalSkynexRoots, type Profile } from "./core/index.js"
import { SkyAgents } from "./rpc.js"

export default {
  id: "skynex-sky-agents.server",
  async setup(context) {
    const source = fileURLToPath(import.meta.url)
    const roots = resolveGlobalSkynexRoots()
    await lstat(source)
    const [actualSource, actualRoot] = await Promise.all([realpath(source), realpath(roots.configRoot)])
    const location = relative(resolve(actualRoot), resolve(actualSource))
    if (location === "" || location === ".." || location.startsWith(`..${sep}`) || resolve(location) === location) {
      throw new Error("Sky Agents plugin must be loaded from the canonical global OpenCode config root")
    }
    const backend = createSkyAgentsBackend(defaultDependencies())
    return context.rpc.register(SkyAgents, {
      listProfiles: () => backend.store.list(),
      getProfile: (input: { name: string }) => backend.store.get(input.name),
      saveProfile: async (input: { profile: Profile }) => {
        await backend.store.save(input.profile)
        return { ok: true }
      },
      updateProfile: async (input: { profile: Profile }) => {
        await backend.store.update(input.profile)
        return { ok: true }
      },
      deleteProfile: async (input: { name: string }) => {
        await backend.store.remove(input.name)
        return { ok: true }
      },
      previewProfileApply: (input: { name: string; config: "json" | "jsonc" }) => backend.previewApply(input.name, input.config),
    })
  },
}
