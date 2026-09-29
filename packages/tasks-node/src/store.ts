import type { Dirent, Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  INSTRUCTION_PATH_PATTERN,
  MAX_INSTRUCTION_BYTES,
  MAX_TASK_JSON_BYTES,
  SLUG_PATTERN,
  TaskError,
  asTaskError,
  computeNextStepId,
  parseTask,
  serializeTask,
} from "@skynex-internal/tasks";
import type { InstructionFile, Task, TaskListEntry, TaskStore } from "@skynex-internal/tasks";
import {
  assertSafeRoot,
  assertSafeTarget,
  atomicWrite,
  publishDirectory,
  readFileSafe,
  resolveContained,
} from "./fs-safe.js";

const TASK_FILE = "task.json";
const STATUS_FILE = "status.json";
const LOCK_FILE = ".task.lock";

export interface FileTaskStoreOptions {
  readonly tasksRoot: string;
}

type ReadOutcome =
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly note: string }
  | { readonly kind: "text"; readonly text: string };

function errnoOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertSlug(taskId: string): void {
  if (!SLUG_PATTERN.test(taskId)) {
    throw new TaskError("INVALID_ARGUMENT", `Invalid task id: ${JSON.stringify(taskId)}`);
  }
}

async function lstatOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
      return undefined;
    }
    throw asTaskError(error);
  }
}

async function readOutcome(path: string, maximum: number, root: string): Promise<ReadOutcome> {
  try {
    const text = await readFileSafe(path, maximum, undefined, root);
    return text === undefined ? { kind: "missing" } : { kind: "text", text };
  } catch (error) {
    return { kind: "error", note: messageOf(error) };
  }
}

function summarize(task: Task): TaskListEntry {
  return {
    id: task.id,
    format: "task",
    title: task.title,
    status: task.status,
    revision: task.revision,
    stepCount: task.steps.length,
    doneCount: task.steps.filter((step) => step.status === "done").length,
    nextStepId: computeNextStepId(task.steps),
  };
}

function assertInstructionPaths(instructions: readonly InstructionFile[]): void {
  for (const file of instructions) {
    if (!INSTRUCTION_PATH_PATTERN.test(file.relativePath)) {
      throw new TaskError("INVALID_PATH", `Invalid instruction path: ${JSON.stringify(file.relativePath)}`);
    }
  }
}

