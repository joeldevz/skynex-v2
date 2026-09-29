import { bound, identifier, projection, publication, record, SessionTask, snapshot, updateSchema } from "./snapshot.ts"
import type { Snapshot } from "./snapshot.ts"
import { readSecurity, readTask, shouldBlock } from "./review-gate.ts"
import type { ReadSecurity, ReadTask } from "./review-gate.ts"

type Registration = { dispose(): Promise<void> }
type Location = { directory: string; workspaceID?: string }
type Host = {
  location: Location & { project: { id: string } }
  storage: { get(key: string): Promise<unknown>; set(key: string, value: Snapshot): Promise<void>; remove(key: string): Promise<void> }
  session: {
    get(input: { sessionID: string }): Promise<{ id: string; projectID: string; location: Location }>
    hook(name: "context", callback: (event: { agent: string; system: { type: "text"; text: string }[] }) => void): Promise<Registration>
  }
  tool: {
    hook(name: "execute.before" | "execute.after", callback: (event: {
      tool: string; readonly sessionID: string; readonly agent: string; readonly messageID: string; readonly id: string; input: unknown
    }) => Promise<void> | void): Promise<Registration>
    transform(callback: (editor: { add(tool: {
    name: string; description: string; input: typeof updateSchema
    execute(input: unknown, context: { sessionID: string; signal: AbortSignal }): Promise<{ content: string }>
  }): void }) => void): Promise<Registration> }
  rpc: { register(definition: typeof SessionTask, handlers: {
    getSessionTask(input: unknown): Promise<Snapshot | null>
  }): Promise<Registration> }
}
const instruction = "Skynex Tasks: al iniciar/reanudar, obtén la tarea con la CLI skynex task: skynex task status --task <id> --json; luego vincula la sesión con skynex_task_update {task:{id}} (basta el id; el plugin lee el estado vivo de la CLI y lo refresca tras cada comando skynex task, no hace falta republicar al cambiar pasos). También se acepta el resumen completo id,title,status,doneCount,total,current,next,blockers,steps y reviews {security} tal como lo da la CLI. No inventes estados ni envíes cuerpos, instrucciones o evidencias, sesión ni ruta. Sin tarea asignada: task:null."
// L2: shell tool names whose `input.command` may run the CLI; refresh is event-driven, never timed.
const shellTools = new Set(["bash", "shell"])
const runsTaskCli = (tool: string, input: unknown) => shellTools.has(tool) && typeof input === "object" && input !== null &&
  typeof (input as { command?: unknown }).command === "string" && (input as { command: string }).command.includes("skynex task")

