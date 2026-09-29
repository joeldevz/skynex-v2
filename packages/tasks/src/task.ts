import { TaskError } from "./errors.js";

export const SCHEMA_VERSION = 1 as const;

export type StepStatus = "pending" | "in_progress" | "done" | "blocked";
export type TaskStatus = "open" | "in_progress" | "done" | "blocked";

export interface Step {
  readonly id: string;
  readonly title: string;
  readonly scope: string;
  readonly doneWhen: string;
  readonly expectedEvidence: string;
  readonly dependsOn: readonly string[];
  readonly status: StepStatus;
  readonly instructionPath: string;
  readonly blockReason?: string;
  readonly declaredDoneAt?: string;
}

export interface Task {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly steps: readonly Step[];
}

export interface StepDraft {
  readonly title: string;
  readonly scope: string;
  readonly doneWhen: string;
  readonly expectedEvidence: string;
  readonly dependsOn?: readonly string[];
  readonly instruction?: string;
}

export interface CreateTaskInput {
  readonly title: string;
  readonly steps?: readonly StepDraft[];
}

export interface TaskListEntry {
  readonly id: string;
  readonly format: "task" | "legacy" | "unknown";
  readonly title?: string;
  readonly status?: TaskStatus;
  readonly revision?: number;
  readonly stepCount?: number;
  readonly doneCount?: number;
  readonly nextStepId?: string | null;
  readonly note?: string;
}

export interface TaskSummary extends TaskListEntry {
  readonly format: "task";
  readonly title: string;
  readonly status: TaskStatus;
  readonly revision: number;
  readonly stepCount: number;
  readonly doneCount: number;
  readonly nextStepId: string | null;
}

export interface TaskStatusView {
  readonly taskId: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly revision: number;
  readonly nextStepId: string | null;
  readonly blockedStepIds: readonly string[];
  readonly steps: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: StepStatus;
    readonly dependsOn: readonly string[];
    readonly blockReason?: string;
  }[];
}

export interface TaskBoardView {
  readonly tasks: readonly TaskSummary[];
  readonly omittedCount: number;
}

export interface StepInstructionView {
  readonly taskId: string;
  readonly stepId: string;
  readonly revision: number;
  readonly status: StepStatus;
  readonly title: string;
  readonly instructionPath: string;
  readonly instruction: string;
}

export interface MarkStepDoneResult {
  readonly taskId: string;
  readonly stepId: string;
  readonly previousStatus: StepStatus;
  readonly status: "done";
  readonly declared: true;
  readonly approved: false;
  readonly changed: boolean;
  readonly revision: number;
}

export const MAX_STEPS = 999;
export const MAX_TITLE_LENGTH = 200;
export const MAX_TEXT_FIELD_LENGTH = 2000;
export const MAX_INSTRUCTION_BYTES = 256 * 1024;
export const MAX_TASK_JSON_BYTES = 256 * 1024;
export const STEP_ID_PATTERN = /^step-\d{3}$/;

export function stepIdAt(index0: number): string {
  return `step-${String(index0 + 1).padStart(3, "0")}`;
}

export function deriveTaskStatus(steps: readonly Step[]): TaskStatus {
  if (steps.some((step) => step.status === "blocked")) {
    return "blocked";
  }
  if (steps.length > 0 && steps.every((step) => step.status === "done")) {
    return "done";
  }
  if (steps.some((step) => step.status === "in_progress" || step.status === "done")) {
    return "in_progress";
  }
  return "open";
}

export function computeNextStepId(steps: readonly Step[]): string | null {
  const next = steps.find((step) => step.status !== "done");
  return next === undefined ? null : next.id;
}

export function assertStepDraft(draft: StepDraft): void {
  const title = draft.title.trim();
  if (title.length === 0) {
    throw new TaskError("INVALID_ARGUMENT", "Step title must not be empty");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new TaskError("INVALID_ARGUMENT", `Step title exceeds ${MAX_TITLE_LENGTH} characters`);
  }
  assertTextField(draft.scope, "scope");
  assertTextField(draft.doneWhen, "doneWhen");
  assertTextField(draft.expectedEvidence, "expectedEvidence");
  const dependsOn = draft.dependsOn ?? [];
  for (const dependency of dependsOn) {
    if (!STEP_ID_PATTERN.test(dependency)) {
      throw new TaskError("INVALID_ARGUMENT", `Invalid dependsOn entry: ${JSON.stringify(dependency)}`);
    }
  }
}

function assertTextField(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TaskError("INVALID_ARGUMENT", `Step ${label} must not be empty`);
  }
  if (value.length > MAX_TEXT_FIELD_LENGTH) {
    throw new TaskError("INVALID_ARGUMENT", `Step ${label} exceeds ${MAX_TEXT_FIELD_LENGTH} characters`);
  }
}
