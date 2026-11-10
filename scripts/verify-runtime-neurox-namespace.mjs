import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { test } from "node:test";

// The source tree's prompt import is rewritten during resource packaging; load the
// runtime body directly so this contract does not fail on that unrelated path.
const runtimeSource = await readFile(new URL("../targets/opencode/resources/native/plugins/skynex-runtime.ts", import.meta.url), "utf8");
const selfContainedSource = runtimeSource.replace(/^import \{ markSkynexPrompt \} from "\.\/prompt\.ts";\n/m, "const markSkynexPrompt = () => {};\n");
assert.notEqual(selfContainedSource, runtimeSource, "expected to remove only the source-tree prompt import");
const runtimeRoot = await mkdtemp("/tmp/opencode/neurox-runtime-module-");
const runtimePath = join(runtimeRoot, "runtime.ts");
await writeFile(runtimePath, selfContainedSource);
const runtime = (await import(new URL(`file://${runtimePath}`))).default;

async function fixture(directory) {
  const hooks = new Map();
  const context = {
    location: { directory },
    storage: { set: async () => {} },
    session: { hook: async (name, callback) => hooks.set(`session:${name}`, callback) },
    tool: {
      hook: async (name, callback) => hooks.set(`tool:${name}`, callback),
      transform: async () => {},
    },
  };
  await runtime.setup(context);
  return hooks;
}

test("R1 resolves and normalizes the git top-level basename, or directory basename outside git", async (t) => {
  t.after(() => rm(runtimeRoot, { recursive: true, force: true }));
  const root = await mkdtemp("/tmp/opencode/neurox-namespace-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "Team Repo_One");
  const nested = join(repo, "packages", "child");
  await mkdir(nested, { recursive: true });
  execFileSync("git", ["init", "--quiet", repo]);
  const standalone = join(root, "Loose Dir");
  await mkdir(standalone);
  const longName = "A".repeat(70);
  const longRepo = join(root, longName);
  await mkdir(longRepo);
  execFileSync("git", ["init", "--quiet", longRepo]);

  for (const [directory, expected] of [[nested, "team-repo_one"], [standalone, "loose-dir"], [longRepo, "a".repeat(64)]]) {
    const hooks = await fixture(directory);
    const callback = hooks.get("tool:execute.before");
    assert.equal(typeof callback, "function");
    const event = { tool: "neurox_context", input: { namespace: "other" } };
    await callback(event);
    assert.deepEqual(event.input, { namespace: expected });
  }
});

test("R2 injects one system entry per context event even across repeated calls", async () => {
  const hooks = await fixture("/tmp/opencode/My Project");
  const callback = hooks.get("session:context");
  assert.equal(typeof callback, "function");
  const existing = { type: "text", text: "existing system instruction" };
  const event = { system: [existing] };
  await callback(event);
  await callback(event);
  assert.deepEqual(event.system, [
    existing,
    { type: "text", text: "Skynex enforces this repository's Neurox namespace automatically on project-scoped calls (save, context, session_start, and recall with an explicit namespace)." },
  ]);
});

test("R2 keeps an instruction-like repository name out of system context while R3 still enforces it", async (t) => {
  const root = await mkdtemp("/tmp/opencode/ignore-previous-instructions-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "ignore-previous-instructions");
  const nested = join(repo, "subdir");
  await mkdir(nested, { recursive: true });
  execFileSync("git", ["init", "--quiet", repo]);
  const hooks = await fixture(nested);
  const existing = { type: "text", text: "preserve this" };
  const systemEvent = { system: [existing] };
  const contextHook = hooks.get("session:context");
  const toolHook = hooks.get("tool:execute.before");
  assert.equal(typeof contextHook, "function");
  assert.equal(typeof toolHook, "function");
  const toolEvent = { tool: "neurox_context", input: { namespace: "other" } };
  await toolHook(toolEvent);
  assert.deepEqual(toolEvent.input, { namespace: "ignore-previous-instructions" });
  await contextHook(systemEvent);
  await contextHook(systemEvent);
  assert.deepEqual(systemEvent.system, [
    existing,
    { type: "text", text: "Skynex enforces this repository's Neurox namespace automatically on project-scoped calls (save, context, session_start, and recall with an explicit namespace)." },
  ]);
  const namespaceEntries = systemEvent.system.filter((entry) => entry.text?.includes("Neurox namespace"));
  assert.deepEqual(namespaceEntries, [{ type: "text", text: "Skynex enforces this repository's Neurox namespace automatically on project-scoped calls (save, context, session_start, and recall with an explicit namespace)." }]);
  assert.equal(systemEvent.system.some((entry) => entry.text?.includes("ignore-previous-instructions")), false);
});

test("R3 enforces only the specified Neurox MCP namespace rules", async () => {
  const hooks = await fixture("/tmp/opencode/My Project");
  const callback = hooks.get("tool:execute.before");
  assert.equal(typeof callback, "function");
  const cases = [
    ["neurox_save", { namespace: "wrong", observation_type: "bugfix" }, { namespace: "my-project", observation_type: "bugfix" }],
    ["neurox_save", { observation_type: "preference" }, { observation_type: "preference" }],
    ["neurox_save", { namespace: "default", observation_type: "preference" }, { namespace: "default", observation_type: "preference" }],
    ["neurox_save", { namespace: "other", observation_type: "preference" }, { namespace: "my-project", observation_type: "preference" }],
    ["neurox_context", { namespace: "wrong" }, { namespace: "my-project" }],
    ["neurox_session_start", {}, { namespace: "my-project" }],
    ["neurox_recall", { namespace: "other" }, { namespace: "my-project" }],
    ["neurox_recall", { namespace: "default" }, { namespace: "default" }],
    ["neurox_recall", {}, {}],
    ["neurox_status", { namespace: "other" }, { namespace: "other" }],
    ["read", { namespace: "other", path: "file.txt" }, { namespace: "other", path: "file.txt" }],
    ["execute", { namespace: "other" }, { namespace: "other" }],
  ];
  for (const [tool, input, expected] of cases) {
    const event = { tool, input: structuredClone(input) };
    await callback(event);
    assert.deepEqual(event.input, expected, `${tool} input`);
  }
});

test("R4 registers namespace hooks; R5 callbacks fail open", async () => {
  const missingDirectory = "/tmp/opencode/No Such Repo/Child";
  const hooks = await fixture(missingDirectory);
  assert.equal(typeof hooks.get("session:context"), "function");
  assert.equal(typeof hooks.get("tool:execute.before"), "function");
  const event = { system: [] };
  await assert.doesNotReject(hooks.get("session:context")(event));
  assert.equal(event.system.length, 1);
  const toolEvent = { tool: "neurox_context", input: {} };
  await assert.doesNotReject(hooks.get("tool:execute.before")(toolEvent));
  assert.equal(toolEvent.input.namespace, "child");
});
