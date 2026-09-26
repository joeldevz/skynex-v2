import type { Task, TaskListEntry } from "./task.js";

export interface InstructionFile {
  readonly relativePath: string;
  readonly content: string;
}

export interface TaskStore {
  list(): Promise<readonly TaskListEntry[]>;
  exists(taskId: string): Promise<boolean>;
  create(task: Task, instructions: readonly InstructionFile[]): Promise<void>;
  read(taskId: string): Promise<Task>;
  readInstruction(taskId: string, relativePath: string): Promise<string>;
  save(task: Task, expectedRevision: number, instructions?: readonly InstructionFile[]): Promise<void>;
}

export interface Clock {
  nowIso(): string;
}

export interface IdGenerator {
  newId(): string;
}

export interface TaskServiceDependencies {
  readonly store: TaskStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
