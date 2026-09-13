import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { applyEdits, modify, parse, type FormattingOptions, type ParseError } from "jsonc-parser"
import type { InstallRoots } from "@skynex-internal/domain"
import { APPROVED_AGENT_IDS, validateProfile, type Profile, type ProfileStore } from "./profiles.js"

const formatting: FormattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" }
const digest = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex")
const tokenPattern = /^[a-f0-9]{64}$/

export type ProfileApplyRoots = Omit<InstallRoots, "scope"> & { readonly scope: "global" }
export interface ProfileApplyPlan {
  readonly profile: Profile
  readonly configPath: string
  readonly sourceDigest: string
  readonly planDigest: string
  readonly current: Readonly<Record<string, string | null>>
  readonly desired: Readonly<Record<string, string>>
  readonly changes: readonly { readonly agent: string; readonly from: string | null; readonly to: string }[]
}
export interface ProfileApplyResult { readonly planDigest: string; readonly configPath: string; readonly backupPath: string; readonly changed: number }
export interface ProfileApplyDependencies {
  readonly readConfig?: (path: string) => Promise<Buffer>
  readonly writeConfig?: (path: string, bytes: Buffer) => Promise<void>
  readonly now?: () => number
}
type Confirmation = { readonly planDigest: string; readonly expires: number }

function canonical(value: unknown): string {
  if (value === undefined) return '"[undefined]"'
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
}

export function computePlanDigest(plan: Pick<ProfileApplyPlan, "profile" | "configPath" | "sourceDigest" | "current" | "desired" | "changes">): string {
  return digest(canonical({ profile: plan.profile, configPath: plan.configPath, sourceDigest: plan.sourceDigest, current: plan.current, desired: plan.desired, changes: plan.changes }))
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8"); const b = Buffer.from(right, "utf8")
  return a.length === b.length && timingSafeEqual(a, b)
}

function assertGlobalRoots(roots: InstallRoots): asserts roots is ProfileApplyRoots {
  if (!roots || roots.scope !== "global" || typeof roots.targetRoot !== "string" || typeof roots.stateRoot !== "string") throw new Error("Profile apply requires global roots")
}
function validateApplyPlan(roots: InstallRoots, plan: ProfileApplyPlan): void {
  assertGlobalRoots(roots)
  validateProfile(plan.profile)
  if (typeof plan.configPath !== "string") throw new Error("Invalid profile apply plan")
  const expectedJson = resolve(selectConfig(roots, "json")); const expectedJsonc = resolve(selectConfig(roots, "jsonc")); const path = resolve(plan.configPath)
  if (path !== expectedJson && path !== expectedJsonc) throw new Error("Invalid profile apply configuration path")
  if (!tokenPattern.test(plan.sourceDigest)) throw new Error("Invalid profile apply source digest")
  const ids = [...APPROVED_AGENT_IDS].sort()
  const keys = (value: object): string[] => Object.keys(value).sort()
  if (!plan.current || Array.isArray(plan.current) || Object.getPrototypeOf(plan.current) !== Object.prototype || JSON.stringify(keys(plan.current)) !== JSON.stringify(ids)) throw new Error("Invalid profile apply current values")
  if (!plan.desired || Array.isArray(plan.desired) || Object.getPrototypeOf(plan.desired) !== Object.prototype || JSON.stringify(keys(plan.desired)) !== JSON.stringify(ids)) throw new Error("Invalid profile apply desired values")
  for (const id of APPROVED_AGENT_IDS) {
    const current = plan.current[id]; if (current !== null && typeof current !== "string") throw new Error("Invalid profile apply current values")
    if (typeof plan.desired[id] !== "string" || plan.desired[id] !== plan.profile.models[id]) throw new Error("Invalid profile apply desired values")
  }
  const changes = APPROVED_AGENT_IDS.filter((id) => plan.current[id] !== plan.desired[id]).map((agent) => ({ agent, from: plan.current[agent], to: plan.desired[agent]! }))
  if (!Array.isArray(plan.changes) || plan.changes.length !== changes.length || plan.changes.some((change, index) => { const expected = changes[index]; return !expected || change.agent !== expected.agent || change.from !== expected.from || change.to !== expected.to })) throw new Error("Invalid profile apply changes")
}

