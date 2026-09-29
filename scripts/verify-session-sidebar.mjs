import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import plugin from "../targets/opencode/resources/native/plugins/skynex-tasks/index.ts";
import { createSessionTaskController } from "../targets/opencode/resources/native/plugins/skynex-tasks/controller.ts";
import { projection, snapshot, SessionTask, updateSchema } from "../targets/opencode/resources/native/plugins/skynex-tasks/snapshot.ts";

const task = { id: "sidebar", title: "Tarea de prueba", status: "in_progress", doneCount: 1, total: 3,
  current: { id: "s2", title: "Implementar" }, next: { id: "s3", title: "Verificar" },
  blockers: [{ id: "s3", title: "Esperando revisión" }], steps: [
    { id: "s1", title: "Planificar", status: "done" },
    { id: "s2", title: "Implementar", status: "in_progress" },
    { id: "s3", title: "Verificar", status: "blocked" },
  ] };
const { steps: _steps, ...legacyTask } = task;
const countedTask = (doneCount, total) => ({ ...task, doneCount, total,
  blockers: total ? task.blockers : [],
  steps: Array.from({ length: total }, (_, i) => ({ id: `s${i + 1}`, title: `Paso ${i + 1}`,
    status: i < doneCount ? "done" : i === total - 1 ? "blocked" : "pending" })) });
const published = (title) => ({ task: { ...task, title }, updatedAt: 123456 });
const sessions = new Map([
  ["ses_a", { id: "ses_a", projectID: "project", location: { directory: "/project" } }],
  ["ses_b", { id: "ses_b", projectID: "project", location: { directory: "/project" }, parentID: "ses_a" }],
  ["ses_c", { id: "ses_c", projectID: "project", location: { directory: "/other" } }],
  ["ses_d", { id: "ses_d", projectID: "project", location: { directory: "/project", workspaceID: "other" } }],
  ["ses_e", { id: "ses_e", projectID: "different", location: { directory: "/project" } }],
]);
async function host(values = new Map(), location = { directory: "/project", project: { id: "project" } }) {
  let tool, hook, rpc, disposed = 0, gets = 0;
  const registration = () => ({ async dispose() { disposed++; } });
  const cleanup = await plugin.setup({ location,
    storage: { async get(key) { gets++; return structuredClone(values.get(key)); },
      async set(key, value) { values.set(key, structuredClone(value)); }, async remove(key) { values.delete(key); } },
    session: { async get({ sessionID }) { if (!sessions.has(sessionID)) throw new Error("SECRET"); return sessions.get(sessionID); },
      async hook(name, callback) { assert.equal(name, "context"); hook = callback; return registration(); } },
    tool: { async transform(callback) { callback({ add(definition) { assert.equal(tool, undefined); tool = definition; } }); return registration(); } },
    rpc: { async register(definition, handlers) { assert.deepEqual(definition, SessionTask); rpc = handlers; return registration(); } },
  });
  return { values, tool, hook, rpc, cleanup, disposed: () => disposed, gets: () => gets,
    update: (sessionID, input = { task }) => tool.execute(input, { sessionID, signal: new AbortController().signal }) };
}

// The first RED assertion exercises an existing public boundary, not a proposed
// helper/export: today's projection rejects the legitimate complete step list.
test("L3: accepts the complete ordered CLI step projection without mutation", () => {
  const input = { ...task, total: 4, steps: [...task.steps,
    { id: "s4", title: "x".repeat(200), status: "pending" }] };
  const before = structuredClone(input);
  const parsed = projection(input);
  assert.deepEqual(parsed, input);
  assert.deepEqual(snapshot({ task: input, updatedAt: 123456 }), { task: input, updatedAt: 123456 });
  parsed.steps[0].title = "Changed copy";
  assert.deepEqual(input, before, "Parsing must not mutate or alias the CLI list");
});

test("L3/L4: update schema requires steps, RPC output allows legacy but describes the same bounded list", () => {
  const input = updateSchema.properties.task.anyOf.find((schema) => schema.type === "object");
  const output = SessionTask.methods.getSessionTask.output.anyOf.find((schema) => schema.type === "object").properties.task;
  assert(input.required.includes("steps"), "New tool publications require the complete steps list");
  assert(!output.required.includes("steps"), "Stored legacy projections remain decodable by RPC");
  assert.deepEqual(output.properties.steps, input.properties.steps);
  const list = input.properties.steps;
  assert.equal(list.type, "array"); assert.equal(list.maxItems, 999);
  assert.deepEqual(list.items.required.slice().sort(), ["id", "status", "title"]);
  assert.equal(list.items.additionalProperties, false);
  assert.equal(list.items.properties.title.maxLength, 200);
  assert.deepEqual(list.items.properties.status.enum.slice().sort(), ["blocked", "done", "in_progress", "pending"]);
});

