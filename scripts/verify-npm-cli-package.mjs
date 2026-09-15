import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const mode = args[0];
assert(["--contract", "--static-and-install", "--release", "--publish-dry-run"].includes(mode),
  "usage: verify-npm-cli-package.mjs --contract|--static-and-install|--release|--publish-dry-run [tarball]");
const repo = resolve(new URL("..", import.meta.url).pathname);
const packageRoot = join(repo, "packages/npm-cli");
const manifestPath = join(packageRoot, "package.json");
const lifecycle = ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const under = (root, path) => !relative(root, path).startsWith(`..${sep}`) && relative(root, path) !== "..";

function npmPackageOutput(parsed, packageName) {
  const npmError = parsed?.error ?? parsed?.data?.error ?? parsed?.data?.[0]?.error ?? (Array.isArray(parsed) ? parsed[0]?.error : undefined) ?? parsed?.[packageName]?.error;
  assert(!npmError, `${npmError?.code}: ${npmError?.summary}`);
  const output = Array.isArray(parsed) ? parsed[0] : parsed;
  const selected = output?.name ? output : output?.data?.name ? output.data : output?.data?.[0] ?? output?.[packageName] ?? output;
  assert(!selected?.error, `${selected?.error?.code}: ${selected?.error?.summary}`);
  assert.equal(selected?.name, packageName, "npm output must explicitly identify the selected package");
  assert.equal(typeof selected?.version, "string", "npm output must explicitly include a version");
  return selected;
}

function verifyNpmPackageOutputContract() {
  const packageName = "@skynex-ai/cli";
  const npmError = { error: { code: "E403", summary: "publication forbidden" } };
  const rejected = [
    ["top-level error", npmError],
    ["selected data error", { data: npmError }],
    ["selected array error", [npmError]],
    ["keyed nested error", { [packageName]: npmError }],
  ];
  const failures = rejected.flatMap(([label, value]) => {
    try { npmPackageOutput(value, packageName); return [label]; }
    catch (error) { assert.match(String(error), /E403|publication forbidden/, `${label} must preserve npm error evidence`); return []; }
  });
  assert.deepEqual(
    npmPackageOutput({ [packageName]: { name: packageName, version: "0.1.0" } }, packageName),
    { name: packageName, version: "0.1.0" },
    "npm 11 keyed success must be accepted",
  );
  return failures;
}

async function run(command, commandArgs, options = {}) {
  return await new Promise((resolveRun, reject) => {
    assert(Array.isArray(commandArgs), "command arguments must be an array");
    assert(options && !Array.isArray(options), "command options must be an object");
    const child = spawn(command, commandArgs, { shell: false, ...options });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (v) => { if (stdout.length < 1_000_000) stdout += v; });
    child.stderr?.on("data", (v) => { if (stderr.length < 1_000_000) stderr += v; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolveRun({ code, signal, stdout, stderr }));
  });
}
function npmInvocation(commandArgs) {
  const cli = process.env.NPM_CLI;
  assert(cli, "NPM_CLI must name the explicitly selected npm CLI module");
  assert(resolve(cli) === cli && cli.endsWith("/lib/node_modules/npm/bin/npm-cli.js"), "NPM_CLI must be an absolute installed npm CLI module path");
  return [process.execPath, [cli, ...commandArgs]];
}

async function readContract() {
  const stat = await lstat(manifestPath).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  assert(stat?.isFile() && !stat.isSymbolicLink(),
    "missing public package contract: packages/npm-cli/package.json must be a regular file");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(typeof manifest.version, "string");
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "release version must be a stable semver");
  assert.deepEqual({ name: manifest.name, version: manifest.version, description: manifest.description,
    license: manifest.license, type: manifest.type, bin: manifest.bin, files: manifest.files,
    engines: manifest.engines, publishConfig: manifest.publishConfig }, {
    name: "@skynex-ai/cli", version: manifest.version,
    description: "Install and manage Skynex resources for OpenCode 2", license: "Apache-2.0",
    type: "module", bin: { skynex: "dist/cli.js" },
    files: ["dist/cli.js", "dist/resources", "README.md", "LICENSE"], engines: { node: ">=24" },
    publishConfig: { access: "public", registry: "https://registry.npmjs.org/" },
  });
  for (const key of ["private", "repository", "bugs", "homepage"]) assert(!Object.hasOwn(manifest, key), `manifest must omit ${key}`);
  for (const key of lifecycle) assert(!Object.hasOwn(manifest.scripts ?? {}, key), `manifest must omit lifecycle script ${key}`);
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      assert(!name.startsWith("@skynex-internal/"), `${section} exposes ${name}`);
      assert(!(typeof range === "string" && range.startsWith("workspace:")), `${section}.${name} uses workspace:`);
    }
  return manifest;
}