function selectConfig(roots: InstallRoots, preference?: "json" | "jsonc"): string {
  if (preference === "json" || preference === "jsonc") return join(roots.targetRoot, preference === "json" ? "opencode.json" : "opencode.jsonc")
  throw new Error("Profile apply requires an explicit config preference (json or jsonc)")
}
function parseConfiguration(source: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const parsed = parse(source, errors) as Record<string, unknown> | undefined
  if (errors.length) throw new Error("OpenCode configuration contains JSONC syntax errors")
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("OpenCode configuration must be a JSON object")
  return parsed
}

function verifyManagedModels(parsed: Record<string, unknown>, desired: Readonly<Record<string, string>>): void {
  const agents = parsed.agents
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) throw new Error("OpenCode 'agents' must be an object")
  for (const id of APPROVED_AGENT_IDS) {
    const entry = (agents as Record<string, unknown>)[id]
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Managed OpenCode agent is missing: ${id}`)
    if ((entry as Record<string, unknown>).model !== desired[id]) throw new Error(`Managed OpenCode agent has an unexpected model: ${id}`)
  }
}

function buildContent(source: string, desired: Readonly<Record<string, string>>): string {
  const parsed = parseConfiguration(source)
  const agents = parsed.agents as Record<string, unknown>
  for (const id of APPROVED_AGENT_IDS) {
    const entry = agents[id]
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Managed OpenCode agent is missing: ${id}`)
  }
  let result = source
  for (const id of APPROVED_AGENT_IDS) result = applyEdits(result, modify(result, ["agents", id, "model"], desired[id], { formattingOptions: formatting }))
  verifyManagedModels(parseConfiguration(result), desired)
  return result
}

