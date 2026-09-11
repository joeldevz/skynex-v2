import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BackupManifest, BackupSummary, InstallLock, InstallRoots, InstallationPlan } from "@skynex-internal/domain";
import { digest } from "./digest.js";
import { assertSafeRoot, validateManagedPath, assertSafeMutationTarget } from "./path-policy.js";
import { executeTransaction } from "./transaction.js";
const transactionPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const manifestFor = async (roots: InstallRoots, id: string): Promise<BackupManifest> => {
   if (!transactionPattern.test(id)) throw new Error("Invalid backup transaction ID"); await assertSafeRoot(roots.stateRoot); await assertSafeRoot(join(roots.stateRoot, "backups")); await assertSafeRoot(join(roots.stateRoot, "backups", id));
   const path = validateManagedPath(join(roots.stateRoot, "backups"), `${id}/manifest.json`); const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe backup manifest");
   const value = JSON.parse(await readFile(path, "utf8")) as BackupManifest;
   if (value.schemaVersion !== 1 || value.transactionId !== id || value.target !== "opencode-v2" || value.scope !== roots.scope || !Array.isArray(value.files) || !value.priorLock || typeof value.priorLock.present !== "boolean" || (value.priorLock.digest !== null && !digestPattern.test(String(value.priorLock.digest))) || (value.resultingLockDigest !== null && !digestPattern.test(String(value.resultingLockDigest)))) throw new Error("Malformed backup manifest");
   for (const file of value.files) {
     await assertSafeMutationTarget(roots.targetRoot, file.relativePath);
      if (typeof file.relativePath !== "string" || (file.priorDigest !== null && !digestPattern.test(file.priorDigest)) || (file.resultingDigest !== null && !digestPattern.test(file.resultingDigest)) || typeof file.snapshot !== "boolean" || !file.resource || file.resource.relativePath !== file.relativePath) throw new Error("Malformed backup ownership metadata");
     if (file.snapshot && file.priorDigest === null) throw new Error("Snapshot without prior digest");
   }
   return value;
};
export async function listBackups(roots: InstallRoots): Promise<BackupSummary[]> {
  const root = join(roots.stateRoot, "backups"); try { await assertSafeRoot(roots.stateRoot); const info = await lstat(root); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Unsafe backup root");
    const result: BackupSummary[] = []; for (const id of (await readdir(root)).sort()) try { const value = await manifestFor(roots, id); result.push({ transactionId: id, createdAt: value.createdAt, fileCount: value.files.length }); } catch (error) { result.push({ transactionId: id, createdAt: "", fileCount: 0, corrupt: error instanceof Error ? error.message : String(error) }); } return result;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
export async function restoreBackup(roots: InstallRoots, transactionId: string, allowedResources?: ReadonlyMap<string, string>): Promise<{ restored: string[]; transactionId: string; backupRoot: string | null }> {
  const manifest = await manifestFor(roots, transactionId); if (manifest.target !== "opencode-v2" || manifest.scope !== roots.scope) throw new Error("Backup target or scope does not match");
  const backupRoot = join(roots.stateRoot, "backups", transactionId); const operations = [];
  await assertSafeRoot(backupRoot);
  for (const file of manifest.files) {
    const destination = await assertSafeMutationTarget(roots.targetRoot, file.relativePath); let content: Buffer | string = "";
    if (!allowedResources || allowedResources.get(file.resource?.id ?? "") !== file.relativePath) throw new Error(`Backup resource is not in the trusted catalog: ${file.relativePath}`);
    if (file.snapshot) { const snapshot = await assertSafeMutationTarget(backupRoot, `files/${file.relativePath}`); const bytes = await readFile(snapshot); if (file.priorDigest !== digest(bytes)) throw new Error(`Backup digest mismatch: ${file.relativePath}`); content = bytes; }
    const current = await readFile(destination).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if ((current ? digest(current) : null) !== file.resultingDigest) throw new Error(`Current file changed since backup: ${file.relativePath}`);
    operations.push({ kind: file.snapshot ? "restore" as const : "remove" as const, artifact: { resource: file.resource!, component: "configuration" as const, relativePath: file.relativePath, content } as unknown as InstallationPlan["operations"][number]["artifact"], relativePath: file.relativePath, destination, currentDigest: current ? digest(current) : null, desiredDigest: file.priorDigest ?? "", expectedPriorDigest: file.resultingDigest });
  }
  const priorLock = manifest.priorLock.present ? await readFile(await assertSafeMutationTarget(backupRoot, manifest.priorLock.snapshot ?? "lock.json")) : null;
  if (manifest.priorLock.present && (!priorLock || digest(priorLock) !== manifest.priorLock.digest)) throw new Error("Backup lock digest mismatch");
  const plan: InstallationPlan = { id: `restore-${transactionId}-${randomUUID().slice(0, 8)}`, createdAt: new Date().toISOString(), target: { id: "opencode-v2", roots }, operations, allowedResources: manifest.files.map((file) => ({ id: file.resource?.id ?? "", relativePath: file.relativePath })) };
  const transactionOptions = priorLock === null ? { plan, removeLock: true, expectedPreviousLockDigest: manifest.resultingLockDigest } : { plan, lockBytes: priorLock, expectedPreviousLockDigest: manifest.resultingLockDigest };
  const result = await executeTransaction(transactionOptions); return { restored: result.changed ? manifest.files.map((file) => file.relativePath) : [], transactionId: result.transactionId, backupRoot: result.backupRoot };
}
