import assert from "node:assert/strict";
import { createServer } from "../targets/opencode/resources/native/plugins/skynex-tasks/index.ts";
import { updateSchema } from "../targets/opencode/resources/native/plugins/skynex-tasks/snapshot.ts";

const cases = [];
async function test(name, fn) { await fn(); cases.push(name); console.log(`PASS ${name}`); }
const live = (title = "Live", done = 1) => ({ id: "task-1", title, status: "in_progress", doneCount: done, total: 2,
  current: { id: "s2", title: "Build" }, next: null, blockers: [],
  steps: [{ id: "s1", title: "Plan", status: "done" }, { id: "s2", title: "Build", status: done === 2 ? "done" : "in_progress" }] });
const published = { ...live("Published"), doneCount: 0, steps: [{ id: "s1", title: "Plan", status: "pending" }, { id: "s2", title: "Build", status: "in_progress" }] };
const session = { id: "ses_a", projectID: "p", location: { directory: "/proj" } };

async function host(readTask) {
  const values = new Map(), hooks = {};
  let tool, rpc, timers = 0;
  const reg = () => ({ async dispose() {} });
  const realSet = globalThis.setInterval, realTimeout = globalThis.setTimeout;
  globalThis.setInterval = (...a) => { timers++; return realSet(...a); };
  globalThis.setTimeout = (...a) => { timers++; return realTimeout(...a); };
  try {
    await createServer({ readTask, readSecurity: async () => undefined }).setup({
      location: { directory: "/proj", project: { id: "p" } },
      storage: { async get(k) { return structuredClone(values.get(k)); }, async set(k, v) { values.set(k, structuredClone(v)); }, async remove(k) { values.delete(k); } },
      session: { async get() { return session; }, async hook() { return reg(); } },
      tool: { async transform(cb) { cb({ add(d) { tool = d; } }); return reg(); }, async hook(name, cb) { hooks[name] = cb; return reg(); } },
      rpc: { async register(_d, h) { rpc = h; return reg(); } },
    });
  } finally { globalThis.setInterval = realSet; globalThis.setTimeout = realTimeout; }
  return { values, hooks, timers: () => timers,
    update: (task) => tool.execute({ task }, { sessionID: "ses_a", signal: new AbortController().signal }),
    get: () => rpc.getSessionTask({ sessionID: "ses_a" }),
    after: (tool, input) => hooks["execute.after"]({ tool, sessionID: "ses_a", agent: "thalam", messageID: "m", id: "c", input, status: "completed", result: {} }) };
}
const counter = (impl) => { const calls = []; const fn = async (id, cwd) => { calls.push([id, cwd]); return impl(calls.length); }; fn.calls = calls; return fn; };

await test("schema-accepts-binding-only-and-full-payload", async () => {
  const variants = updateSchema.properties.task.anyOf;
  assert(variants.some((s) => s.type === "object" && s.required.includes("steps")));
  assert(variants.some((s) => s.type === "object" && JSON.stringify(s.required) === '["id"]'));
  assert(variants.some((s) => s.type === "null"));
});
await test("publish-binding-only-refreshes-from-cli", async () => {
  const read = counter(() => live());
  const h = await host(read);
  await h.update({ id: "task-1" });
  assert.deepEqual(read.calls, [["task-1", "/proj"]]);
  assert.deepEqual((await h.get()).task, live());
  assert.equal(read.calls.length, 1, "already refreshed: getSessionTask must not re-exec");
});
await test("publish-full-payload-then-refresh-overrides", async () => {
  const read = counter(() => live());
  const h = await host(read);
  await h.update(published);
  assert.deepEqual((await h.get()).task, live());
});
await test("cli-failure-keeps-published-snapshot-and-id-only-shows-id", async () => {
  const h = await host(counter(() => { throw new Error("ENOENT"); }));
  await h.update(published);
  assert.deepEqual((await h.get()).task, published);
  const h2 = await host(counter(() => { throw new Error("ENOENT"); }));
  await h2.update({ id: "task-1" });
  const task = (await h2.get()).task;
  assert.equal(task.id, "task-1"); assert.equal(task.title, "task-1");
});
await test("invalid-cli-projection-keeps-snapshot", async () => {
  const h = await host(counter(() => ({ ...live(), doneCount: 9 })));
  await h.update(published);
  assert.deepEqual((await h.get()).task, published);
});
await test("execute-after-refreshes-only-for-skynex-task-shell-commands", async () => {
  const read = counter((n) => live("Live", n >= 2 ? 2 : 1));
  const h = await host(read);
  assert.equal(typeof h.hooks["execute.after"], "function");
  await h.update({ id: "task-1" });
  await h.after("bash", { command: "ls -la" });
  await h.after("read", { command: "skynex task next done s2" });
  await h.after("bash", { cmd: "skynex task next done s2" });
  await h.after("bash", null);
  assert.equal(read.calls.length, 1);
  await h.after("bash", { command: "skynex task next done s2 --json" });
  assert.equal(read.calls.length, 2);
  assert.equal((await h.get()).task.doneCount, 2);
  await h.after("shell", { command: "cd /proj && skynex task status" });
  assert.equal(read.calls.length, 3);
});
await test("execute-after-without-binding-does-not-exec", async () => {
  const read = counter(() => live());
  const h = await host(read);
  await h.after("bash", { command: "skynex task list" });
  assert.equal(read.calls.length, 0);
});
await test("first-view-refreshes-once-and-dedupes-in-flight", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const read = counter(async () => { await gate; return live(); });
  // Simulate a fresh server process: stored entry exists, never refreshed from CLI here.
  const h2 = await host(read);
  h2.values.set(`session-task/v1/${encodeURIComponent(JSON.stringify(["p", "/proj", null, "ses_a"]))}`, { task: published, updatedAt: 1 });
  const before = read.calls.length;
  const views = Promise.all([h2.get(), h2.get(), h2.get()]);
  release();
  const results = await views;
  assert.equal(read.calls.length - before, 1, "concurrent first views dedupe to one exec");
  for (const r of results) assert.deepEqual(r.task, live());
  await h2.get(); await h2.get();
  assert.equal(read.calls.length - before, 1, "no re-exec on subsequent polls");
});
await test("no-timers-and-null-clears", async () => {
  const read = counter(() => live());
  const h = await host(read);
  assert.equal(h.timers(), 0);
  await h.update({ id: "task-1" });
  await h.update(null);
  assert.equal(await h.get(), null);
  assert.equal(read.calls.length, 1);
});
console.log(`live-sidebar: ${cases.length} cases passed`);