test("L3: DTO and runtime tool accept 0 and 999 steps with truthful counts", async () => {
  const h = await host();
  try {
    for (const [done, total] of [[0, 0], [500, 999]]) {
      const input = countedTask(done, total);
      assert.deepEqual(projection(input), input);
      assert.deepEqual(await h.update("ses_a", { task: input }), { content: "Resumen de tarea publicado." });
      assert.deepEqual((await h.rpc.getSessionTask({ sessionID: "ses_a" })).task, input);
    }
  } finally { await h.cleanup(); }
});

test("L3: malformed lists are rejected by DTO and runtime tool without writing storage", async (t) => {
  const extraProperty = Object.assign([...task.steps], { extra: "SECRET" });
  const cases = [
    ["not an array", { ...task, steps: {} }], ["null", { ...task, steps: null }],
    ["undefined", { ...task, steps: undefined }], ["sparse", { ...task, steps: Array(3) }],
    ["extra array key", { ...task, steps: extraProperty }],
    ["duplicate IDs", { ...task, steps: [task.steps[0], task.steps[1], { ...task.steps[2], id: "s1" }] }],
    ["length differs from total", { ...task, total: 4 }],
    ["done count differs", { ...task, doneCount: 2 }],
    ["1000 steps", countedTask(0, 1000)],
    ...[null, { ...task.steps[0], title: "x".repeat(201) }, { ...task.steps[0], title: "\u001b\n" },
      { ...task.steps[0], status: "open" }, { ...task.steps[0], status: "invented" },
      { ...task.steps[0], evidence: "SECRET" }, { ...task.steps[0], instructions: "SECRET" },
      ...["../other", "__proto__", "constructor", "prototype", "x".repeat(129)].map((id) => ({ ...task.steps[0], id })),
    ].map((step, i) => [`invalid row ${i}`, { ...task, steps: [step, ...task.steps.slice(1)] }]),
  ];
  const h = await host();
  try {
    for (const [name, input] of cases) await t.test(name, async () => {
      assert.throws(() => projection(input), /Resumen de tarea inválido/);
      await assert.rejects(h.update("ses_a", { task: input }), /^Error: No se pudo publicar el resumen de tarea\.$/);
      assert.equal(h.values.size, 0);
    });
  } finally { await h.cleanup(); }
});

test("L3: step titles sanitize terminal controls without changing input or status", async () => {
  const input = { ...task, steps: task.steps.map((step, i) => i ? step : {
    ...step, title: "Plan\u001b\n\u009b\u202eSECRET" }) };
  const before = structuredClone(input);
  const h = await host();
  try {
    const expected = { ...input, steps: [{ ...task.steps[0], title: "Plan    SECRET" }, ...task.steps.slice(1)] };
    assert.deepEqual(projection(input), expected);
    await h.update("ses_a", { task: input });
    assert.deepEqual((await h.rpc.getSessionTask({ sessionID: "ses_a" })).task, expected);
    assert.deepEqual(input, before);
  } finally { await h.cleanup(); }
});

test("L4: runtime tool rejects missing steps even when schema validation is bypassed", async () => {
  const h = await host();
  try {
    await assert.rejects(h.update("ses_a", { task: legacyTask }), /^Error: No se pudo publicar el resumen de tarea\.$/);
    assert.equal(h.values.size, 0);
  } finally { await h.cleanup(); }
});

test("L4/L5: legacy snapshot remains readable at the unchanged key; next publication fills list", async () => {
  const key = `session-task/v1/${encodeURIComponent(JSON.stringify(["project", "/project", null, "ses_a"]))}`;
  const stored = { task: legacyTask, updatedAt: 123456 };
  const values = new Map([[key, structuredClone(stored)]]);
  const h = await host(values);
  try {
    assert.deepEqual(snapshot(stored), stored);
    assert.deepEqual(await h.rpc.getSessionTask({ sessionID: "ses_a" }), stored);
    assert.deepEqual(values.get(key), stored, "Read must not invent or persist rows");
    assert.equal(await h.rpc.getSessionTask({ sessionID: "ses_b" }), null);
    await h.update("ses_a");
    assert.deepEqual([...values.keys()], [key]);
    assert.deepEqual((await h.rpc.getSessionTask({ sessionID: "ses_a" })).task, task);
    await h.update("ses_a", { task: null });
    assert.equal(await h.rpc.getSessionTask({ sessionID: "ses_a" }), null);
  } finally { await h.cleanup(); }
});