async function resourceAllowlist() {
  const root = join(repo, "targets/opencode/resources");
  const catalog = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const allowed = new Set(["manifest.json", "provenance.json", "templates/.gitkeep"]);
  for (const item of catalog.resources) allowed.add(item.sourcePath);
  const leaves = [];
  async function walk(dir, prefix = "") {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await lstat(join(dir, entry.name));
      assert(!stat.isSymbolicLink(), `resource symlink forbidden: ${rel}`);
      if (stat.isDirectory()) await walk(join(dir, entry.name), rel);
      else { assert(stat.isFile(), `non-regular resource forbidden: ${rel}`); leaves.push(rel); }
    }
  }
  await walk(root);
  assert.deepEqual(leaves.sort(), [...allowed].sort(), "source resource leaves must equal manifest-derived allowlist");
  return allowed;
}

function scan(path, bytes) {
  const text = bytes.toString("utf8");
  const rules = [...(path.includes("dist/resources/") ? [] : [/@skynex-internal\//]), /workspace:/, /(?:^|\W)\/home\//, /\/Users\//,
    /[A-Za-z]:\\(?:Users|Documents and Settings|ProgramData)\\/i, /\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9$._-]+\\/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /(?:npm|github|openai|anthropic)[_-]?(?:token|key)\s*[=:]/i];
  for (const rule of rules) assert(!rule.test(text), `forbidden content rule ${rule} in ${path}`);
}

async function verifyBuild(allowed) {
  const dist = join(packageRoot, "dist");
  const cli = join(dist, "cli.js");
  const top = (await readdir(dist)).sort();
  assert.deepEqual(top, ["cli.js", "resources"]);
  const stat = await lstat(cli); assert(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.mode & 0o777, 0o755);
  const bytes = await readFile(cli); assert(bytes.toString("utf8").startsWith("#!/usr/bin/env node\n"));
  assert.equal(bytes.toString("utf8").split("#!/usr/bin/env node").length - 1, 1); scan("dist/cli.js", bytes);
  assert(!/sourceMappingURL|\.js\.map|\.d\.ts|\.tsbuildinfo/.test(bytes.toString("utf8")), "build leaks maps/declarations");
  const built = [], directories = [];
  async function walk(dir, prefix = "") { for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name; const s = await lstat(join(dir, e.name));
    assert(!s.isSymbolicLink()); if (s.isDirectory()) { assert.equal(s.mode & 0o777, 0o755); directories.push(rel); await walk(join(dir, e.name), rel); } else { assert(s.isFile()); assert.equal(s.mode & 0o777, 0o644); built.push(rel); }
  }}
  await walk(join(dist, "resources")); assert.deepEqual(built.sort(), [...allowed].sort());
}

