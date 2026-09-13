import { SkyAgents } from "./rpc.js"

type Profile = { name: string; created_at: string; updated_at: string; models: Record<string, string> }
type Model = { providerID: string; modelID: string; variant?: string; name?: string }
const AGENTS = ["coder", "diagnostic-researcher", "infrastructure-engineer", "mentor", "pr-reviewer", "security", "skill-validator", "skynex-orchestrator", "task-classifier", "tech-planner", "test-engineer", "test-reviewer", "verifier"]

export default {
  id: "skynex-sky-agents.tui",
  setup(context) {
    const rpc = context.client.rpc(SkyAgents)
    const edit = async (profile: Profile, models: Model[], update: boolean) => {
      const values = { ...profile.models }
      for (const agent of AGENTS) {
        const model = await context.ui.dialog.select<Model>({ title: `Model for ${agent}`, options: models.map((item) => ({ title: item.name || item.modelID, value: item, description: `${item.providerID}/${item.modelID}` })), current: models.find((item) => `${item.providerID}/${item.modelID}${item.variant ? `#${item.variant}` : ""}` === values[agent]) })
        if (!model) return
        values[agent] = `${model.providerID}/${model.modelID}${model.variant ? `#${model.variant}` : ""}`
      }
      const result = { ...profile, models: values, updated_at: new Date().toISOString() }
      if (update) await rpc.updateProfile({ profile: result }); else await rpc.saveProfile({ profile: result })
      context.ui.toast.show({ title: "Sky Agents", message: `Profile ${profile.name} saved` })
    }
    const open = async () => {
      try {
        const location = context.location ?? context.data.location.default()
        await context.data.location.model.sync(location)
        const profiles = await rpc.listProfiles() as Profile[]
        const selected = await context.ui.dialog.select<Profile>({
          title: "Sky Agents profiles",
          placeholder: "Select a profile or create one",
          options: [{ title: "Create profile", value: {} as Profile, category: "Actions" }, ...profiles.map((profile) => ({ title: profile.name, value: profile, description: "Edit, delete, or apply" }))],
        })
        if (!selected) return
        if (selected.name === undefined) {
          const name = await context.ui.dialog.prompt({ title: "New profile", placeholder: "lowercase-name" })
          if (!name) return
          const models = (context.data.location.model.list(location) ?? []) as Model[]
          await edit({ name, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), models: {} }, models, false)
          return
        }
        const action = await context.ui.dialog.select<string>({ title: selected.name, options: [{ title: "Edit", value: "edit" }, { title: "Apply", value: "apply" }, { title: "Delete", value: "delete" }, { title: "Cancel", value: "cancel" }] })
        if (action === "edit") { const models = (context.data.location.model.list(location) ?? []) as Model[]; await edit(selected, models, true) }
        if (action === "delete") { await rpc.deleteProfile({ name: selected.name }); context.ui.toast.show({ title: "Sky Agents", message: "Profile deleted" }) }
        if (action === "apply") {
          const plan = await rpc.previewProfileApply({ name: selected.name, config: "jsonc" })
           const confirmed = await context.ui.dialog.confirm({ title: "Preview profile apply?", description: JSON.stringify(plan.changes, null, 2) })
           if (!confirmed) return
           context.ui.toast.show({ title: "Sky Agents", message: `No files changed. Run: skynex profile apply --name ${selected.name}` })
        }
      } catch (error) { context.ui.toast.show({ variant: "error", title: "Sky Agents", message: error instanceof Error ? error.message : String(error) }) }
    }
    return context.ui.slot({ append: "app", render: () => { context.keymap.layer(() => ({ mode: "global", priority: 10, commands: [{ id: "skynex.sky-agents", title: "Sky Agents profiles", group: "Skynex", palette: true, slash: { name: "sky-agents" }, run: open }] })); return null } })
  },
}
