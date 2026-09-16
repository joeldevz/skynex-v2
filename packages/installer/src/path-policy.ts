import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const contained = (root: string, candidate: string): boolean => {
  const rel = relative(resolve(root), resolve(candidate));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** Validate an untrusted catalog/lock path without ever normalising through a symlink. */
export function validateManagedPath(root: string, relativePath: string): string {
  if (!relativePath || relativePath.includes("\0") || isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    throw new Error(`Invalid managed path: ${relativePath}`);
  }
  const result = resolve(root, relativePath);
  if (!contained(root, result)) throw new Error(`Path escapes root: ${relativePath}`);
  return result;
}

export async function assertSafeRoot(root: string): Promise<void> {
  let cursor = resolve(root);
  while (true) {
    try { const info = await lstat(cursor); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe root ancestor: ${cursor}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = dirname(cursor); if (parent === cursor) return; cursor = parent;
  }
}

/** Check every existing ancestor, including roots used for state and backups. */
export async function assertSafeMutationTarget(root: string, relativePath: string): Promise<string> {
  await assertSafeRoot(root);
  const target = validateManagedPath(root, relativePath);
  const rootPath = resolve(root);
  let cursor = dirname(target);
  while (cursor !== rootPath && cursor !== dirname(cursor)) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe ancestor: ${cursor}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    cursor = dirname(cursor);
  }
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Unsafe destination: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}