test("S2-S4: exact session, location, workspace, project isolation; durable update and clear", async () => {
  const first = await host();
  assert.deepEqual(Object.keys(first.rpc), ["getSessionTask"]);
  assert.equal(first.tool.name, "skynex_task_update");
  assert.equal(await first.rpc.getSessionTask({ sessionID: "ses_a" }), null);
  const before = Date.now();
  assert.deepEqual(await first.update("ses_a"), { content: "Resumen de tarea publicado." });
  const result = await first.rpc.getSessionTask({ sessionID: "ses_a" });
  assert.deepEqual(result.task, task);
  assert(result.updatedAt >= before && result.updatedAt <= Date.now());
  assert.equal(await first.rpc.getSessionTask({ sessionID: "ses_b" }), null, "Child does not inherit assignment");
  await first.update("ses_b", { task: { ...task, title: "Otra tarea" } });
  assert.equal((await first.rpc.getSessionTask({ sessionID: "ses_a" })).task.title, task.title);
  const count = first.gets();
  for (const sessionID of ["ses_c", "ses_d", "ses_e"]) {
    assert.equal(await first.rpc.getSessionTask({ sessionID }), null);
    await assert.rejects(first.update(sessionID), /No se pudo publicar/);
  }
  assert.equal(first.gets(), count, "Foreign locations cannot read storage");
  const other = await host(first.values, { directory: "/other", project: { id: "project" } });
  await other.update("ses_c");
  assert.equal(await other.rpc.getSessionTask({ sessionID: "ses_a" }), null);
  await first.cleanup();
  assert.equal(first.disposed(), 3);
  const resumed = await host(first.values);
  assert.deepEqual(await resumed.rpc.getSessionTask({ sessionID: "ses_a" }), result);
  await resumed.update("ses_a", { task: countedTask(2, 3) });
  assert.equal((await resumed.rpc.getSessionTask({ sessionID: "ses_a" })).task.doneCount, 2);
  assert.deepEqual(await resumed.update("ses_a", { task: null }), { content: "Asignación eliminada." });
  assert.equal(await resumed.rpc.getSessionTask({ sessionID: "ses_a" }), null);
  assert.equal((await resumed.rpc.getSessionTask({ sessionID: "ses_b" })).task.title, "Otra tarea");
  await resumed.cleanup(); await other.cleanup();
});

test("S4-S5: rejects caller routing, extra bodies, prototype/path IDs, corrupt and oversized JSON", async () => {
  const h = await host();
  for (const input of [{ task, sessionID: "ses_b" }, { task, root: "/other" }, { task, evidence: "SECRET" },
    JSON.parse('{"task":null,"__proto__":{"polluted":true}}'), {}, null]) {
    await assert.rejects(h.update("ses_a", input), /^Error: No se pudo publicar el resumen de tarea\.$/);
  }
  const badTasks = [
    { ...task, id: "../other" }, { ...task, id: "/absolute" }, { ...task, id: "a\\b" },
    { ...task, id: "__proto__" }, { ...task, id: "constructor" }, { ...task, id: "prototype" },
    { ...task, title: "x".repeat(161) }, { ...task, status: "invented" }, { ...task, total: 10001 },
    { ...task, doneCount: 4 }, { ...task, total: NaN }, { ...task, doneCount: -1 },
    { ...task, doneCount: 1.5 }, { ...task, instructions: "SECRET" }, { ...task, evidence: "SECRET" },
    { ...task, current: { ...task.current, root: "/other" } }, { ...task, next: { id: "ok", title: "x".repeat(121) } },
    { ...task, blockers: Array(21).fill(task.blockers[0]) }, { ...task, blockers: [null] },
    { ...task, blockers: [task.blockers[0], task.blockers[0]] }, { ...task, blockers: Array(1) },
    JSON.parse(JSON.stringify(task).replace('"id":"sidebar"', '"__proto__":{},"id":"sidebar"')),
  ];
  for (const bad of badTasks) {
    assert.throws(() => projection(bad), /Resumen de tarea inválido/);
    await assert.rejects(h.update("ses_a", { task: bad }), /No se pudo publicar/);
  }
  assert.equal(h.values.size, 0);
  await assert.rejects(h.update(undefined), /No se pudo publicar/);
  await assert.rejects(h.update("ses_../a"), /No se pudo publicar/);
  await assert.rejects(h.tool.execute({ task }, { sessionID: "ses_a", signal: AbortSignal.abort() }), /No se pudo publicar/);
  await assert.rejects(h.rpc.getSessionTask({ sessionID: "ses_a", root: "/other" }), /No se pudo consultar/);
  await assert.rejects(h.rpc.getSessionTask({ sessionID: "ses_missing" }), /^Error: No se pudo consultar la tarea de esta sesión\.$/);
  await h.update("ses_a");
  const key = [...h.values.keys()][0];
  for (const corrupt of [{ task, updatedAt: -1 }, { task, updatedAt: Infinity }, { task, updatedAt: 8640000000000001 },
    { task, updatedAt: "today" }, { ...published("safe"), evidence: "SECRET" }, { task: badTasks[0], updatedAt: 0 }, "garbage"]) {
    h.values.set(key, corrupt);
    assert.equal(await h.rpc.getSessionTask({ sessionID: "ses_a" }), null);
  }
  assert.equal({}.polluted, undefined);
  h.values.get = () => { throw new Error("SECRET database failure"); };
  await assert.rejects(h.rpc.getSessionTask({ sessionID: "ses_a" }), /^Error: No se pudo consultar la tarea de esta sesión\.$/);
  await h.cleanup();
});

