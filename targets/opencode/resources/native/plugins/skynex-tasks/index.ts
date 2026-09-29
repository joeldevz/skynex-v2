import { identifier, projection, record, SessionTask, snapshot, updateSchema } from "./snapshot.ts"
import type { Snapshot } from "./snapshot.ts"
import { shouldBlock } from "./review-gate.ts"

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
    hook(name: "execute.before", callback: (event: {
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
const instruction = "Skynex Tasks: al iniciar/reanudar o cambiar pasos, usa la CLI skynex task: skynex task status --task <id> --json; luego publica con skynex_task_update id,title,status,doneCount,total,current,next,blockers (id/title; máx.20) y steps con TODOS los pasos id/title/status en orden CLI (máx.999); opcional reviews {security} con on|off|auto tal como lo da la CLI. No inventes estados ni envíes cuerpos, instrucciones o evidencias, sesión ni ruta. Sin tarea asignada: task:null. Es una instantánea, no lectura en vivo."

export default {
  id: "skynex-tasks.server",
  async setup(ctx: Host) {
    const registrations: Registration[] = []
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
            const task = data.task === null ? null : projection(data.task, true)
            const key = await keyFor(identifier(context.sessionID, true))
            if (!key || context.signal.aborted) throw new Error()
            if (task === null) await ctx.storage.remove(key)
            else await ctx.storage.set(key, { task, updatedAt: Date.now() })
            return { content: task === null ? "Asignación eliminada." : "Resumen de tarea publicado." }
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
        if (await shouldBlock({ tool: event.tool, input: event.input, snapshotTaskId, cwd: ctx.location.directory }))
          throw new Error("Revisión de seguridad desactivada por la tarea (reviews.security=off).")
      }))
      registrations.push(await ctx.rpc.register(SessionTask, {
        async getSessionTask(input) {
          try {
            const { sessionID } = record(input, ["sessionID"])
            const key = await keyFor(identifier(sessionID, true))
            if (!key) return null
            const stored = await ctx.storage.get(key)
            if (stored === undefined || stored === null) return null
            try { return snapshot(stored) } catch { return null }
          } catch { throw new Error("No se pudo consultar la tarea de esta sesión.") }
        },
      }))
    } catch (error) { await cleanup(); throw error }
    return cleanup
  },
}
