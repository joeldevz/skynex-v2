import { TaskError } from "./errors.js";
import { instructionPathFor } from "./instruction.js";
import { SLUG_PATTERN } from "./slug.js";
import {
  MAX_STEPS,
  MAX_TASK_JSON_BYTES,
  MAX_TEXT_FIELD_LENGTH,
  MAX_TITLE_LENGTH,
  SCHEMA_VERSION,
  STEP_ID_PATTERN,
} from "./task.js";
import type { Step, StepStatus, Task, TaskStatus } from "./task.js";

const STEP_STATUSES: readonly StepStatus[] = ["pending", "in_progress", "done", "blocked"];
const TASK_STATUSES: readonly TaskStatus[] = ["open", "in_progress", "done", "blocked"];

export function parseTask(text: string, expectedId: string): Task {
  if (utf8ByteLength(text) > MAX_TASK_JSON_BYTES) {
    throw new TaskError("FILE_TOO_LARGE", `Task JSON exceeds ${MAX_TASK_JSON_BYTES} bytes`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TaskError("UNSUPPORTED_SCHEMA", "Task file is not valid JSON");
  }
  if (!isRecord(raw)) {
    throw new TaskError("UNSUPPORTED_SCHEMA", "Task file must contain a JSON object");
  }
  if (!Object.prototype.hasOwnProperty.call(raw, "schemaVersion")) {
    throw new TaskError("LEGACY_FORMAT", "Task file has no schemaVersion; the legacy format is not supported");
  }
  if (raw["schemaVersion"] !== SCHEMA_VERSION) {
    throw new TaskError("UNSUPPORTED_SCHEMA", `Unsupported schemaVersion: ${JSON.stringify(raw["schemaVersion"])}`);
  }

  const id = requireString(raw, "id");
  if (!SLUG_PATTERN.test(id)) {
    throw new TaskError("INVALID_ARGUMENT", `Task id is not a valid slug: ${JSON.stringify(id)}`);
  }
  if (id !== expectedId) {
    throw new TaskError(
      "INVALID_ARGUMENT",
      `Task id ${JSON.stringify(id)} does not match expected id ${JSON.stringify(expectedId)}`,
    );
  }

  const title = requireString(raw, "title");
  if (title.trim().length === 0) {
    throw new TaskError("INVALID_ARGUMENT", "Task title must not be empty");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new TaskError("INVALID_ARGUMENT", `Task title exceeds ${MAX_TITLE_LENGTH} characters`);
  }

  const status = requireEnum(raw, "status", TASK_STATUSES);
  const revision = requireInteger(raw, "revision", 1);
  const createdAt = requireString(raw, "createdAt");
  const updatedAt = requireString(raw, "updatedAt");

  const rawSteps = raw["steps"];
  if (!Array.isArray(rawSteps)) {
    throw new TaskError("INVALID_ARGUMENT", "Task steps must be an array");
  }
  if (rawSteps.length > MAX_STEPS) {
    throw new TaskError("INVALID_ARGUMENT", `Task exceeds the maximum of ${MAX_STEPS} steps`);
  }
  const steps = rawSteps.map((item, index) => parseStep(item, index));
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) {
      throw new TaskError("INVALID_ARGUMENT", `Duplicate step id: ${step.id}`);
    }
    seen.add(step.id);
  }

  return { schemaVersion: SCHEMA_VERSION, id, title, status, revision, createdAt, updatedAt, steps };
}

export function serializeTask(task: Task): string {
  const serialized = {
    schemaVersion: task.schemaVersion,
    id: task.id,
    title: task.title,
    status: task.status,
    revision: task.revision,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    steps: task.steps.map(serializeStep),
  };
  return `${JSON.stringify(serialized, null, 2)}\n`;
}

function serializeStep(step: Step): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    id: step.id,
    title: step.title,
    scope: step.scope,
    doneWhen: step.doneWhen,
    expectedEvidence: step.expectedEvidence,
    dependsOn: [...step.dependsOn],
    status: step.status,
    instructionPath: step.instructionPath,
  };
  if (step.blockReason !== undefined) {
    serialized["blockReason"] = step.blockReason;
  }
  if (step.declaredDoneAt !== undefined) {
    serialized["declaredDoneAt"] = step.declaredDoneAt;
  }
  return serialized;
}

