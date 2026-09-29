import { TaskError } from "./errors.js";
import { instructionPathFor, renderInstruction } from "./instruction.js";
import { slugify, withCollisionSuffix } from "./slug.js";
import {
  MAX_STEPS,
  MAX_TITLE_LENGTH,
  DEFAULT_REVIEWS,
  SCHEMA_VERSION,
  assertReviewsPatch,
  assertStepDraft,
  computeNextStepId,
  deriveTaskStatus,
  resolveReviews,
  stepIdAt,
} from "./task.js";
import type {
  CreateTaskInput,
  MarkStepDoneResult,
  SetReviewsResult,
  Step,
  StepDraft,
  StepInstructionView,
  Task,
  TaskBoardView,
  TaskListEntry,
  TaskReviewsPatch,
  TaskReviewsView,
  TaskSummary,
  TaskStatusView,
} from "./task.js";
import type { InstructionFile, TaskReader, TaskServiceDependencies, TaskStore } from "./ports.js";

export interface TaskService {
  createTask(input: CreateTaskInput): Promise<{
    readonly taskId: string;
    readonly task: Task;
    readonly instructionPaths: readonly string[];
  }>;
  listTasks(): Promise<readonly TaskListEntry[]>;
  getBoard(): Promise<TaskBoardView>;
  getStatus(taskId: string | null): Promise<TaskStatusView>;
  readStepInstruction(taskId: string | null, stepId: string | null): Promise<StepInstructionView>;
  addStep(
    taskId: string | null,
    draft: StepDraft,
    options?: { readonly expectedRevision?: number },
  ): Promise<{
    readonly taskId: string;
    readonly stepId: string;
    readonly instructionPath: string;
    readonly revision: number;
  }>;
  markStepDone(
    taskId: string | null,
    stepId: string,
    options?: { readonly expectedRevision?: number },
  ): Promise<MarkStepDoneResult>;
  getReviews(taskId: string | null): Promise<TaskReviewsView>;
  setReviews(
    taskId: string | null,
    patch: TaskReviewsPatch,
    options?: { readonly expectedRevision?: number },
  ): Promise<SetReviewsResult>;
}

const MAX_COLLISION_ATTEMPTS = 100;

