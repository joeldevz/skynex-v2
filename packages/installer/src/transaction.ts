import { open, readFile, rm, mkdir, rename, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { InstallOperation, InstallationPlan, TransactionResult } from "@skynex-internal/domain";
import { assertSafeMutationTarget, assertSafeRoot, validateManagedPath } from "./path-policy.js";

const hash = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
const present = async (path: string): Promise<boolean> => lstat(path).then(() => true).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
const syncDirectory = async (path: string): Promise<void> => {
  const directory = await open(path, "r");
  try { await directory.sync(); } finally { await directory.close(); }
};
const atomic = async (path: string, value: Buffer | string, token: string, mutated?: () => void): Promise<void> => {
  const temporary = `${path}.skynex-${token}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path); mutated?.(); await syncDirectory(dirname(path));
  } catch (error) { await rm(temporary, { force: true }); throw error; }
};
const ensureDirectory = async (path: string): Promise<void> => {
  if (!await present(path)) { await ensureDirectory(dirname(path)); await mkdir(path, { mode: 0o700 }); await syncDirectory(dirname(path)); }
  await syncDirectory(path);
};
const ensureParent = async (path: string): Promise<void> => ensureDirectory(dirname(path));

/** Internal fault-injection seam; never exposed as CLI flags. */
interface TransactionDependencies {
  readonly readLock?: (path: string) => Promise<Buffer>;
  readonly beforeLockCommit?: () => Promise<void>;
}
type PriorLock = { kind: "uncaptured" } | { kind: "absent" } | { kind: "present"; bytes: Buffer };

export interface TransactionOptions {
  readonly plan: InstallationPlan;
  readonly lockBytes?: Buffer | string;
  readonly removeLock?: boolean;
  readonly verify?: () => Promise<void>;
  readonly expectedPreviousLockDigest?: string | null;
}

/** Shared prepare/snapshot/apply/verify/commit/rollback executor. Lease is held for the entire lifecycle. */
export async function executeTransaction(options: TransactionOptions, dependencies: TransactionDependencies = {}): Promise<TransactionResult> {
  const { plan } = options;
  const roots = plan.target.roots;
  await assertSafeRoot(roots.targetRoot); await assertSafeRoot(roots.stateRoot);
  await ensureDirectory(roots.stateRoot); await assertSafeRoot(roots.stateRoot);
  const stateRoot = resolve(roots.stateRoot); const targetRoot = resolve(roots.targetRoot);
  const leasePath = await assertSafeMutationTarget(stateRoot, ".installer.lock");
  const lockPath = await assertSafeMutationTarget(stateRoot, "lock.json");
  const backupsRoot = validateManagedPath(stateRoot, "backups");
  try { const info = await lstat(backupsRoot); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe backup root: ${backupsRoot}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await ensureDirectory(backupsRoot);
  await assertSafeRoot(backupsRoot);
  const backupRoot = validateManagedPath(backupsRoot, plan.id);
    const changed = plan.operations.filter((item) => item.kind !== "unchanged" && item.kind !== "preserve");
  const snapshots = new Map<string, Buffer | null>(); const applied: InstallOperation[] = [];
  let lease: Awaited<ReturnType<typeof open>> | undefined; let priorLockState: PriorLock = { kind: "uncaptured" }; let lockChanged = false; let ownsBackup = false;
  const restoredPaths: string[] = []; const unreconciledPaths: string[] = [];
  try {
    lease = await open(leasePath, "wx", 0o600).catch(() => { throw new Error("Another installer transaction is active"); });
    await lease.writeFile(`${JSON.stringify({ transactionId: plan.id, backupRoot })}\n`); await lease.sync(); await syncDirectory(stateRoot);
    try { priorLockState = { kind: "present", bytes: await (dependencies.readLock ?? readFile)(lockPath) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; priorLockState = { kind: "absent" }; }
    const oldLock = priorLockState.kind === "present" ? priorLockState.bytes : null;
    if (options.expectedPreviousLockDigest !== undefined && (oldLock === null ? null : hash(oldLock)) !== options.expectedPreviousLockDigest) throw new Error("Lock changed after planning");
    const allowed = new Map((plan.allowedResources ?? []).map((entry) => [entry.id, entry.relativePath]));
    if (plan.allowedResources === undefined || allowed.size !== plan.allowedResources.length || new Set(plan.allowedResources.map((entry) => entry.relativePath)).size !== plan.allowedResources.length) throw new Error("Missing or invalid trusted resource ownership map");
    for (const item of plan.operations) {
      const relativePath = item.relativePath ?? item.artifact.relativePath;
      if (allowed.get(item.artifact.resource.id) !== relativePath) throw new Error(`Resource ownership mismatch: ${item.artifact.resource.id}`);
      const destination = await assertSafeMutationTarget(targetRoot, relativePath);
      const current = await present(destination) ? await readFile(destination) : null;
      if ((current ? hash(current) : null) !== (item.expectedPriorDigest ?? item.currentDigest)) throw new Error(`Target changed after planning: ${relativePath}`);
      if ((current ? hash(current) : null) !== (item.currentDigest ?? null)) throw new Error(`Target changed after planning: ${relativePath}`);
      if (changed.includes(item)) snapshots.set(relativePath, current);
    }
    for (const item of changed) if (item.kind === "conflict") throw new Error(`Unresolved update conflict: ${item.relativePath ?? item.artifact.relativePath}`);
    await mkdir(backupRoot, { mode: 0o700 }); ownsBackup = true; await syncDirectory(backupsRoot); await assertSafeRoot(backupRoot);
    const files = [];
    for (const item of changed) {
      const relativePath = item.relativePath ?? item.artifact.relativePath;
      const prior = snapshots.get(relativePath) ?? null;
      if (prior !== null) { const snapshot = await assertSafeMutationTarget(backupRoot, `files/${relativePath}`); await ensureParent(snapshot); await atomic(snapshot, prior, plan.id); }
      files.push({ relativePath, priorDigest: prior ? hash(prior) : null, snapshot: prior !== null, resultingDigest: item.kind === "remove" ? null : item.desiredDigest, resource: { ...item.artifact.resource, origin: item.artifact.resource.kind === "native" ? "native" : "canonical", relativePath, sourceDigest: item.desiredDigest, installedDigest: item.desiredDigest } });
    }
    const priorLock = oldLock === null ? { present: false, digest: null, snapshot: null } : { present: true, digest: hash(oldLock), snapshot: "lock.json" };
    if (oldLock !== null) await atomic(validateManagedPath(backupRoot, "lock.json"), oldLock, `${plan.id}-lock`);
    const resultingLock = options.removeLock ? null : options.lockBytes !== undefined ? hash(options.lockBytes) : oldLock === null ? null : hash(oldLock);
    await atomic(join(backupRoot, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, transactionId: plan.id, createdAt: new Date().toISOString(), target: plan.target.id, scope: roots.scope, priorLock, resultingLockDigest: resultingLock, files })}\n`, plan.id);
    for (const item of changed) {
      const destination = await assertSafeMutationTarget(targetRoot, item.relativePath ?? item.artifact.relativePath);
      if (item.kind === "remove") { await rm(destination, { force: true }); applied.push(item); await syncDirectory(dirname(destination)); }
      else { await ensureParent(destination); await atomic(destination, item.artifact.content, plan.id, () => applied.push(item)); }
    }
    if (options.verify) await options.verify();
    for (const item of changed) if (item.kind !== "remove" && hash(await readFile(await assertSafeMutationTarget(targetRoot, item.relativePath ?? item.artifact.relativePath))) !== item.desiredDigest) throw new Error(`Verification failed: ${item.relativePath ?? item.artifact.relativePath}`);
    await dependencies.beforeLockCommit?.();
    if (options.removeLock) { await rm(lockPath, { force: true }); lockChanged = oldLock !== null; await syncDirectory(stateRoot); }
    else if (options.lockBytes !== undefined) { await ensureParent(lockPath); await atomic(lockPath, options.lockBytes, plan.id, () => { lockChanged = true; }); }
    await atomic(join(backupRoot, "completion.json"), `${JSON.stringify({ transactionId: plan.id, status: "committed" })}\n`, plan.id);
    await lease.close(); await rm(leasePath, { force: true }); lease = undefined;
    return { transactionId: plan.id, changed: changed.length, backupRoot, lockPath, restoredPaths: [], unreconciledPaths: [], warnings: [] };
  } catch (error) {
    // A contender never acquired ownership and must not alter winner state.
    if (!lease) throw error;
    for (const item of applied.slice().reverse()) try {
      const relativePath = item.relativePath ?? item.artifact.relativePath;
      const destination = await assertSafeMutationTarget(targetRoot, relativePath); const prior = snapshots.get(relativePath) ?? null;
      if (prior === null) { await rm(destination, { force: true }); await syncDirectory(dirname(destination)); } else { await ensureParent(destination); await atomic(destination, prior, `${plan.id}-rollback`); }
      restoredPaths.push(relativePath);
    } catch { unreconciledPaths.push(item.relativePath ?? item.artifact.relativePath); }
    if (lockChanged && priorLockState.kind !== "uncaptured") try {
      if (priorLockState.kind === "absent") { await rm(lockPath, { force: true }); await syncDirectory(stateRoot); }
      else await atomic(lockPath, priorLockState.bytes, `${plan.id}-lock-rollback`);
    } catch { unreconciledPaths.push("lock.json"); }
    if (ownsBackup && (applied.length || lockChanged)) {
      try { await atomic(join(backupRoot, "recovery.json"), `${JSON.stringify({ transactionId: plan.id, status: unreconciledPaths.length ? "recovery-required" : "rolled-back", restoredPaths, unreconciledPaths, lockPath, backupRoot })}\n`, `${plan.id}-recovery`); }
      catch { unreconciledPaths.push("recovery.json"); }
    }
    if (lease) await lease.close().catch(() => undefined);
    if (!unreconciledPaths.length) await rm(leasePath, { force: true }).catch(() => undefined);
    throw new Error(`${error instanceof Error ? error.message : String(error)}${unreconciledPaths.length ? `; recovery required: ${unreconciledPaths.join(", ")}` : ""}`);
  }
}
