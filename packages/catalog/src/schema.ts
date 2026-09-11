import type { CatalogResource } from "@skynex-internal/domain";
export interface ReleaseManifest { readonly schemaVersion: 1; readonly version: string; readonly targets: readonly { readonly id: "opencode-v2"; readonly compatibility: string }[]; readonly resources: readonly CatalogResource[]; }
const validPath = (path: string): boolean => Boolean(path) && !path.includes("\0") && !path.includes("\\") && !path.startsWith("/") && !path.includes("//") && path.split("/").every((segment) => segment !== "." && segment !== "..");
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(value);
const validVersion = (value: unknown): value is string => typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
const kinds = new Set(["agent", "skill", "command", "hook", "mcp", "configuration", "native"]);
const components = new Set(["configuration", "agents", "skills", "commands", "plugins"]);

export function validateManifest(value: unknown): ReleaseManifest {
  if (!value || typeof value !== "object") throw new Error("Manifest must be an object");
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1 || !validVersion(manifest.version) || !Array.isArray(manifest.targets) || !Array.isArray(manifest.resources)) throw new Error("Unsupported or malformed release manifest");
  if (manifest.targets.length !== 1) throw new Error("Exactly one OpenCode 2 target is required");
  const targetValue = manifest.targets[0];
  if (!targetValue || typeof targetValue !== "object") throw new Error("Invalid target compatibility");
  const target = targetValue as Record<string, unknown>;
  if (target.id !== "opencode-v2" || typeof target.compatibility !== "string" || !target.compatibility) throw new Error("Invalid target compatibility");
  const ids = new Set<string>();
  const destinations = new Set<string>();
  for (const unknownResource of manifest.resources) {
    if (!unknownResource || typeof unknownResource !== "object") throw new Error("Invalid resource");
    const resource = unknownResource as Record<string, unknown>;
    if (!validId(resource.id) || ids.has(resource.id) || !validVersion(resource.version) || typeof resource.kind !== "string" || typeof resource.origin !== "string" || typeof resource.component !== "string" || typeof resource.sourcePath !== "string" || !validPath(resource.sourcePath) || !Array.isArray(resource.targets) || resource.targets.length === 0) throw new Error(`Invalid or duplicate resource: ${String(resource.id)}`);
    if (!kinds.has(resource.kind) || !["canonical", "native"].includes(resource.origin) || !components.has(resource.component)) throw new Error(`Invalid or duplicate resource: ${String(resource.id)}`);
    ids.add(resource.id);
    if (resource.kind === "native" && resource.origin !== "native") throw new Error(`Native resource origin mismatch: ${resource.id}`);
    for (const unknownOutput of resource.targets) {
      if (!unknownOutput || typeof unknownOutput !== "object") throw new Error("Invalid target output");
      const output = unknownOutput as Record<string, unknown>;
      if (output.id !== "opencode-v2" || typeof output.relativePath !== "string" || !validPath(output.relativePath) || destinations.has(output.relativePath)) throw new Error(`Invalid or duplicate destination: ${String(output.relativePath)}`);
      destinations.add(output.relativePath);
    }
  }
  return manifest as unknown as ReleaseManifest;
}
