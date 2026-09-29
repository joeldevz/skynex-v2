import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// No inherited OpenCode settings, credentials, NODE_OPTIONS, or service discovery.
const command = resolve(process.env.OPENCODE2 ?? "/home/clasing/.opencode/bin/opencode2");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { parse } = createRequire(join(repo, "targets/opencode/package.json"))("jsonc-parser");
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === "--installed-config-dir"),
  "Usage: node scripts/verify-opencode2.mjs [--installed-config-dir /tmp/opencode/.../.opencode]");
const root = await mkdtemp("/tmp/opencode/skynex-runtime-");
const project = join(root, "project");
const env = { PATH: "/usr/bin:/bin", HOME: join(root, "home"),
  XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"),
  XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"),
  TMPDIR: join(root, "tmp") };
const globalConfigRoot = join(env.XDG_CONFIG_HOME, "opencode");
const configDir = globalConfigRoot;
const evidence = { integrationVerified: false, mode: args.length ? "installed-snapshot" : "resource-fixture",
  command, node: { executable: process.execPath, version: process.version }, root, digests: {},
  tuiImport: { covered: "not-checked", cliLoaderVerified: false, reason: "The server /api/plugin does not verify CLI plugin loading or panel rendering." } };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
let child;
let closed;
let output = "";
let deadline;
let authorization;

async function regularFile(path) {
  assert((await lstat(path)).isFile(), `Not a regular file: ${path}`);
  assert.equal(await realpath(path), path, `Symlinked path refused: ${path}`);
  return readFile(path);
}

