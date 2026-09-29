// Only module in this plugin allowed to touch the system (design E3): fixed-argv execFile,
// no shell, bounded time/output, and only `reviews.security` is read from the CLI output.
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

export function createReadSecurity(run: Exec): ReadSecurity {
  // cwd must be the session's project directory: the CLI resolves .skynex/tasks from it.
  return (taskId, cwd) => new Promise((resolve, reject) => {
    if (!validTaskId(taskId)) return reject(new Error("invalid task id"))
    if (!validDirectory(cwd)) return reject(new Error("invalid directory"))
    run("skynex", ["task", "status", "--task", taskId, "--json"], { shell: false, timeout: 2000, maxBuffer: 65536, cwd }, (error, stdout) => {
      if (error) return reject(error)
      try {
        const data: unknown = JSON.parse(String(stdout))
        const reviews = typeof data === "object" && data !== null ? (data as { reviews?: unknown }).reviews : undefined
        const security = typeof reviews === "object" && reviews !== null ? (reviews as { security?: unknown }).security : undefined
        resolve(switches.has(security) ? security as SecuritySwitch : undefined)
      } catch (parseError) { reject(parseError) }
    })
  })
}

export const readSecurity: ReadSecurity = createReadSecurity(execFile as unknown as Exec)

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
