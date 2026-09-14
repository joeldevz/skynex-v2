import { constants } from "node:fs";
import { lstat, readFile, readdir, mkdir, rm, open, rename } from "node:fs/promises";
import { dirname, join, relative, resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256, normalizeAgent, managedAgents, transformSkill } from "./lib/real-resource-transforms.mjs";

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const sourceRoot = value("--source-root");
const inventoryPath = value("--inventory");
const outputRootArgument = value("--output-root");
const mode = args.includes("--write") ? "write" : args.includes("--check") ? "check" : undefined;
if (!sourceRoot || !inventoryPath || !mode) throw new Error("Usage: --source-root PATH --inventory PATH [--output-root PATH] (--check|--write)");

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const defaultOutputRoot = join(repoRoot, "targets/opencode/resources");
const outputRoot = resolve(outputRootArgument ?? defaultOutputRoot);
const sourceRootResolved = resolve(sourceRoot);
const isWithin = (child, parent) => child === parent || child.startsWith(`${parent}/`);
if (outputRoot === "/") throw new Error("Output root cannot be the filesystem root");
if (isWithin(outputRoot, sourceRootResolved)) throw new Error("Output root cannot be the source root or one of its descendants");

// Validate every existing ancestor without creating anything. In particular, a
// symlink may not be used to redirect a caller-selected output path.
async function validateOutputAncestors(path) {
  const existing = [];
  let current = path;
  while (true) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`Symlink output ancestor rejected: ${current}`);
      if (!info.isDirectory()) throw new Error(`Non-directory output ancestor rejected: ${current}`);
      existing.push(current);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw new Error(`Cannot resolve output root: ${path}`);
      current = parent;
    }
  }
  return existing;
}
await validateOutputAncestors(outputRoot);
const inventoryBytes = await readFile(inventoryPath);
if (sha256(inventoryBytes) !== "e77b256d2b992b021eaa12c8e85e35cbf04ef2a69b9d49f8569363fe1f2022f2") throw new Error("Inventory digest mismatch");
const inventory = JSON.parse(inventoryBytes);
const selectedAgents = inventory.entries.filter((e) => e.category === "global-agent" && !["advisor.md", "manager.md", "linear-orchestrator.md"].includes(e.path.split("/").pop())).sort((a, b) => a.path.localeCompare(b.path));
const selectedSkills = inventory.entries.filter((e) => e.category === "global-skill").sort((a, b) => a.path.localeCompare(b.path));
const generated = new Map();
const sourceChecks = [];
// Native resources are inputs to this importer today. Keep the historical
// repository location as their source so an isolated, initially-empty output
// root can be generated without borrowing files from itself.
const nativeRoot = join(defaultOutputRoot, "native");
const nativeFiles = [
  ["skynex-runtime", "native", "native/plugins/skynex-runtime.ts", "skynex/plugins/runtime/index.ts"],
  ["skynex-prompt-hook", "hook", "native/hooks/prompt.ts", "skynex/plugins/runtime/prompt.ts"],
  ["skynex-sky-agents-package", "native", "native/plugins/sky-agents/package.json", "skynex/plugins/sky-agents/package.json"],
  ["skynex-sky-agents-index", "native", "native/plugins/sky-agents/index.ts", "skynex/plugins/sky-agents/index.ts"],
  ["skynex-sky-agents-tui", "native", "native/plugins/sky-agents/tui.tsx", "skynex/plugins/sky-agents/tui.tsx"],
  ["skynex-sky-agents-rpc", "native", "native/plugins/sky-agents/rpc.ts", "skynex/plugins/sky-agents/rpc.ts"],
  ["skynex-sky-agents-jsonc-parser", "native", "native/plugins/sky-agents/vendor/jsonc-parser/main.js", "skynex/plugins/sky-agents/vendor/jsonc-parser/main.js"],
  ["skynex-sky-agents-jsonc-parser-types", "native", "native/plugins/sky-agents/vendor/jsonc-parser/main.d.ts", "skynex/plugins/sky-agents/vendor/jsonc-parser/main.d.ts"],
  ["skynex-sky-agents-jsonc-parser-license", "native", "native/plugins/sky-agents/vendor/jsonc-parser/LICENSE.md", "skynex/plugins/sky-agents/vendor/jsonc-parser/LICENSE.md"],
  ...["edit", "format", "parser", "scanner", "string-intern"].map((name) => ["skynex-sky-agents-jsonc-parser-impl-" + name, "native", `native/plugins/sky-agents/vendor/jsonc-parser/impl/${name}.js`, `skynex/plugins/sky-agents/vendor/jsonc-parser/impl/${name}.js`]),
  ...["catalog", "index", "profile-apply", "profiles", "roots", "rpc", "storage"].map((name) => [`skynex-sky-agents-core-${name}`, "native", `native/plugins/sky-agents/core/${name}.ts`, `skynex/plugins/sky-agents/core/${name}.ts`]),
].map(([id, kind, sourcePath, relativePath]) => ({ id, kind, sourcePath, relativePath }));
async function safeSource(path, expected) {
  let current = resolve(sourceRoot, path);
  const root = resolve(sourceRoot);
  while (true) {
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Symlink source rejected: ${current}`);
    if (current === root) break;
    current = dirname(current);
  }
  const info = await lstat(resolve(sourceRoot, path));
  if (!info.isFile()) throw new Error(`Non-regular source rejected: ${path}`);
  const bytes = await readFile(resolve(sourceRoot, path));
  if (sha256(bytes) !== expected) throw new Error(`Source digest mismatch: ${path}`);
  sourceChecks.push(path);
  return bytes.toString("utf8");
}
for (const entry of [...selectedAgents, ...selectedSkills]) {
  const source = await safeSource(entry.path, entry.sha256);
  const sourceName = entry.path.split("/").pop().replace(/\.md$/, "");
  const outputName = sourceName === "skynex-orchestrator" ? "thalam" : sourceName;
  const target = entry.category === "global-agent" ? `canonical/agents/${outputName}.md` : `canonical/${entry.path}`;
  generated.set(target, entry.category === "global-agent" ? normalizeAgent(outputName, source) : transformSkill(entry.path === "skills/diagnose/SKILL.md" ? "diagnose" : entry.path, source));
}
const agentNames = selectedAgents.map((e) => e.path.split("/").pop().replace(/\.md$/, "")).map((name) => name === "skynex-orchestrator" ? "thalam" : name);
const managed = JSON.stringify(managedAgents(agentNames), null, 2) + "\n";
generated.set("canonical/config/managed-agents.json", managed);
const nativeRecords = [];
const approvedNativePaths = new Set(nativeFiles.map((resource) => resource.sourcePath));
async function assertNativeTree(dir, prefix) {
  const directoryInfo = await lstat(dir);
  if (directoryInfo.isSymbolicLink()) throw new Error(`Symlink native resource rejected: ${prefix}`);
  if (!directoryInfo.isDirectory()) throw new Error(`Non-regular native resource rejected: ${prefix}`);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const sourcePath = `${prefix}/${entry.name}`;
    const info = await lstat(join(dir, entry.name));
    if (info.isSymbolicLink()) throw new Error(`Symlink native resource rejected: ${sourcePath}`);
    if (info.isDirectory()) await assertNativeTree(join(dir, entry.name), sourcePath);
    else if (!info.isFile()) throw new Error(`Non-regular native resource rejected: ${sourcePath}`);
    else if (!approvedNativePaths.has(sourcePath)) throw new Error(`Unexpected native resource: ${sourcePath}`);
  }
}
await assertNativeTree(nativeRoot, "native");
const nativeContents = new Map();
const profileApplyImport = 'from "jsonc-parser"';
const profileApplyVendoredImport = 'from "../vendor/jsonc-parser/main.js"';
function transformNativeSource(sourcePath, bytes) {
  if (sourcePath !== "native/plugins/sky-agents/core/profile-apply.ts") return bytes;
  const source = bytes.toString("utf8");
  const matches = source.split(profileApplyImport).length - 1;
  if (matches !== 1 || source.includes(profileApplyVendoredImport)) {
    throw new Error("Sky Agents profile-apply jsonc-parser import mismatch");
  }
  return Buffer.from(source.replace(profileApplyImport, profileApplyVendoredImport));
}
const vendorPackageName = "jsonc-parser";
const vendorPackageVersion = "3.3.1";
const vendorPackageRoot = join(repoRoot, "node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser");
const vendorPackage = JSON.parse(await readFile(join(vendorPackageRoot, "package.json"), "utf8"));
if (vendorPackage.name !== vendorPackageName || vendorPackage.version !== vendorPackageVersion) throw new Error("Installed jsonc-parser package/version mismatch");
const lockfile = await readFile(join(repoRoot, "pnpm-lock.yaml"), "utf8");
const lockMatch = lockfile.match(/jsonc-parser@3\.3\.1:\n\s+resolution: \{integrity: ([^}]+)\}/);
if (!lockMatch) throw new Error("Locked jsonc-parser integrity missing");
const vendorIntegrity = lockMatch[1];
const vendorRepository = vendorPackage.repository?.url;
if (vendorRepository !== "https://github.com/microsoft/node-jsonc-parser") throw new Error("Unexpected jsonc-parser repository");
const vendorTarball = `https://registry.npmjs.org/${vendorPackageName}/-/${vendorPackageName}-${vendorPackageVersion}.tgz`;
const vendorPackagePath = (sourcePath) => sourcePath.replace("native/plugins/sky-agents/vendor/jsonc-parser/", "lib/esm/").replace("lib/esm/LICENSE.md", "LICENSE.md");
const normalizeVendorBytes = (path, bytes) => path === "LICENSE.md"
  ? Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"))
  : Buffer.from(bytes.toString("utf8").replace(/(from |import \* as [^;]+ from )(['"]\.\.?\/[^'"]+)(['"])/g, "$1$2.js$3"));
for (const resource of nativeFiles) {
  const name = resource.sourcePath.match(/core\/([^/]+)\.ts$/)?.[1];
  const source = name ? `packages/sky-agents/src/${name}.ts` : null;
  const inputBytes = source ? await readFile(join(repoRoot, source)) : await readFile(join(defaultOutputRoot, resource.sourcePath));
  const bytes = transformNativeSource(resource.sourcePath, inputBytes);
  nativeContents.set(resource.sourcePath, bytes);
  const isVendor = resource.sourcePath.includes("vendor/jsonc-parser");
  const packagePath = isVendor ? vendorPackagePath(resource.sourcePath) : null;
  const packageBytes = isVendor ? await readFile(join(vendorPackageRoot, packagePath)) : null;
  if (packageBytes && !normalizeVendorBytes(packagePath, packageBytes).equals(bytes)) throw new Error(`Vendored source mismatch: ${packagePath}`);
  const vendor = isVendor ? { package: vendorPackageName, packageVersion: vendorPackageVersion, packageIntegrity: vendorIntegrity, upstreamRepository: vendorRepository, upstreamTag: `v${vendorPackageVersion}`, npmTarball: vendorTarball } : {};
  nativeRecords.push({ ...resource, version: "0.1.0", origin: "native", component: "plugins", targets: [{ id: "opencode-v2", relativePath: resource.relativePath }], transformation: isVendor ? "vendored-jsonc-parser-3.3.1" : "v2-adaptation", ...vendor, sourceReferences: isVendor ? [{ path: `npm:${vendorPackageName}@${vendorPackageVersion}/${packagePath}`, sha256: sha256(bytes) }] : source ? [{ path: source, sha256: sha256(inputBytes) }] : [], generatedSha256: sha256(bytes) });
}
const provenance = { schemaVersion: 1, inventorySha256: sha256(inventoryBytes), generated: [...generated].sort(([a], [b]) => a.localeCompare(b)).map(([target, content]) => { const entry = inventory.entries.find((e) => `canonical/${e.path}` === target) ?? (target === "canonical/agents/thalam.md" ? inventory.entries.find((e) => e.path === "agents/skynex-orchestrator.md") : undefined); return { target, source: entry?.path ?? "generated", sourceSha256: entry?.sha256 ?? null, generatedSha256: sha256(content) }; }) };
provenance.generated.push(...nativeRecords.map(({ sourcePath, generatedSha256, transformation, sourceReferences, package: packageName, packageVersion, packageIntegrity, upstreamRepository, upstreamTag, npmTarball }) => ({ target: sourcePath, source: sourceReferences[0]?.path ?? sourcePath, sourceSha256: sourceReferences[0]?.sha256 ?? generatedSha256, generatedSha256, transformation, sourceReferences, ...(packageName ? { package: packageName, packageVersion, packageIntegrity, upstreamRepository, upstreamTag, npmTarball } : {}) })));
generated.set("provenance.json", JSON.stringify(provenance, null, 2) + "\n");
const manifestResources = [...generated.keys()].filter((p) => p !== "provenance.json").sort().map((sourcePath) => {
  const isAgent = sourcePath.startsWith("canonical/agents/");
  const isSkill = sourcePath.startsWith("canonical/skills/");
  const isConfig = sourcePath.includes("/config/");
  const id = isConfig ? "opencode-config" : sourcePath.replace(/^canonical\//, "").replace(/\/SKILL\.md$|\.md$|\.json$/, "").replaceAll("/", ".").toLowerCase();
  const kind = isAgent ? "agent" : isSkill ? "skill" : "configuration";
  const component = isAgent ? "agents" : isSkill ? "skills" : "configuration";
  const relativePath = isConfig ? "opencode.jsonc" : sourcePath.replace(/^canonical\//, "");
  return { id, kind, version: "0.1.0", origin: "canonical", sourcePath, component, targets: [{ id: "opencode-v2", relativePath }] };
});
manifestResources.push(...nativeRecords);
const manifest = JSON.stringify({ schemaVersion: 1, version: "0.1.0", targets: [{ id: "opencode-v2", compatibility: "^2" }], resources: manifestResources.sort((a, b) => a.id.localeCompare(b.id)) }, null, 2) + "\n";
generated.set("manifest.json", manifest);

const existing = new Set();
async function collect(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, item.name);
    const info = await lstat(p);
    if (info.isSymbolicLink()) throw new Error(`Symlink existing output rejected: ${p}`);
    if (info.isDirectory()) await collect(p);
    else if (info.isFile()) existing.add(relative(outputRoot, p));
    else throw new Error(`Non-regular existing output rejected: ${p}`);
  }
}
await collect(join(outputRoot, "canonical")).catch((error) => {
  if (error?.code !== "ENOENT") throw error;
});
async function validateOutputLeaf(destination) {
  const info = await lstat(destination).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return null;
  if (info.isSymbolicLink()) throw new Error(`Symlink output leaf rejected: ${destination}`);
  if (!info.isFile()) throw new Error(`Non-regular output leaf rejected: ${destination}`);
  return info;
}
// Only files previously declared by the importer may be stale-cleaned. An
// unknown file is never silently removed, including in a custom root.
const manifestPath = join(outputRoot, "manifest.json");
await validateOutputLeaf(manifestPath);
const previousManifest = await readFile(manifestPath, "utf8").catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
const previouslyOwned = new Set();
if (previousManifest) {
  try {
    for (const resource of JSON.parse(previousManifest).resources ?? []) {
      if (typeof resource.sourcePath === "string" && resource.sourcePath.startsWith("canonical/")) previouslyOwned.add(resource.sourcePath);
    }
  } catch { throw new Error("Existing manifest is invalid; refusing stale cleanup"); }
}
for (const stale of existing) {
  if (!previouslyOwned.has(stale)) throw new Error(`Unexpected existing output: ${stale}`);
}
async function writeAtomic(destination, content) {
  await validateOutputLeaf(destination);
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  await validateOutputAncestors(parent);
  await validateOutputLeaf(destination);
  const temporary = join(parent, `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}
for (const [path, content] of generated) {
  const destination = join(outputRoot, path);
  await validateOutputAncestors(dirname(destination));
  if (mode === "check") {
    await validateOutputLeaf(destination);
    if (await readFile(destination, "utf8").catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)) !== content) throw new Error(`Generated output differs: ${path}`);
  } else await writeAtomic(destination, content);
  existing.delete(path);
}
for (const [path, bytes] of nativeContents) {
  const destination = join(outputRoot, path);
  await validateOutputAncestors(dirname(destination));
  if (mode === "check") {
    await validateOutputLeaf(destination);
    const existingBytes = await readFile(destination).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!existingBytes || !existingBytes.equals(bytes)) throw new Error(`Generated output differs: ${path}`);
  }
  else await writeAtomic(destination, bytes);
}
if (mode === "write") for (const stale of existing) {
  if (!previouslyOwned.has(stale)) throw new Error(`Refusing to remove unowned output: ${stale}`);
  const destination = join(outputRoot, stale);
  await validateOutputLeaf(destination);
  await rm(destination);
}
console.log(`${mode}: ${generated.size} deterministic outputs; ${sourceChecks.length} verified sources`);