export const createServer = (deps: { readTask: ReadTask; readSecurity: ReadSecurity }) => ({
  id: "skynex-tasks.server",
  async setup(ctx: Host) {
    const registrations: Registration[] = []
    const refreshed = new Set<string>()
    const inFlight = new Map<string, { taskId: string; done: Promise<void> }>()
    const storedTask = async (key: string) => {
      const stored = await ctx.storage.get(key)
      return stored === undefined || stored === null ? undefined : snapshot(stored).task
    }
    // L2: one deduped CLI read per key; any failure keeps the published snapshot.
    const refresh = (key: string, taskId: string): Promise<void> => {
      const running = inFlight.get(key)
      if (running && running.taskId === taskId) return running.done
      refreshed.add(key)
      const entry: { taskId: string; done: Promise<void> } = { taskId, done: Promise.resolve() }
      entry.done = (async () => {
        try {
          const task = projection(await deps.readTask(taskId, ctx.location.directory), true)
          if (task.id !== taskId || (await storedTask(key))?.id !== taskId) return
          await ctx.storage.set(key, { task, updatedAt: Date.now() })
        } catch { /* keep the published snapshot */ }
        finally { if (inFlight.get(key) === entry) inFlight.delete(key) }
      })()
      inFlight.set(key, entry)
      return entry.done
    }
    const keyFor = async (sessionID: string) => {
      const session = await ctx.session.get({ sessionID })
      if (session.id !== sessionID || session.location.directory !== ctx.location.directory ||
          session.location.workspaceID !== ctx.location.workspaceID || session.projectID !== ctx.location.project.id) return null
      // Tuple encoding avoids delimiter collisions and object/prototype keyed maps.
      return `session-task/v1/${encodeURIComponent(JSON.stringify([
        session.projectID, session.location.directory, session.location.workspaceID ?? null, sessionID,
      ]))}`
    }
    const cleanup = async () => { await Promise.all(registrations.map((registration) => registration.dispose())) }
    try {
      registrations.push(await ctx.tool.transform((editor) => editor.add({
        name: "skynex_task_update",
        description: "Publica el resumen CLI y todos los pasos (id/title/status, orden CLI, máximo 999) de la tarea de esta sesión; task:null borra la asignación. No modifica la tarea CLI.",
        input: updateSchema,
        async execute(input, context) {
          try {
            const data = record(input, ["task"])
            const published = publication(data.task)
            const key = await keyFor(identifier(context.sessionID, true))
            if (!key || context.signal.aborted) throw new Error()
            if (published === null) await ctx.storage.remove(key)
            else {
              const current = "title" in published ? undefined : await storedTask(key).catch(() => undefined)
              const task = "title" in published ? published : current?.id === published.id ? current : bound(published.id)
              await ctx.storage.set(key, { task, updatedAt: Date.now() })
              await refresh(key, task.id)
            }
            return { content: published === null ? "Asignación eliminada." : "Resumen de tarea publicado." }
          } catch { throw new Error("No se pudo publicar el resumen de tarea.") }
        },
      })))
      registrations.push(await ctx.session.hook("context", (event) => {
        if (event.agent === "thalam") event.system.push({ type: "text", text: instruction })
      }))
      // E1/E4: enforce reviews.security=off; any failure resolving the task allows the call.
      registrations.push(await ctx.tool.hook("execute.before", async (event) => {
        if (event.tool !== "subagent") return
        let snapshotTaskId: string | undefined
        try {
          const key = await keyFor(identifier(event.sessionID, true))
          const stored = key ? await ctx.storage.get(key) : undefined
          snapshotTaskId = stored === undefined || stored === null ? undefined : snapshot(stored).task.id
        } catch { return }
        if (await shouldBlock({ tool: event.tool, input: event.input, snapshotTaskId, cwd: ctx.location.directory, readSecurity: deps.readSecurity }))
          throw new Error("Revisión de seguridad desactivada por la tarea (reviews.security=off).")
      }))
      registrations.push(await ctx.tool.hook("execute.after", async (event) => {
        if (!runsTaskCli(event.tool, event.input)) return
        try {
          const key = await keyFor(identifier(event.sessionID, true))
          const task = key ? await storedTask(key) : undefined
          if (key && task) await refresh(key, task.id)
        } catch { /* never affect the tool result */ }
      }))
      registrations.push(await ctx.rpc.register(SessionTask, {
        async getSessionTask(input) {
          try {
            const { sessionID } = record(input, ["sessionID"])
            const key = await keyFor(identifier(sessionID, true))
            if (!key) return null
            const stored = await ctx.storage.get(key)
            if (stored === undefined || stored === null) return null
            let current: Snapshot
            try { current = snapshot(stored) } catch { return null }
            if (refreshed.has(key) && !inFlight.has(key)) return current
            await refresh(key, current.task.id)
            const fresh = await ctx.storage.get(key)
            if (fresh === undefined || fresh === null) return null
            try { return snapshot(fresh) } catch { return null }
          } catch { throw new Error("No se pudo consultar la tarea de esta sesión.") }
        },
      }))
    } catch (error) { await cleanup(); throw error }
    return cleanup
  },
})

export default createServer({ readTask, readSecurity })
