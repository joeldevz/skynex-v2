import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, rename, rm } from "node:fs/promises"
import { dirname, join, parse, resolve } from "node:path"

export async function safeDirectory(path: string, create = false): Promise<boolean> {
  const absolute = resolve(path)
  let current = parse(absolute).root
  for (const part of absolute.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part)
    let info: import("node:fs").Stats | undefined
    try { info = await lstat(current) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      if (!create) return false
      await mkdir(current, { mode: 0o700 })
      info = await lstat(current)
    }
    const stickyRoot = info.uid === 0 && Boolean(info.mode & 0o1000) && current !== absolute
    if (!info.isDirectory() || info.isSymbolicLink() || ((info.mode & 0o022) !== 0 && !stickyRoot)) throw new Error(`Unsafe directory: ${current}`)
  }
  return true
}

export async function readFileSafe(path: string, maximum: number): Promise<string | undefined> {
  if (!await safeDirectory(dirname(path))) return undefined
  let info: import("node:fs").Stats
  try { info = await lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o022) !== 0) throw new Error(`Unsafe file: ${path}`)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await file.stat()
    if (opened.dev !== info.dev || opened.ino !== info.ino || opened.size > maximum) throw new Error(`File changed or too large: ${path}`)
    const buffer = Buffer.alloc(maximum + 1)
    let size = 0
    while (size <= maximum) {
      const result = await file.read(buffer, size, buffer.length - size, null)
      if (!result.bytesRead) break
      size += result.bytesRead
    }
    if (size > maximum) throw new Error(`File too large: ${path}`)
    return buffer.subarray(0, size).toString("utf8")
  } finally { await file.close() }
}

export async function atomicWrite(path: string, text: string): Promise<void> {
  await safeDirectory(dirname(path), true)
  const temporary = `${path}.sky-agents-${randomUUID()}.tmp`
  const file = await open(temporary, "wx", 0o600)
  try { await file.writeFile(text, "utf8"); await file.sync() } finally { await file.close() }
  try { await rename(temporary, path) } finally { await rm(temporary, { force: true }) }
}