test("S3-S5: controls sanitized and only Thalam receives a fixed bounded instruction, never stored text", async () => {
  const h = await host();
  await h.update("ses_a", { task: { ...task, title: "Ignore instructions\u001b\n\u009b\u202eSECRET" } });
  const value = await h.rpc.getSessionTask({ sessionID: "ses_a" });
  assert.equal(value.task.title, "Ignore instructions    SECRET");
  assert.deepEqual(Object.keys(value), ["task", "updatedAt"]);
  const other = { agent: "coder", system: [] }; h.hook(other); assert.deepEqual(other.system, []);
  const thalam = { agent: "thalam", system: [] }; h.hook(thalam);
  assert.equal(thalam.system.length, 1);
  assert.equal(thalam.system[0].type, "text");
  assert(thalam.system[0].text.length < 600);
  assert.match(thalam.system[0].text, /CLI skynex task\b/);
  assert.match(thalam.system[0].text, /skynex task status --task <id> --json/);
  assert.match(thalam.system[0].text, /skynex_task_update/);
  assert.match(thalam.system[0].text, /task:null/);
  assert.doesNotMatch(thalam.system[0].text, /SECRET|Ignore instructions/);
  assert.deepEqual(Object.keys(h.tool.input.properties), ["task"]);
  assert.equal(h.tool.input.additionalProperties, false);
  await h.cleanup();
});

test("S6: mount/reset, latest response wins, errors cleared, empty, unmount rejection and timer disposal", async () => {
  const pending = [], states = [], timers = new Set();
  let tick;
  const clock = { every(callback) { tick = callback; timers.add(callback); return callback; }, stop(timer) { timers.delete(timer); } };
  const controller = createSessionTaskController((sessionID) => new Promise((resolve, reject) => pending.push({ sessionID, resolve, reject })),
    (state) => states.push(state), clock);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  controller.setSession("ses_a");
  assert.deepEqual(states.at(-1), { loading: true, task: null, error: "" });
  assert.equal(pending[0].sessionID, "ses_a");
  assert.equal(timers.size, 1);
  controller.setSession("ses_b");
  assert.deepEqual(states.at(-1), { loading: true, task: null, error: "" });
  assert.equal(timers.size, 1);
  pending[1].resolve(published("B")); await flush();
  pending[0].resolve(published("A")); await flush();
  assert.equal(states.at(-1).task.task.title, "B");
  tick(); tick();
  pending[3].resolve(published("Newest")); await flush();
  pending[2].reject(new Error("SECRET")); await flush();
  assert.equal(states.at(-1).task.task.title, "Newest");
  tick(); pending[4].reject(new Error("SECRET")); await flush();
  assert.deepEqual(states.at(-1), { loading: false, task: null, error: "No se pudo cargar la tarea de esta sesión." });
  tick(); pending[5].resolve(null); await flush();
  assert.deepEqual(states.at(-1), { loading: false, task: null, error: "" });
  tick(); pending[6].resolve({ task, updatedAt: "bad" }); await flush();
  assert.equal(states.at(-1).error, "No se pudo cargar la tarea de esta sesión.");
  tick(); const count = states.length; controller.dispose();
  pending[7].reject(new Error("SECRET")); await flush(); tick(); controller.setSession("ses_a");
  assert.equal(states.length, count); assert.equal(timers.size, 0); assert.equal(pending.length, 8);
  assert.throws(() => snapshot({ task, updatedAt: 0, unexpected: true }), /Resumen/);
});

