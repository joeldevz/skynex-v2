import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { TargetAdapter, TargetDetection } from "@skynex-internal/application";
import type { DesiredArtifact, InstallComponent, InstallLock, InstallRoots, InstallationPlan, ManagedResourceState, UpdateDecision } from "@skynex-internal/domain";
import { assertSafeMutationTarget, assertSafeRoot } from "./path-policy.js";
import { executeTransaction } from "./transaction.js";
import { readInstallLockSnapshot } from "./state-store.js";
export { validateManagedPath, assertSafeMutationTarget, assertSafeRoot } from "./path-policy.js";
export { digest } from "./digest.js";
export { readInstallLock, readInstallLockSnapshot } from "./state-store.js";
export { compareResource } from "./planner.js";
export { createUninstallPlan } from "./uninstall.js";
export { listBackups, restoreBackup } from "./backup-service.js";
export { executeTransaction } from "./transaction.js";

export interface InstallOperation { readonly kind: "create" | "replace" | "unchanged" | "conflict"; readonly artifact: DesiredArtifact; readonly relativePath: string; readonly destination: string; readonly currentDigest: string | null; readonly desiredDigest: string; readonly previous?: ManagedResourceState; readonly decision?: UpdateDecision; }
export interface InstallPlan { readonly id: string; readonly createdAt: string; readonly target: TargetDetection; readonly operations: readonly InstallOperation[]; readonly allowedResources?: readonly { readonly id: string; readonly relativePath: string }[]; readonly selectedComponents?: readonly InstallComponent[]; readonly updateMode?: boolean; readonly expectedPreviousLockDigest?: string | null; }
export interface ApplyResult { readonly transactionId: string; readonly changed: number; readonly backupRoot: string | null; readonly lockPath: string; }
const sha256 = (content: string | Buffer): string => createHash("sha256").update(content).digest("hex");
const exists = async (path: string): Promise<boolean> => lstat(path).then(() => true).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return false; throw e; });
const isSharedOpenCodeConfig = (target: TargetDetection, artifact: DesiredArtifact): boolean =>
  target.id === "opencode-v2" && artifact.resource.id === "opencode-config" && artifact.resource.kind === "configuration" &&
  (artifact.relativePath === "opencode.json" || artifact.relativePath === "opencode.jsonc") && artifact.component === "configuration";
const convergedResource = (resource: ManagedResourceState, item: InstallOperation): ManagedResourceState => {
  const converged = { ...resource, sourceDigest: item.desiredDigest, installedDigest: item.desiredDigest, version: item.artifact.resource.version };
  delete (converged as { pendingSourceDigest?: string; pendingVersion?: string }).pendingSourceDigest;
  delete (converged as { pendingSourceDigest?: string; pendingVersion?: string }).pendingVersion;
  return converged;
};