async function request(base, path, method = "GET", body) {
  const url = new URL(path, base);
  url.searchParams.set("directory", project);
  const response = await fetch(url, { method, headers: { authorization, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000), redirect: "error" });
  assert(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function rpcRequest(base, namespace, method, input) {
  const url = new URL(`/api/rpc/${namespace}/${method}`, base);
  url.searchParams.set("location[directory]", project);
  const response = await fetch(url, { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ input }), signal: AbortSignal.timeout(10_000), redirect: "error" });
  const text = await response.text();
  assert(response.ok, `POST ${url.pathname}: HTTP ${response.status}: ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : null;
}

try {
  // V2 discovers ancestors all the way to /. Refuse rather than load outside config.
  for (let directory = dirname(root); ; directory = dirname(directory)) {
    for (const name of ["opencode.json", "opencode.jsonc", ".opencode"]) {
      const path = join(directory, name);
      const exists = await lstat(path).then(() => true, (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
      assert(!exists, `Ancestor configuration could escape isolation: ${path}`);
    }
    if (directory === dirname(directory)) break;
  }
  for (const path of [project, globalConfigRoot, join(globalConfigRoot, "plugins"), ...Object.values(env).filter((value) => value.startsWith(root))]) {
    await mkdir(path, { recursive: true });
  }
  const installed = args.length ? await realpath(resolve(args[1])) : null;
  if (installed) assert(installed.startsWith("/tmp/opencode/"), "Only approved isolated installed fixtures are accepted");
  let configName = "opencode.json";
  if (installed) {
    const names = [];
    for (const name of ["opencode.json", "opencode.jsonc"]) {
      if (await lstat(join(installed, name)).then(() => true, (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      })) names.push(name);
    }
    assert.equal(names.length, 1, "Expected one installed JSON/JSONC config");
    configName = names[0];
  }
  const configBytes = installed ? await regularFile(join(installed, configName)) : Buffer.from(JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    plugins: [
      { package: "./skynex/plugins/runtime", options: { managedBy: "skynex" } },
      { package: "./skynex/plugins/sky-agents", options: { managedBy: "skynex" } },
      { package: "./skynex/plugins/skynex-tasks", options: { managedBy: "skynex" } },
    ],
    agents: Object.fromEntries(["coder", "diagnostic-researcher", "infrastructure-engineer", "mentor", "pr-reviewer", "security", "skill-validator", "thalam", "tech-planner", "test-engineer", "test-reviewer", "verifier"].map((id) => [id, { mode: id === "thalam" ? "all" : "subagent", permissions: [] }])),
    experimental: {
      http: { enabled: true, hostname: "127.0.0.1", port: 0 },
    },
  }));
  const parseErrors = [];
  const config = parse(configBytes.toString(), parseErrors);
  assert.equal(parseErrors.length, 0, "Installed JSON/C must parse without errors");
  assert(Object.keys(config).every((key) => ["$schema", "plugins", "agents", "experimental"].includes(key)), "Use a clean isolated fixture config");
  const registrations = config.plugins?.map((plugin) => typeof plugin === "string" ? plugin : plugin.package);
  assert.deepEqual(registrations, ["./skynex/plugins/runtime", "./skynex/plugins/sky-agents", "./skynex/plugins/skynex-tasks"],
    "Expected exactly the installed runtime, sky-agents, and Tasks server registrations");
  assert.equal(Object.keys(config.agents ?? {}).length, 12, "Expected all 13 installed agent policies");
  const serverConfig = { ...config };
  await writeFile(join(configDir, configName), Buffer.from(JSON.stringify(serverConfig)));
  evidence.digests.config = digest(configBytes);
  evidence.source = installed ?? join(repo, "targets/opencode/resources");
  evidence.digests.manifest = digest(await readFile(join(repo, "targets/opencode/resources/manifest.json")));
  const resources = [
    ["agents/thalam.md", "canonical/agents/thalam.md"],
    ["skynex/plugins/runtime/index.ts", "native/plugins/skynex-runtime.ts"],
    ["skynex/plugins/runtime/prompt.ts", "native/hooks/prompt.ts"],
    ["skills/skynex-tasks/SKILL.md", "canonical/skills/skynex-tasks/SKILL.md"],
    ...["core/catalog.ts", "core/index.ts", "core/profile-apply.ts", "core/profiles.ts", "core/roots.ts", "core/rpc.ts", "core/storage.ts", "index.ts", "package.json", "rpc.ts", "tui.tsx", "vendor/jsonc-parser/impl/edit.js", "vendor/jsonc-parser/impl/format.js", "vendor/jsonc-parser/impl/parser.js", "vendor/jsonc-parser/impl/scanner.js", "vendor/jsonc-parser/impl/string-intern.js", "vendor/jsonc-parser/LICENSE.md", "vendor/jsonc-parser/main.d.ts", "vendor/jsonc-parser/main.js"]
      .map((name) => [`skynex/plugins/sky-agents/${name}`, `native/plugins/sky-agents/${name}`]),
    ...["index.ts", "package.json", "snapshot.ts", "controller.ts", "review-gate.ts", "tasks.js", "tasks-node.js", "tui.tsx"]
      .map((name) => [`skynex/plugins/skynex-tasks/${name}`, `native/plugins/skynex-tasks/${name}`]),
    ...["errors.js", "index.js", "instruction.js", "ports.js", "schema.js", "service.js", "slug.js", "task.js"]
      .map((name) => [`skynex/plugins/skynex-tasks/tasks-core/${name}`, `native/plugins/skynex-tasks/tasks-core/${name}`]),
    ...["fs-safe.js", "index.js", "roots.js", "store.js", "system.js"]
      .map((name) => [`skynex/plugins/skynex-tasks/tasks-node-core/${name}`, `native/plugins/skynex-tasks/tasks-node-core/${name}`]),
  ];
  for (const [relative, source] of resources) {
    const bytes = await regularFile(installed ? join(installed, relative) : join(evidence.source, source));
    evidence.digests[relative] = digest(bytes);
    const destination = join(configDir, relative);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  child = spawn(command, ["serve", "--hostname", "127.0.0.1", "--port", "0", "--print-logs"], {
    cwd: project, env: { ...env, OPENCODE_CONFIG_DIR: globalConfigRoot }, stdio: ["ignore", "pipe", "pipe"],
  });
  evidence.pid = child.pid;
  closed = new Promise((resolveExit) => {
    child.once("error", (error) => resolveExit({ error: error.message }));
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => {
    output = (output + data.toString()).slice(-64_000);
  });
  // Foreground only: never call service/api CLI discovery, never use --service.
  deadline = setTimeout(() => child.kill("SIGKILL"), 45_000);
  let base;
  const startupEnd = Date.now() + 20_000;
  while (Date.now() < startupEnd) {
    base = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    const password = output.match(/server password (\S+)/)?.[1];
    if (base && password) {
      authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
      break;
    }
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Foreground server exited before readiness");
    await delay(100);
  }
  assert(base, "No explicit loopback URL from foreground server within 20s");
  assert(authorization, "No foreground server password within 20s");
  evidence.server = base;
  evidence.info = await request(base, "/api/info");
  assert.equal(output.includes(`http://127.0.0.1:${new URL(base).port}`), true, "Server URL must originate from owned child output");
  await request(base, "/api/session", "POST", { title: "OpenCode v2 plugin verification" });
  let plugins;
  const pluginReadyEnd = Date.now() + 5_000;
  while (Date.now() < pluginReadyEnd) {
    plugins = await request(base, "/api/plugin");
    const ids = new Set(plugins.data.map((plugin) => plugin.id));
    if (ids.has("skynex.runtime") && ids.has("skynex-sky-agents.server") && ids.has("skynex-tasks.server")) break;
    await delay(100);
  }
  evidence.plugins = plugins;
  if (plugins.data.length === 0) throw new Error("No server plugin exports loaded; see redacted server.log and separate TUI package/export checks.");
    assert.equal(plugins.location.directory, project);
    const runtime = plugins.data.filter((plugin) => plugin.id === "skynex.runtime");
  assert.equal(runtime.length, 1, "Expected exactly one actual skynex.runtime export");
  assert.equal(runtime[0].state.status, "active", "Plugin setup must complete successfully");
  assert.equal(runtime[0].features.server, true);
  assert.equal(runtime[0].source.type, "local");
  assert(runtime[0].source.path.startsWith(join(configDir, "skynex/plugins/runtime")), "Plugin must resolve from snapshot");
    const skyAgents = plugins.data.filter((plugin) => plugin.id === "skynex-sky-agents.server");
   assert.equal(skyAgents.length, 1, "Expected exactly one actual sky-agents server export");
   assert.equal(skyAgents[0].state.status, "active", "Sky Agents server setup must complete successfully");
   assert.equal(skyAgents[0].features.server, true);
    assert(skyAgents[0].source.path.startsWith(join(configDir, "skynex/plugins/sky-agents")), "Sky Agents must resolve from snapshot");
      const localPlugins = plugins.data.filter((plugin) => plugin.source.type === "local");
    const serverPluginIDs = new Set(localPlugins.map((plugin) => plugin.id));
     const expectedServerPluginIDs = new Set(["skynex.runtime", "skynex-sky-agents.server", "skynex-tasks.server"]);
    const serverPluginsReady = [...serverPluginIDs].length === expectedServerPluginIDs.size && [...expectedServerPluginIDs].every((id) => serverPluginIDs.has(id));
     evidence.serverPlugins = { loaded: [...serverPluginIDs], expected: [...expectedServerPluginIDs], ready: serverPluginsReady };
     const tasksServer = plugins.data.filter((plugin) => plugin.id === "skynex-tasks.server");
     assert.equal(tasksServer.length, 1, "Expected exactly one actual skynex-tasks.server export from the installed Tasks package");
     assert.equal(tasksServer[0].state.status, "active", "Tasks server setup must complete successfully");
     assert.equal(tasksServer[0].features.server, true);
     assert.equal(tasksServer[0].source.type, "local");
     assert(tasksServer[0].source.path.startsWith(join(configDir, "skynex/plugins/skynex-tasks")), "Tasks server must resolve from the isolated snapshot");
     assert.equal(serverPluginsReady, true, "Expected exactly the three managed server plugins");
    const rpcEnvelope = await rpcRequest(base, "skynex.sky-agents", "listProfiles", {});
     evidence.rpc = { registered: skyAgents[0].features.rpc === true, listProfiles: { called: true, result: rpcEnvelope.output } };
    assert.equal(evidence.rpc.registered, true, "Sky Agents RPC feature must be registered");
     assert.deepEqual(evidence.rpc.listProfiles.result, [], "Fresh isolated profile store must be empty");
     const mutationProfile = { name: "rpc-contract", created_at: new Date(0).toISOString(), updated_at: new Date(1).toISOString(), models: Object.fromEntries(Object.keys(config.agents).map((id) => [id, "openai/gpt-5"])) };
     const saveEnvelope = await rpcRequest(base, "skynex.sky-agents", "saveProfile", { profile: mutationProfile });
     assert.deepEqual(saveEnvelope.output, { ok: true }, "saveProfile must return an explicit JSON success envelope");
     assert.deepEqual((await rpcRequest(base, "skynex.sky-agents", "getProfile", { name: mutationProfile.name })).output, mutationProfile, "saveProfile mutation must be observable");
     mutationProfile.updated_at = new Date(2).toISOString();
     mutationProfile.models.coder = "anthropic/claude";
     const updateEnvelope = await rpcRequest(base, "skynex.sky-agents", "updateProfile", { profile: mutationProfile });
     assert.deepEqual(updateEnvelope.output, { ok: true }, "updateProfile must return an explicit JSON success envelope");
     assert.deepEqual((await rpcRequest(base, "skynex.sky-agents", "getProfile", { name: mutationProfile.name })).output, mutationProfile, "updateProfile mutation must be observable");
     const deleteEnvelope = await rpcRequest(base, "skynex.sky-agents", "deleteProfile", { name: mutationProfile.name });
     assert.deepEqual(deleteEnvelope.output, { ok: true }, "deleteProfile must return an explicit JSON success envelope");
     assert.equal((await rpcRequest(base, "skynex.sky-agents", "getProfile", { name: mutationProfile.name })).output, null, "deleteProfile mutation must be observable");
     evidence.rpc.mutations = { save: saveEnvelope.output, update: updateEnvelope.output, delete: deleteEnvelope.output, observableCrud: true };
    const previewEnvelope = await rpcRequest(base, "skynex.sky-agents", "previewProfileApply", { name: "missing-profile", config: "jsonc" }).then(
      (value) => ({ value }),
      (error) => ({ error: error.message }),
    );
    evidence.rpc.previewProfileApply = { called: true, ...previewEnvelope };
    assert(previewEnvelope.error?.includes("HTTP 500") || previewEnvelope.value, "Preview RPC must be callable");
    evidence.profileRoot = join(env.XDG_CONFIG_HOME, "skynex", "profiles");
  const tuiBytes = await regularFile(join(configDir, "skynex/plugins/sky-agents/tui.tsx"));
   const rpcBytes = await regularFile(join(configDir, "skynex/plugins/sky-agents/rpc.ts"));
   const serverBytes = await regularFile(join(configDir, "skynex/plugins/sky-agents/index.ts"));
   const packageJson = JSON.parse((await regularFile(join(configDir, "skynex/plugins/sky-agents/package.json"))).toString());
   assert(!/(?:from|import\s*)\s*[('][^./]/.test(tuiBytes.toString()), "Installed TUI source must have no bare imports");
   for (const [label, bytes] of [["RPC definition", rpcBytes], ["server", serverBytes], ["TUI", tuiBytes]]) {
     assert(!/\b(?:authorizeProfileApply|applyProfile)\b/.test(bytes.toString()), `${label} must not expose mutation RPCs`);
   }
   assert(tuiBytes.toString().includes("skynex profile apply --name"), "TUI apply action must point to the confirmed CLI flow");
   assert(rpcBytes.toString().includes("previewProfileApply:"), "RPC definition must expose previewProfileApply");
   assert(serverBytes.toString().includes("previewProfileApply:"), "Server must expose previewProfileApply");
    assert.equal(packageJson.exports?.["./tui"], "./tui.tsx", "Installed package must export its TUI entry");
     const tasksPackage = JSON.parse((await regularFile(join(configDir, "skynex/plugins/skynex-tasks/package.json"))).toString());
     assert.equal(tasksPackage.exports?.["./tui"], "./tui.tsx", "Tasks package must export its TUI entry");
     assert.equal(tasksPackage.exports?.["."], "./index.ts", "Tasks package must export its server entry beside ./tui");
     const tasksTuiPath = join(configDir, "skynex/plugins/skynex-tasks/tui.tsx");
  const tasksTui = (await regularFile(tasksTuiPath)).toString();
    assert.match(tasksTui, /Plugin\.define/);
    assert.match(tasksTui, /id: "skynex-tasks\.tui"/);
    assert.match(tasksTui, /setup\(context\)/);
     assert.match(tasksTui, /from "\.\/snapshot\.ts"/);
     assert.match(tasksTui, /from "\.\/controller\.ts"/);
     assert.match(tasksTui, /append: "sidebar\.content"/);
     assert.match(tasksTui, /sessionID=\{slot\.sessionID\}/);
      assert.match(tasksTui, /Sin tarea asignada/);
      assert.match(tasksTui, /<For each=\{item\(\)\.steps\}/);
      assert.match(tasksTui, /<scrollbox maxHeight=\{10\}/);
      assert.match(tasksTui, /flexShrink=\{0\}/);
      assert.match(tasksTui, /done: "✓", pending: "○", in_progress: "→", blocked: "!"/);
      assert.match(tasksTui, /shortTitle\(step\.title\)/);
      assert.match(tasksTui, /Lista pendiente de actualizar/);
      assert.match(tasksTui, /Sin pasos/);
      assert.doesNotMatch(tasksTui, /task\?\.current \?\? task\?\.next/);
     assert.match(tasksTui, /onMouseDown=\{toggle\}/);
     assert.doesNotMatch(tasksTui, /updatedAt|instantánea CLI|Publicado:/);
     const tasksController = (await regularFile(join(configDir, "skynex/plugins/skynex-tasks/controller.ts"))).toString();
     assert.match(tasksController, /setInterval\(callback, 4000\)/);
     assert.match(tasksController, /clock\.stop\(timer\)/);
     for (const name of ["index.ts", "tui.tsx", "snapshot.ts", "controller.ts"]) {
       const source = (await regularFile(join(configDir, "skynex/plugins/skynex-tasks", name))).toString();
       assert.doesNotMatch(source, /node:|tasks-node|tasks-core|\.\/tasks\.js|child_process|readFile|readdir|session\.panel|palette|listTasks|getTask\(/);
     }
    for (const name of ["tasks.js", "tasks-node.js"]) {
       const wrapper = (await regularFile(join(configDir, "skynex/plugins/skynex-tasks", name))).toString();
      assert(!/\.\.\//.test(wrapper), `Tasks ${name} must not escape its installed package`);
    }
      evidence.tuiImport = { covered: "static-limited", cliLoaderVerified: false, packageExport: tasksPackage.exports["./tui"], source: tasksTuiPath, slot: "sidebar.content", reason: "The server /api/plugin proves only server activation; CLI loading and sidebar rendering require a separate isolated CLI/PTY check." };
  const skillPath = join(configDir, "skills/skynex-tasks/SKILL.md");
  const skillText = (await regularFile(skillPath)).toString();
  assert.match(skillText, /more than one genuine/i, "Isolated project must load the managed Tasks skill");
   const thalam = (await regularFile(join(configDir, "agents/thalam.md"))).toString();
  assert.match(thalam, /MUST invoke the\s+`skynex-tasks` skill/i);
  assert.match(thalam, /Automatic Tasks quick procedure/);
  evidence.taskSkill = { path: skillPath, digest: digest(Buffer.from(skillText)), automaticRouting: true };
  evidence.integrationVerified = true;
} catch (error) {
  evidence.error = String(error.message).replace(/server password \S+/g, "server password [REDACTED]");
  process.exitCode = 1;
} finally {
  if (child && closed) {
    child.kill("SIGTERM");
    let timer;
    const grace = new Promise((resolveGrace) => { timer = setTimeout(() => resolveGrace(null), 5_000); });
    evidence.processExit = await Promise.race([closed, grace]);
    clearTimeout(timer);
    if (!evidence.processExit) {
      child.kill("SIGKILL");
      evidence.processExit = await closed;
    }
  }
  clearTimeout(deadline);
  evidence.digests.script = digest(await readFile(fileURLToPath(import.meta.url)));
  await writeFile(join(root, "server.log"), output.replace(/server password \S+/g, "server password [REDACTED]"));
  let serializedEvidence = JSON.stringify(evidence, null, 2);
  const credentials = [authorization, ...[...output.matchAll(/server password (\S+)/g)].map((match) => match[1])].filter(Boolean);
  for (const credential of credentials) serializedEvidence = serializedEvidence.replaceAll(credential, "[REDACTED]");
  await writeFile(join(root, "evidence.json"), serializedEvidence + "\n");
  console.log(serializedEvidence);
}