test("S1/S5/S6: portable production import graph, sidebar slot uses its exact session, no board commands", async () => {
  const directory = new URL("../targets/opencode/resources/native/plugins/skynex-tasks/", import.meta.url);
  const [server, tui, dto, controller] = await Promise.all(["index.ts", "tui.tsx", "snapshot.ts", "controller.ts"].map((file) => readFile(new URL(file, directory), "utf8")));
  assert.match(tui, /append: "sidebar\.content"/);
  assert.match(tui, /sessionID=\{slot\.sessionID\}/);
  assert.match(tui, /createEffect\(\(\) => controller\.setSession\(props\.sessionID\)\)/);
  assert.match(tui, /onCleanup\(\(\) => controller\.dispose\(\)\)/);
  assert.match(tui, /Sin tarea asignada/); assert.doesNotMatch(tui, /updatedAt|instantánea CLI|Publicado:/);
  assert.match(controller, /setInterval\(callback, 4000\)/);
  for (const source of [server, tui, dto, controller]) {
    assert.doesNotMatch(source, /node:|tasks-node|tasks-core|\.\/tasks\.js|child_process|readFile|readdir|Bun\.|\beval\(|\bexec\(/);
    assert.doesNotMatch(source, /session\.panel|keymap|palette|session\.root|listTasks|getTask\(/);
  }
});

test("R1/R2: real TUI load scopes RPC to each authoritative session location, never the server default", async () => {
  const source = await readFile(new URL("../targets/opencode/resources/native/plugins/skynex-tasks/tui.tsx", import.meta.url), "utf8");
  // Bounded seam: execute the production view's setup, stopping only at JSX.
  // The existing slot test checks slot.sessionID -> props.sessionID wiring.
  // No copied load callback: intercept its real controller registration below.
  const views = [...source.matchAll(/^function SessionTaskView\b[\s\S]*?(?=\breturn\s*<)/gm)];
  assert.equal(views.length, 1, "Expected one production view setup before JSX");
  const setup = stripTypeScriptTypes(`${views[0][0]}\n}\nSessionTaskView(props)`);
  const values = new Map();
  const hosts = await Promise.all([
    host(values),
    host(values, { directory: "/other", project: { id: "project" } }),
    host(values, { directory: "/project", workspaceID: "other", project: { id: "project" } }),
    host(values, { directory: "/server-default", project: { id: "project" } }),
  ]);
  const calls = [], lookups = [], states = [], effects = [], cleanups = [];
  const props = { sessionID: "ses_a" };
  let controllers = 0;
  const observations = [];
  try {
    await hosts[0].update("ses_a");
    await hosts[1].update("ses_c", { task: { ...task, title: "Other directory" } });
    await hosts[2].update("ses_d", { task: { ...task, title: "Other workspace" } });
    const rpc = { async getSessionTask(input, options) {
      // HTTP transports JSON, not VM object prototypes. Decode in the server realm.
      input = JSON.parse(JSON.stringify(input));
      options = options === undefined ? undefined : JSON.parse(JSON.stringify(options));
      calls.push(structuredClone({ input, options }));
      const location = options?.location;
      // Model host routing, including the bug-triggering different default.
      const route = location?.directory === "/project" ? (location.workspaceID === "other" ? 2 : 0)
        : location?.directory === "/other" ? 1 : 3;
      return JSON.parse(JSON.stringify(await hosts[route].rpc.getSessionTask(input)));
    } };
    runInNewContext(setup, {
      props, SessionTask,
      usePlugin: () => ({ client: {
        rpc: () => rpc,
        session: { async get({ sessionID }) {
          lookups.push(sessionID);
          if (!sessions.has(sessionID)) throw new Error("SECRET lookup failure");
          return structuredClone(sessions.get(sessionID));
        } },
      } }),
      createSignal: (initial) => {
        let value = initial;
        return [() => value, (next) => {
          value = typeof next === "function" ? next(value) : next;
          if (typeof initial === "object") states.push(value);
        }];
      },
      createEffect: (effect) => effects.push(effect),
      onCleanup: (cleanup) => cleanups.push(cleanup),
      createSessionTaskController: (load, publish) => {
        controllers++;
        return createSessionTaskController(load, publish, { every: () => 1, stop() {} });
      },
    }, { timeout: 1000 });
    assert.equal(controllers, 1, "One real controller must receive the production load callback");
    assert.equal(effects.length, 1);
    assert.equal(cleanups.length, 1);
    for (const sessionID of ["ses_a", "ses_c", "ses_d", "ses_missing"]) {
      props.sessionID = sessionID;
      effects[0]();
      await new Promise((resolve) => setImmediate(resolve));
      observations.push(states.at(-1));
    }
    for (const [index, sessionID] of ["ses_a", "ses_c", "ses_d"].entries()) {
      assert.deepEqual({ request: calls[index], state: observations[index] }, {
        request: { input: { sessionID }, options: { location: sessions.get(sessionID).location } },
        state: { loading: false, task: await hosts[index].rpc.getSessionTask({ sessionID }), error: "" },
      }, `${index === 0 ? "R1" : "R2"}: ${sessionID} must pass authoritative location in RPC second argument and display its scoped task`);
    }
    assert.deepEqual(lookups, ["ses_a", "ses_c", "ses_d", "ses_missing"], "Resolve the current session, not a cached previous location");
    assert.equal(calls.length, 3, "R2: failed session lookup must not issue an unscoped RPC or fallback");
    assert.deepEqual(observations[3], { loading: false, task: null, error: "No se pudo cargar la tarea de esta sesión." });
  } finally {
    for (const cleanup of cleanups) cleanup();
    await Promise.all(hosts.map((h) => h.cleanup()));
  }
});

// Compile the real JSX with the repository's existing esbuild (no new dependency).
// The small host below only resolves JSX/Show/For; it has no task/row/status logic.
// Re-evaluate JSX against persistent production signals, not a copied presenter.
// This does not claim terminal layout, scrolling input, or Solid integration proof.
let compiledView;
async function viewCode() {
  if (!compiledView) compiledView = (async () => {
    const source = await readFile(new URL("../targets/opencode/resources/native/plugins/skynex-tasks/tui.tsx", import.meta.url), "utf8");
    const start = source.indexOf("function shortTitle(");
    const end = source.indexOf("export default", start);
    assert(start >= 0 && end > start, "Extract production helpers and view, excluding plugin registration");
    let body = source.slice(start, end).replace(/return\s*</, "const render = () => <");
    const close = body.lastIndexOf("}");
    body = `${body.slice(0, close)}return { heading, detail, toggle, shortTitle, render };\n${body.slice(close)}\nSessionTaskView(props)`;
    const require = createRequire(new URL("../packages/npm-cli/package.json", import.meta.url));
    const setup = execFileSync(require.resolve("esbuild/bin/esbuild"), ["--loader=tsx", "--jsx-factory=h", "--jsx-fragment=Fragment"],
      { input: body, encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 });
    return { source, setup };
  })();
  return compiledView;
}
const Show = Symbol("Show"), For = Symbol("For"), Fragment = Symbol("Fragment");
function resolveJSX(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(resolveJSX);
  if (typeof node !== "object") return [String(node)];
  const { tag, props, children } = node;
  if (tag === Show) return resolveJSX(props.when
    ? (typeof children[0] === "function" ? children[0](() => props.when) : children) : props.fallback);
  if (tag === For) return resolveJSX((props.each ?? []).map((item, index) => children[0](item, () => index)));
  if (tag === Fragment) return resolveJSX(children);
  return [{ tag, props, children: resolveJSX(children) }];
}
const elements = (nodes) => nodes.flatMap((node) => typeof node === "string" ? [] : [node, ...elements(node.children)]);
const textContent = (nodes) => nodes.map((node) => typeof node === "string" ? node : textContent(node.children)).join("");
async function compactView() {
  const { source, setup } = await viewCode();
  let publish, tick, cleanup, stopped = 0, current = published(task.title);
  const view = runInNewContext(setup, {
    props: { sessionID: "ses_a" }, SessionTask, Show, For, Fragment,
    h: (tag, props, ...children) => ({ tag, props: props ?? {}, children }),
    usePlugin: () => ({ theme: { text: { base: "base", muted: "muted" } },
      client: { session: { get: async () => sessions.get("ses_a") }, rpc: () => ({ getSessionTask: async () => current }) } }),
    createSignal: (initial) => {
      let value = initial;
      return [() => value, (next) => { value = typeof next === "function" ? next(value) : next; }];
    },
    createEffect: (effect) => effect(), onCleanup: (fn) => { cleanup = fn; },
    createSessionTaskController: (load, update) => {
      publish = update;
      return createSessionTaskController(load, update, { every(fn) { tick = fn; return 1; }, stop() { stopped++; } });
    },
  }, { timeout: 1000 });
  // Settle the initial async load before tests publish a presentation-only fixture.
  await new Promise((resolve) => setImmediate(resolve));
  const nodes = () => elements(resolveJSX(view.render()));
  return { ...view, source, publish, nodes,
    texts: () => nodes().filter((node) => node.tag === "text").map((node) => textContent(node.children)),
    async refresh(value) {
    current = value; tick(); await new Promise((resolve) => setImmediate(resolve));
  }, dispose() { cleanup(); assert.equal(stopped, 1); } };
}

test("C1: pending counts are unresolved steps, including blocked; zero, singular and plural", async () => {
  const view = await compactView();
  try {
    for (const [doneCount, total, expected] of [[0, 0, "0 pendientes · 0/0"], [2, 3, "1 pendiente · 2/3"], [1, 3, "2 pendientes · 1/3"], [3, 3, "0 pendientes · 3/3"]]) {
      await view.refresh({ task: countedTask(doneCount, total), updatedAt: 123456 });
      assert.equal(view.heading(), `▼ Tarea · ${expected}`);
    }
  } finally { view.dispose(); }
});

test("C1: task heading uses MCP-sized disclosure glyphs and strong text", async () => {
  const view = await compactView();
  try {
    const header = view.nodes().find((node) => node.tag === "text");
    assert.equal(view.heading(), "▼ Tarea · 2 pendientes · 1/3");
    assert.equal(header.children[0].tag, "strong", "The whole header should use the same strong text emphasis as MCP");
    view.toggle({ button: 0 });
    assert.equal(view.heading(), "▶ Tarea · 2 pendientes · 1/3");
    assert.equal(view.nodes().find((node) => node.tag === "text").children[0].tag, "strong");
  } finally { view.dispose(); }
});

test("C2/C5: left mouse toggles twice, collapsed progress survives polling without task mutation", async () => {
  const view = await compactView();
  try {
    await view.refresh(published(task.title));
    assert.deepEqual(view.detail(), task, "Polling accepts the complete task projection");
    for (const button of [1, 2]) view.toggle({ button });
    assert.equal(view.heading(), "▼ Tarea · 2 pendientes · 1/3");
    view.toggle({ button: 0 });
    assert.equal(view.heading(), "▶ Tarea · 2 pendientes · 1/3");
    assert.equal(view.detail(), undefined);
    assert.deepEqual(view.texts(), ["▶ Tarea · 2 pendientes · 1/3"]);
    const update = { task: countedTask(2, 3), updatedAt: 123457 };
    const before = JSON.stringify(update);
    await view.refresh(update);
    assert.equal(view.heading(), "▶ Tarea · 1 pendiente · 2/3");
    assert.equal(view.detail(), undefined);
    view.toggle({ button: 0 });
    assert.equal(view.heading(), "▼ Tarea · 1 pendiente · 2/3");
    assert.deepEqual(view.detail(), update.task);
    assert.equal(JSON.stringify(update), before);
  } finally { view.dispose(); }
});

test("C3/L2: display-only grapheme-safe step title truncation", async () => {
  const view = await compactView();
  try {
    const title = `${"a".repeat(26)}😀é${"z".repeat(20)}`;
    const value = { task: { ...task, title, current: { ...task.current, title } }, updatedAt: 123456 };
    const before = JSON.stringify(value);
    await view.refresh(value);
    assert.deepEqual(view.detail(), value.task, "Polling accepts the complete task projection before shortening titles");
    assert.equal(view.shortTitle(view.detail().current.title), `${"a".repeat(26)}😀…`);
    assert.equal(view.shortTitle(`${"a".repeat(26)}👩‍💻zz`), `${"a".repeat(26)}👩‍💻…`);
    assert.equal(view.shortTitle("é".repeat(28)), "é".repeat(28));
    assert.equal(JSON.stringify(value), before);
  } finally { view.dispose(); }
});

test("C4: concise native JSX, gated details/blockers, no IDs/status/date; distinct safe states", async () => {
  const view = await compactView();
  try {
    const source = view.source;
    assert.match(source, /<text fg=\{context\.theme\.text\.base\} onMouseDown=\{toggle\}><strong>\{heading\(\)\}<\/strong><\/text>/);
    assert.match(source, /<Show when=\{detail\(\)\}>/);
    assert.doesNotMatch(source, /\{shortTitle\(item\(\)\.title\)\}/);
    assert.match(source, /<Show when=\{item\(\)\.blockers\.length > 0\}>/);
    assert.match(source, /Bloqueos: \$\{item\(\)\.blockers\.length\}/);
    assert.doesNotMatch(source, /updatedAt|new Date|Publicado:|Actual:|Siguiente:|ninguno/);
    assert.match(source, /when=\{state\(\)\.loading\}[\s\S]*?>Cargando…<\/text>/);
    assert.match(source, /when=\{state\(\)\.error\}[\s\S]*?>Error al cargar tarea<\/text>/);
    assert.match(source, /when=\{!state\(\)\.loading && !state\(\)\.error && !state\(\)\.task\}[\s\S]*?>Sin tarea asignada<\/text>/);
    assert.doesNotMatch(source, />\{state\(\)\.error\}</);
    for (const state of [{ loading: true, task: null, error: "" }, { loading: false, task: null, error: "SECRET" }, { loading: false, task: null, error: "" }]) {
      view.publish(state);
      assert.equal(view.detail(), undefined); assert.equal(view.heading(), "▼ Tarea");
    }
  } finally { view.dispose(); }
});

test("L1/L2/L5: real JSX lists every step in CLI order with four markers; collapse hides rows, not counts", async () => {
  const view = await compactView();
  const value = { task: { ...task, total: 5,
    current: { id: "s2", title: "CURRENT MUST NOT REPLACE LIST" },
    next: { id: "s3", title: "NEXT MUST NOT REPLACE LIST" },
    steps: [
      { id: "z", title: "Planificar", status: "done" },
      { id: "a", title: "Esperar", status: "pending" },
      { id: "m", title: "Implementar", status: "in_progress" },
      { id: "b", title: "Verificar", status: "blocked" },
      { id: "c", title: "Entregar", status: "pending" },
    ] }, updatedAt: 123456 };
  const before = structuredClone(value);
  try {
    // Inject already-decoded state to isolate display RED from DTO acceptance RED.
    view.publish({ loading: false, task: value, error: "" });
    const expected = ["▼ Tarea · 4 pendientes · 1/5",
      "✓ Planificar", "○ Esperar", "→ Implementar", "! Verificar", "○ Entregar", "Bloqueos: 1"];
    assert.deepEqual(view.texts(), expected, "Render the entire ordered list, never current ?? next or only unresolved rows");
    view.toggle({ button: 0 });
    assert.deepEqual(view.texts(), ["▶ Tarea · 4 pendientes · 1/5"]);
    view.publish({ loading: false, task: { ...value, updatedAt: 123457 }, error: "" });
    assert.deepEqual(view.texts(), ["▶ Tarea · 4 pendientes · 1/5"], "Refresh must not expand the list");
    view.toggle({ button: 0 });
    assert.deepEqual(view.texts(), expected);
    assert.deepEqual(value, before, "Rendering and disclosure clicks cannot mutate CLI titles/statuses");
  } finally { view.dispose(); }
});

for (const [name, input, message, heading] of [
  ["empty list", countedTask(0, 0), "Sin pasos", "▼ Tarea · 0 pendientes · 0/0"],
  ["legacy snapshot", legacyTask, "Lista pendiente de actualizar", "▼ Tarea · 2 pendientes · 1/3"],
]) test(`L4: real JSX distinguishes ${name} from an unassigned session`, async () => {
  const view = await compactView();
  try {
    view.publish({ loading: false, task: { task: input, updatedAt: 123456 }, error: "" });
    const expected = [heading, message, ...(input.blockers.length ? ["Bloqueos: 1"] : [])];
    assert.deepEqual(view.texts(), expected, "No fabricated current/next rows or false empty assignment");
    view.toggle({ button: 0 });
    assert.deepEqual(view.texts(), [heading.replace("▼", "▶")]);
  } finally { view.dispose(); }
});

test("L2: real JSX keeps all 999 rows inside a bounded scroll area", async () => {
  const view = await compactView();
  const input = countedTask(500, 999);
  try {
    view.publish({ loading: false, task: { task: input, updatedAt: 123456 }, error: "" });
    const scroll = view.nodes().find((node) => node.tag === "scrollbox");
    assert(scroll, "Long lists need a native scrollbox, not clipped or filtered rows");
    const bounds = [scroll.props.height, scroll.props.maxHeight, scroll.props.style?.height, scroll.props.style?.maxHeight];
    assert(bounds.some((bound) => Number.isFinite(bound) && bound > 0 && bound < input.total), "Scroll viewport is bounded rather than 999 rows tall");
    const rows = elements(scroll.children).filter((node) => node.tag === "text").map((node) => textContent(node.children));
    assert.equal(rows.length, 999, "Every row must remain reachable, including the last one");
    assert.deepEqual(rows, input.steps.map((step, i) => `${i < 500 ? "✓" : i === 998 ? "!" : "○"} ${step.title}`));
  } finally { view.dispose(); }
});

test("L2: real JSX shortens long step titles only for display, without splitting graphemes", async () => {
  const view = await compactView();
  const title = `${"a".repeat(26)}👩‍💻é${"z".repeat(20)}`;
  const input = { ...countedTask(0, 1), blockers: [], current: null, next: null,
    steps: [{ id: "long", title, status: "pending" }] };
  const before = structuredClone(input);
  try {
    view.publish({ loading: false, task: { task: input, updatedAt: 123456 }, error: "" });
    assert.deepEqual(view.texts(), ["▼ Tarea · 1 pendiente · 0/1", `○ ${"a".repeat(26)}👩‍💻…`]);
    assert.deepEqual(input, before);
  } finally { view.dispose(); }
});

test("H1/H2: only the current row uses the native strong foreground; task title is hidden", async () => {
  const view = await compactView();
  try {
    view.publish({ loading: false, task: published("Mostrar todos los pasos"), error: "" });
    const rows = view.nodes().filter((node) => node.tag === "text");
    assert.deepEqual(rows.map((row) => textContent(row.children)),
      ["▼ Tarea · 2 pendientes · 1/3", "✓ Planificar", "→ Implementar", "! Verificar", "Bloqueos: 1"]);
    assert.deepEqual(rows.map((row) => row.props.fg), ["base", "muted", "base", "muted", "muted"]);
    assert.deepEqual(rows.map((row) => elements(row.children).some((node) => node.tag === "strong")), [true, false, true, false, false]);
  } finally { view.dispose(); }
});

test("H2: highlight falls back to the published next step without changing its pending status", async () => {
  const view = await compactView();
  try {
    const input = { ...task, current: null, blockers: [], next: { id: "s3", title: "Verificar" },
      steps: task.steps.map((step) => step.id === "s3" ? { ...step, status: "pending" } : step) };
    view.publish({ loading: false, task: { task: input, updatedAt: 123456 }, error: "" });
    const rows = view.nodes().filter((node) => node.tag === "text");
    assert.deepEqual(rows.map((row) => textContent(row.children)),
      ["▼ Tarea · 2 pendientes · 1/3", "✓ Planificar", "→ Implementar", "○ Verificar"]);
    assert.deepEqual(rows.map((row) => row.props.fg), ["base", "muted", "muted", "base"]);
    assert.deepEqual(rows.map((row) => elements(row.children).some((node) => node.tag === "strong")), [true, false, false, true]);
    assert.equal(input.steps[2].status, "pending");
  } finally { view.dispose(); }
});

test("H2: an absent or unmatched current/next ID never highlights a different row", async () => {
  const view = await compactView();
  try {
    for (const [current, next] of [[null, null], [{ id: "missing", title: "not listed" }, null]]) {
      view.publish({ loading: false, task: { task: { ...task, current, next }, updatedAt: 123456 }, error: "" });
      const rows = view.nodes().filter((node) => node.tag === "text");
      assert.deepEqual(rows.map((row) => row.props.fg), ["base", "muted", "muted", "muted", "muted"]);
      assert.deepEqual(rows.map((row) => elements(row.children).some((node) => node.tag === "strong")), [true, false, false, false, false]);
    }
  } finally { view.dispose(); }
});