export function createTaskService(deps: TaskServiceDependencies): TaskService {
  const { store, clock } = deps;

  return {
    async createTask(input) {
      const title = input.title;
      if (title.trim().length === 0 || title.length > MAX_TITLE_LENGTH) {
        throw new TaskError(
          "INVALID_ARGUMENT",
          `Task title must be non-empty and at most ${MAX_TITLE_LENGTH} characters`,
        );
      }
      const reviewsPatch = input.reviews === undefined ? undefined : assertReviewsPatch(input.reviews);
      const steps: Step[] = [];
      const instructionFiles: InstructionFile[] = [];
      const drafts = input.steps ?? [];
      if (drafts.length > MAX_STEPS) {
        throw new TaskError("INVALID_ARGUMENT", `A task cannot have more than ${MAX_STEPS} steps`);
      }
      drafts.forEach((draft, index) => {
        assertStepDraft(draft);
        const id = stepIdAt(index);
        const step = buildPendingStep(id, draft);
        steps.push(step);
        instructionFiles.push(renderInstructionFile(step, draft));
      });

      const ids = new Set(steps.map((step) => step.id));
      for (const step of steps) {
        assertDependenciesExist(step.dependsOn, ids);
      }

      const base = slugify(input.title);
      const id = await resolveAvailableId(store, base);
      const now = clock.nowIso();
      const task: Task = {
        schemaVersion: SCHEMA_VERSION,
        id,
        title: input.title,
        status: deriveTaskStatus(steps),
        revision: 1,
        createdAt: now,
        updatedAt: now,
        steps,
        ...(reviewsPatch === undefined ? {} : { reviews: { ...DEFAULT_REVIEWS, ...reviewsPatch } }),
      };
      await store.create(task, instructionFiles);
      return { taskId: id, task, instructionPaths: instructionFiles.map((file) => file.relativePath) };
    },

    listTasks() {
      return store.list();
    },

    async getBoard() {
      return createTaskBoardView(await store.list());
    },

    async getStatus(taskId) {
      if (taskId === null) {
        throw new TaskError("NO_ACTIVE_TASK", "No active task is selected");
      }
      return createTaskStatusView(await store.read(taskId));
    },

    async readStepInstruction(taskId, stepId) {
      if (taskId === null) {
        throw new TaskError("NO_ACTIVE_TASK", "No active task is selected");
      }
      const task = await store.read(taskId);
      const resolvedId = stepId ?? computeNextStepId(task.steps);
      if (resolvedId === null) {
        throw new TaskError("STEP_NOT_FOUND", "No step is available");
      }
      const step = task.steps.find((candidate) => candidate.id === resolvedId);
      if (step === undefined) {
        throw new TaskError("STEP_NOT_FOUND", `Step not found: ${resolvedId}`);
      }
      const instruction = await store.readInstruction(task.id, step.instructionPath);
      return {
        taskId: task.id,
        stepId: step.id,
        revision: task.revision,
        status: step.status,
        title: step.title,
        instructionPath: step.instructionPath,
        instruction,
      };
    },

    async addStep(taskId, draft, options) {
      if (taskId === null) {
        throw new TaskError("NO_ACTIVE_TASK", "No active task is selected");
      }
      assertStepDraft(draft);
      const task = await store.read(taskId);
      if (task.steps.length >= MAX_STEPS) {
        throw new TaskError("INVALID_ARGUMENT", `A task cannot have more than ${MAX_STEPS} steps`);
      }
      const existingIds = new Set(task.steps.map((step) => step.id));
      let nextIndex = task.steps.length;
      let id = stepIdAt(nextIndex);
      while (existingIds.has(id)) {
        nextIndex += 1;
        if (nextIndex >= MAX_STEPS) {
          throw new TaskError("INVALID_ARGUMENT", `A task cannot have more than ${MAX_STEPS} steps`);
        }
        id = stepIdAt(nextIndex);
      }
      const dependsOn = draft.dependsOn ?? [];
      assertDependenciesExist(dependsOn, existingIds);
      if (options?.expectedRevision !== undefined && options.expectedRevision !== task.revision) {
        throw new TaskError(
          "REVISION_CONFLICT",
          `Expected revision ${options.expectedRevision} but current revision is ${task.revision}`,
        );
      }
      const step = buildPendingStep(id, draft);
      const steps = [...task.steps, step];
      const newTask: Task = {
        ...task,
        status: deriveTaskStatus(steps),
        revision: task.revision + 1,
        updatedAt: clock.nowIso(),
        steps,
      };
      await store.save(newTask, task.revision, [renderInstructionFile(step, draft)]);
      return { taskId: task.id, stepId: id, instructionPath: step.instructionPath, revision: newTask.revision };
    },

    async markStepDone(taskId, stepId, options) {
      if (taskId === null) {
        throw new TaskError("NO_ACTIVE_TASK", "No active task is selected");
      }
      const task = await store.read(taskId);
      const index = task.steps.findIndex((step) => step.id === stepId);
      const current = task.steps[index];
      if (current === undefined) {
        throw new TaskError("STEP_NOT_FOUND", `Step not found: ${stepId}`);
      }
      if (current.status === "done") {
        return {
          taskId: task.id,
          stepId,
          previousStatus: "done",
          status: "done",
          declared: true,
          approved: false,
          changed: false,
          revision: task.revision,
        };
      }
      if (options?.expectedRevision !== undefined && options.expectedRevision !== task.revision) {
        throw new TaskError(
          "REVISION_CONFLICT",
          `Expected revision ${options.expectedRevision} but current revision is ${task.revision}`,
        );
      }
      const doneStep: Step = {
        id: current.id,
        title: current.title,
        scope: current.scope,
        doneWhen: current.doneWhen,
        expectedEvidence: current.expectedEvidence,
        dependsOn: [...current.dependsOn],
        status: "done",
        instructionPath: current.instructionPath,
        declaredDoneAt: clock.nowIso(),
      };
      const steps = task.steps.map((step, position) => (position === index ? doneStep : step));
      const newTask: Task = {
        ...task,
        status: deriveTaskStatus(steps),
        revision: task.revision + 1,
        updatedAt: clock.nowIso(),
        steps,
      };
      await store.save(newTask, task.revision);
      return {
        taskId: task.id,
        stepId,
        previousStatus: current.status,
        status: "done",
        declared: true,
        approved: false,
        changed: true,
        revision: newTask.revision,
      };
    },

    async getReviews(taskId) {
      if (taskId === null) {
        throw new TaskError("NO_ACTIVE_TASK", "No active task is selected");
      }
      const task = await store.read(taskId);
      return { taskId: task.id, revision: task.revision, reviews: resolveReviews(task) };
    },

    async setReviews(taskId, patch, options) {
      if (taskId === null) {
        throw new TaskError("NO_ACTIVE_TASK", "No active task is selected");
      }
      const validated = assertReviewsPatch(patch);
      if (validated.security === undefined) {
        throw new TaskError("INVALID_ARGUMENT", "A review value (security) is required");
      }
      const task = await store.read(taskId);
      if (options?.expectedRevision !== undefined && options.expectedRevision !== task.revision) {
        throw new TaskError(
          "REVISION_CONFLICT",
          `Expected revision ${options.expectedRevision} but current revision is ${task.revision}`,
        );
      }
      const reviews = { ...resolveReviews(task), ...validated };
      const newTask: Task = { ...task, reviews, revision: task.revision + 1, updatedAt: clock.nowIso() };
      await store.save(newTask, task.revision);
      return { taskId: task.id, reviews, revision: newTask.revision };
    },
  };
}

