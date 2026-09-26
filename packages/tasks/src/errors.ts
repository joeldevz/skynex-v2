export type TaskErrorCode =
  | "NO_ACTIVE_TASK"
  | "AMBIGUOUS_TASK"
  | "TASK_NOT_FOUND"
  | "STEP_NOT_FOUND"
  | "TASK_EXISTS"
  | "REVISION_CONFLICT"
  | "LOCKED"
  | "INVALID_PATH"
  | "INVALID_ARGUMENT"
  | "INVALID_SLUG"
  | "UNSUPPORTED_SCHEMA"
  | "LEGACY_FORMAT"
  | "FILE_TOO_LARGE"
  | "IO_ERROR";

export class TaskError extends Error {
  readonly code: TaskErrorCode;
  readonly details?: Readonly<Record<string, string>>;

  constructor(code: TaskErrorCode, message: string, details?: Readonly<Record<string, string>>) {
    super(message);
    this.name = "TaskError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function isTaskError(value: unknown): value is TaskError {
  return value instanceof TaskError;
}

export function asTaskError(value: unknown, fallback: TaskErrorCode = "IO_ERROR"): TaskError {
  if (isTaskError(value)) {
    return value;
  }
  const message = value instanceof Error ? value.message : String(value);
  return new TaskError(fallback, message);
}
