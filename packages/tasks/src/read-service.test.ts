import assert from "node:assert/strict";
import test from "node:test";
import { createTaskReadService } from "./service.js";
import type { TaskReader } from "./ports.js";
import type { Task } from "./task.js";

const sample: Task = {
  schemaVersion: 1, id: "sample", title: "Sample", status: "blocked", revision: 3,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  steps: [{ id: "step-001", title: "Blocked step", scope: "private scope", doneWhen: "private criterion", expectedEvidence: "private evidence", dependsOn: [], status: "blocked", instructionPath: "instructions/step-001.md", blockReason: "waiting" }],
};

test("read-only task service filters non-managed entries and exposes only summary/detail fields", async () => {
  const reader: TaskReader = {
    async list() { return [
      { id: "sample", format: "task", title: "Sample", status: "blocked", revision: 3, stepCount: 1, doneCount: 0, nextStepId: "step-001" },
      { id: "old", format: "legacy", note: "legacy" },
      { id: "bad", format: "unknown", note: "invalid" },
    ]; },
    async read(id) { assert.equal(id, "sample"); return sample; },
  };
  const service = createTaskReadService(reader);
  assert.deepEqual(await service.getBoard(), {
    tasks: [{ id: "sample", format: "task", title: "Sample", status: "blocked", revision: 3, stepCount: 1, doneCount: 0, nextStepId: "step-001" }],
    omittedCount: 2,
  });
  assert.deepEqual(await service.getStatus("sample"), {
    taskId: "sample", title: "Sample", status: "blocked", revision: 3, nextStepId: "step-001", blockedStepIds: ["step-001"],
    steps: [{ id: "step-001", title: "Blocked step", status: "blocked", dependsOn: [], blockReason: "waiting" }],
  });
  assert.equal("addStep" in service, false);
  assert.equal("mutateTask" in service, false);
  assert.equal("scope" in (await service.getStatus("sample")).steps[0]!, false);
});

// --- review toggles -------------------------------------------------------
import { createTaskService } from "./service.js";
import { parseTask, serializeTask } from "./schema.js";
import { isTaskError } from "./errors.js";
import type { InstructionFile, TaskStore } from "./ports.js";

function legacyJson(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1, id: "sample", title: "Sample", status: "open", revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", steps: [], ...extra,
  });
}

function memoryStore(): TaskStore & { readonly tasks: Map<string, Task> } {
  const tasks = new Map<string, Task>();
  return {
    tasks,
    async list() { return []; },
    async read(id) { const task = tasks.get(id); if (task === undefined) throw new Error(`missing ${id}`); return parseTask(serializeTask(task), id); },
    async exists(id) { return tasks.has(id); },
    async create(task: Task, _instructions: readonly InstructionFile[]) { tasks.set(task.id, task); },
    async readInstruction() { return ""; },
    async save(task: Task, expectedRevision: number) {
      assert.equal(tasks.get(task.id)?.revision, expectedRevision);
      tasks.set(task.id, task);
    },
  };
}

const fixedDeps = (store: TaskStore) => ({ store, clock: { nowIso: () => "2026-02-02T00:00:00.000Z" }, ids: { newId: () => "x" } });

test("task without reviews (or with missing keys) reads as auto", async () => {
  const store = memoryStore();
  store.tasks.set("sample", parseTask(legacyJson(), "sample"));
  const service = createTaskService(fixedDeps(store));
  assert.deepEqual((await service.getReviews("sample")).reviews, { security: "auto" });
  assert.deepEqual(parseTask(legacyJson({ reviews: {} }), "sample").reviews, { security: "auto" });
});

test("invalid review values or unknown keys are rejected with INVALID_ARGUMENT", () => {
  for (const reviews of [{ security: "maybe" }, { other: "on" }, "on", null]) {
    assert.throws(() => parseTask(legacyJson({ reviews }), "sample"), (error: unknown) => isTaskError(error) && error.code === "INVALID_ARGUMENT");
  }
});

test("setReviews updates security, bumps revision and persists", async () => {
  const store = memoryStore();
  const service = createTaskService(fixedDeps(store));
  const created = await service.createTask({ title: "Sample", reviews: { security: "off" } });
  assert.deepEqual((await service.getReviews(created.taskId)).reviews, { security: "off" });
  const first = await service.setReviews(created.taskId, { security: "on" });
  assert.deepEqual(first, { taskId: "sample", reviews: { security: "on" }, revision: 2 });
  const second = await service.setReviews(created.taskId, { security: "auto" }, { expectedRevision: 2 });
  assert.equal(second.revision, 3);
  assert.deepEqual(JSON.parse(serializeTask(store.tasks.get("sample")!)).reviews, { security: "auto" });
  await assert.rejects(() => service.setReviews("sample", {}), (error: unknown) => isTaskError(error) && error.code === "INVALID_ARGUMENT");
  await assert.rejects(() => service.setReviews("sample", { security: "bad" as "on" }), (error: unknown) => isTaskError(error) && error.code === "INVALID_ARGUMENT");
  await assert.rejects(() => service.setReviews("sample", { security: "on" }, { expectedRevision: 1 }), (error: unknown) => isTaskError(error) && error.code === "REVISION_CONFLICT");
  await assert.rejects(() => service.createTask({ title: "Bad", reviews: { security: "nope" as "on" } }), (error: unknown) => isTaskError(error) && error.code === "INVALID_ARGUMENT");
});

test("legacy reviews.skills and reviews.conventions are ignored on read and dropped on write", () => {
  for (const legacy of [{ skills: "off" }, { conventions: "off" }, { skills: 1, conventions: "maybe" }]) {
    const task = parseTask(legacyJson({ reviews: { security: "on", ...legacy } }), "sample");
    assert.deepEqual(task.reviews, { security: "on" });
    assert.deepEqual(JSON.parse(serializeTask(task)).reviews, { security: "on" });
  }
});

test("setReviews and createTask reject skills and conventions keys", async () => {
  const store = memoryStore();
  const service = createTaskService(fixedDeps(store));
  await service.createTask({ title: "Sample" });
  for (const key of ["skills", "conventions"]) {
    const patch = { [key]: "on" } as unknown as { security: "on" };
    await assert.rejects(() => service.setReviews("sample", patch), (error: unknown) => isTaskError(error) && error.code === "INVALID_ARGUMENT");
    await assert.rejects(() => service.createTask({ title: "Other", reviews: patch }), (error: unknown) => isTaskError(error) && error.code === "INVALID_ARGUMENT");
  }
});