async function verifyCleanWorkspaceBuildContract() {
  const root = await mkdtemp(join(tmpdir(), "skynex-clean-build-contract-"));
  try {
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "packages/npm-cli/scripts"), { recursive: true });
    await copyFile(join(packageRoot, "scripts/build-distribution.mjs"), join(workspace, "packages/npm-cli/scripts/build-distribution.mjs"));
    await copyFile(join(packageRoot, "package.json"), join(workspace, "packages/npm-cli/package.json"));
    await mkdir(join(workspace, "apps/cli/src"), { recursive: true });
    await copyFile(join(repo, "apps/cli/src/index.ts"), join(workspace, "apps/cli/src/index.ts"));
    for (const rel of ["packages/npm-cli/src", "packages/catalog/src", "packages/compiler/src", "packages/application/src", "packages/domain/src", "packages/installer/src", "packages/sky-agents/src", "targets/opencode/src", "targets/opencode/resources"]) {
      await import("node:fs/promises").then(({ cp }) => cp(join(repo, rel), join(workspace, rel), { recursive: true }));
    }
    const esbuildPackage = join(repo, "node_modules/.pnpm/esbuild@0.25.9/node_modules/esbuild");
    await mkdir(join(workspace, "node_modules"), { recursive: true });
    await import("node:fs/promises").then(({ symlink }) => symlink(esbuildPackage, join(workspace, "node_modules/esbuild"), "dir"));
    const result = await run(process.execPath, [join(workspace, "packages/npm-cli/scripts/build-distribution.mjs")], {
      cwd: workspace,
      env: { PATH: process.env.PATH, HOME: join(root, "home") },
    });
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function parseTar(tgz) {
  const tar = gunzipSync(tgz); const entries = []; const names = new Set(); let zeroBlocks = 0, offset = 0;
  const octal = (bytes, label) => { const raw = bytes.toString("ascii").replace(/\0.*$/, "").trim(); assert(/^[0-7]+$/.test(raw), `invalid tar octal ${label}`); const value = Number.parseInt(raw, 8); assert(Number.isSafeInteger(value)); return value; };
  for (; offset + 512 <= tar.length;) {
    const h = tar.subarray(offset, offset + 512); if (h.every((b) => b === 0)) { zeroBlocks++; offset += 512; if (zeroBlocks === 2) break; continue; }
    assert.equal(zeroBlocks, 0, "nonzero tar data after zero block");
    const expected = octal(h.subarray(148, 156), "checksum"); const copy = Buffer.from(h); copy.fill(0x20, 148, 156);
    assert.equal(copy.reduce((sum, byte) => sum + byte, 0), expected, "invalid tar header checksum");
    const field = (a, b) => h.subarray(a, b).toString("utf8").replace(/\0.*$/, "");
    const name = `${field(345, 500) ? `${field(345, 500)}/` : ""}${field(0, 100)}`;
    assert(name && !name.includes("\0") && !name.includes("\\") && !name.startsWith("/"), `unsafe tar path: ${name}`);
    const parts = name.split("/"); assert(parts.every((p) => p && p !== "." && p !== ".."), `unsafe tar segment: ${name}`);
    assert(name.startsWith("package/")); assert(!names.has(name), `duplicate tar entry: ${name}`); names.add(name);
    const type = field(156, 157) || "0"; assert(["0", "5"].includes(type), `forbidden tar type ${type} at ${name}`);
    assert(!["1", "2", "3", "4", "6", "x", "g", "L", "K"].includes(type), `link/device/PAX forbidden: ${name}`);
    const size = octal(h.subarray(124, 136), "size"), mode = octal(h.subarray(100, 108), "mode") & 0o777;
    const end = offset + 512 + size, paddedEnd = offset + 512 + Math.ceil(size / 512) * 512; assert(end <= tar.length && paddedEnd <= tar.length, "truncated tar payload/padding");
    assert(tar.subarray(end, paddedEnd).every((b) => b === 0), "nonzero tar padding");
    const content = tar.subarray(offset + 512, end);
    entries.push({ name, type: type === "5" ? "directory" : "file", mode, linkTarget: "", content }); offset = paddedEnd;
  }
  assert.equal(zeroBlocks, 2, "tar must end with exactly two zero blocks"); assert(tar.subarray(offset).every((b) => b === 0), "nonzero trailing tar data");
  return entries;
}