/** Read-only facade for UIs which must not receive task mutation capabilities. */
export interface TaskReadService {
  getBoard(): Promise<TaskBoardView>;
  getStatus(taskId: string): Promise<TaskStatusView>;
}

export function createTaskReadService(store: TaskReader): TaskReadService {
  return {
    async getBoard() {
      return createTaskBoardView(await store.list());
    },
    async getStatus(taskId) {
      return createTaskStatusView(await store.read(taskId));
    },
  };
}

export function createTaskBoardView(entries: readonly TaskListEntry[]): TaskBoardView {
  const tasks = entries.filter(isTaskSummary);
  return { tasks, omittedCount: entries.length - tasks.length };
}

export function createTaskStatusView(task: Task): TaskStatusView {
  return {
    taskId: task.id,
    title: task.title,
    status: task.status,
    revision: task.revision,
    nextStepId: computeNextStepId(task.steps),
    blockedStepIds: task.steps.filter((step) => step.status === "blocked").map((step) => step.id),
    steps: task.steps.map(toStatusStep),
  };
}

function toStatusStep(step: Step): TaskStatusView["steps"][number] {
  return {
    id: step.id,
    title: step.title,
    status: step.status,
    dependsOn: [...step.dependsOn],
    ...(step.blockReason === undefined ? {} : { blockReason: step.blockReason }),
  };
}

function isTaskSummary(entry: TaskListEntry): entry is TaskSummary {
  return entry.format === "task" && entry.title !== undefined && entry.status !== undefined && entry.revision !== undefined && entry.stepCount !== undefined && entry.doneCount !== undefined;
}

function buildPendingStep(id: string, draft: StepDraft): Step {
  return {
    id,
    title: draft.title,
    scope: draft.scope,
    doneWhen: draft.doneWhen,
    expectedEvidence: draft.expectedEvidence,
    dependsOn: [...(draft.dependsOn ?? [])],
    status: "pending",
    instructionPath: instructionPathFor(id),
  };
}

function renderInstructionFile(step: Step, draft: StepDraft): InstructionFile {
  const content = draft.instruction === undefined ? renderInstruction(step) : renderInstruction(step, draft.instruction);
  return { relativePath: step.instructionPath, content };
}

function assertDependenciesExist(dependsOn: readonly string[], available: ReadonlySet<string>): void {
  for (const dependency of dependsOn) {
    if (!available.has(dependency)) {
      throw new TaskError("INVALID_ARGUMENT", `Unknown step dependency: ${dependency}`);
    }
  }
}

async function resolveAvailableId(store: TaskStore, base: string): Promise<string> {
  let attempt = 1;
  let id = base;
  while (await store.exists(id)) {
    attempt += 1;
    if (attempt > MAX_COLLISION_ATTEMPTS) {
      throw new TaskError("TASK_EXISTS", `Unable to allocate a unique task id for slug ${JSON.stringify(base)}`);
    }
    id = withCollisionSuffix(base, attempt);
  }
  return id;
}
