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
const instruction = "Skynex Tasks: vincula una vez la sesión con skynex_task_update {task:{id}}; no requiere status previo ni republicar pasos. El plugin consulta la CLI skynex task y refresca tras mutaciones. Consulta opcional/revisión: skynex task status --task <id> --json. Tasks es el único registro de progreso y recuperación: checkpoint show/set, sin registro paralelo. También se acepta el resumen completo CLI (parent opcional, 1 nivel) con reviews {security}. No inventes estados ni envíes cuerpos, instrucciones, evidencias, sesión ni ruta. Sin tarea asignada: task:null."
// L2: shell tool names whose `input.command` may run the CLI; refresh is event-driven, never timed.
const shellTools = new Set(["bash", "shell"])
// CLI VALUE_FLAGS consume the following value (including -h); only skip those
// values when detecting help. This does not execute or validate a CLI command.
const taskValueFlags = new Set(["--tasks-root", "--task", "--scope", "--done-when", "--evidence", "--instruction-file",
  "--instruction", "--depends-on", "--parent", "--expected-revision", "--security", "--reason", "--checkpoint"])
// A bounded lexer for simple shell command lists, not a shell interpreter. Quoted
// arguments remain single words; unsupported expansion/redirection is not guessed.
const mutatesTask = (command: string): boolean => {
  if (command.length > 32768) return false
  const commands: string[][] = []
  let words: string[] = [], word = "", active = false, quote = ""
  const flushWord = () => { if (active) words.push(word); word = ""; active = false }
  const flushCommand = () => { flushWord(); if (words.length) commands.push(words); words = [] }
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!
    if (quote) {
      if (char === quote) { quote = ""; continue }
      if (quote === '"' && (char === "$" || char === "`")) return false
      if (quote === '"' && char === "\\") {
        const next = command[++i]
        if (next === undefined) return false
        word += next; continue
      }
      word += char; continue
    }
    if (char === "'" || char === '"') { quote = char; active = true; continue }
    if (char === "$" || char === "`" || /[<>(){}]/.test(char)) return false
    if (char === "\\") {
      const next = command[++i]
      if (next === undefined) return false
      if (next !== "\n") { word += next; active = true }
      continue
    }
    if (char === "#" && !active) {
      while (i < command.length && command[i] !== "\n") i++
      flushCommand(); continue
    }
    if (char === ";" || char === "&" || char === "|" || char === "\n") { flushCommand(); continue }
    if (/\s/.test(char)) { flushWord(); continue }
    word += char; active = true
  }
  if (quote) return false
  flushCommand()
  return commands.some((args) => {
    if (args[0] !== "skynex" || args[1] !== "task") return false
    for (let i = 3; i < args.length; i++) {
      const token = args[i]!
      const value = args[i + 1]
      if (taskValueFlags.has(token) && value !== undefined && !value.startsWith("--")) { i++; continue }
      if (token === "--help" || token === "-h") return false
    }
    return args[2] === "init" || (args[2] === "next" && ["add", "start", "block", "done"].includes(args[3] ?? "")) ||
      (["reviews", "checkpoint"].includes(args[2] ?? "") && args[3] === "set")
  })
}
const runsTaskMutation = (tool: string, input: unknown) => shellTools.has(tool) && typeof input === "object" && input !== null &&
  typeof (input as { command?: unknown }).command === "string" && mutatesTask((input as { command: string }).command)

export const createServer = (deps: { readTask: ReadTask; readSecurity: ReadSecurity }) => ({
  id: "skynex-tasks.server",
  async setup(ctx: Host) {
    const registrations: Registration[] = []
    const refreshed = new Set<string>()
    const inFlight = new Map<string, { taskId: string; done: Promise<void> }>()
    const mutations = new Map<string, Promise<void>>()
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
    // Never let a mutation adopt a pre-mutation read already in flight. Queuing
    // per session key also keeps overlapping mutation events fresh without timers.
    const refreshMutation = (key: string, taskId: string): Promise<void> => {
      const previous = mutations.get(key)
      const reading = inFlight.get(key)?.done
      const done = (async () => {
        await previous
        await reading
        await refresh(key, taskId)
      })()
      mutations.set(key, done)
      return done.finally(() => { if (mutations.get(key) === done) mutations.delete(key) })
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
        description: "Publica el resumen CLI y todos los pasos (id/title/status y parent opcional, orden CLI, máximo 999) de la tarea de esta sesión; task:null borra la asignación. No modifica la tarea CLI.",
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
        if (!runsTaskMutation(event.tool, event.input)) return
        try {
          const key = await keyFor(identifier(event.sessionID, true))
          const task = key ? await storedTask(key) : undefined
          if (key && task) await refreshMutation(key, task.id)
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
