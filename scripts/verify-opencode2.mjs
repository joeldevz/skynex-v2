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
const configDir = join(project, ".opencode");
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
  await mkdir(join(env.XDG_CONFIG_HOME, "opencode"));
  // Disable builtins at lower precedence; project config re-enables only this local plugin.
  await writeFile(join(env.XDG_CONFIG_HOME, "opencode", "opencode.json"), JSON.stringify({ plugins: ["-*"] }));
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
    plugins: [{ package: "./skynex/plugins/runtime", options: { managedBy: "skynex" } }],
  }));
  const parseErrors = [];
  const config = parse(configBytes.toString(), parseErrors);
  assert.equal(parseErrors.length, 0, "Installed JSON/C must parse without errors");
  assert(Object.keys(config).every((key) => ["$schema", "plugins"].includes(key)), "Use a clean installer fixture config (schema/plugins only)");
  assert.equal(config.plugins?.length, 1, "Expected exactly the installed runtime registration");
  assert.equal(typeof config.plugins[0] === "string" ? config.plugins[0] : config.plugins[0].package,
    "./skynex/plugins/runtime");
  await writeFile(join(configDir, configName), configBytes);
  evidence.digests.config = digest(configBytes);
  evidence.source = installed ?? join(repo, "targets/opencode/resources");
  evidence.digests.manifest = digest(await readFile(join(repo, "targets/opencode/resources/manifest.json")));
  for (const [name, source] of [["index.ts", "native/plugins/skynex-runtime.ts"], ["prompt.ts", "native/hooks/prompt.ts"]]) {
    const relative = `skynex/plugins/runtime/${name}`;
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
  assert(plugins.data.every((plugin) => plugin.id === "skynex.runtime"), "Unexpected plugin activation");
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
