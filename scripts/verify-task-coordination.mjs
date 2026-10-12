import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTaskService, isTaskError, MAX_TEXT_FIELD_LENGTH } from "../packages/tasks/dist/index.js";
import { createFileTaskStore, systemClock, uuidIds } from "../packages/tasks-node/dist/index.js";
import { createServer } from "../targets/opencode/resources/native/plugins/skynex-tasks/index.ts";
import { createReadSecurity, createReadTask } from "../targets/opencode/resources/native/plugins/skynex-tasks/review-gate.ts";

// Frozen intent: A1 sole progress/recovery record; A2 bounded checkpoint/versioning;
// A3 atomic transitions/idempotency; A4 one-read status and mutation-only refresh.
// A5 resource digests belong to final verification, not a prose/hash snapshot here.
const repo = fileURLToPath(new URL("../", import.meta.url));
const cli = join(repo, "apps/cli/dist/index.js");
const basis = "9890f055975f9ef7703d570b724692e6ccde888e";
const draft = (title) => ({ title, scope: "packages/tasks/src/", doneWhen: "Observable result", expectedEvidence: "Test result" });
const checkpoint = () => ({
  version: 1, WorkflowID: "coordination-test", AttemptID: "a1", NodeID: "red-contract",
  BaseCandidateOID: basis, Scope: { paths: ["packages/tasks/src/service.ts"], acceptance: ["A2", "A3"] },
  candidateOid: null, candidateOidReason: "Working-tree content has no candidate object",
  manifestRef: { id: "manifest.1", sha256: "a".repeat(64) }, phase: "handoff",
  note: "Untrusted metadata, not approval or permission", refs: [{ id: "red-proof", sha256: "b".repeat(64) }],
});
const taskError = (codes) => (error) => isTaskError(error) && codes.includes(error.code);
const keys = (value) => Object.keys(value).sort();