export function createFileTaskStore(options: FileTaskStoreOptions): TaskStore {
  const tasksRoot = resolve(options.tasksRoot);

  async function list(): Promise<readonly TaskListEntry[]> {
    await assertSafeRoot(tasksRoot);
    let entries: Dirent[];
    try {
      entries = await readdir(tasksRoot, { withFileTypes: true });
    } catch (error) {
      if (errnoOf(error) === "ENOENT") {
        return [];
      }
      throw asTaskError(error);
    }
    const result: TaskListEntry[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const id = entry.name;
      const directory = join(tasksRoot, id);
      const info = await lstatOrUndefined(directory);
      if (info === undefined) {
        result.push({ id, format: "unknown", note: "unreadable entry" });
        continue;
      }
      if (info.isSymbolicLink() || !info.isDirectory()) {
        result.push({ id, format: "unknown", note: "not a regular directory" });
        continue;
      }
      const taskOutcome = await readOutcome(join(directory, TASK_FILE), MAX_TASK_JSON_BYTES, tasksRoot);
      if (taskOutcome.kind === "text") {
        try {
          result.push(summarize(parseTask(taskOutcome.text, id)));
        } catch (error) {
          result.push({ id, format: "unknown", note: messageOf(error) });
        }
        continue;
      }
      if (taskOutcome.kind === "error") {
        result.push({ id, format: "unknown", note: taskOutcome.note });
        continue;
      }
      const legacyOutcome = await readOutcome(join(directory, STATUS_FILE), MAX_TASK_JSON_BYTES, tasksRoot);
      if (legacyOutcome.kind === "text") {
        result.push({ id, format: "legacy", note: "status.json present; not a managed task" });
        continue;
      }
      if (legacyOutcome.kind === "error") {
        result.push({ id, format: "unknown", note: legacyOutcome.note });
        continue;
      }
      result.push({ id, format: "unknown", note: "no task.json" });
    }
    return result;
  }

  async function exists(taskId: string): Promise<boolean> {
    assertSlug(taskId);
    await assertSafeRoot(tasksRoot);
    const directory = await resolveContained(tasksRoot, taskId);
    const info = await lstatOrUndefined(directory);
    if (info === undefined) {
      return false;
    }
    if (info.isSymbolicLink()) {
      throw new TaskError("INVALID_PATH", `Refusing to inspect symlink: ${taskId}`);
    }
    return info.isDirectory();
  }

  async function read(taskId: string): Promise<Task> {
    assertSlug(taskId);
    await assertSafeRoot(tasksRoot);
    const directory = await resolveContained(tasksRoot, taskId);
    const info = await lstatOrUndefined(directory);
    if (info === undefined) {
      throw new TaskError("TASK_NOT_FOUND", `Task not found: ${taskId}`);
    }
    if (info.isSymbolicLink()) {
      throw new TaskError("INVALID_PATH", `Refusing to read symlink: ${taskId}`);
    }
    if (!info.isDirectory()) {
      throw new TaskError("TASK_NOT_FOUND", `Task not found: ${taskId}`);
    }
    const text = await readFileSafe(join(directory, TASK_FILE), MAX_TASK_JSON_BYTES, undefined, tasksRoot);
    if (text === undefined) {
      const legacy = await readFileSafe(join(directory, STATUS_FILE), MAX_TASK_JSON_BYTES, undefined, tasksRoot);
      if (legacy !== undefined) {
        throw new TaskError("LEGACY_FORMAT", `Task ${taskId} uses the legacy status.json format`);
      }
      throw new TaskError("TASK_NOT_FOUND", `Task not found: ${taskId}`);
    }
    return parseTask(text, taskId);
  }

  async function readInstruction(taskId: string, relativePath: string): Promise<string> {
    assertSlug(taskId);
    if (!INSTRUCTION_PATH_PATTERN.test(relativePath)) {
      throw new TaskError("INVALID_PATH", `Invalid instruction path: ${JSON.stringify(relativePath)}`);
    }
    const directory = await assertSafeTarget(tasksRoot, taskId);
    const target = await resolveContained(directory, relativePath);
    const text = await readFileSafe(target, MAX_INSTRUCTION_BYTES, undefined, tasksRoot);
    if (text === undefined) {
      throw new TaskError("STEP_NOT_FOUND", `Instruction not found: ${relativePath}`);
    }
    return text;
  }

  async function create(task: Task, instructions: readonly InstructionFile[]): Promise<void> {
    assertSlug(task.id);
    assertInstructionPaths(instructions);
    const serialized = serializeTask(task);
    if (Buffer.byteLength(serialized, "utf8") > MAX_TASK_JSON_BYTES) {
      throw new TaskError(
        "FILE_TOO_LARGE",
        `Task JSON exceeds ${MAX_TASK_JSON_BYTES} bytes: ${join(tasksRoot, task.id, TASK_FILE)}`,
      );
    }
    for (const file of instructions) {
      if (Buffer.byteLength(file.content, "utf8") > MAX_INSTRUCTION_BYTES) {
        throw new TaskError(
          "FILE_TOO_LARGE",
          `Instruction exceeds ${MAX_INSTRUCTION_BYTES} bytes: ${join(tasksRoot, task.id, file.relativePath)}`,
        );
      }
    }
    await publishDirectory(tasksRoot, task.id, async (staging) => {
      await atomicWrite(join(staging, TASK_FILE), serialized, 0o600);
      await mkdir(join(staging, "instructions"), { mode: 0o700 });
      for (const file of instructions) {
        const target = await resolveContained(staging, file.relativePath);
        await atomicWrite(target, file.content, 0o600);
      }
      await mkdir(join(staging, "evidence"), { mode: 0o700 });
      await mkdir(join(staging, "checkpoints"), { mode: 0o700 });
      await mkdir(join(staging, "checkpoints", "history"), { mode: 0o700 });
      await mkdir(join(staging, "notes"), { mode: 0o700 });
    });
  }

  async function save(
    task: Task,
    expectedRevision: number,
    instructions?: readonly InstructionFile[],
  ): Promise<void> {
    assertSlug(task.id);
    if (instructions !== undefined) {
      assertInstructionPaths(instructions);
    }
    const taskDirectory = await assertSafeTarget(tasksRoot, task.id);
    const lockPath = join(taskDirectory, LOCK_FILE);
    let lock: FileHandle;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      const code = errnoOf(error);
      if (code === "EEXIST") {
        throw new TaskError(
          "LOCKED",
          `Task ${task.id} is locked (${lockPath}); a crashed process may have left the lock behind, remove it only once no other process is writing`,
        );
      }
      if (code === "ENOENT") {
        throw new TaskError("TASK_NOT_FOUND", `Task not found: ${task.id}`);
      }
      throw asTaskError(error);
    }
    try {
      const currentText = await readFileSafe(join(taskDirectory, TASK_FILE), MAX_TASK_JSON_BYTES, undefined, tasksRoot);
      if (currentText === undefined) {
        throw new TaskError("TASK_NOT_FOUND", `Task not found: ${task.id}`);
      }
      const current = parseTask(currentText, task.id);
      if (current.revision !== expectedRevision) {
        throw new TaskError(
          "REVISION_CONFLICT",
          `Expected revision ${expectedRevision} but current revision is ${current.revision}`,
        );
      }
      if (task.revision !== expectedRevision + 1) {
        throw new TaskError(
          "INVALID_ARGUMENT",
          `New revision must be ${expectedRevision + 1} but was ${task.revision}`,
        );
      }
      const serialized = serializeTask(task);
      if (Buffer.byteLength(serialized, "utf8") > MAX_TASK_JSON_BYTES) {
        throw new TaskError(
          "FILE_TOO_LARGE",
          `Task JSON exceeds ${MAX_TASK_JSON_BYTES} bytes: ${join(taskDirectory, TASK_FILE)}`,
        );
      }
      if (instructions !== undefined) {
        for (const file of instructions) {
          if (Buffer.byteLength(file.content, "utf8") > MAX_INSTRUCTION_BYTES) {
            throw new TaskError(
              "FILE_TOO_LARGE",
              `Instruction exceeds ${MAX_INSTRUCTION_BYTES} bytes: ${join(taskDirectory, file.relativePath)}`,
            );
          }
        }
      }
      if (instructions !== undefined) {
        for (const file of instructions) {
          const target = await resolveContained(taskDirectory, file.relativePath);
          await atomicWrite(target, file.content, 0o600);
        }
      }
      await atomicWrite(join(taskDirectory, TASK_FILE), serialized, 0o600);
    } finally {
      await lock.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }

  return { list, exists, create, read, readInstruction, save };
}

export function createFileTaskReader(options: FileTaskStoreOptions): Pick<TaskStore, "list" | "read"> {
  return createFileTaskStore(options);
}