function expectedDirectories(files) { const result = new Set(); for (const file of files) { let path = dirname(file); while (path !== ".") { result.add(`${path}/`); path = dirname(path); } } return result; }
function assertManifestContract(packed, expected) {
  for (const key of ["name", "version", "description", "license", "type", "bin", "files", "engines", "publishConfig"])
    assert.deepEqual(packed[key], expected[key], `packed manifest ${key} drifted`);
  for (const key of ["private", "repository", "bugs", "homepage"]) assert(!Object.hasOwn(packed, key), `packed manifest must omit ${key}`);
  for (const key of lifecycle) assert(!Object.hasOwn(packed.scripts ?? {}, key));
  const dependencySections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  for (const section of dependencySections) { assert.deepEqual(packed[section] ?? {}, expected[section] ?? {}, `packed ${section} drifted`); for (const [name, range] of Object.entries(packed[section] ?? {})) assert(!name.startsWith("@skynex-internal/") && !String(range).startsWith("workspace:")); }
}
function verifyArchive(entries, allowed, expectedManifest) {
  const exactFiles = new Set(["package/package.json", "package/README.md", "package/LICENSE", "package/dist/cli.js",
    ...[...allowed].map((p) => `package/dist/resources/${p}`)]);
  const actualFiles = new Set(entries.filter((e) => e.type === "file").map((e) => e.name));
  assert.deepEqual([...actualFiles].sort(), [...exactFiles].sort(), "tar regular files violate exact allowlist");
  const actualDirectories = new Set(entries.filter((e) => e.type === "directory").map((e) => e.name.endsWith("/") ? e.name : `${e.name}/`));
  const expectedDirs = expectedDirectories(exactFiles);
  assert([...actualDirectories].every((path) => expectedDirs.has(path)), "tar directory entries violate exact derived set");
  for (const e of entries) { assert.equal(e.mode, e.name === "package/dist/cli.js" ? 0o755 : e.type === "directory" ? 0o755 : 0o644);
    if (e.type === "file") { assert(!/(^|\/)(?:tests?|logs?|\.skynex)(\/|$)|\.map$|\.tsbuildinfo$|\.env|\.npmrc|inventory/i.test(e.name)); scan(e.name, e.content); }
  }
  const packed = JSON.parse(entries.find((e) => e.name === "package/package.json").content.toString("utf8"));
  assertManifestContract(packed, expectedManifest);
  const cli = entries.find((e) => e.name === "package/dist/cli.js"); assert(cli.content.toString("utf8").startsWith("#!/usr/bin/env node\n"));
  const records = entries.map((e) => `${e.name}\0${e.type}\0${e.mode.toString(8)}\0${e.linkTarget}\0${sha(e.content)}`).sort();
  return { records, normalizedSha256: sha(Buffer.from(records.join("\n"))) };
}

async function isolatedEnv(root) {
  const env = { PATH: process.env.PATH, HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"),
    TMPDIR: join(root, "tmp"), npm_config_cache: join(root, "npm-cache"), npm_config_userconfig: join(root, "empty-npmrc"),
    PNPM_HOME: join(root, "pnpm-home"), SOURCE_DATE_EPOCH: "0" };
  await Promise.all(Object.values(env).filter((v) => v?.startsWith(root)).map((v) => import("node:fs/promises").then(({ mkdir }) => mkdir(dirname(v), { recursive: true }))));
  return env;
}

async function packTwice(root, env, allowed, manifest) {
  const records = [];
  for (const n of [1, 2]) { const out = join(root, `pack-${n}`); await import("node:fs/promises").then(({ mkdir }) => mkdir(out, { recursive: true }));
    const result = await run("npm", ["pack", packageRoot, "--pack-destination", out, "--ignore-scripts", "--json"], { cwd: root, env }); assert.equal(result.code, 0, result.stderr);
    const files = await readdir(out); assert.equal(files.filter((x) => x.endsWith(".tgz")).length, 1);
    const path = join(out, files[0]), bytes = await readFile(path); records.push({ path, tarSha256: sha(bytes), normalized: verifyArchive(parseTar(bytes), allowed, manifest) });
  }
  assert.deepEqual(records[0].normalized, records[1].normalized, "normalized packs differ"); return records[0];
}