async function validateAncestors(path: string): Promise<void> {
  if (!path.startsWith("/")) throw new Error("Profile apply paths must be absolute")
  let current = resolve(path)
  while (true) {
    try {
      const info = await lstat(current)
      if (!info.isDirectory() && current !== "/") throw new Error(`Unsafe profile apply path: ${current}`)
      if (info.isSymbolicLink()) throw new Error(`Unsafe profile apply symlink: ${current}`)
      const mode = info.mode & 0o7777
      if ((mode & 0o022) !== 0 && (mode & 0o1000) === 0) throw new Error(`Unsafe writable profile apply path: ${current}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    if (current === "/") return
    current = dirname(current)
  }
}

async function requireDirectory(path: string): Promise<void> {
  await validateAncestors(path)
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe profile apply directory: ${path}`)
}

async function requireRegularFile(path: string): Promise<void> {
  await validateAncestors(dirname(path))
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Unsafe profile apply configuration file: ${path}`)
}

async function ensureStateRoot(path: string): Promise<void> {
  await validateAncestors(dirname(path))
  try { await requireDirectory(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    await mkdir(path, { mode: 0o700 })
    await requireDirectory(path)
  }
}

export function createProfileApplyService(roots: ProfileApplyRoots, store: ProfileStore, dependencies: ProfileApplyDependencies = {}) {
  assertGlobalRoots(roots)
  const confirmations = new Map<string, Confirmation>()
  const now = dependencies.now ?? Date.now
  const read = dependencies.readConfig ?? (async (path: string) => readFile(path))
  const write = dependencies.writeConfig ?? (async (path: string, bytes: Buffer) => {
    const temporary = `${path}.skynex-profile-${randomUUID()}.tmp`
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    try { await file.write(bytes); await file.sync() } finally { await file.close() }
    try { await requireRegularFile(path); await rename(temporary, path) } finally { await rm(temporary, { force: true }) }
  })
  const preview = async (name: string, preference: "json" | "jsonc"): Promise<ProfileApplyPlan> => {
    assertGlobalRoots(roots)
    const profile = await store.get(name); if (!profile) throw new Error("Profile not found"); validateProfile(profile)
    await requireDirectory(roots.targetRoot)
    const path = selectConfig(roots, preference); await requireRegularFile(path); const source = await read(path); const parsed = parseConfiguration(source.toString("utf8")) as { agents?: Record<string, { model?: unknown }> }
    if (!parsed.agents || typeof parsed.agents !== "object" || Array.isArray(parsed.agents)) throw new Error("OpenCode 'agents' must be an object")
    const current: Record<string, string | null> = {}; const desired: Record<string, string> = {}
    for (const id of APPROVED_AGENT_IDS) { const entry = parsed.agents[id]; if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Invalid managed OpenCode agent: ${id}`); const value = entry.model; if (value !== undefined && value !== null && typeof value !== "string") throw new Error(`Invalid model for agent: ${id}`); current[id] = value == null ? null : value; desired[id] = profile.models[id]! }
    const changes = APPROVED_AGENT_IDS.filter((id) => current[id] !== desired[id]).map((agent) => ({ agent, from: current[agent] ?? null, to: desired[agent]! }))
    const sourceDigest = digest(source); const planDigest = computePlanDigest({ profile, configPath: path, sourceDigest, current, desired, changes })
    return { profile, configPath: path, sourceDigest, planDigest, current, desired, changes }
  }
  const authorize = (planDigest: string): string => {
    if (!tokenPattern.test(planDigest)) throw new Error("Invalid plan digest")
    const token = randomBytes(32).toString("hex"); confirmations.set(token, { planDigest, expires: now() + 300_000 }); return token
  }
  const apply = async (plan: ProfileApplyPlan, confirmationToken: string): Promise<ProfileApplyResult> => {
    assertGlobalRoots(roots)
    const confirmation = confirmations.get(confirmationToken); confirmations.delete(confirmationToken)
    if (!confirmation || typeof plan?.planDigest !== "string" || !constantTimeEqual(confirmation.planDigest, plan.planDigest) || confirmation.expires < now()) throw new Error("Invalid or expired profile apply confirmation")
    validateApplyPlan(roots, plan)
    if (!tokenPattern.test(plan.planDigest) || !constantTimeEqual(computePlanDigest(plan), plan.planDigest)) throw new Error("Invalid profile apply plan digest")
    await requireDirectory(roots.targetRoot); await ensureStateRoot(roots.stateRoot); await requireRegularFile(plan.configPath)
    const leasePath = resolve(roots.stateRoot, ".profile-apply.lock")
    const lease = await open(leasePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600).catch(() => { throw new Error("Another profile apply is active") })
    try {
      await requireRegularFile(plan.configPath); const latest = await read(plan.configPath); if (digest(latest) !== plan.sourceDigest) throw new Error("Configuration changed after preview")
      const result = Buffer.from(buildContent(latest.toString("utf8"), plan.desired), "utf8"); const backupsRoot = resolve(roots.stateRoot, "profile-backups")
      try { await requireDirectory(backupsRoot) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await mkdir(backupsRoot, { mode: 0o700 }); await requireDirectory(backupsRoot) }
      const backupDir = resolve(backupsRoot, randomUUID()); await mkdir(backupDir, { mode: 0o700 }); await requireDirectory(backupDir)
      const backupPath = join(backupDir, "config")
      const backup = await open(backupPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      try { await backup.write(latest); await backup.sync() } finally { await backup.close() }
      if (!latest.equals(await readFile(backupPath))) throw new Error("Profile apply backup verification failed")
      const beforeWrite = await read(plan.configPath); if (digest(beforeWrite) !== plan.sourceDigest) throw new Error("Configuration changed after preview")
      try { await write(plan.configPath, result) } catch (error) {
        try { await write(plan.configPath, latest) } catch { throw new Error(`${error instanceof Error ? error.message : String(error)}; profile apply rollback failed`) }
        throw error
      }
      return { planDigest: plan.planDigest, configPath: plan.configPath, backupPath, changed: plan.changes.length }
    } finally { await lease.close().catch(() => undefined); await rm(leasePath, { force: true }).catch(() => undefined) }
  }
  return { preview, authorize, apply }
}
