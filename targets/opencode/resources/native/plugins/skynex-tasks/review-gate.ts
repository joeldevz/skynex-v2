// Only module in this plugin allowed to touch the system (design E3/L1): fixed-argv execFile,
// no shell, bounded time/output. The gate reads only `reviews.security`; readTask maps the CLI
// status into the sidebar projection shape (validated by snapshot.ts in the caller).
import { execFile } from "node:child_process"

export type SecuritySwitch = "on" | "off" | "auto"
export type ReadSecurity = (taskId: string, cwd: string) => Promise<SecuritySwitch | undefined | null>
type ExecOptions = { shell: false; timeout: number; maxBuffer: number; cwd: string }
export type Exec = (
  file: string, args: string[], options: ExecOptions,
  callback: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void,
) => unknown

const taskIdPattern = /^[a-z0-9][a-z0-9-]{0,79}$/
const validTaskId = (value: unknown): value is string => typeof value === "string" && taskIdPattern.test(value)
const validDirectory = (value: unknown): value is string => typeof value === "string" && value.startsWith("/")
const switches = new Set<unknown>(["on", "off", "auto"])

export type TaskShape = {
  id: string; title: string; status: unknown; doneCount: number; total: number
  current: { id: string; title: string } | null; next: { id: string; title: string } | null
  blockers: { id: string; title: string }[]; steps: { id: string; title: string; status: unknown }[]
  reviews?: { security: SecuritySwitch }
}
export type ReadTask = (taskId: string, cwd: string) => Promise<TaskShape>

// cwd must be the session's project directory: the CLI resolves .skynex/tasks from it.
function status(run: Exec, taskId: string, cwd: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!validTaskId(taskId)) return reject(new Error("invalid task id"))
    if (!validDirectory(cwd)) return reject(new Error("invalid directory"))
    run("skynex", ["task", "status", "--task", taskId, "--json"], { shell: false, timeout: 2000, maxBuffer: 1048576, cwd }, (error, stdout) => {
      if (error) return reject(error)
      try { resolve(JSON.parse(String(stdout))) } catch (parseError) { reject(parseError) }
    })
  })
}
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined
const securityOf = (data: unknown): SecuritySwitch | undefined => {
  const security = field(field(data, "reviews"), "security")
  return switches.has(security) ? security as SecuritySwitch : undefined
}

export function createReadSecurity(run: Exec): ReadSecurity {
  return async (taskId, cwd) => securityOf(await status(run, taskId, cwd))
}

export function createReadTask(run: Exec): ReadTask {
  return async (taskId, cwd) => {
    const data = await status(run, taskId, cwd)
    const raw = field(data, "steps"), title = field(data, "title")
    if (field(data, "taskId") !== taskId || typeof title !== "string" || !Array.isArray(raw)) throw new Error("invalid status")
    const steps = raw.map((item: unknown) => {
      const id = field(item, "id"), text = field(item, "title")
      if (typeof id !== "string" || typeof text !== "string") throw new Error("invalid step")
      return { id, title: text.slice(0, 200), status: field(item, "status") }
    })
    const short = (step: { id: string; title: string } | undefined) => step ? { id: step.id, title: step.title.slice(0, 120) } : null
    const blocked = field(data, "blockedStepIds")
    const blockers = (Array.isArray(blocked) ? blocked : []).map((id: unknown) => short(steps.find((step) => step.id === id)))
      .filter((step): step is { id: string; title: string } => step !== null).slice(0, 20)
    const security = securityOf(data)
    return { id: taskId, title: title.slice(0, 160), status: field(data, "status"),
      doneCount: steps.filter((step) => step.status === "done").length, total: steps.length,
      current: short(steps.find((step) => step.status === "in_progress")),
      next: short(steps.find((step) => step.id === field(data, "nextStepId"))),
      blockers, steps, ...(security ? { reviews: { security } } : {}) }
  }
}

export const readSecurity: ReadSecurity = createReadSecurity(execFile as unknown as Exec)
export const readTask: ReadTask = createReadTask(execFile as unknown as Exec)

export async function shouldBlock(event: {
  tool: string; input: unknown; snapshotTaskId: unknown; cwd: unknown; readSecurity?: ReadSecurity
}): Promise<boolean> {
  try {
    if (event.tool !== "subagent") return false
    const input = event.input
    if (typeof input !== "object" || input === null || (input as { agent?: unknown }).agent !== "security") return false
    if (!validTaskId(event.snapshotTaskId) || !validDirectory(event.cwd)) return false
    return (await (event.readSecurity ?? readSecurity)(event.snapshotTaskId, event.cwd)) === "off"
  } catch { return false }
}