async function fixture(t, statuses = ["pending", "pending"]) {
  await mkdir("/tmp/opencode", { recursive: true });
  const root = await mkdtemp("/tmp/opencode/skynex-coordination-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const disk = createFileTaskStore({ tasksRoot: root });
  const reads = [], saves = [];
  // Observers delegate every operation to the real file store; no storage stub.
  const store = { ...disk,
    async read(id) { reads.push(id); return disk.read(id); },
    async save(task, revision, instructions) { saves.push({ task, revision, instructions }); return disk.save(task, revision, instructions); },
  };
  const service = createTaskService({ store, clock: systemClock, ids: uuidIds });
  const created = await service.createTask({ title: "Coordination fixture", steps: statuses.map((_, i) => draft(`Step ${i + 1}`)) });
  const id = created.taskId, path = join(root, id, "task.json");
  if (statuses.some((status) => status !== "pending")) {
    const task = JSON.parse(await readFile(path, "utf8"));
    task.steps.forEach((step, i) => {
      step.status = statuses[i];
      if (step.status === "blocked") step.blockReason = "Awaiting gate";
      if (step.status === "done") step.declaredDoneAt = task.createdAt;
    });
    task.status = statuses.includes("blocked") ? "blocked" : statuses.every((s) => s === "done") ? "done" : "in_progress";
    await writeFile(path, JSON.stringify(task, null, 2) + "\n");
  }
  return { root, id, path, service, reads, saves,
    bytes: () => readFile(path), task: async () => JSON.parse(await readFile(path, "utf8")) };
}

function operation(service, name, ...args) {
  assert.equal(typeof service[name], "function", `Requested Tasks operation ${name} is missing`);
  return service[name](...args);
}

function runCli(f, args, preload) {
  const result = spawnSync(process.execPath,
    [...(preload ? ["--import", pathToFileURL(preload).href] : []), cli, "task", ...args, "--tasks-root", f.root, "--json"],
    { cwd: f.root, encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined, `CLI execution failure: ${result.error}`);
  assert.equal(result.signal, null, `CLI terminated by ${result.signal}`);
  return { ...result, json: JSON.parse(result.stdout) };
}

test("C01 A1: authoritative Tasks sections forbid a parallel recovery/fallback register", async () => {
  const agent = await readFile(join(repo, "targets/opencode/resources/canonical/agents/thalam.md"), "utf8");
  const skill = await readFile(join(repo, "targets/opencode/resources/canonical/skills/skynex-tasks/SKILL.md"), "utf8");
  const tasksSection = agent.split("SKYNEX TASKS — AUTOMATIC COORDINATION FOR MULTI-STEP WORK")[1]?.split("PRIMARY OBJECTIVE")[0];
  assert.equal(typeof tasksSection, "string", "Inspect the authoritative Tasks policy, not an unrelated mention");
  assert.doesNotMatch(tasksSection, /bounded manual artifact contract|manual fallback|does not replace this\s+agent's lineage\/checkpoints/i);
  assert.doesNotMatch(agent.split("RUNTIME BOUNDARY — NO SKYNEX WORKFLOW")[1]?.split("SKYNEX TASKS")[0] ?? "", /existing task\/plan file/i);
  assert.doesNotMatch(agent.split("## ARTIFACT CONTRACT")[1]?.split("## CIRCUIT EVALUATION")[0] ?? "", /Otherwise the orchestrator\s+writes a reviewable bounded/i);
  assert.doesNotMatch(skill.split("## CLI unavailable or incompatible")[1] ?? "", /continue safely using[\s\S]{0,180}manual|fallback was used/i);
  for (const [name, text] of [["Thalam", tasksSection], ["Tasks skill", skill]]) {
    assert(text.split(/\n\s*\n/).some((paragraph) => /Tasks|notebook/i.test(paragraph) && /progress/i.test(paragraph) && /recovery/i.test(paragraph) && /sole|single|only|alone/i.test(paragraph)),
      `${name} must explicitly make Tasks the sole progress/recovery record`);
    assert.match(text, /checkpoint (?:set|show)/, `${name} must describe recovery through the notebook CLI`);
  }
  assert.match(agent, /Neurox[\s\S]{0,150}never\s+workflow state or authority/, "Advisory memory is not operational state");
  assert.match(skill, /declaration, not approval|declaration[^.]*not[^.]*approval/i);
});

test("C02 A2: v1 creation and checkpoint-free reads remain byte-compatible", async (t) => {
  const f = await fixture(t);
  const before = await f.bytes();
  assert.equal((await f.task()).schemaVersion, 1);
  assert.equal("checkpoint" in await f.task(), false);
  assert.deepEqual(await operation(f.service, "getCheckpoint", f.id), { taskId: f.id, checkpoint: null });
  await f.service.getStatus(f.id);
  assert.deepEqual(await f.bytes(), before);
  assert.equal(f.saves.length, 0);
});

test("C03 A2: checkpoint promotion, cloning, preservation and revision-checked no-op", async (t) => {
  const f = await fixture(t), cp = checkpoint();
  assert.deepEqual(await operation(f.service, "setCheckpoint", f.id, cp, { expectedRevision: 1 }), { taskId: f.id, changed: true, revision: 2 });
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].revision, 1);
  assert.equal((await f.task()).schemaVersion, 2);
  assert.deepEqual((await f.task()).checkpoint, cp);
  const shown = await operation(f.service, "getCheckpoint", f.id);
  shown.checkpoint.Scope.paths.push("not-persisted.ts");
  cp.note = "Caller mutation must not change storage";
  const persisted = (await f.task()).checkpoint;
  const before = await f.bytes();
  assert.deepEqual(await operation(f.service, "setCheckpoint", f.id, persisted, { expectedRevision: 2 }), { taskId: f.id, changed: false, revision: 2 });
  await assert.rejects(() => operation(f.service, "setCheckpoint", f.id, persisted, { expectedRevision: 1 }), taskError(["REVISION_CONFLICT"]));
  assert.deepEqual(await f.bytes(), before);
  assert.equal(f.saves.length, 1);
  await f.service.setReviews(f.id, { security: "off" });
  await f.service.addStep(f.id, draft("Additional step"));
  await f.service.markStepDone(f.id, "step-001");
  const later = await f.task();
  assert.equal(later.schemaVersion, 2, "Existing mutations must never downgrade a checkpoint task");
  assert.equal(later.revision, 5);
  assert.deepEqual(later.checkpoint, persisted, "Every existing writer must preserve the recovery record");
});

test("C04 A2: valid v2 checkpoint reads are inert; future v3 rejects without rewriting", async (t) => {
  const f = await fixture(t), task = await f.task();
  task.schemaVersion = 2; task.checkpoint = checkpoint();
  await writeFile(f.path, JSON.stringify(task) + "\n");
  const before = await f.bytes();
  const shown = runCli(f, ["checkpoint", "show", "--task", f.id]);
  assert.equal(shown.status, 0, JSON.stringify(shown.json));
  assert.deepEqual(shown.json.checkpoint, task.checkpoint);
  assert.deepEqual(keys(shown.json), ["ok", "command", "tasksRoot", "taskId", "checkpoint"].sort());
  assert.deepEqual(await f.bytes(), before);
  task.schemaVersion = 3;
  await writeFile(f.path, JSON.stringify(task) + "\n");
  const futureBytes = await f.bytes();
  const future = runCli(f, ["status", "--task", f.id]);
  assert.equal(future.status, 5);
  assert.equal(future.json.code, "UNSUPPORTED_SCHEMA");
  assert.deepEqual(await f.bytes(), futureBytes);
});

const invalidCheckpoints = [
  ["unknown top-level key", (cp) => ({ ...cp, approved: true })],
  ["unknown Scope key", (cp) => ({ ...cp, Scope: { ...cp.Scope, authorize: true } })],
  ["unknown manifest key", (cp) => ({ ...cp, manifestRef: { ...cp.manifestRef, path: "evidence/raw.txt" } })],
  ["unknown ref key", (cp) => ({ ...cp, refs: [{ ...cp.refs[0], command: "execute" }] })],
  ["missing required field", (cp) => { delete cp.candidateOidReason; return cp; }],
  ["unsupported checkpoint version", (cp) => ({ ...cp, version: 2 })],
  ["unknown phase", (cp) => ({ ...cp, phase: "approved" })],
  ["non-ASCII ID", (cp) => ({ ...cp, NodeID: "nódulo" })],
  ["ID over 128", (cp) => ({ ...cp, AttemptID: "x".repeat(129) })],
  ["invalid basis OID", (cp) => ({ ...cp, BaseCandidateOID: "not-an-oid" })],
  ["parent path", (cp) => ({ ...cp, Scope: { ...cp.Scope, paths: ["a/../secret"] } })],
  ["dot path", (cp) => ({ ...cp, Scope: { ...cp.Scope, paths: ["./file"] } })],
  ["absolute path", (cp) => ({ ...cp, Scope: { ...cp.Scope, paths: ["/secret"] } })],
  ["backslash path", (cp) => ({ ...cp, Scope: { ...cp.Scope, paths: ["a\\secret"] } })],
  ["control path", (cp) => ({ ...cp, Scope: { ...cp.Scope, paths: ["a\u0000b"] } })],
  ["path over 240", (cp) => ({ ...cp, Scope: { ...cp.Scope, paths: ["a".repeat(241)] } })],
  ["65 scope paths", (cp) => ({ ...cp, Scope: { ...cp.Scope, paths: Array.from({ length: 65 }, (_, i) => `file-${i}`) } })],
  ["33 acceptance IDs", (cp) => ({ ...cp, Scope: { ...cp.Scope, acceptance: Array.from({ length: 33 }, (_, i) => `A${i}`) } })],
  ["21 refs", (cp) => ({ ...cp, refs: Array.from({ length: 21 }, (_, i) => ({ id: `ref-${i}`, sha256: "a".repeat(64) })) })],
  ["duplicate ref IDs", (cp) => ({ ...cp, refs: [cp.refs[0], { ...cp.refs[0], sha256: "c".repeat(64) }] })],
  ["invalid ref digest", (cp) => ({ ...cp, refs: [{ id: "proof", sha256: "g".repeat(64) }] })],
  ["note over 1000", (cp) => ({ ...cp, note: "x".repeat(1001) })],
  ["null candidate without reason", (cp) => ({ ...cp, candidateOidReason: null })],
  ["null candidate without manifest", (cp) => ({ ...cp, manifestRef: null })],
  ["reason over 200", (cp) => ({ ...cp, candidateOidReason: "x".repeat(201) })],
  ["present candidate with reason", (cp) => ({ ...cp, candidateOid: "c".repeat(40) })],
  ["checkpoint over 32KiB UTF8", (cp) => ({ ...cp, Scope: { ...cp.Scope, paths: Array.from({ length: 64 }, (_, i) => `file-${i}-${"界".repeat(230)}`) } })],
];
test("C05 A2/A3: invalid attached checkpoints reject before any state/save/byte change", async (t) => {
  for (const [name, change] of invalidCheckpoints) await t.test(name, async (t) => {
    const f = await fixture(t), cp = change(checkpoint()), before = await f.bytes();
    if (name.includes("32KiB")) assert(Buffer.byteLength(JSON.stringify(cp), "utf8") > 32 * 1024);
    await assert.rejects(() => f.service.markStepDone(f.id, "step-001", { expectedRevision: 1, checkpoint: cp }),
      taskError(["INVALID_ARGUMENT", "FILE_TOO_LARGE"]), `Invalid checkpoint (${name}) must not be ignored by done`);
    assert.deepEqual(await f.bytes(), before);
    assert.equal(f.saves.length, 0);
  });
});

for (const [command, method, initial, status] of [
  ["start", "startStep", "blocked", "in_progress"],
  ["block", "blockStep", "pending", "blocked"],
  ["done", "markStepDone", "blocked", "done"],
]) test(`C06-${command} A2/A3: ${command} plus checkpoint commits one revision/save`, async (t) => {
  const f = await fixture(t, [initial, "pending"]), cp = checkpoint();
  const args = command === "block" ? [f.id, "step-001", "Waiting for review", { expectedRevision: 1, checkpoint: cp }]
    : [f.id, "step-001", { expectedRevision: 1, checkpoint: cp }];
  const result = await operation(f.service, method, ...args);
  if (command === "done") {
    assert.equal(result.declared, true); assert.equal(result.approved, false);
    assert.equal(result.changed, true); assert.equal(result.revision, 2);
  } else assert.deepEqual(result, { taskId: f.id, stepId: "step-001", status, changed: true, revision: 2 });
  const task = await f.task();
  assert.deepEqual(task.checkpoint, cp, "State mutation must not discard the attached checkpoint");
  assert.equal(task.schemaVersion, 2); assert.equal(task.revision, 2); assert.equal(task.steps[0].status, status);
  assert.equal(f.saves.length, 1); assert.equal(f.saves[0].revision, 1);
  if (command !== "block") assert.equal("blockReason" in task.steps[0], false);
  else assert.equal(task.steps[0].blockReason, "Waiting for review");
  if (command !== "done") {
    const beforeRepeat = await f.bytes(), saveCount = f.saves.length;
    const repeatArgs = [...args.slice(0, -1), { expectedRevision: task.revision, checkpoint: cp }];
    assert.deepEqual(await operation(f.service, method, ...repeatArgs),
      { taskId: f.id, stepId: "step-001", status, changed: false, revision: task.revision });
    assert.deepEqual(await f.bytes(), beforeRepeat, `Repeated ${command} with identical checkpoint must preserve bytes`);
    assert.equal((await f.task()).revision, task.revision, "An identical state/checkpoint must not advance revision");
    assert.equal(f.saves.length, saveCount, "An identical state/checkpoint must not save again");
  }
});

test("C07 A3: transition guards and stale-revision checks apply before no-op", async (t) => {
  const f = await fixture(t, ["blocked", "pending"]);
  await operation(f.service, "startStep", f.id, "step-001", { expectedRevision: 1 });
  let before = await f.bytes();
  assert.deepEqual(await operation(f.service, "startStep", f.id, "step-001", { expectedRevision: 2 }),
    { taskId: f.id, stepId: "step-001", status: "in_progress", changed: false, revision: 2 });
  await assert.rejects(() => operation(f.service, "startStep", f.id, "step-001", { expectedRevision: 1 }), taskError(["REVISION_CONFLICT"]));
  assert.deepEqual(await f.bytes(), before);
  for (const reason of ["", " \t ", "x".repeat(MAX_TEXT_FIELD_LENGTH + 1)]) {
    await assert.rejects(() => operation(f.service, "blockStep", f.id, "step-001", reason), taskError(["INVALID_ARGUMENT"]));
    assert.deepEqual(await f.bytes(), before);
  }
  await operation(f.service, "blockStep", f.id, "step-001", "Waiting", { expectedRevision: 2 });
  before = await f.bytes();
  assert.deepEqual(await operation(f.service, "blockStep", f.id, "step-001", "Waiting", { expectedRevision: 3 }),
    { taskId: f.id, stepId: "step-001", status: "blocked", changed: false, revision: 3 });
  await assert.rejects(() => operation(f.service, "blockStep", f.id, "step-001", "Waiting", { expectedRevision: 2 }), taskError(["REVISION_CONFLICT"]));
  assert.deepEqual(await f.bytes(), before);
  assert.equal((await f.service.markStepDone(f.id, "step-001")).approved, false);
  before = await f.bytes();
  await assert.rejects(() => operation(f.service, "startStep", f.id, "step-001"), taskError(["INVALID_ARGUMENT"]));
  await assert.rejects(() => operation(f.service, "blockStep", f.id, "step-001", "Waiting"), taskError(["INVALID_ARGUMENT"]));
  assert.deepEqual(await f.bytes(), before, "A declaration of done cannot be reopened or blocked");
});

test("C08 A2/A3: accepted upper bounds and opaque refs need no files or authorization", async (t) => {
  const f = await fixture(t), cp = checkpoint();
  Object.assign(cp, { WorkflowID: "W".repeat(128), BaseCandidateOID: "d".repeat(64), candidateOid: "e".repeat(64),
    candidateOidReason: null, manifestRef: null, note: "x".repeat(1000), phase: "interrupted",
    Scope: { paths: Array.from({ length: 64 }, (_, i) => `${i}-${"x".repeat(237)}`.slice(0, 240)), acceptance: Array.from({ length: 32 }, (_, i) => `A${i}`) },
    refs: Array.from({ length: 20 }, (_, i) => ({ id: `not-a-file:${i}`, sha256: "f".repeat(64) })) });
  await operation(f.service, "setCheckpoint", f.id, cp);
  assert.deepEqual((await operation(f.service, "getCheckpoint", f.id)).checkpoint, cp);
  assert.deepEqual((await f.task()).steps.map((step) => step.status), ["pending", "pending"]);
  assert.equal((await f.service.getReviews(f.id)).reviews.security, "auto", "Checkpoint metadata cannot grant a review override");
});

test("C09 A3: first non-done next/show selection and existing current/blockers projection remain unchanged", async (t) => {
  const f = await fixture(t, ["blocked", "in_progress"]);
  assert.equal((await f.service.getStatus(f.id)).nextStepId, "step-001");
  assert.equal((await f.service.readStepInstruction(f.id, null)).stepId, "step-001");
  const read = createReadTask(cliExec(f, []));
  const projection = await read(f.id, f.root);
  assert.deepEqual(projection.current, { id: "step-002", title: "Step 2" });
  assert.deepEqual(projection.next, { id: "step-001", title: "Step 1" });
  assert.deepEqual(projection.blockers, [{ id: "step-001", title: "Step 1" }]);
});

test("C10 A2/A3/A4: CLI checkpoint and transitions preserve old JSON envelopes and keep checkpoint out of status", async (t) => {
  const f = await fixture(t), cp = checkpoint();
  const set = runCli(f, ["checkpoint", "set", "--checkpoint", JSON.stringify(cp), "--task", f.id, "--expected-revision", "1"]);
  assert.equal(set.status, 0, JSON.stringify(set.json));
  assert.equal(set.json.changed, true); assert.equal(set.json.revision, 2);
  for (const [command, revision, extra] of [["start", 2, []], ["block", 3, ["--reason", "Waiting"]], ["done", 4, []]]) {
    const attached = { ...cp, NodeID: `cli-${command}` };
    const result = runCli(f, ["next", command, "step-001", ...extra, "--checkpoint", JSON.stringify(attached), "--task", f.id, "--expected-revision", String(revision)]);
    assert.equal(result.status, 0, JSON.stringify(result.json));
    if (command === "start") assert.equal((await f.task()).steps[0].status, "in_progress", "Pending CLI start must persist in_progress immediately");
    assert.equal(result.json.revision, revision + 1);
    assert.deepEqual((await f.task()).checkpoint, attached);
    if (command === "done") {
      assert.equal(result.json.approved, false);
      assert.deepEqual(keys(result.json), ["ok", "command", "tasksRoot", "taskId", "stepId", "previousStatus", "status", "declared", "approved", "changed", "revision", "autoCompletedStepIds"].sort());
      assert.deepEqual(result.json.autoCompletedStepIds, []);
    }
  }
  const status = runCli(f, ["status", "--task", f.id]);
  assert.equal(status.status, 0);
  assert.deepEqual(keys(status.json), ["ok", "command", "tasksRoot", "taskId", "title", "status", "revision", "nextStepId", "blockedStepIds", "steps", "reviews"].sort());
  assert.equal("checkpoint" in status.json, false);
  const before = await f.bytes();
  const rejected = runCli(f, ["checkpoint", "set", "--checkpoint-file", "evidence/not-imported.json", "--task", f.id]);
  assert.equal(rejected.status, 2); assert.equal(rejected.json.code, "INVALID_ARGUMENT");
  assert.deepEqual(await f.bytes(), before);
});

test("C11 A4: service status and reviews come from one authoritative read", async (t) => {
  const f = await fixture(t);
  await f.service.setReviews(f.id, { security: "off" });
  const view = await f.service.getStatus(f.id);
  f.reads.length = 0;
  assert.deepEqual(await operation(f.service, "getStatusWithReviews", f.id), { view, reviews: { security: "off" } });
  assert.deepEqual(f.reads, [f.id]);
});

test("C12 A4: real CLI status reads task.json once, retaining the existing JSON shape", async (t) => {
  const f = await fixture(t), preload = join(f.root, "observe-task-reads.mjs");
  // Passive instrumentation of actual I/O in the CLI process, not a fake store.
  await writeFile(preload, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
let reads = 0;
const isTask = (path) => String(path).endsWith('/task.json');
const open = fs.open;
fs.open = async (...args) => {
  const handle = await open(...args);
  if (isTask(args[0])) {
    const original = handle.read;
    let observed = false;
    handle.read = async function (...args) {
      const result = await original.apply(this, args);
      if (!observed && result.bytesRead > 0) { observed = true; reads++; }
      return result;
    };
  }
  return handle;
};
syncBuiltinESMExports();
process.on('exit', () => process.stderr.write('COORDINATION_TASK_READS=' + reads + '\\n'));
`);
  const before = await f.bytes(), result = runCli(f, ["status", "--task", f.id], preload);
  assert.equal(result.status, 0, JSON.stringify(result.json));
  assert.deepEqual(result.json.reviews, { security: "auto" });
  assert.deepEqual(keys(result.json), ["ok", "command", "tasksRoot", "taskId", "title", "status", "revision", "nextStepId", "blockedStepIds", "steps", "reviews"].sort());
  assert.deepEqual(await f.bytes(), before);
  const count = /COORDINATION_TASK_READS=(\d+)/.exec(result.stderr);
  assert(count, "The real CLI process must report observed content reads");
  const observedReads = Number(count[1]);
  assert(observedReads > 0, "The passive observer must see a positive content-read session");
  assert.equal(observedReads, 1, "CLI status currently reads the same notebook separately for view and reviews");
});

function cliExec(f, calls) {
  return (file, args, options, callback) => {
    calls.push({ file, args: [...args], options: { ...options } });
    assert.equal(file, "skynex");
    assert.deepEqual(args, ["task", "status", "--task", f.id, "--json"]);
    assert.equal(options.shell, false); assert.equal(options.cwd, f.root);
    assert(options.timeout > 0 && options.timeout <= 2000); assert(options.maxBuffer <= 1048576);
    return execFile(process.execPath, [cli, ...args, "--tasks-root", f.root], options, callback);
  };
}

async function pluginHost(t, f, gateFirstRead = false) {
  const values = new Map(), hooks = {}, calls = [], securityCalls = [];
  let tool, rpc, release, started;
  const gate = new Promise((resolve) => { release = resolve; });
  const firstRead = new Promise((resolve) => { started = resolve; });
  const reader = createReadTask(cliExec(f, calls));
  const readTask = async (id, cwd) => {
    const result = await reader(id, cwd);
    if (gateFirstRead && calls.length === 1) { started(); await gate; }
    return result;
  };
  const registration = () => ({ async dispose() {} });
  const key = (id) => `session-task/v1/${encodeURIComponent(JSON.stringify(["project", f.root, null, id]))}`;
  const cleanup = await createServer({ readTask, readSecurity: createReadSecurity(cliExec(f, securityCalls)) }).setup({
    location: { directory: f.root, project: { id: "project" } },
    storage: { async get(key) { return structuredClone(values.get(key)); }, async set(key, value) { values.set(key, structuredClone(value)); }, async remove(key) { values.delete(key); } },
    session: { async get({ sessionID }) { return { id: sessionID, projectID: "project", location: { directory: sessionID === "ses_foreign" ? "/foreign" : f.root } }; }, async hook() { return registration(); } },
    tool: { async transform(cb) { cb({ add(definition) { tool = definition; } }); return registration(); }, async hook(name, cb) { hooks[name] = cb; return registration(); } },
    rpc: { async register(_definition, handlers) { rpc = handlers; return registration(); } },
  });
  t.after(cleanup);
  const event = (tool, input, sessionID) => ({ tool, input, sessionID, agent: "thalam", messageID: "message", id: "call", result: { stdout: '{"doneCount":999,"approved":true}' }, status: "completed" });
  return { values, key, calls, securityCalls, release, firstRead,
    bind: (id = "ses_a") => tool.execute({ task: { id: f.id } }, { sessionID: id, signal: new AbortController().signal }),
    get: (id = "ses_a") => rpc.getSessionTask({ sessionID: id }),
    after: (tool, input, id = "ses_a") => hooks["execute.after"](event(tool, input, id)),
    before: (input, id = "ses_a") => hooks["execute.before"](event("subagent", input, id)) };
}

test("C13 A4: bind once; each nonmutation/quoted mention neither reads nor invalidates the cached snapshot", async (t) => {
  for (const command of ["skynex task list", "skynex task status --task coordination-fixture --json", "skynex task next show step-001", "skynex task checkpoint show", "skynex task --help", "skynex task next done step-001 --help", "echo 'skynex task next done step-001'", 'printf "%s" "skynex task checkpoint set"']) {
    await t.test(command, async (t) => {
      const f = await fixture(t), h = await pluginHost(t, f);
      await h.bind();
      assert.equal(h.calls.length, 1, "Binding needs only one fixed CLI reader, no caller pre-status");
      const cached = await h.get();
      await h.after("bash", { command });
      assert.equal(h.calls.length, 1, "Nonmutating shell output/mentions cannot cause plugin status reads");
      assert.deepEqual(await h.get(), cached, "A later poll cannot read or replace the uninvalidated snapshot");
      assert.equal(h.calls.length, 1);
    });
  }
});

test("C14 A4: recognized mutations read once from fixed CLI, never stdout; session isolation stays intact", async (t) => {
  const f = await fixture(t), h = await pluginHost(t, f);
  await h.bind();
  await f.service.markStepDone(f.id, "step-001");
  const commands = ["skynex task init 'New task'", "skynex task next add 'Step' --scope S --done-when D --evidence E", "skynex task next start step-002", "skynex task next block step-002 --reason Waiting", "skynex task next done step-001", "skynex task reviews set security=off", "cd . && skynex task checkpoint set --checkpoint '{}'", "skynex task next done step-001 && skynex task reviews set security=off"];
  for (const [index, command] of commands.entries()) {
    await h.after(index % 2 ? "shell" : "bash", { command });
    assert.equal(h.calls.length, index + 2, "One shell event containing mutations triggers one authoritative refresh");
    const published = (await h.get()).task;
    assert.equal(published.doneCount, 1); assert.equal(published.steps[0].status, "done");
    assert.equal("checkpoint" in published, false); assert.equal("approved" in published, false);
    assert.equal(h.calls.length, index + 2);
  }
  assert.equal(await h.get("ses_b"), null, "Another session cannot inherit binding");
  await h.after("bash", { command: commands[0] }, "ses_b");
  await h.after("bash", { command: commands[0] }, "ses_foreign");
  assert.equal(h.calls.length, commands.length + 1);
});

test("C15 A4: mutation waits for the prior in-flight read, then rereads post-mutation state", async (t) => {
  const f = await fixture(t), h = await pluginHost(t, f, true);
  h.values.set(h.key("ses_a"), { task: { id: f.id, title: "Stored", status: "open", doneCount: 0, total: 0, current: null, next: null, blockers: [], steps: [] }, updatedAt: 1 });
  const prior = h.get();
  let mutation;
  try {
    await h.firstRead;
    await f.service.markStepDone(f.id, "step-001");
    mutation = h.after("bash", { command: "skynex task next done step-001 --json" });
    h.release();
    await Promise.all([prior, mutation]);
    assert.equal(h.calls.length, 2, "Mutation must not adopt the stale in-flight pre-mutation read");
    const fresh = await h.get();
    assert.equal(fresh.task.doneCount, 1); assert.equal(fresh.task.steps[0].status, "done");
    assert.equal(h.calls.length, 2);
  } finally {
    h.release();
    await Promise.allSettled([prior, ...(mutation ? [mutation] : [])]);
  }
});

test("C16 A4: cached visual reviews never replace a fresh live security read", async (t) => {
  const f = await fixture(t), h = await pluginHost(t, f);
  await h.bind();
  assert.deepEqual((await h.get()).task.reviews, { security: "auto" });
  await f.service.setReviews(f.id, { security: "off" });
  await assert.rejects(() => h.before({ agent: "security", prompt: "Bounded review" }), /Revisión de seguridad desactivada/);
  assert.equal(h.securityCalls.length, 1);
  assert.equal(h.calls.length, 1, "The stale visual cache need not be refreshed to enforce the live security switch");
  await h.before({ agent: "coder", prompt: "Implementation" });
  await h.before({ agent: "security", prompt: "Other session" }, "ses_b");
  assert.equal(h.securityCalls.length, 1);
});