export const createInstallPlan = async (target: TargetAdapter, roots: InstallRoots, components?: readonly InstallComponent[], options?: { readonly configPreference?: "json" | "jsonc" }): Promise<InstallPlan> => {
  const selected = components ?? (roots.scope === "project" ? ["configuration", "agents", "skills"] : ["configuration", "agents", "skills", "plugins"] satisfies InstallComponent[]);
  // The OpenCode adapter's default catalog includes the bundled Sky runtime.
  // Other adapters may omit plugins even when no component filter is supplied.
  const selectsPlugins = components?.includes("plugins") ?? false;
  if (roots.scope === "project" && selectsPlugins) throw new Error("Sky Agents plugins can only be installed globally");
  await assertSafeRoot(roots.targetRoot); await assertSafeRoot(roots.stateRoot);
  const detection = await target.detect(roots); const artifacts = await target.desiredArtifacts(roots, components, options);
  // Ownership must come from the complete trusted catalog, not just selected operations.
  const trustedArtifacts = components === undefined ? artifacts : await target.desiredArtifacts(roots, roots.scope === "project" ? ["configuration", "agents", "skills"] : undefined, options);
  const allowedIds = new Set<string>(); const allowedPaths = new Set<string>();
  for (const artifact of trustedArtifacts) {
    if (allowedIds.has(artifact.resource.id)) throw new Error(`Duplicate catalog resource: ${artifact.resource.id}`);
    if (allowedPaths.has(artifact.relativePath)) throw new Error(`Duplicate catalog destination: ${artifact.relativePath}`);
    allowedIds.add(artifact.resource.id); allowedPaths.add(artifact.relativePath);
  }
  const destinations = new Set<string>(); const operations: InstallOperation[] = [];
  const priorSnapshot = await readInstallLockSnapshot(roots, new Map(trustedArtifacts.map((artifact) => [artifact.resource.id, artifact.relativePath])));
  const priorResources = priorSnapshot ? new Map(priorSnapshot.lock.resources.map((resource) => [resource.relativePath, resource])) : new Map();
  for (const artifact of artifacts) {
    if (destinations.has(artifact.relativePath)) throw new Error(`Duplicate destination: ${artifact.relativePath}`); destinations.add(artifact.relativePath);
    const destination = await assertSafeMutationTarget(roots.targetRoot, artifact.relativePath); const current = await exists(destination) ? await readFile(destination) : null; const desiredDigest = artifact.sourceDigest ?? sha256(artifact.content); const currentDigest = current ? sha256(current) : null;
    const prior = priorResources.get(artifact.relativePath);
    if (current && !prior && !isSharedOpenCodeConfig(detection, artifact)) {
      throw new Error(`Unmanaged existing resource collision: ${artifact.relativePath}`);
    }
    operations.push({ artifact, relativePath: artifact.relativePath, currentDigest, desiredDigest, previous: prior, kind: !current ? "create" : currentDigest === desiredDigest ? "unchanged" : "replace", destination });
  }
  return { id: randomUUID(), createdAt: new Date().toISOString(), target: detection, operations, selectedComponents: selected, allowedResources: trustedArtifacts.map((artifact) => ({ id: artifact.resource.id, relativePath: artifact.relativePath })) };
};

export const applyInstallPlan = async (plan: InstallPlan): Promise<ApplyResult> => {
  if (plan.operations.some((item) => item.kind === "conflict")) throw new Error("Unresolved update conflict; edit the resource and replan");
  const roots = plan.target.roots; const allowed = new Map((plan.allowedResources ?? []).map((entry) => [entry.id, entry.relativePath]));
  if (!plan.allowedResources?.length) throw new Error("Missing trusted resource ownership map");
  if (allowed.size !== plan.allowedResources.length || new Set(plan.allowedResources.map((entry) => entry.relativePath)).size !== plan.allowedResources.length) throw new Error("Invalid trusted resource ownership map");
  const snapshot = await readInstallLockSnapshot(roots, allowed); const prior = snapshot?.lock ?? null;
  const installed = prior;
  const planned = new Set(plan.operations.map((item) => item.artifact.relativePath));
  const resources = [...(prior?.resources ?? []).filter((resource) => !planned.has(resource.relativePath)), ...plan.operations.map((item) => item.previous && item.kind === "unchanged" ? (item.currentDigest === item.desiredDigest ? convergedResource(item.previous, item) : item.previous) : ({ ...item.artifact.resource, origin: item.artifact.resource.kind === "native" ? "native" : "canonical", relativePath: item.relativePath, sourceDigest: item.desiredDigest, installedDigest: item.desiredDigest } as ManagedResourceState))];
  const lock = { schemaVersion: 1 as const, target: "opencode-v2" as const, scope: roots.scope, targetRoot: resolve(roots.targetRoot), stateRoot: resolve(roots.stateRoot), installedAt: new Date().toISOString(), transactionId: plan.id, resources, installedComponents: plan.selectedComponents ?? [...new Set(plan.operations.map((operation) => operation.artifact.component))] } satisfies InstallLock;
  for (const item of plan.operations) {
    const owned = installed?.resources.find((resource) => resource.id === item.artifact.resource.id && resource.relativePath === item.relativePath);
    const reviewed = plan.updateMode && ["accept-upstream", "keep-local", "skip", "preserve"].includes(item.decision ?? "");
    if (item.currentDigest !== null && !owned && !isSharedOpenCodeConfig(plan.target, item.artifact)) throw new Error(`Unmanaged existing resource collision: ${item.relativePath}`);
    if (owned && item.currentDigest !== owned.installedDigest && item.currentDigest !== item.desiredDigest && !reviewed) throw new Error(`Locally edited managed resource: ${item.relativePath}`);
    if (owned && !plan.updateMode && item.currentDigest !== item.desiredDigest && (owned.pendingSourceDigest !== undefined || item.currentDigest !== owned.sourceDigest)) throw new Error(`Customized managed resource requires an explicit update decision: ${item.relativePath}`);
    if (plan.updateMode && reviewed && (!owned || item.previous?.id !== owned.id || item.previous.relativePath !== owned.relativePath)) throw new Error(`Reviewed update requires the reviewed resource: ${item.relativePath}`);
  }
  const result = await executeTransaction({ plan: plan as unknown as InstallationPlan, lockBytes: `${JSON.stringify(lock)}\n`, expectedPreviousLockDigest: plan.expectedPreviousLockDigest ?? (snapshot ? sha256(snapshot.bytes) : null) });
  return { transactionId: result.transactionId, changed: result.changed, backupRoot: result.backupRoot, lockPath: result.lockPath };
};

