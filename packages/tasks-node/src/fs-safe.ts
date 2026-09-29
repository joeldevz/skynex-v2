import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { TaskError, asTaskError } from "@skynex-internal/tasks";

function errnoOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/**
 * Reject any existing component of the chain that is a symlink or not a directory.
 * Missing components are allowed (they will be created by the caller).
 */
export async function assertSafeRoot(root: string): Promise<void> {
  let cursor = resolve(root);
  while (true) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new TaskError("INVALID_PATH", `Unsafe root ancestor: ${cursor}`);
      }
    } catch (error) {
      if (errnoOf(error) !== "ENOENT") {
        throw error;
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      return;
    }
    cursor = parent;
  }
}

/**
 * Verify (and optionally create) a directory chain. Returns `false` when a
 * component is missing and `create` is not requested.
 */
export async function safeDirectory(path: string, create = false): Promise<boolean> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let info: Stats | undefined;
    try {
      info = await lstat(current);
    } catch (error) {
      if (errnoOf(error) !== "ENOENT") {
        throw error;
      }
      if (!create) {
        return false;
      }
      await mkdir(current, { mode: 0o700 });
      info = await lstat(current);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new TaskError("INVALID_PATH", `Unsafe directory: ${current}`);
    }
  }
  return true;
}

/**
 * Resolve a relative path strictly inside `root`. Absolute paths, `..`
 * segments, backslash separators and empty paths are rejected.
 */
export async function resolveContained(root: string, relativePath: string): Promise<string> {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    isAbsolute(relativePath) ||
    relativePath.split("/").includes("..")
  ) {
    throw new TaskError("INVALID_PATH", `Invalid relative path: ${JSON.stringify(relativePath)}`);
  }
  const rootResolved = resolve(root);
  const candidate = resolve(rootResolved, relativePath);
  const rel = relative(rootResolved, candidate);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new TaskError("INVALID_PATH", `Path escapes root: ${JSON.stringify(relativePath)}`);
  }
  return candidate;
}

/**
 * Validate every existing ancestor of a target plus the target itself. Missing
 * components are allowed; symlinks are rejected.
 */
export async function assertSafeTarget(root: string, relativePath: string): Promise<string> {
  await assertSafeRoot(root);
  const target = await resolveContained(root, relativePath);
  const rootPath = resolve(root);
  let cursor = dirname(target);
  while (cursor !== rootPath && cursor !== dirname(cursor)) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new TaskError("INVALID_PATH", `Unsafe ancestor: ${cursor}`);
      }
    } catch (error) {
      if (errnoOf(error) !== "ENOENT") {
        throw error;
      }
    }
    cursor = dirname(cursor);
  }
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) {
      throw new TaskError("INVALID_PATH", `Unsafe destination: ${target}`);
    }
  } catch (error) {
    if (errnoOf(error) !== "ENOENT") {
      throw error;
    }
  }
  return target;
}

/** Minimal handle surface used by {@link readFileSafe}; a seam for tests. */
export interface ReadableFileHandle {
  stat(): Promise<{ isFile(): boolean; readonly size: number; readonly dev?: number; readonly ino?: number }>;
  read(buffer: Buffer, offset: number, length: number, position: number | null): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export type OpenReadable = (path: string) => Promise<ReadableFileHandle>;

const openReadable: OpenReadable = (path) =>
  open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Read a regular file without ever following a symlink. Returns `undefined` when
 * the file does not exist. Never reads more than `maximum + 1` bytes.
 *
 * When `root` is given, the real path must be contained in the real path of
 * `root`, and the opened handle must be the same inode (dev/ino) that was
 * validated. Limitation: this narrows but cannot fully close TOCTOU races
 * against a concurrent attacker running as the same local user; the threat
 * model is a same-user local workspace, not a hostile multi-tenant filesystem.
 */
export async function readFileSafe(
  path: string,
  maximum: number,
  openFile: OpenReadable = openReadable,
  root?: string,
): Promise<string | undefined> {
  // Inspect the path before opening: a FIFO opened O_RDONLY would block forever
  // waiting for a writer, so non-regular files must be rejected up front.
  let initial: Stats;
  let validated: Stats | undefined;
  try {
    initial = await lstat(path);
    if (root !== undefined && !initial.isSymbolicLink()) {
      const real = await realpath(path);
      if (!isInside(await realpath(root), real)) {
        throw new TaskError("INVALID_PATH", `Path escapes root: ${path}`);
      }
      validated = await lstat(real);
    }
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return undefined;
    }
    throw asTaskError(error);
  }
  if (initial.isSymbolicLink()) {
    throw new TaskError("INVALID_PATH", `Refusing to follow symlink: ${path}`);
  }
  if (!initial.isFile()) {
    throw new TaskError("INVALID_PATH", `Not a regular file: ${path}`);
  }
  let handle: ReadableFileHandle;
  try {
    handle = await openFile(path);
  } catch (error) {
    const code = errnoOf(error);
    if (code === "ENOENT") {
      return undefined;
    }
    if (code === "ELOOP") {
      throw new TaskError("INVALID_PATH", `Refusing to follow symlink: ${path}`);
    }
    throw asTaskError(error);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new TaskError("INVALID_PATH", `Not a regular file: ${path}`);
    }
    if (info.size > maximum) {
      throw new TaskError("FILE_TOO_LARGE", `File exceeds ${maximum} bytes: ${path}`);
    }
    const buffer = Buffer.alloc(maximum + 1);
    let total = 0;
    while (total <= maximum) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (bytesRead === 0) {
        break;
      }
      total += bytesRead;
    }
    if (total > maximum) {
      throw new TaskError("FILE_TOO_LARGE", `File exceeds ${maximum} bytes: ${path}`);
    }
    // Identity check: the opened handle must be the inode that was validated.
    const expected = validated ?? initial;
    if (info.dev !== expected.dev || info.ino !== expected.ino) {
      throw new TaskError("INVALID_PATH", `File changed while opening: ${path}`);
    }
    return buffer.subarray(0, total).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is a best-effort durability hint on some platforms.
  }
}

/**
 * Write a file atomically: temporary sibling, file fsync, rename, directory fsync.
 * The temporary file is removed on failure.
 */
export async function atomicWrite(path: string, text: string, mode = 0o600): Promise<void> {
  const directory = dirname(path);
  await safeDirectory(directory, true);
  const temporary = `${path}.tmp-${randomUUID()}`;
  let handle: FileHandle;
  try {
    handle = await open(temporary, "wx", mode);
  } catch (error) {
    throw asTaskError(error);
  }
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw asTaskError(error);
  }
  await syncDirectory(directory);
}

/**
 * Build a directory in a staging sibling and publish it with a single rename.
 * Any failure removes the staging directory.
 */
export async function publishDirectory(
  root: string,
  finalName: string,
  build: (staging: string) => Promise<void>,
): Promise<void> {
  await assertSafeRoot(root);
  const rootResolved = resolve(root);
  await safeDirectory(rootResolved, true);
  const staging = join(rootResolved, `.tmp-${finalName}-${randomUUID()}`);
  try {
    await mkdir(staging, { mode: 0o700 });
  } catch (error) {
    throw asTaskError(error);
  }
  try {
    await build(staging);
    await rename(staging, join(rootResolved, finalName));
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    const code = errnoOf(error);
    if (code === "EEXIST" || code === "ENOTEMPTY") {
      throw new TaskError("TASK_EXISTS", `Directory already exists: ${join(rootResolved, finalName)}`);
    }
    throw asTaskError(error);
  }
}

export async function removeRecursive(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
