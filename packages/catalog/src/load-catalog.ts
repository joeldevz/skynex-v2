import { lstat, readFile, readdir } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { validateManifest, type ReleaseManifest } from "./schema.js";
import type { LoadedResource } from "@skynex-internal/domain";
export interface ResourceCatalog { readonly manifest: ReleaseManifest; readonly resources: readonly LoadedResource[]; }

type ExpectedPath = "directory" | "file";

const checkPath = async (root: string, target: string, expected: ExpectedPath) => {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const relativeTarget = relative(rootPath, targetPath);
  if (relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
    throw new Error("Catalog path escapes root");
  }

  let current = targetPath;
  let finalInfo: Stats | undefined;
  while (true) {
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Unsafe symlink in catalog: ${relative(rootPath, current) || "."}`);
    if (current === targetPath) finalInfo = info;
    else if (!info.isDirectory()) throw new Error(`Unsafe catalog ancestor: ${relative(rootPath, current) || "."}`);

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  if (!finalInfo) throw new Error("Unable to inspect catalog path");
  if (expected === "directory" && !finalInfo.isDirectory()) {
    throw new Error(`Unsafe catalog path (expected directory): ${relative(rootPath, targetPath) || "."}`);
  }
  if (expected === "file" && !finalInfo.isFile()) {
    throw new Error(`Unsafe catalog path (expected file): ${relative(rootPath, targetPath) || "."}`);
  }
  return finalInfo;
};

const listFiles = async (root: string, directory = root): Promise<string[]> => {
  await checkPath(root, directory, "directory");
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const info = await checkPath(root, path, entry.isDirectory() ? "directory" : "file");
    if (info.isDirectory()) result.push(...await listFiles(root, path));
    else result.push(relative(root, path).replaceAll("\\", "/"));
  }
  return result;
};

export async function loadCatalog(input: { readonly manifestPath: string }): Promise<ResourceCatalog> {
  const manifestPath = resolve(input.manifestPath);
  const root = dirname(manifestPath);
  await checkPath(root, manifestPath, "file");
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  const declared = new Set(manifest.resources.map((resource) => resource.sourcePath));
  const actual = (await Promise.all(["canonical", "native"].map(async (name) => {
    try { return await listFiles(root, resolve(root, name)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }))).flat();
  const undeclared = actual.filter((path) => !declared.has(path));
  if (undeclared.length) throw new Error(`Undeclared catalog files: ${undeclared.join(", ")}`);
  const resources: LoadedResource[] = [];
  for (const entry of manifest.resources) {
    const path = resolve(root, entry.sourcePath);
    if (!path.startsWith(`${root}/`)) throw new Error("Resource escapes manifest root");
    await checkPath(root, path, "file");
    const content = await readFile(path, "utf8");
    resources.push({ ...entry, content, digest: createHash("sha256").update(content).digest("hex") });
  }
  return { manifest, resources };
}
