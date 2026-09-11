import { mkdtemp, mkdir, lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";

export { assert, join, readFile };
export const fixtures = [];
export const results = [];
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const exists = (path) => lstat(path).then(() => true).catch((error) => {
  if (error.code === "ENOENT") return false;
  throw error;
});
export const fail = (action, message) => assert.rejects(action, (error) =>
  error instanceof Error && error.message.includes(message));
export async function fresh(name) {
  await mkdir("/tmp/opencode", { recursive: true });
  const root = await mkdtemp(`/tmp/opencode/skynex-proof-${name}-`);
  fixtures.push(root);
  return root;
}
export async function fixture(name) {
  const root = await fresh(name);
  const roots = { scope: "project", targetRoot: join(root, "target"), stateRoot: join(root, "state") };
  await mkdir(roots.targetRoot);
  return { root, roots, target: (path) => join(roots.targetRoot, path), lockPath: join(roots.stateRoot, "lock.json") };
}
// lstat/readlink never read through symlinks. Failed-operation proofs include dirs.
// Successful uninstall snapshots omit dirs because empty directories may survive.
export async function snapshot(base, directories = true) {
  const entries = [];
  async function walk(path) {
    if (!await exists(path)) return;
    const info = await lstat(path);
    const name = relative(base, path);
    if (info.isSymbolicLink()) entries.push([name, "symlink", await readlink(path)]);
    else if (info.isDirectory()) {
      if (directories) entries.push([name, "directory"]);
      for (const child of (await readdir(path)).sort()) await walk(join(path, child));
    } else entries.push([name, "file", (await readFile(path)).toString("base64")]);
  }
  await walk(base);
  return entries;
}
export async function test(id, action) {
  try {
    await action();
    results.push(id);
    console.log(`PASS ${id}`);
  } catch (error) {
    console.error(`FAIL ${id}`);
    throw error;
  }
}
export const detection = async (roots) => ({ id: "opencode-v2", installed: true, configPath: null, configCandidates: [], roots, notes: [] });
