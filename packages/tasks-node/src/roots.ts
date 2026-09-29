import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TaskError } from "@skynex-internal/tasks";

function markerPresent(directory: string, name: string): boolean {
  try {
    lstatSync(join(directory, name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the project root: the first ancestor of `cwd` containing a `.git`
 * entry (file or directory, so linked worktrees work) or a `.skynex` entry.
 * Falls back to `cwd` when no marker is found.
 */
export function resolveProjectRoot(cwd: string): string {
  const start = resolve(cwd);
  let cursor = start;
  while (true) {
    if (markerPresent(cursor, ".git") || markerPresent(cursor, ".skynex")) {
      return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      return start;
    }
    cursor = parent;
  }
}

/** Realpath of the nearest existing ancestor, with the missing tail re-appended. */
function realpathLenient(path: string): string {
  const tail: string[] = [];
  let cursor = resolve(path);
  while (true) {
    try {
      return join(realpathSync(cursor), ...tail.reverse());
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) {
        return resolve(path);
      }
      tail.push(basename(cursor));
      cursor = parent;
    }
  }
}

/**
 * Resolve the `.skynex/tasks` root.
 *
 * An explicit override must resolve (by realpath) inside the project root;
 * otherwise `INVALID_PATH` is thrown before the root is touched. Without an
 * override the root is `<projectRoot>/.skynex/tasks`.
 */
export function resolveTasksRoot(options: { readonly cwd: string; readonly override?: string }): string {
  const projectRoot = resolveProjectRoot(options.cwd);
  if (options.override !== undefined) {
    const candidate = resolve(options.cwd, options.override);
    const rel = relative(realpathLenient(projectRoot), realpathLenient(candidate));
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new TaskError("INVALID_PATH", `--tasks-root must be inside the project root: ${candidate}`);
    }
    return candidate;
  }
  return join(projectRoot, ".skynex", "tasks");
}
