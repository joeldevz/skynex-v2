import assert from "node:assert/strict";
import { createReadSecurity, shouldBlock } from "../targets/opencode/resources/native/plugins/skynex-tasks/review-gate.ts";

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
  assert.deepEqual(calls, [{ file: "skynex", args: ["task", "status", "--task", "task-1", "--json"], options: { shell: false, timeout: 2000, maxBuffer: 65536, cwd: "/home/u/proj" } }]);
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
console.log(`review-gate: ${cases.length} cases passed`);
