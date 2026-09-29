import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, readdir, readlink, lstat, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_INSTRUCTION_BYTES,
  MAX_TASK_JSON_BYTES,
  createTaskService,
  isTaskError,
  serializeTask,
} from "../packages/tasks/dist/index.js";
import {
  createFileTaskStore,
  resolveContained,
  systemClock,
  uuidIds,
} from "../packages/tasks-node/dist/index.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const cli = resolve(repoRoot, "apps/cli/dist/index.js");
const BASE_TMP = "/tmp/opencode";
const REAL_TASKS_ROOT = join(repoRoot, ".skynex", "tasks");

const cases = [];
let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    cases.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error && error.stack ? error.stack : String(error));
  }
}

async function freshRoot() {
  await mkdir(BASE_TMP, { recursive: true });
  return mkdtemp(join(BASE_TMP, "skynex-tasks-"));
}

function runCli(args, options = {}) {
  // Isolated roots live outside the repo; run from the root itself so the
  // --tasks-root containment rule (root must be inside the project) holds.
  const rootIndex = args.indexOf("--tasks-root");
  const defaultCwd = rootIndex >= 0 ? args[rootIndex + 1] : repoRoot;
  return spawnSync(process.execPath, [cli, "task", ...args], {
    cwd: options.cwd ?? defaultCwd,
    encoding: "utf8",
    timeout: 20000,
  });
}

function parseJson(result) {
  assert.equal(result.signal, null, `CLI terminated: ${result.signal}`);
  return JSON.parse(result.stdout);
}

function keysOf(value) {
  return Object.keys(value).sort();
}

async function readTaskJson(root, id) {
  return JSON.parse(await readFile(join(root, id, "task.json"), "utf8"));
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function treeContains(root, marker) {
  async function walk(directory) {
    let names;
    try {
      names = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
    for (const entry of names) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (await walk(full)) return true;
      } else if (entry.isFile()) {
        const info = await lstat(full);
        if (info.size <= 1024 * 1024 && (await readFile(full, "utf8")).includes(marker)) {
          return true;
        }
      }
    }
    return false;
  }
  return walk(root);
}

async function snapshotTree(root) {
  const entries = [];
  async function walk(directory, prefix) {
    let names;
    try {
      names = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(directory, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) {
        entries.push([relative, "symlink", await readlink(full)]);
      } else if (info.isDirectory()) {
        entries.push([relative, "dir"]);
        await walk(full, relative);
      } else if (info.isFile()) {
        const digest = createHash("sha256").update(await readFile(full)).digest("hex");
        entries.push([relative, "file", digest]);
      } else {
        entries.push([relative, "other"]);
      }
    }
  }
  await walk(root, "");
  return entries;
}

const realTasksBefore = await snapshotTree(REAL_TASKS_ROOT);

