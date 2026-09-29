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
