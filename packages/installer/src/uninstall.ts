import type { DesiredArtifact, InstallLock, InstallRoots, InstallationPlan } from "@skynex-internal/domain";
import { executeTransaction } from "./transaction.js";
import { digest } from "./digest.js";
import { readInstallLock, readInstallLockSnapshot } from "./state-store.js";
export function createUninstallPlan(input: { readonly roots: InstallRoots; readonly lock: InstallLock; readonly allowedResources: ReadonlyMap<string, string>; readonly config?: { readonly resourceId: string; readonly relativePath: string; readonly currentContent: string; readonly removeManagedRegistration: (source: string) => string } }): InstallationPlan {
  if (!input.allowedResources) throw new Error("Trusted resource ownership map is required for uninstall");
  for (const resource of input.lock.resources) {
    if (input.allowedResources.get(resource.id) !== resource.relativePath) throw new Error(`Lock resource identity/path does not match the installed catalog: ${resource.id}`);
  }
  const configResource = input.lock.resources.find((resource) => resource.id === "opencode-config");
  if (configResource && (!input.config || input.config.resourceId !== configResource.id || input.config.relativePath !== configResource.relativePath)) {
    throw new Error("Trusted OpenCode config descriptor is required for uninstall");
  }
  const operations = input.lock.resources.map((resource) => {
    const config = input.config && resource.id === input.config.resourceId && resource.relativePath === input.config.relativePath;
    const content = config ? input.config.removeManagedRegistration(input.config.currentContent) : "";
    const artifact: DesiredArtifact = { resource, component: "configuration", relativePath: resource.relativePath, content };
    return { kind: config ? "replace" as const : "remove" as const, artifact, relativePath: resource.relativePath, destination: "", currentDigest: config ? digest(input.config!.currentContent) : resource.installedDigest, desiredDigest: config ? digest(content) : "", expectedPriorDigest: config ? digest(input.config!.currentContent) : resource.installedDigest };
  });
  return { id: `uninstall-${Date.now()}`, createdAt: new Date().toISOString(), target: { id: input.lock.target, roots: input.roots }, operations, allowedResources: [...input.allowedResources].map(([id, relativePath]) => ({ id, relativePath })) };
}

export async function applyUninstallPlan(plan: InstallationPlan, allowedResources: ReadonlyMap<string, string>): Promise<{ transactionId: string; changed: number; backupRoot: string | null; lockPath: string }> {
  if (!allowedResources) throw new Error("Trusted resource ownership map is required for uninstall");
  const roots = plan.target.roots;
  const planEntries = plan.allowedResources;
  if (planEntries === undefined || planEntries.length !== allowedResources.size || planEntries.some((entry) => allowedResources.get(entry.id) !== entry.relativePath) || [...allowedResources].some(([id, relativePath]) => !planEntries.some((entry) => entry.id === id && entry.relativePath === relativePath))) throw new Error("Uninstall plan trusted resource ownership map does not match supplied map");
  for (const operation of plan.operations) {
    if (allowedResources.get(operation.artifact.resource.id) !== operation.relativePath) throw new Error(`Resource ownership mismatch: ${operation.artifact.resource.id}`);
  }
  const snapshot = await readInstallLockSnapshot(roots, allowedResources);
  const old = snapshot?.lock;
  if (!old || !snapshot) throw new Error("Install lock is missing");
  const lock: InstallLock = { ...old, targetRoot: roots.targetRoot, stateRoot: roots.stateRoot, installedAt: new Date().toISOString(), transactionId: plan.id, resources: [] };
  const trustedPlan = { ...plan, allowedResources: [...allowedResources].map(([id, relativePath]) => ({ id, relativePath })) };
  const result = await executeTransaction({ plan: trustedPlan, lockBytes: `${JSON.stringify(lock)}\n`, expectedPreviousLockDigest: digest(snapshot.bytes) });
  return { transactionId: result.transactionId, changed: result.changed, backupRoot: result.backupRoot, lockPath: result.lockPath };
}