async function verifyInstall(tarball, root, env, manifest) {
  const prefix = join(root, "prefix"), project = join(root, "project"), state = join(root, "cli-state");
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([prefix, project, state].map((p) => mkdir(p, { recursive: true }))));
  const install = await run("npm", ["install", "--global", "--prefix", prefix, "--cache", env.npm_config_cache,
    "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: project, env }); assert.equal(install.code, 0, install.stderr);
  const bin = join(prefix, "bin", "skynex"), binStat = await lstat(bin); assert(binStat.isSymbolicLink());
  const binTarget = await realpath(bin); assert(under(prefix, binTarget)); const targetStat = await lstat(binTarget); assert.equal(targetStat.mode & 0o777, 0o755); assert((await readFile(binTarget, "utf8")).startsWith("#!/usr/bin/env node\n"));
  const commandEnv = { ...env, PATH: `${join(prefix, "bin")}:${env.PATH}` };
  for (const commandArgs of [["--version"], ["--help"]]) {
    const result = await run(bin, commandArgs, { cwd: project, env: commandEnv }); assert.equal(result.code, 0, result.stderr);
    if (commandArgs[0] === "--version") assert.equal(result.stdout.trim(), manifest.version);
    else assert.match(result.stdout, /install.*update.*uninstall.*doctor/is);
  }
  const doctor = await run(bin, ["doctor", "--project", project, "--state-dir", state, "--json"], { cwd: project, env: commandEnv }); assert.equal(doctor.code, 0, doctor.stderr);
  assert(under(root, project) && under(root, state)); const doctorJson = JSON.parse(doctor.stdout.trim().split("\n").at(-1).replace(/^\x1b\[[0-9;?]*[A-Za-z]/, ""));
  const inspectPaths = (value) => { if (Array.isArray(value)) return value.forEach(inspectPaths); if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { if (typeof item === "string" && /path|root|dir|file/i.test(key) && resolve(item) === item) assert(under(root, resolve(item)), `doctor path escaped isolation: ${key}`); else inspectPaths(item); } };
  inspectPaths(doctorJson);
  const digestTree = async (path) => { const stat = await lstat(path).catch((e) => e.code === "ENOENT" ? null : Promise.reject(e)); if (!stat) return "absent"; if (stat.isSymbolicLink()) return `link:${await readlink(path)}`; if (stat.isFile()) return `file:${sha(await readFile(path))}`; const rows = []; for (const name of (await readdir(path)).sort()) rows.push([name, await digestTree(join(path, name))]); return sha(Buffer.from(JSON.stringify(rows))); };
  const outside = join(root, "outside-sentinel"); await writeFile(outside, "unchanged"); const beforeOutside = await digestTree(outside);
  for (const flow of [["install", "--project", project, "--state-dir", state, "--components", "configuration,agents,skills", "--yes"],
    ["update", "--project", project, "--state-dir", state, "--dry-run"], ["uninstall", "--project", project, "--state-dir", state, "--dry-run", "--yes"]]) {
    const before = flow.includes("--dry-run") ? await digestTree(project) : null; const result = await run(bin, flow, { cwd: project, env: commandEnv }); assert.equal(result.code, 0, result.stderr); if (before) assert.equal(await digestTree(project), before, `${flow[0]} --dry-run mutated project`);
  }
  assert.notEqual(await digestTree(join(project, ".opencode")), "absent", "project install created no expected resources");
  const globalState = join(root, "global-state"); const globalFlow = await run(bin, ["install", "--global", "--state-dir", globalState,
    "--components", "configuration,agents,skills,plugins", "--yes", "--allow-executable-plugins"], { cwd: project, env: commandEnv }); assert.equal(globalFlow.code, 0, globalFlow.stderr);
  assert.notEqual(await digestTree(join(env.XDG_CONFIG_HOME, "opencode")), "absent", "global install created no expected resources"); assert.equal(await digestTree(outside), beforeOutside);
  const installedPackage = join(prefix, "lib/node_modules/@skynex-ai/cli"); const packedFiles = new Set(parseTar(await readFile(tarball)).filter((e) => e.type === "file").map((e) => e.name.replace(/^package\//, "")));
  async function auditInstalled(dir, rel = "") { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name), child = rel ? `${rel}/${entry.name}` : entry.name; const stat = await lstat(path); if (stat.isSymbolicLink()) assert(under(prefix, await realpath(path)), `installed symlink escaped: ${child}`); else if (stat.isDirectory()) await auditInstalled(path, child); else { assert(stat.isFile()); if (!child.startsWith("node_modules/")) assert(packedFiles.has(child), `unexpected installed package file: ${child}`); if (/\.m?js$/.test(child)) assert(!/@skynex-internal\/|workspace:/.test(await readFile(path, "utf8")), `unresolved internal import: ${child}`); } } }
  await auditInstalled(installedPackage);
  const ls = await run("npm", ["ls", "--global", "--prefix", prefix, "--all", "--json"], { cwd: project, env }); assert.equal(ls.code, 0, ls.stderr);
  assert(!/@skynex-internal|workspace:/.test(ls.stdout)); return { installedConfigDir: join(env.XDG_CONFIG_HOME, "opencode"), env, project };
}

async function verifyRuntime(installed, root) {
  const command = process.env.OPENCODE2; assert(command, "release mode requires OPENCODE2"); await access(command, constants.X_OK);
  const canonical = await realpath(installed.installedConfigDir); assert(under(root, canonical), "installed OpenCode config escaped isolation root");
  const verifier = join(packageRoot, "scripts/verify-installed-opencode2.mjs"); const stat = await lstat(verifier);
  assert(stat.isFile() && !stat.isSymbolicLink(), "installed runtime verifier contract missing");
  const result = await run(process.execPath, [verifier, "--command", command, "--installed-config-dir", canonical, "--root", root],
    { cwd: installed.project, env: installed.env }); assert.equal(result.code, 0, result.stderr);
  const evidence = JSON.parse(result.stdout); assert.equal(evidence.integrationVerified, true); assert.equal(evidence.ownedProcessExited, true);
}

async function verifyPublishDryRun() {
  const evidencePath = args[1]; assert(evidencePath, "--publish-dry-run requires full-verifier evidence JSON");
  const exportBase = await realpath("/tmp/opencode"), evidenceReal = await realpath(resolve(evidencePath)); assert(under(exportBase, evidenceReal));
  const evidenceStat = await lstat(resolve(evidencePath)); assert(evidenceStat.isFile() && !evidenceStat.isSymbolicLink()); const exportRoot = dirname(evidenceReal);
  const rootStat = await lstat(exportRoot); assert(rootStat.isDirectory() && !rootStat.isSymbolicLink() && basename(exportRoot).startsWith("skynex-npm-audit-"));
  const markerPath = join(exportRoot, ".skynex-owned-audit"), markerStat = await lstat(markerPath); assert(markerStat.isFile() && !markerStat.isSymbolicLink());
  const marker = JSON.parse(await readFile(markerPath, "utf8")); assert.deepEqual(marker, { schema: "skynex-npm-audit-owner-v1", evidence: "audit-evidence.json" });
  const evidence = JSON.parse(await readFile(evidenceReal, "utf8")); assert.equal(evidence.schema, "skynex-npm-audit-v1"); assert.equal(await realpath(evidence.root), exportRoot);
  const tarballStat = await lstat(evidence.tarball); assert(tarballStat.isFile() && !tarballStat.isSymbolicLink()); const tarball = await realpath(evidence.tarball); assert(under(exportRoot, tarball));
  const bytes = await readFile(tarball); assert.equal(sha(bytes), evidence.tarSha256); const allowed = await resourceAllowlist(); const audited = verifyArchive(parseTar(bytes), allowed, await readContract()); assert.equal(audited.normalizedSha256, evidence.normalizedSha256); assert.deepEqual(audited.records, evidence.records);
  const root = await mkdtemp(join(tmpdir(), "skynex-publish-dry-run-")); try { const env = await isolatedEnv(root);
    const localName = `skynex-ai-cli-${manifest.version}.tgz`, localTarball = join(root, localName), localSpec = `./${localName}`;
    await copyFile(tarball, localTarball); assert.equal(sha(await readFile(localTarball)), evidence.tarSha256, "dry-run local tarball copy drifted");
    const argv = ["publish", localSpec, "--dry-run", "--json", "--registry=https://registry.npmjs.org/", "--access=public"];
    assert.deepEqual(argv, ["publish", `./skynex-ai-cli-${manifest.version}.tgz`, "--dry-run", "--json", "--registry=https://registry.npmjs.org/", "--access=public"]);
    assert(argv.includes("--dry-run"), "publish execution is forbidden without --dry-run");
    assert((await lstat(localTarball)).isFile(), "local publish tarball must exist at spawn");
    assert(!/^(?:git|github):|github\.com/i.test(localSpec), "git/GitHub publish spec forbidden");
    const [npmCommand, npmArgs] = npmInvocation(argv);
    const [versionCommand, versionArgs] = npmInvocation(["--version"]); const version = await run(versionCommand, versionArgs, { cwd: root, env }); assert.equal(version.code, 0, version.stderr); assert.match(version.stdout.trim(), /^11\./, "publish dry-run requires npm 11");
    const result = await run(npmCommand, npmArgs, { cwd: root, env }); assert.equal(result.code, 0, result.stderr);
    const parsedOutput = JSON.parse(result.stdout); const published = npmPackageOutput(parsedOutput, "@skynex-ai/cli");
    assert.equal(published.name, "@skynex-ai/cli"); assert.equal(published.version, manifest.version); if (published.filename) assert.equal(basename(published.filename), basename(tarball));
    const [packCommand, packArgs] = npmInvocation(["pack", packageRoot, "--dry-run", "--ignore-scripts", "--json"]); const dryPack = await run(packCommand, packArgs, { cwd: root, env }); assert.equal(dryPack.code, 0, dryPack.stderr); const packJson = JSON.parse(dryPack.stdout); const listed = (Array.isArray(packJson) ? packJson[0] : packJson).files?.map((x) => `package/${x.path}`).sort(); assert.deepEqual(listed, audited.records.filter((x) => !x.includes("\0directory\0")).map((x) => x.split("\0")[0]).sort());
  } finally { await rm(root, { recursive: true, force: true }); if (process.env.SKYNEX_PRESERVE_AUDIT !== "1") await rm(exportRoot, { recursive: true, force: true }); }
}

async function exportAudit(packed) {
  const base = "/tmp/opencode"; await mkdir(base, { recursive: true, mode: 0o755 }); const staging = await mkdtemp(join(base, ".skynex-npm-audit-staging-"));
  const final = join(base, `skynex-npm-audit-${basename(staging).slice(".skynex-npm-audit-staging-".length)}`);
  try { const tarball = join(staging, basename(packed.path)); await copyFile(packed.path, tarball);
    await writeFile(join(staging, ".skynex-owned-audit"), JSON.stringify({ schema: "skynex-npm-audit-owner-v1", evidence: "audit-evidence.json" }), { flag: "wx", mode: 0o600 });
    await writeFile(join(staging, "audit-evidence.json"), JSON.stringify({ schema: "skynex-npm-audit-v1", root: final, tarball: join(final, basename(tarball)), tarSha256: packed.tarSha256, normalizedSha256: packed.normalized.normalizedSha256, records: packed.normalized.records }), { flag: "wx", mode: 0o600 });
    await rename(staging, final); return join(final, "audit-evidence.json");
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

const manifest = await readContract();
if (mode === "--contract") { assert(manifest); const npmOutputFailures = verifyNpmPackageOutputContract(); await verifyCleanWorkspaceBuildContract(); assert.deepEqual(npmOutputFailures, [], `npm error-bearing selected outputs were accepted: ${npmOutputFailures.join(", ")}`); console.log("PASS full npm CLI verifier contract entrypoint"); }
else if (mode === "--publish-dry-run") await verifyPublishDryRun();
else {
  const root = await mkdtemp(join(tmpdir(), "skynex-package-")); let evidencePath; try { const allowed = await resourceAllowlist(); await verifyBuild(allowed);
    const env = await isolatedEnv(root); const packed = await packTwice(root, env, allowed, manifest); const installed = await verifyInstall(packed.path, root, env, manifest);
    if (mode === "--release") await verifyRuntime(installed, root);
    evidencePath = await exportAudit(packed);
  } finally { await rm(root, { recursive: true, force: true }); }
  console.log(JSON.stringify({ ok: true, evidencePath, staleArtifactRequiresCleanupIfDryRunSkipped: true }));
}
