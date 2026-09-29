import assert from "node:assert/strict";
import { createReadSecurity, createReadTask, shouldBlock } from "../targets/opencode/resources/native/plugins/skynex-tasks/review-gate.ts";

const cases = [];
async function test(name, fn) { await fn(); cases.push(name); console.log(`PASS ${name}`); }
const reader = (value) => async () => value;
const base = { tool: "subagent", input: { agent: "security" }, snapshotTaskId: "task-1", cwd: "/proj" };

await test("off-blocks-security-subagent", async () => {
  assert.equal(await shouldBlock({ ...base, readSecurity: reader("off") }), true);
});
await test("auto-on-missing-allow", async () => {
  for (const value of ["auto", "on", undefined, null]) assert.equal(await shouldBlock({ ...base, readSecurity: reader(value) }), false);
});
await test("other-agent-or-tool-allow-without-reading", async () => {
  let reads = 0;
  const readSecurity = async () => { reads++; return "off"; };
  assert.equal(await shouldBlock({ ...base, input: { agent: "verifier" }, readSecurity }), false);
  assert.equal(await shouldBlock({ ...base, tool: "bash", readSecurity }), false);
  assert.equal(await shouldBlock({ ...base, input: null, readSecurity }), false);
  assert.equal(reads, 0);
});
await test("invalid-or-missing-task-id-allow", async () => {
  for (const id of [undefined, null, "", "Bad", "-x", "a/b", "a".repeat(81), 7]) {
    assert.equal(await shouldBlock({ ...base, snapshotTaskId: id, readSecurity: reader("off") }), false);
  }
});
await test("reader-throw-allows", async () => {
  assert.equal(await shouldBlock({ ...base, readSecurity: async () => { throw new Error("boom"); } }), false);
});
await test("exec-invoked-with-fixed-argv-and-bounds", async () => {
  const calls = [];
  const exec = (file, args, options, callback) => { calls.push({ file, args, options }); callback(null, JSON.stringify({ id: "task-1", reviews: { security: "off" } }), ""); };
  const read = createReadSecurity(exec);
  assert.equal(await read("task-1", "/home/u/proj"), "off");
  assert.deepEqual(calls, [{ file: "skynex", args: ["task", "status", "--task", "task-1", "--json"], options: { shell: false, timeout: 2000, maxBuffer: 1048576, cwd: "/home/u/proj" } }]);
});
await test("session-directory-is-passed-and-required", async () => {
  const seen = [];
  const readSecurity = async (id, cwd) => { seen.push([id, cwd]); return "off"; };
  assert.equal(await shouldBlock({ ...base, readSecurity }), true);
  assert.deepEqual(seen, [["task-1", "/proj"]]);
  for (const cwd of [undefined, "", "relative/dir"]) assert.equal(await shouldBlock({ ...base, cwd, readSecurity }), false);
});
await test("exec-output-parsing-is-strict", async () => {
  const run = (stdout, error = null) => createReadSecurity((f, a, o, cb) => cb(error, stdout, ""))("task-1", "/proj");
  assert.equal(await run(JSON.stringify({ reviews: { security: "auto" } })), "auto");
  assert.equal(await run(JSON.stringify({ reviews: { security: "maybe" } })), undefined);
  assert.equal(await run(JSON.stringify({})), undefined);
  await assert.rejects(run("not json"));
  await assert.rejects(run("", new Error("ENOENT")));
  await assert.rejects(createReadSecurity(() => assert.fail("must not exec"))("Bad id"));
});
const cliStatus = { ok: true, command: "task.status", tasksRoot: "/proj/.skynex/tasks", taskId: "task-1", title: "Live task",
  status: "in_progress", revision: 4, nextStepId: "s3", blockedStepIds: ["s4"], steps: [
    { id: "s1", title: "Plan", status: "done", dependsOn: [] },
    { id: "s2", title: "Build", status: "in_progress", dependsOn: ["s1"] },
    { id: "s3", title: "Verify", status: "pending", dependsOn: ["s2"] },
    { id: "s4", title: "Wait", status: "blocked", dependsOn: [] },
  ], reviews: { security: "auto" } };
await test("read-task-maps-cli-status-into-projection-shape", async () => {
  const calls = [];
  const read = createReadTask((file, args, options, cb) => { calls.push({ file, args, options }); cb(null, JSON.stringify(cliStatus), ""); });
  assert.deepEqual(await read("task-1", "/proj"), { id: "task-1", title: "Live task", status: "in_progress", doneCount: 1, total: 4,
    current: { id: "s2", title: "Build" }, next: { id: "s3", title: "Verify" }, blockers: [{ id: "s4", title: "Wait" }],
    steps: [{ id: "s1", title: "Plan", status: "done" }, { id: "s2", title: "Build", status: "in_progress" },
      { id: "s3", title: "Verify", status: "pending" }, { id: "s4", title: "Wait", status: "blocked" }],
    reviews: { security: "auto" } });
  assert.deepEqual(calls, [{ file: "skynex", args: ["task", "status", "--task", "task-1", "--json"], options: { shell: false, timeout: 2000, maxBuffer: 1048576, cwd: "/proj" } }]);
});
await test("read-task-bounds-titles-and-blockers-and-handles-empty", async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ id: `b${i}`, title: "t".repeat(300), status: "blocked", dependsOn: [] }));
  const read = createReadTask((f, a, o, cb) => cb(null, JSON.stringify({ ...cliStatus, title: "x".repeat(400), nextStepId: "b0",
    blockedStepIds: many.map((s) => s.id), steps: many, reviews: { security: "bogus" } }), ""));
  const task = await read("task-1", "/proj");
  assert.equal(task.title.length, 160); assert.equal(task.blockers.length, 20); assert.equal(task.next.title.length, 120);
  assert.equal(task.steps[0].title.length, 200); assert.equal(task.current, null); assert.equal("reviews" in task, false);
  const empty = await createReadTask((f, a, o, cb) => cb(null, JSON.stringify({ ...cliStatus, nextStepId: null, blockedStepIds: [], steps: [] }), ""))("task-1", "/proj");
  assert.deepEqual([empty.total, empty.doneCount, empty.current, empty.next, empty.blockers, empty.steps], [0, 0, null, null, [], []]);
});
await test("read-task-rejects-bad-input-and-output", async () => {
  const run = (stdout, error = null) => createReadTask((f, a, o, cb) => cb(error, stdout, ""))("task-1", "/proj");
  await assert.rejects(run("nope")); await assert.rejects(run("", new Error("ETIMEDOUT")));
  await assert.rejects(run(JSON.stringify({ ...cliStatus, taskId: "other" })));
  await assert.rejects(run(JSON.stringify({ ...cliStatus, steps: "x" })));
  await assert.rejects(createReadTask(() => assert.fail("must not exec"))("Bad id", "/proj"));
  await assert.rejects(createReadTask(() => assert.fail("must not exec"))("task-1", "rel"));
});
console.log(`review-gate: ${cases.length} cases passed`);