await test("init-creates-task-with-zero-steps", async () => {
  const root = await freshRoot();
  try {
    const result = runCli(["init", "Zero Steps Task", "--tasks-root", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const json = parseJson(result);
    assert.equal(json.ok, true);
    assert.equal(json.command, "task.init");
    assert.equal(json.taskId, "zero-steps-task");
    assert.equal(json.revision, 1);
    assert.equal(json.status, "open");
    assert.equal(json.indexPath, "task.json");
    assert.deepEqual(json.instructionPaths, []);
    const task = await readTaskJson(root, "zero-steps-task");
    assert.equal(task.schemaVersion, 1);
    assert.equal(task.revision, 1);
    assert.deepEqual(task.steps, []);
    for (const directory of ["evidence", "checkpoints/history", "notes"]) {
      assert.equal((await stat(join(root, "zero-steps-task", directory))).isDirectory(), true, directory);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("add-step-appends-and-writes-instruction", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Two Step Task", "--tasks-root", root, "--json"]).status, 0);
    const first = runCli([
      "next", "add", "First title", "--scope", "First scope", "--done-when", "First done", "--evidence", "First evidence",
      "--instruction", "First body", "--task", "two-step-task", "--tasks-root", root, "--json",
    ]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(parseJson(first).stepId, "step-001");
    const second = runCli([
      "next", "add", "Second title", "--scope", "Second scope", "--done-when", "Second done", "--evidence", "Second evidence",
      "--depends-on", "step-001", "--task", "two-step-task", "--tasks-root", root, "--json",
    ]);
    assert.equal(second.status, 0, second.stderr);
    const secondJson = parseJson(second);
    assert.equal(secondJson.stepId, "step-002");
    assert.equal(secondJson.revision, 3);
    const task = await readTaskJson(root, "two-step-task");
    assert.equal(task.revision, 3);
    assert.deepEqual(task.steps.map((step) => step.id), ["step-001", "step-002"]);
    assert.deepEqual(task.steps.map((step) => step.title), ["First title", "Second title"]);
    assert.deepEqual(task.steps[0].dependsOn, []);
    assert.deepEqual(task.steps[1].dependsOn, ["step-001"]);
    for (const name of ["step-001", "step-002"]) {
      const text = await readFile(join(root, "two-step-task", "instructions", `${name}.md`), "utf8");
      assert.equal(text.length > 0, true, name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("add-step-rejects-unknown-dependency", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Dep Task", "--tasks-root", root, "--json"]).status, 0);
    const taskPath = join(root, "dep-task", "task.json");
    const before = await readFile(taskPath);
    const result = runCli([
      "next", "add", "Dep title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--depends-on", "step-099", "--task", "dep-task", "--tasks-root", root, "--json",
    ]);
    assert.equal(result.status, 2, result.stderr);
    const json = parseJson(result);
    assert.equal(json.ok, false);
    assert.equal(json.code, "INVALID_ARGUMENT");
    assert.deepEqual(await readFile(taskPath), before);
    assert.equal(await exists(join(root, "dep-task", "instructions", "step-001.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("add-step-requires-title", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "No Title Task", "--tasks-root", root, "--json"]).status, 0);
    const taskPath = join(root, "no-title-task", "task.json");
    const beforeTask = await readFile(taskPath);
    const beforeTree = await snapshotTree(root);
    const result = runCli([
      "next", "add", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--task", "no-title-task", "--tasks-root", root, "--json",
    ]);
    assert.equal(result.status, 2, result.stderr);
    const json = parseJson(result);
    assert.equal(json.ok, false);
    assert.equal(json.code, "INVALID_ARGUMENT");
    assert.deepEqual(await readFile(taskPath), beforeTask);
    assert.deepEqual(await snapshotTree(root), beforeTree);
    assert.equal(await exists(join(root, "no-title-task", "instructions", "step-001.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("add-step-title-distinct-from-scope", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Distinct Task", "--tasks-root", root, "--json"]).status, 0);
    const title = "Título visible para la persona";
    const scope = "SCOPE-TEXT-differente-xyz";
    const added = runCli([
      "next", "add", title, "--scope", scope, "--done-when", "D", "--evidence", "E",
      "--task", "distinct-task", "--tasks-root", root, "--json",
    ]);
    assert.equal(added.status, 0, added.stderr);
    const status = runCli(["status", "--task", "distinct-task", "--tasks-root", root, "--json"]);
    assert.equal(status.status, 0, status.stderr);
    const json = parseJson(status);
    assert.equal(json.steps.length, 1);
    assert.equal(json.steps[0].title, title);
    assert.notEqual(json.steps[0].title, scope);
    const task = await readTaskJson(root, "distinct-task");
    assert.equal(task.steps[0].title, title);
    assert.equal(task.steps[0].scope, scope);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("slug-deterministic-and-bounded", async () => {
  const firstRoot = await freshRoot();
  const secondRoot = await freshRoot();
  const thirdRoot = await freshRoot();
  try {
    const accented = "Café Déjà Vu — ñoño! ¿Qué?";
    const first = runCli(["init", accented, "--tasks-root", firstRoot, "--json"]);
    const second = runCli(["init", accented, "--tasks-root", secondRoot, "--json"]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    const firstId = parseJson(first).taskId;
    assert.equal(firstId, "cafe-deja-vu-nono-que");
    assert.equal(parseJson(second).taskId, firstId);

    const longTitle = `${"alpha ".repeat(25)}omega`;
    const long = runCli(["init", longTitle, "--tasks-root", thirdRoot, "--json"]);
    assert.equal(long.status, 0, long.stderr);
    const longId = parseJson(long).taskId;
    assert.equal(longId.length <= 80, true, longId);
    assert.match(longId, /^[a-z0-9][a-z0-9-]{0,79}$/);

    for (const title of ["@@@", "..."]) {
      const bad = runCli(["init", title, "--tasks-root", firstRoot, "--json"]);
      assert.equal(bad.status, 5, bad.stderr);
      assert.equal(parseJson(bad).code, "INVALID_SLUG");
    }
  } finally {
    for (const root of [firstRoot, secondRoot, thirdRoot]) await rm(root, { recursive: true, force: true });
  }
});

await test("init-collision-suffix-preserves-first", async () => {
  const root = await freshRoot();
  try {
    const first = runCli(["init", "Same Title", "--tasks-root", root, "--json"]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(parseJson(first).taskId, "same-title");
    const firstPath = join(root, "same-title", "task.json");
    const before = await readFile(firstPath);
    const second = runCli(["init", "Same Title", "--tasks-root", root, "--json"]);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(parseJson(second).taskId, "same-title-2");
    assert.deepEqual(await readFile(firstPath), before);
    assert.equal((await readTaskJson(root, "same-title")).id, "same-title");
    assert.equal((await readTaskJson(root, "same-title-2")).id, "same-title-2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("reject-symlink-and-nonregular", async () => {
  const root = await freshRoot();
  const outside = await freshRoot();
  try {
    await mkdir(join(root, "evil-target"), { recursive: true });
    await symlink(join(root, "evil-target"), join(root, "evil-task"));
    const beforeDirectory = await snapshotTree(root);
    const viaDirectory = runCli(["status", "--task", "evil-task", "--tasks-root", root, "--json"]);
    assert.equal(viaDirectory.status, 5, viaDirectory.stderr);
    assert.equal(parseJson(viaDirectory).code, "INVALID_PATH");
    assert.deepEqual(await snapshotTree(root), beforeDirectory);

    assert.equal(runCli(["init", "Symlink Json", "--tasks-root", root, "--json"]).status, 0);
    const taskDirectory = join(root, "symlink-json");
    await rm(join(taskDirectory, "task.json"));
    await writeFile(join(outside, "target.json"), "{}\n");
    await symlink(join(outside, "target.json"), join(taskDirectory, "task.json"));
    const beforeFile = await snapshotTree(root);
    const viaFile = runCli(["status", "--task", "symlink-json", "--tasks-root", root, "--json"]);
    assert.equal(viaFile.status, 5, viaFile.stderr);
    assert.equal(parseJson(viaFile).code, "INVALID_PATH");
    assert.deepEqual(await snapshotTree(root), beforeFile);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

await test("reject-path-escape", async () => {
  const root = await freshRoot();
  try {
    await mkdir(root, { recursive: true });
    const before = await snapshotTree(root);
    const escapes = ["../escape", join(root, "..", "escape"), "/etc/passwd", "a/../b", "..\\escape", ""];
    for (const candidate of escapes) {
      await assert.rejects(
        () => resolveContained(root, candidate),
        (error) => isTaskError(error) && error.code === "INVALID_PATH",
        `expected INVALID_PATH for ${JSON.stringify(candidate)}`,
      );
    }
    assert.deepEqual(await snapshotTree(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("revision-conflict-two-writers", async () => {
  const root = await freshRoot();
  try {
    const store = createFileTaskStore({ tasksRoot: root });
    const service = createTaskService({ store, clock: systemClock, ids: uuidIds });
    const created = await service.createTask({ title: "Rev Conflict" });
    const draftA = { title: "A", scope: "A", doneWhen: "A", expectedEvidence: "A" };
    const draftB = { title: "B", scope: "B", doneWhen: "B", expectedEvidence: "B" };
    await service.addStep(created.taskId, draftA, { expectedRevision: 1 });
    let conflict;
    try {
      await service.addStep(created.taskId, draftB, { expectedRevision: 1 });
    } catch (error) {
      conflict = error;
    }
    assert.equal(isTaskError(conflict), true);
    assert.equal(conflict.code, "REVISION_CONFLICT");
    const status = await service.getStatus(created.taskId);
    assert.equal(status.revision, 2);
    assert.deepEqual(status.steps.map((step) => step.id), ["step-001"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("lock-blocks-concurrent-writer", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Lock Task", "--tasks-root", root, "--json"]).status, 0);
    const lockPath = join(root, "lock-task", ".task.lock");
    await writeFile(lockPath, "held\n", { mode: 0o600 });
    const taskPath = join(root, "lock-task", "task.json");
    const before = await readFile(taskPath);
    const result = runCli([
      "next", "add", "Lock title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--task", "lock-task", "--tasks-root", root, "--json",
    ]);
    assert.equal(result.status, 4, result.stderr);
    assert.equal(parseJson(result).code, "LOCKED");
    assert.deepEqual(await readFile(taskPath), before);
    assert.equal(await exists(lockPath), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("status-is-compact", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Compact Task", "--tasks-root", root, "--json"]).status, 0);
    const added = runCli([
      "next", "add", "STEP-TITLE", "--scope", "SCOPE-MARKER-xyz", "--done-when", "DONEWHEN-MARKER-xyz",
      "--evidence", "EVIDENCE-MARKER-xyz", "--instruction", "INSTRUCTION-MARKER-xyz",
      "--task", "compact-task", "--tasks-root", root, "--json",
    ]);
    assert.equal(added.status, 0, added.stderr);
    const result = runCli(["status", "--task", "compact-task", "--tasks-root", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const json = parseJson(result);
    assert.equal(json.title, "Compact Task");
    assert.equal(json.steps.length, 1);
    assert.equal(json.steps[0].id, "step-001");
    assert.equal(json.steps[0].title, "STEP-TITLE");
    assert.equal(json.steps[0].status, "pending");
    assert.deepEqual(json.steps[0].dependsOn, []);
    assert.equal(result.stdout.includes("SCOPE-MARKER-xyz"), false);
    assert.equal(result.stdout.includes("DONEWHEN-MARKER-xyz"), false);
    assert.equal(result.stdout.includes("EVIDENCE-MARKER-xyz"), false);
    assert.equal(result.stdout.includes("INSTRUCTION-MARKER-xyz"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("next-show-returns-only-instruction", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Show Task", "--tasks-root", root, "--json"]).status, 0);
    assert.equal(runCli([
      "next", "add", "Show First", "--scope", "First", "--done-when", "D", "--evidence", "E",
      "--instruction", "UNIQUE-BODY-42", "--task", "show-task", "--tasks-root", root, "--json",
    ]).status, 0);
    assert.equal(runCli([
      "next", "add", "Show Second", "--scope", "Second", "--done-when", "D", "--evidence", "E",
      "--instruction", "OTHER-BODY-99", "--task", "show-task", "--tasks-root", root, "--json",
    ]).status, 0);
    const first = runCli(["next", "show", "step-001", "--task", "show-task", "--tasks-root", root, "--json"]);
    assert.equal(first.status, 0, first.stderr);
    const firstJson = parseJson(first);
    assert.equal(firstJson.instructionPath, "instructions/step-001.md");
    assert.equal(firstJson.instruction, await readFile(join(root, "show-task", "instructions", "step-001.md"), "utf8"));
    assert.equal(firstJson.instruction.includes("UNIQUE-BODY-42"), true);
    assert.equal(firstJson.instruction.includes("OTHER-BODY-99"), false);
    const second = runCli(["next", "show", "step-002", "--task", "show-task", "--tasks-root", root, "--json"]);
    const secondJson = parseJson(second);
    assert.equal(secondJson.instruction.includes("OTHER-BODY-99"), true);
    assert.equal(secondJson.instruction.includes("UNIQUE-BODY-42"), false);
    const next = runCli(["next", "show", "--task", "show-task", "--tasks-root", root, "--json"]);
    assert.equal(parseJson(next).stepId, "step-001");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("next-done-declares-not-approves", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Done Task", "--tasks-root", root, "--json"]).status, 0);
    const added = runCli([
      "next", "add", "Done title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--task", "done-task", "--tasks-root", root, "--json",
    ]);
    assert.equal(parseJson(added).revision, 2);
    const result = runCli(["next", "done", "step-001", "--task", "done-task", "--tasks-root", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const json = parseJson(result);
    assert.equal(json.previousStatus, "pending");
    assert.equal(json.status, "done");
    assert.equal(json.declared, true);
    assert.equal(json.approved, false);
    assert.equal(json.changed, true);
    assert.equal(json.revision, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("next-done-idempotent", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Idem Task", "--tasks-root", root, "--json"]).status, 0);
    assert.equal(runCli([
      "next", "add", "Idem title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--task", "idem-task", "--tasks-root", root, "--json",
    ]).status, 0);
    assert.equal(runCli(["next", "done", "step-001", "--task", "idem-task", "--tasks-root", root, "--json"]).status, 0);
    const repeated = runCli(["next", "done", "step-001", "--task", "idem-task", "--tasks-root", root, "--json"]);
    assert.equal(repeated.status, 0, repeated.stderr);
    const json = parseJson(repeated);
    assert.equal(json.changed, false);
    assert.equal(json.revision, 3);
    assert.equal(json.declared, true);
    assert.equal(json.approved, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("list-reports-legacy-without-mutation", async () => {
  const root = await freshRoot();
  try {
    const legacyDirectory = join(root, "scout-agent");
    await mkdir(legacyDirectory, { recursive: true });
    const statusPath = join(legacyDirectory, "status.json");
    await writeFile(statusPath, '{"WorkflowID":"legacy"}\n');
    const before = await readFile(statusPath);
    const beforeTree = await snapshotTree(root);
    const result = runCli(["list", "--tasks-root", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const json = parseJson(result);
    const entry = json.tasks.find((task) => task.id === "scout-agent");
    assert(entry);
    assert.equal(entry.format, "legacy");
    assert.equal(typeof entry.note, "string");
    assert.deepEqual(await readFile(statusPath), before);
    assert.deepEqual(await snapshotTree(root), beforeTree);
    assert.equal(await exists(join(legacyDirectory, "task.json")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("unsupported-schema-rejected", async () => {
  const root = await freshRoot();
  try {
    const directory = join(root, "bad-schema");
    await mkdir(directory, { recursive: true });
    const taskPath = join(directory, "task.json");
    await writeFile(taskPath, '{"schemaVersion":2}\n');
    const before = await readFile(taskPath);
    const result = runCli(["status", "--task", "bad-schema", "--tasks-root", root, "--json"]);
    assert.equal(result.status, 5, result.stderr);
    assert.equal(parseJson(result).code, "UNSUPPORTED_SCHEMA");
    assert.deepEqual(await readFile(taskPath), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("legacy-format-on-read", async () => {
  const root = await freshRoot();
  try {
    const directory = join(root, "legacy-task");
    await mkdir(directory, { recursive: true });
    const statusPath = join(directory, "status.json");
    await writeFile(statusPath, '{"state":"specified"}\n');
    const before = await readFile(statusPath);
    const result = runCli(["status", "--task", "legacy-task", "--tasks-root", root, "--json"]);
    assert.equal(result.status, 5, result.stderr);
    assert.equal(parseJson(result).code, "LEGACY_FORMAT");
    assert.deepEqual(await readFile(statusPath), before);
    assert.equal(await exists(join(directory, "task.json")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("instruction-with-commands-is-inert", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Inert Task", "--tasks-root", root, "--json"]).status, 0);
    const marker = join(root, "PWNED-MARKER");
    const body = `rm -rf ${root}; echo $(touch ${marker}); \`touch ${marker}\``;
    assert.equal(runCli([
      "next", "add", "Inert title", "--scope", "Inert", "--done-when", "D", "--evidence", "E",
      "--instruction", body, "--task", "inert-task", "--tasks-root", root, "--json",
    ]).status, 0);
    const before = await snapshotTree(root);
    const result = runCli(["next", "show", "step-001", "--task", "inert-task", "--tasks-root", root, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const json = parseJson(result);
    assert.equal(json.instruction.includes("rm -rf"), true);
    assert.equal(json.instruction.includes("$(touch"), true);
    assert.equal(await exists(marker), false);
    assert.deepEqual(await snapshotTree(root), before);
    assert.equal(await exists(join(root, "PWNED")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("cli-json-shapes-and-exit-codes", async () => {
  const root = await freshRoot();
  const pathRoot = await freshRoot();
  try {
    const init = runCli(["init", "Shapes Task", "--tasks-root", root, "--json"]);
    assert.equal(init.status, 0, init.stderr);
    assert.deepEqual(keysOf(parseJson(init)), [
      "ok", "command", "tasksRoot", "taskId", "title", "revision", "status", "indexPath", "instructionPaths",
    ].sort());

    const list = runCli(["list", "--tasks-root", root, "--json"]);
    assert.equal(list.status, 0, list.stderr);
    const listJson = parseJson(list);
    assert.deepEqual(keysOf(listJson), ["ok", "command", "tasksRoot", "tasks"].sort());
    assert.deepEqual(keysOf(listJson.tasks[0]), [
      "id", "format", "title", "status", "revision", "stepCount", "doneCount", "nextStepId",
    ].sort());

    const add = runCli([
      "next", "add", "Shapes title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--task", "shapes-task", "--tasks-root", root, "--json",
    ]);
    assert.equal(add.status, 0, add.stderr);
    assert.deepEqual(keysOf(parseJson(add)), [
      "ok", "command", "tasksRoot", "taskId", "stepId", "instructionPath", "revision",
    ].sort());

    const status = runCli(["status", "--task", "shapes-task", "--tasks-root", root, "--json"]);
    assert.equal(status.status, 0, status.stderr);
    assert.deepEqual(keysOf(parseJson(status)), [
      "ok", "command", "tasksRoot", "taskId", "title", "status", "revision", "nextStepId", "blockedStepIds", "steps",
    ].sort());

    const show = runCli(["next", "show", "step-001", "--task", "shapes-task", "--tasks-root", root, "--json"]);
    assert.equal(show.status, 0, show.stderr);
    assert.deepEqual(keysOf(parseJson(show)), [
      "ok", "command", "tasksRoot", "taskId", "stepId", "revision", "status", "title", "instructionPath", "instruction",
    ].sort());

    const done = runCli(["next", "done", "step-001", "--task", "shapes-task", "--tasks-root", root, "--json"]);
    assert.equal(done.status, 0, done.stderr);
    assert.deepEqual(keysOf(parseJson(done)), [
      "ok", "command", "tasksRoot", "taskId", "stepId", "previousStatus", "status", "declared", "approved", "changed", "revision",
    ].sort());

    const noActive = runCli(["status", "--json", "--tasks-root", root]);
    assert.equal(noActive.status, 3, noActive.stderr);
    const noActiveJson = parseJson(noActive);
    assert.equal(noActiveJson.ok, false);
    assert.equal(noActiveJson.command, "task.status");
    assert.equal(noActiveJson.code, "NO_ACTIVE_TASK");
    assert.deepEqual(keysOf(noActiveJson), ["ok", "command", "code", "message"].sort());

    const unknownFlag = runCli(["status", "--not-a-flag", "--json", "--tasks-root", root]);
    assert.equal(unknownFlag.status, 2, unknownFlag.stderr);
    assert.equal(parseJson(unknownFlag).code, "INVALID_ARGUMENT");

    const notFound = runCli(["status", "--task", "missing-task", "--json", "--tasks-root", root]);
    assert.equal(notFound.status, 3, notFound.stderr);
    assert.equal(parseJson(notFound).code, "TASK_NOT_FOUND");

    const stepNotFound = runCli(["next", "show", "step-099", "--task", "shapes-task", "--tasks-root", root, "--json"]);
    assert.equal(stepNotFound.status, 3, stepNotFound.stderr);
    assert.equal(parseJson(stepNotFound).code, "STEP_NOT_FOUND");

    const conflict = runCli([
      "next", "add", "Conflict title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--task", "shapes-task", "--expected-revision", "1", "--tasks-root", root, "--json",
    ]);
    assert.equal(conflict.status, 4, conflict.stderr);
    assert.equal(parseJson(conflict).code, "REVISION_CONFLICT");

    await mkdir(join(pathRoot, "evil-target"), { recursive: true });
    await symlink(join(pathRoot, "evil-target"), join(pathRoot, "evil-task"));
    const invalidPath = runCli(["status", "--task", "evil-task", "--json", "--tasks-root", pathRoot]);
    assert.equal(invalidPath.status, 5, invalidPath.stderr);
    assert.equal(parseJson(invalidPath).code, "INVALID_PATH");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(pathRoot, { recursive: true, force: true });
  }
});

await test("reject-task-json-over-limit-on-write", async () => {
  const root = await freshRoot();
  try {
    const store = createFileTaskStore({ tasksRoot: root });
    const service = createTaskService({ store, clock: systemClock, ids: uuidIds });
    const big = "a".repeat(2000);
    const stepCount = Math.ceil(MAX_TASK_JSON_BYTES / (big.length * 3)) + 2;
    const steps = Array.from({ length: stepCount }, (_, index) => ({
      title: `Step ${index}`,
      scope: big,
      doneWhen: big,
      expectedEvidence: big,
    }));
    let error;
    try {
      await service.createTask({ title: "Huge Index", steps });
    } catch (caught) {
      error = caught;
    }
    assert.equal(isTaskError(error), true, "expected a TaskError");
    assert.equal(error.code, "FILE_TOO_LARGE");
    assert.equal(await exists(join(root, "huge-index", "task.json")), false);
    const names = await readdir(root);
    assert.equal(names.some((name) => name.startsWith(".tmp-")), false, names.join(","));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("reject-instruction-over-limit-on-write", async () => {
  const root = await freshRoot();
  try {
    const store = createFileTaskStore({ tasksRoot: root });
    const service = createTaskService({ store, clock: systemClock, ids: uuidIds });
    const created = await service.createTask({ title: "Instruction Limit" });
    const taskPath = join(root, created.taskId, "task.json");
    const before = await readFile(taskPath);
    let error;
    try {
      await service.addStep(created.taskId, {
        title: "Oversized",
        scope: "S",
        doneWhen: "D",
        expectedEvidence: "E",
        instruction: "x".repeat(MAX_INSTRUCTION_BYTES + 1),
      });
    } catch (caught) {
      error = caught;
    }
    assert.equal(isTaskError(error), true, "expected a TaskError");
    assert.equal(error.code, "FILE_TOO_LARGE");
    assert.deepEqual(await readFile(taskPath), before);
    assert.equal(await exists(join(root, created.taskId, "instructions", "step-001.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("special-file-does-not-hang", async () => {
  const root = await freshRoot();
  try {
    const directory = join(root, "fifo-task");
    await mkdir(directory, { recursive: true });
    const fifoPath = join(directory, "task.json");
    const mkfifo = spawnSync("mkfifo", [fifoPath], { encoding: "utf8" });
    assert.equal(mkfifo.status, 0, mkfifo.stderr);

    const statusResult = spawnSync(
      process.execPath,
      [cli, "task", "status", "--task", "fifo-task", "--tasks-root", root, "--json"],
      { cwd: root, encoding: "utf8", timeout: 5000 },
    );
    assert.equal(statusResult.error, undefined, `status timed out: ${statusResult.error && statusResult.error.code}`);
    assert.equal(statusResult.signal, null, `status killed by ${statusResult.signal}`);
    assert.equal(statusResult.status, 5, statusResult.stderr);
    assert.equal(JSON.parse(statusResult.stdout).code, "INVALID_PATH");

    const listResult = spawnSync(
      process.execPath,
      [cli, "task", "list", "--tasks-root", root, "--json"],
      { cwd: root, encoding: "utf8", timeout: 5000 },
    );
    assert.equal(listResult.error, undefined, `list timed out: ${listResult.error && listResult.error.code}`);
    assert.equal(listResult.signal, null, `list killed by ${listResult.signal}`);
    assert.equal(listResult.status, 0, listResult.stderr);
    const listJson = JSON.parse(listResult.stdout);
    assert.equal(listJson.ok, true);
    const entry = listJson.tasks.find((task) => task.id === "fifo-task");
    assert(entry);
    assert.equal(entry.format, "unknown");
    assert.equal(typeof entry.note, "string");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("add-step-avoids-duplicate-id", async () => {
  const root = await freshRoot();
  try {
    const now = new Date().toISOString();
    const task = {
      schemaVersion: 1,
      id: "gappy-task",
      title: "Gappy Task",
      status: "open",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: "step-001",
          title: "One",
          scope: "S1",
          doneWhen: "D1",
          expectedEvidence: "E1",
          dependsOn: [],
          status: "pending",
          instructionPath: "instructions/step-001.md",
        },
        {
          id: "step-003",
          title: "Three",
          scope: "S3",
          doneWhen: "D3",
          expectedEvidence: "E3",
          dependsOn: [],
          status: "pending",
          instructionPath: "instructions/step-003.md",
        },
      ],
    };
    const directory = join(root, "gappy-task");
    await mkdir(join(directory, "instructions"), { recursive: true });
    await writeFile(join(directory, "task.json"), serializeTask(task), { mode: 0o600 });

    const added = runCli([
      "next", "add", "New title", "--scope", "SN", "--done-when", "DN", "--evidence", "EN",
      "--task", "gappy-task", "--tasks-root", root, "--json",
    ]);
    assert.equal(added.status, 0, added.stderr);
    const newId = parseJson(added).stepId;
    assert.match(newId, /^step-\d{3}$/);
    assert.notEqual(newId, "step-001");
    assert.notEqual(newId, "step-003");

    const status = runCli(["status", "--task", "gappy-task", "--tasks-root", root, "--json"]);
    assert.equal(status.status, 0, status.stderr);
    const ids = parseJson(status).steps.map((step) => step.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.includes(newId), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("instruction-file-escape-rejected", async () => {
  const root = await freshRoot();
  const outside = await freshRoot();
  try {
    assert.equal(runCli(["init", "Escape Task", "--tasks-root", root, "--json"]).status, 0);
    const secret = join(outside, "secret.md");
    await writeFile(secret, "ESCAPE-SECRET-MARKER\n");
    const escapePath = relative(root, secret);
    assert.equal(escapePath.startsWith(".."), true, escapePath);
    const taskPath = join(root, "escape-task", "task.json");
    const before = await readFile(taskPath);
    const result = runCli([
      "next", "add", "Escape title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--instruction-file", escapePath, "--task", "escape-task", "--tasks-root", root, "--json",
    ], { cwd: root });
    assert.equal(result.status, 5, result.stderr);
    assert.equal(parseJson(result).code, "INVALID_PATH");
    assert.deepEqual(await readFile(taskPath), before);
    assert.equal(await exists(join(root, "escape-task", "instructions", "step-001.md")), false);
    assert.equal(result.stdout.includes("ESCAPE-SECRET-MARKER"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

await test("instruction-file-absolute-outside-rejected", async () => {
  const root = await freshRoot();
  const outside = await freshRoot();
  try {
    assert.equal(runCli(["init", "Absolute Task", "--tasks-root", root, "--json"]).status, 0);
    const secret = join(outside, "secret.md");
    await writeFile(secret, "ABSOLUTE-SECRET-MARKER\n");
    const taskPath = join(root, "absolute-task", "task.json");
    const before = await readFile(taskPath);
    const result = runCli([
      "next", "add", "Absolute title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--instruction-file", secret, "--task", "absolute-task", "--tasks-root", root, "--json",
    ], { cwd: root });
    assert.equal(result.status, 5, result.stderr);
    assert.equal(parseJson(result).code, "INVALID_PATH");
    assert.deepEqual(await readFile(taskPath), before);
    assert.equal(await exists(join(root, "absolute-task", "instructions", "step-001.md")), false);
    assert.equal(result.stdout.includes("ABSOLUTE-SECRET-MARKER"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

await test("instruction-file-symlink-rejected", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Symlink Task", "--tasks-root", root, "--json"]).status, 0);
    await writeFile(join(root, "notas.md"), "SYMLINK-BODY-MARKER\n");
    await symlink("notas.md", join(root, "enlace.md"));
    const taskPath = join(root, "symlink-task", "task.json");
    const before = await readFile(taskPath);
    const result = runCli([
      "next", "add", "Symlink title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--instruction-file", "enlace.md", "--task", "symlink-task", "--tasks-root", root, "--json",
    ], { cwd: root });
    assert.equal(result.status, 5, result.stderr);
    assert.equal(parseJson(result).code, "INVALID_PATH");
    assert.deepEqual(await readFile(taskPath), before);
    assert.equal(await exists(join(root, "symlink-task", "instructions", "step-001.md")), false);
    assert.equal(result.stdout.includes("SYMLINK-BODY-MARKER"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("instruction-file-sensitive-rejected", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Sensitive Task", "--tasks-root", root, "--json"]).status, 0);
    await writeFile(join(root, ".env"), "SENSITIVE-ENV-MARKER\n");
    await writeFile(join(root, "private.pem"), "SENSITIVE-PEM-MARKER\n");
    const added = runCli([
      "next", "add", "Safe title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--instruction", "SAFE-BODY-MARKER", "--task", "sensitive-task", "--tasks-root", root, "--json",
    ], { cwd: root });
    assert.equal(added.status, 0, added.stderr);
    const taskPath = join(root, "sensitive-task", "task.json");
    const before = await readFile(taskPath);
    for (const candidate of [".env", "private.pem"]) {
      const result = runCli([
        "next", "add", "Sensitive title", "--scope", "S", "--done-when", "D", "--evidence", "E",
        "--instruction-file", candidate, "--task", "sensitive-task", "--tasks-root", root, "--json",
      ], { cwd: root });
      assert.equal(result.status, 5, result.stderr);
      const json = parseJson(result);
      assert.equal(json.code, "INVALID_PATH");
      assert.match(json.message, /sensitive/i);
      assert.equal(result.stdout.includes("SENSITIVE-"), false);
    }
    assert.deepEqual(await readFile(taskPath), before);
    assert.equal((await readFile(taskPath, "utf8")).includes("SENSITIVE-"), false);
    assert.equal(await exists(join(root, "sensitive-task", "instructions", "step-002.md")), false);
    const show = runCli(
      ["next", "show", "step-001", "--task", "sensitive-task", "--tasks-root", root, "--json"],
      { cwd: root },
    );
    assert.equal(show.status, 0, show.stderr);
    const shown = parseJson(show);
    assert.equal(shown.instruction.includes("SAFE-BODY-MARKER"), true);
    assert.equal(shown.instruction.includes("SENSITIVE-ENV-MARKER"), false);
    assert.equal(shown.instruction.includes("SENSITIVE-PEM-MARKER"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("instruction-file-oversize-rejected", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Oversize Task", "--tasks-root", root, "--json"]).status, 0);
    await writeFile(join(root, "grande.md"), "x".repeat(MAX_INSTRUCTION_BYTES + 1));
    const taskPath = join(root, "oversize-task", "task.json");
    const before = await readFile(taskPath);
    const result = runCli([
      "next", "add", "Oversize title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--instruction-file", "grande.md", "--task", "oversize-task", "--tasks-root", root, "--json",
    ], { cwd: root });
    assert.equal(result.status, 5, result.stderr);
    assert.equal(parseJson(result).code, "FILE_TOO_LARGE");
    assert.deepEqual(await readFile(taskPath), before);
    assert.equal(await exists(join(root, "oversize-task", "instructions", "step-001.md")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("instruction-file-legitimate-still-works", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Legit Task", "--tasks-root", root, "--json"]).status, 0);
    const body = "LEGIT-BODY-MARKER\n";
    await writeFile(join(root, "notas.md"), body);
    const added = runCli([
      "next", "add", "Legit title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--instruction-file", "./notas.md", "--task", "legit-task", "--tasks-root", root, "--json",
    ], { cwd: root });
    assert.equal(added.status, 0, added.stderr);
    assert.equal(parseJson(added).stepId, "step-001");
    const stored = await readFile(join(root, "legit-task", "instructions", "step-001.md"), "utf8");
    assert.equal(stored.includes(body), true);
    const show = runCli(
      ["next", "show", "step-001", "--task", "legit-task", "--tasks-root", root, "--json"],
      { cwd: root },
    );
    assert.equal(show.status, 0, show.stderr);
    assert.equal(parseJson(show).instruction.includes(body), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("instruction-file-ancestor-symlink-outside-rejected", async () => {
  const root = await freshRoot();
  const outside = await freshRoot();
  try {
    assert.equal(runCli(["init", "Ancestor Escape", "--tasks-root", root, "--json"]).status, 0);
    const marker = "ANCESTOR-ESCAPE-MARKER";
    await writeFile(join(outside, "x.md"), `${marker}\n`);
    await symlink(outside, join(root, "link"));
    const taskPath = join(root, "ancestor-escape", "task.json");
    const before = await readFile(taskPath);
    const result = runCli([
      "next", "add", "Ancestor title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--instruction-file", "link/x.md", "--task", "ancestor-escape", "--tasks-root", root, "--json",
    ], { cwd: root });
    assert.equal(result.status, 5, result.stderr);
    assert.equal(parseJson(result).code, "INVALID_PATH");
    assert.deepEqual(await readFile(taskPath), before);
    assert.equal(await exists(join(root, "ancestor-escape", "instructions", "step-001.md")), false);
    assert.equal(result.stdout.includes(marker), false);
    assert.equal(await treeContains(join(root, "ancestor-escape"), marker), false);
    const show = runCli(
      ["next", "show", "--task", "ancestor-escape", "--tasks-root", root, "--json"],
      { cwd: root },
    );
    assert.equal(show.stdout.includes(marker), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

await test("instruction-file-ancestor-symlink-to-ssh-rejected", async () => {
  const root = await freshRoot();
  const fakeHome = await freshRoot();
  try {
    assert.equal(runCli(["init", "Ancestor Ssh", "--tasks-root", root, "--json"]).status, 0);
    const sshDir = join(fakeHome, ".ssh");
    await mkdir(sshDir, { recursive: true });
    const marker = "SSH-PRIVATE-KEY-MARKER";
    await writeFile(join(sshDir, "id_rsa"), `${marker}\n`);
    await mkdir(join(root, "work"), { recursive: true });
    await symlink(sshDir, join(root, "work", "keys"));
    const taskPath = join(root, "ancestor-ssh", "task.json");
    const before = await readFile(taskPath);
    const result = runCli([
      "next", "add", "Ssh title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--instruction-file", "work/keys/id_rsa", "--task", "ancestor-ssh", "--tasks-root", root, "--json",
    ], { cwd: root });
    assert.equal(result.status, 5, result.stderr);
    assert.equal(parseJson(result).code, "INVALID_PATH");
    assert.deepEqual(await readFile(taskPath), before);
    assert.equal(await exists(join(root, "ancestor-ssh", "instructions", "step-001.md")), false);
    assert.equal(result.stdout.includes(marker), false);
    assert.equal(await treeContains(join(root, "ancestor-ssh"), marker), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
  }
});

await test("instruction-file-hardlink-to-sensitive-rejected", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Hardlink Task", "--tasks-root", root, "--json"]).status, 0);
    const marker = "HARDLINK-ENV-MARKER";
    await writeFile(join(root, ".env"), `${marker}\n`);
    await link(join(root, ".env"), join(root, "notas.md"));
    const taskPath = join(root, "hardlink-task", "task.json");
    const before = await readFile(taskPath);
    const result = runCli([
      "next", "add", "Hardlink title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--instruction-file", "notas.md", "--task", "hardlink-task", "--tasks-root", root, "--json",
    ], { cwd: root });
    assert.equal(result.status, 5, result.stderr);
    const json = parseJson(result);
    assert.equal(json.code, "INVALID_PATH");
    assert.match(json.message, /hard link/i);
    assert.deepEqual(await readFile(taskPath), before);
    assert.equal(await exists(join(root, "hardlink-task", "instructions", "step-001.md")), false);
    assert.equal(await treeContains(join(root, "hardlink-task"), marker), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("instruction-file-uppercase-sensitive-rejected", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Upper Task", "--tasks-root", root, "--json"]).status, 0);
    await writeFile(join(root, ".ENV"), "UPPER-ENV-MARKER\n");
    await writeFile(join(root, "Credentials.json"), "UPPER-CREDS-MARKER\n");
    const taskPath = join(root, "upper-task", "task.json");
    const before = await readFile(taskPath);
    for (const candidate of [".ENV", "Credentials.json"]) {
      const result = runCli([
        "next", "add", "Upper title", "--scope", "S", "--done-when", "D", "--evidence", "E",
        "--instruction-file", candidate, "--task", "upper-task", "--tasks-root", root, "--json",
      ], { cwd: root });
      assert.equal(result.status, 5, result.stderr);
      const json = parseJson(result);
      assert.equal(json.code, "INVALID_PATH");
      assert.match(json.message, /sensitive/i);
    }
    assert.deepEqual(await readFile(taskPath), before);
    assert.equal(await exists(join(root, "upper-task", "instructions", "step-001.md")), false);
    assert.equal(await treeContains(join(root, "upper-task"), "UPPER-ENV-MARKER"), false);
    assert.equal(await treeContains(join(root, "upper-task"), "UPPER-CREDS-MARKER"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("instruction-file-nested-legitimate-still-works", async () => {
  const root = await freshRoot();
  try {
    assert.equal(runCli(["init", "Nested Task", "--tasks-root", root, "--json"]).status, 0);
    const body = "NESTED-LEGIT-MARKER\n";
    await mkdir(join(root, "sub", "dir"), { recursive: true });
    await writeFile(join(root, "sub", "dir", "notas.md"), body);
    const added = runCli([
      "next", "add", "Nested title", "--scope", "S", "--done-when", "D", "--evidence", "E",
      "--instruction-file", "sub/dir/notas.md", "--task", "nested-task", "--tasks-root", root, "--json",
    ], { cwd: root });
    assert.equal(added.status, 0, added.stderr);
    assert.equal(parseJson(added).stepId, "step-001");
    const stored = await readFile(join(root, "nested-task", "instructions", "step-001.md"), "utf8");
    assert.equal(stored.includes(body), true);
    assert.equal(await treeContains(join(root, "nested-task"), body), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("tasks-root-outside-project-rejected", async () => {
  const external = await freshRoot();
  try {
    const target = join(external, "tasks");
    const result = runCli(["init", "Outside Task", "--tasks-root", target, "--json"], { cwd: repoRoot });
    assert.equal(result.status, 5, result.stderr);
    assert.equal(parseJson(result).code, "INVALID_PATH");
    assert.deepEqual(await readdir(external), []);
  } finally {
    await rm(external, { recursive: true, force: true });
  }
});

await test("real-tasks-root-untouched", async () => {
  const after = await snapshotTree(REAL_TASKS_ROOT);
  assert.deepEqual(after, realTasksBefore);
});

console.log(JSON.stringify({ ok: failures === 0, cases: cases.length }));
if (failures > 0) {
  process.exitCode = 1;
}