export { applyUninstallPlan } from "./uninstall.js";

export function prepareUpdatePlan(plan: InstallPlan, lock: InstallLock, choose?: (operation: InstallOperation, reason: "local-only" | "conflict" | "pending") => UpdateDecision, expectedPreviousLockDigest?: string | null): InstallPlan {
  const previous = new Map(lock.resources.map((resource) => [resource.relativePath, resource]));
  const operations = plan.operations.map((operation) => {
    const prior = previous.get(operation.relativePath);
    if (!prior) return operation;
    if (operation.currentDigest === null) throw new Error(`Managed resource is missing: ${operation.relativePath}; restore it or uninstall before updating`);
    const upstreamChanged = operation.desiredDigest !== prior.sourceDigest;
    const localChanged = operation.currentDigest !== prior.sourceDigest;
    const pending = prior.pendingSourceDigest !== undefined;
    if (!upstreamChanged && !pending) return { ...operation, kind: "unchanged" as const, ...(localChanged ? { decision: "preserve" as const, previous: { ...prior, installedDigest: operation.currentDigest! } } : { previous: prior }) };
    if (operation.currentDigest === operation.desiredDigest) { const converged = { ...prior, sourceDigest: operation.desiredDigest, installedDigest: operation.desiredDigest, version: operation.artifact.resource.version }; delete (converged as { pendingSourceDigest?: string; pendingVersion?: string }).pendingSourceDigest; delete (converged as { pendingSourceDigest?: string; pendingVersion?: string }).pendingVersion; return { ...operation, kind: "unchanged" as const, previous: converged }; }
    if (!localChanged && upstreamChanged && !pending) {
      const decision = choose?.(operation, "local-only");
      if (!decision) return { ...operation, previous: prior };
      if (["keep-local", "skip", "preserve"].includes(decision)) return { ...operation, kind: "unchanged" as const, decision, previous: { ...prior, pendingSourceDigest: operation.desiredDigest, pendingVersion: operation.artifact.resource.version } };
      if (decision === "accept-upstream") return { ...operation, kind: "replace" as const, decision, previous: prior };
      return { ...operation, kind: "conflict" as const, decision, previous: prior };
    }
    const reason = pending ? "pending" : "conflict";
    const decision = choose?.(operation, reason);
    if (!decision) return { ...operation, kind: "conflict" as const, previous: prior };
    if (["keep-local", "skip", "preserve"].includes(decision)) return { ...operation, kind: "unchanged" as const, decision, previous: { ...prior, installedDigest: operation.currentDigest!, pendingSourceDigest: operation.desiredDigest, pendingVersion: operation.artifact.resource.version } };
    if (decision === "accept-upstream") return { ...operation, kind: "replace" as const, decision, previous: prior };
    return { ...operation, kind: "conflict" as const, decision, previous: prior };
  });
  return { ...plan, updateMode: true, ...(expectedPreviousLockDigest === undefined ? {} : { expectedPreviousLockDigest }), operations };
}
