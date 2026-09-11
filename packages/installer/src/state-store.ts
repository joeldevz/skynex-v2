import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolve } from "node:path";
import type { InstallLock, InstallRoots, ManagedResourceState } from "@skynex-internal/domain";
import { assertSafeRoot, validateManagedPath } from "./path-policy.js";

const sha256 = /^[a-f0-9]{64}$/;
const id = /^[a-z0-9][a-z0-9._-]{0,79}$/;

const validateResource = (value: unknown): ManagedResourceState => {
  if (!value || typeof value !== "object") throw new Error("Malformed lock resource");
  const resource = value as Record<string, unknown>;
  const required = ["id", "version", "relativePath", "kind", "origin", "sourceDigest", "installedDigest"];
  if (required.some((key) => typeof resource[key] !== "string")) throw new Error("Malformed lock resource fields");
  const idValue = resource.id as string; const version = resource.version as string; const relativePath = resource.relativePath as string;
  const kind = resource.kind as string; const origin = resource.origin as string; const sourceDigest = resource.sourceDigest as string; const installedDigest = resource.installedDigest as string;
  if (!id.test(idValue) || !id.test(version)) throw new Error("Malformed lock resource identity");
  if (!["agent", "skill", "command", "hook", "mcp", "configuration", "native"].includes(kind)) throw new Error("Malformed lock resource kind");
  if (!["canonical", "native"].includes(origin)) throw new Error("Malformed lock resource origin");
  validateManagedPath("/validated-root", relativePath);
  if (!sha256.test(sourceDigest) || !sha256.test(installedDigest)) throw new Error("Malformed lock digest");
  for (const key of ["pendingSourceDigest", "pendingVersion"] as const) {
    if (resource[key] !== undefined && typeof resource[key] !== "string") throw new Error("Malformed pending resource field");
  }
  if (typeof resource.pendingSourceDigest === "string" && !sha256.test(resource.pendingSourceDigest)) throw new Error("Malformed pending digest");
  if (typeof resource.pendingVersion === "string" && !id.test(resource.pendingVersion)) throw new Error("Malformed pending version");
  return { ...resource } as unknown as ManagedResourceState;
};

export async function readInstallLockSnapshot(roots: InstallRoots, allowedResources?: ReadonlyMap<string, string>): Promise<{ lock: InstallLock; bytes: Buffer } | null> {
  try {
    await assertSafeRoot(roots.stateRoot);
    const lockPath = join(roots.stateRoot, "lock.json");
    const info = await lstat(lockPath);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("Unsafe install lock");
    const bytes = await readFile(lockPath);
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object") throw new Error("Malformed install lock");
    const lock = value as Record<string, unknown>;
    if (lock.schemaVersion !== 1 || lock.target !== "opencode-v2" || !["global", "project"].includes(String(lock.scope)) || lock.scope !== roots.scope || lock.stateRoot !== resolve(roots.stateRoot) || lock.targetRoot !== resolve(roots.targetRoot) || !Array.isArray(lock.resources)) throw new Error("Malformed or scope-bound install lock");
    const resources = lock.resources.map(validateResource);
    const ids = new Set<string>(); const paths = new Set<string>();
    for (const resource of resources) {
      if (ids.has(resource.id) || paths.has(resource.relativePath)) throw new Error("Duplicate lock resource ownership");
      ids.add(resource.id); paths.add(resource.relativePath);
    }
    if (allowedResources && resources.some((resource) => allowedResources.get(resource.id) !== resource.relativePath)) throw new Error("Lock resource identity/path does not match the installed catalog");
    return { lock: { ...lock, resources } as unknown as InstallLock, bytes };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readInstallLock(roots: InstallRoots, allowedResources?: ReadonlyMap<string, string>): Promise<InstallLock | null> {
  return (await readInstallLockSnapshot(roots, allowedResources))?.lock ?? null;
}
