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
const configDir = join(root, "config", "opencode");
const env = { PATH: "/usr/bin:/bin", HOME: join(root, "home"),
  XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"),
  XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"),
  TMPDIR: join(root, "tmp") };
const evidence = { integrationVerified: false, mode: args.length ? "installed-snapshot" : "resource-fixture",
  command, node: { executable: process.execPath, version: process.version }, root, digests: {} };
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

async function request(base, path, method = "GET") {
  const url = new URL(path, base);
  if (path !== "/api/health") url.searchParams.set("location[directory]", project);
  const response = await fetch(url, { method, headers: { authorization }, signal: AbortSignal.timeout(10_000), redirect: "error" });
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
  for (const path of [project, configDir, ...Object.values(env).filter((value) => value.startsWith(root))]) {
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
    ],
    agents: Object.fromEntries(["coder", "diagnostic-researcher", "infrastructure-engineer", "mentor", "pr-reviewer", "security", "skill-validator", "skynex-orchestrator", "task-classifier", "tech-planner", "test-engineer", "test-reviewer", "verifier"].map((id) => [id, { mode: id === "skynex-orchestrator" ? "all" : "subagent", permissions: [] }])),
  }));
  const parseErrors = [];
  const config = parse(configBytes.toString(), parseErrors);
  assert.equal(parseErrors.length, 0, "Installed JSON/C must parse without errors");
  assert(Object.keys(config).every((key) => ["$schema", "plugins", "agents"].includes(key)), "Use a clean installer fixture config (schema/plugins/agents only)");
  const registrations = config.plugins?.map((plugin) => typeof plugin === "string" ? plugin : plugin.package);
  assert.deepEqual(registrations, ["./skynex/plugins/runtime", "./skynex/plugins/sky-agents"],
    "Expected exactly the installed runtime and sky-agents registrations");
  assert.equal(Object.keys(config.agents ?? {}).length, 13, "Expected all 13 installed agent policies");
  await writeFile(join(configDir, configName), configBytes);
  evidence.digests.config = digest(configBytes);
  evidence.source = installed ?? join(repo, "targets/opencode/resources");
  evidence.digests.manifest = digest(await readFile(join(repo, "targets/opencode/resources/manifest.json")));
  const resources = [
    ["skynex/plugins/runtime/index.ts", "native/plugins/skynex-runtime.ts"],
    ["skynex/plugins/runtime/prompt.ts", "native/hooks/prompt.ts"],
    ...["core/catalog.ts", "core/index.ts", "core/profile-apply.ts", "core/profiles.ts", "core/roots.ts", "core/rpc.ts", "core/storage.ts", "index.ts", "package.json", "rpc.ts", "tui.tsx", "vendor/jsonc-parser/impl/edit.js", "vendor/jsonc-parser/impl/format.js", "vendor/jsonc-parser/impl/parser.js", "vendor/jsonc-parser/impl/scanner.js", "vendor/jsonc-parser/impl/string-intern.js", "vendor/jsonc-parser/LICENSE.md", "vendor/jsonc-parser/main.d.ts", "vendor/jsonc-parser/main.js"]
      .map((name) => [`skynex/plugins/sky-agents/${name}`, `native/plugins/sky-agents/${name}`]),
  ];
  for (const [relative, source] of resources) {
    const bytes = await regularFile(installed ? join(installed, relative) : join(evidence.source, source));
    evidence.digests[relative] = digest(bytes);
    await mkdir(dirname(join(configDir, relative)), { recursive: true });
    await writeFile(join(configDir, relative), bytes);
  }
  child = spawn(command, ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: project, env, stdio: ["ignore", "pipe", "pipe"],
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
  evidence.health = await request(base, "/api/health");
  assert.equal(evidence.health.healthy, true);
  assert.equal(evidence.health.pid, child.pid, "Refusing a server not owned by this probe");
  await request(base, "/api/plugin/await-activation", "POST");
  const plugins = await request(base, "/api/plugin");
  evidence.plugins = plugins;
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
    assert.deepEqual(new Set(localPlugins.map((plugin) => plugin.id)), new Set(["skynex.runtime", "skynex-sky-agents.server"]), "Unexpected local plugin activation");
   const rpcEnvelope = await rpcRequest(base, "skynex.sky-agents", "listProfiles", {});
    evidence.rpc = { registered: skyAgents[0].features.rpc === true, listProfiles: { called: true, result: rpcEnvelope.output } };
   assert.equal(evidence.rpc.registered, true, "Sky Agents RPC feature must be registered");
    assert.deepEqual(evidence.rpc.listProfiles.result, [], "Fresh isolated profile store must be empty");
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
   evidence.tuiImport = { covered: "static-limited", bareImports: false, packageExport: packageJson.exports["./tui"], reason: "Foreground server loads server exports only; no noninteractive CLI-plugin activation surface was established." };
  evidence.integrationVerified = true;
} catch (error) {
  evidence.error = error.message;
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
  await writeFile(join(root, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
}