function parseStep(value: unknown, index: number): Step {
  if (!isRecord(value)) {
    throw new TaskError("INVALID_ARGUMENT", `steps[${index}] must be an object`);
  }
  const id = requireString(value, "id");
  if (!STEP_ID_PATTERN.test(id)) {
    throw new TaskError("INVALID_ARGUMENT", `steps[${index}].id is invalid: ${JSON.stringify(id)}`);
  }
  const title = requireString(value, "title");
  if (title.trim().length === 0) {
    throw new TaskError("INVALID_ARGUMENT", `steps[${index}].title must not be empty`);
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new TaskError("INVALID_ARGUMENT", `steps[${index}].title exceeds ${MAX_TITLE_LENGTH} characters`);
  }
  const scope = requireTextField(value, "scope", index);
  const doneWhen = requireTextField(value, "doneWhen", index);
  const expectedEvidence = requireTextField(value, "expectedEvidence", index);
  const dependsOn = requireStringArray(value, "dependsOn", index);
  for (const dependency of dependsOn) {
    if (!STEP_ID_PATTERN.test(dependency)) {
      throw new TaskError("INVALID_ARGUMENT", `steps[${index}].dependsOn entry is invalid: ${JSON.stringify(dependency)}`);
    }
  }
  const status = requireEnum(value, "status", STEP_STATUSES);
  const instructionPath = requireString(value, "instructionPath");
  if (instructionPath !== instructionPathFor(id)) {
    throw new TaskError(
      "INVALID_ARGUMENT",
      `steps[${index}].instructionPath must be ${JSON.stringify(instructionPathFor(id))}`,
    );
  }
  const blockReason = optionalString(value, "blockReason", index);
  if (blockReason !== undefined && blockReason.length > MAX_TEXT_FIELD_LENGTH) {
    throw new TaskError("INVALID_ARGUMENT", `steps[${index}].blockReason exceeds ${MAX_TEXT_FIELD_LENGTH} characters`);
  }
  const declaredDoneAt = optionalString(value, "declaredDoneAt", index);

  return {
    id,
    title,
    scope,
    doneWhen,
    expectedEvidence,
    dependsOn,
    status,
    instructionPath,
    ...(blockReason === undefined ? {} : { blockReason }),
    ...(declaredDoneAt === undefined ? {} : { declaredDoneAt }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new TaskError("INVALID_ARGUMENT", `Field ${key} must be a string`);
  }
  return value;
}

function requireTextField(record: Record<string, unknown>, key: string, index: number): string {
  const value = requireString(record, key);
  if (value.trim().length === 0) {
    throw new TaskError("INVALID_ARGUMENT", `steps[${index}].${key} must not be empty`);
  }
  if (value.length > MAX_TEXT_FIELD_LENGTH) {
    throw new TaskError("INVALID_ARGUMENT", `steps[${index}].${key} exceeds ${MAX_TEXT_FIELD_LENGTH} characters`);
  }
  return value;
}

function requireStringArray(record: Record<string, unknown>, key: string, index: number): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    throw new TaskError("INVALID_ARGUMENT", `steps[${index}].${key} must be an array of strings`);
  }
  return value;
}

function requireInteger(record: Record<string, unknown>, key: string, minimum: number): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new TaskError("INVALID_ARGUMENT", `Field ${key} must be an integer >= ${minimum}`);
  }
  return value;
}

function requireEnum<T extends string>(record: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const value = record[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new TaskError("INVALID_ARGUMENT", `Field ${key} is invalid: ${JSON.stringify(value)}`);
  }
  return value as T;
}

function optionalString(record: Record<string, unknown>, key: string, index: number): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TaskError("INVALID_ARGUMENT", `steps[${index}].${key} must be a string when present`);
  }
  return value;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
