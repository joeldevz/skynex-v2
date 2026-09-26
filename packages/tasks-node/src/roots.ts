import { lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function markerPresent(directory: string, name: string): boolean {
  try {
    lstatSync(join(directory, name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the `.skynex/tasks` root.
 *
 * An explicit override wins. Otherwise walk up from `cwd` to the first ancestor
 * that contains a `.git` entry (file or directory, so linked worktrees work) or a
 * `.skynex` directory. When no marker is found, fall back to `<cwd>/.skynex/tasks`.
 */
export function resolveTasksRoot(options: { readonly cwd: string; readonly override?: string }): string {
  if (options.override !== undefined) {
    return resolve(options.cwd, options.override);
  }
  const start = resolve(options.cwd);
  let cursor = start;
  while (true) {
    if (markerPresent(cursor, ".git") || markerPresent(cursor, ".skynex")) {
      return join(cursor, ".skynex", "tasks");
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      return join(start, ".skynex", "tasks");
    }
    cursor = parent;
  }
}
