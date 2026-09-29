import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTaskReadService } from "@skynex-internal/tasks";
import { createFileTaskReader } from "./store.js";

test("file task reader lists managed tasks while reporting legacy and invalid directories only as omitted", async () => {
  const root = await mkdtemp(join(tmpdir(), "skynex-task-read-"));
  try {
    await mkdir(join(root, "managed"));
    await writeFile(join(root, "managed", "task.json"), JSON.stringify({
      schemaVersion: 1, id: "managed", title: "Managed task", status: "open", revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", steps: [],
    }));
    await mkdir(join(root, "legacy"));
    await writeFile(join(root, "legacy", "status.json"), "private legacy content");
    await mkdir(join(root, "invalid"));
    await writeFile(join(root, "invalid", "task.json"), "not json");

    const service = createTaskReadService(createFileTaskReader({ tasksRoot: root }));
    assert.deepEqual(await service.getBoard(), {
      tasks: [{ id: "managed", format: "task", title: "Managed task", status: "open", revision: 1, stepCount: 0, doneCount: 0, nextStepId: null }],
      omittedCount: 2,
    });
    assert.deepEqual((await service.getStatus("managed")).steps, []);
    await assert.rejects(() => service.getStatus("legacy"), /legacy status\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
