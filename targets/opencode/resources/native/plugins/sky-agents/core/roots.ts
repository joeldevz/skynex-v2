import { homedir } from "node:os"
import { resolve } from "node:path"

export interface GlobalSkynexRoots { configRoot: string; stateRoot: string }

export function resolveGlobalSkynexRoots(env: NodeJS.ProcessEnv = process.env, home = homedir()): GlobalSkynexRoots {
  const xdgConfig = env.XDG_CONFIG_HOME?.trim()
  const configHome = resolve(xdgConfig || resolve(home, ".config"))
  return { configRoot: resolve(configHome, "opencode"), stateRoot: resolve(configHome, "skynex") }
}
