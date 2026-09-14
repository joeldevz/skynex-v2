import { mkdir, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "../targets/opencode/node_modules/jsonc-parser/lib/umd/main.js";
import { assert, fresh, readFile, join, sha, snapshot, exists } from "./verify-installer-support.mjs";

const cli = resolve("apps/cli/dist/index.js");
const nonPluginComponents = ["configuration", "agents", "skills"];
function configValue(text) {
  const errors = [];
  const value = parse(text, errors);
  assert.deepEqual(errors, []);
  return value;
}
async function setup(name, formats = []) {
  const root = await fresh(`cli-${name}`);
  const project = join(root, "project");
  const target = join(project, ".opencode");
  const state = join(root, "state");
  const env = { PATH: process.env.PATH, HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg-config"), XDG_DATA_HOME: join(root, "xdg-data"),
    XDG_STATE_HOME: join(root, "xdg-state"), XDG_CACHE_HOME: join(root, "xdg-cache"),
    TMPDIR: join(root, "tmp"), TERM: "dumb", CI: "1" };
  for (const path of [target, env.HOME, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME, env.TMPDIR]) {
    await mkdir(path, { recursive: true });
  }
  for (const format of formats) {
    await writeFile(join(target, `opencode.${format}`), format === "jsonc"
      ? '{\n  // original root comment\n  "unrelated": "before"\n}\n'
      : '{"unrelated":"before"}\n');
  }
  function run(args, expectedError) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: project, env, encoding: "utf8", timeout: 15000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.signal, null, `CLI terminated: ${result.signal}`);
    const output = result.stdout + result.stderr;
    if (expectedError) {
      assert.notEqual(result.status, 0, output);
      assert(output.includes(expectedError), output);
    } else assert.equal(result.status, 0, output);
    return result;
  }
  const args = (command, explicit) => [command, "--project", project, "--state-dir", state,
    "--yes", ...(command === "install" || command === "update" ? ["--components", nonPluginComponents.join(",")] : []),
    ...(explicit ? ["--config", explicit] : [])];
  return { root, project, target, state, env, run, args, lockPath: join(state, "lock.json") };
}
async function runInteractiveSteps(f, steps) {
  const session = `skynex-cli-${process.pid}-${Date.now()}`;
  const args = [process.execPath, cli, "install", "--project", f.project, "--state-dir", f.state, "--components", nonPluginComponents.join(",")];
  const command = ["env", "-u", "CI", ...Object.entries(f.env).filter(([key]) => key !== "CI").map(([key, value]) => `${key}=${value}`), ...args]
    .map((item) => `'${item.replaceAll("'", "'\\''")}'`).join(" ");
  const started = spawnSync("tmux", ["new-session", "-d", "-s", session, "-x", "160", "-y", "40", command], { encoding: "utf8" });
  assert.equal(started.status, 0, started.stderr);
  let output = "";
  try {
    for (const { prompt, keys } of steps) {
      let found = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const captured = spawnSync("tmux", ["capture-pane", "-pt", session, "-S", "-200"], { encoding: "utf8" });
        output = captured.stdout;
        if (output.includes(prompt)) { found = true; break; }
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      assert(found, `interactive prompt missing: ${prompt}\n${output}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      const captured = spawnSync("tmux", ["capture-pane", "-pt", session, "-S", "-200"], { encoding: "utf8" });
      output = captured.stdout;
      const sent = spawnSync("tmux", ["send-keys", "-t", session, ...keys], { encoding: "utf8" });
      assert.equal(sent.status, 0, sent.stderr);
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (spawnSync("tmux", ["has-session", "-t", session]).status !== 0) return { status: 0, signal: null, output };
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error(`interactive CLI did not exit\n${output}`);
  } finally {
    spawnSync("tmux", ["kill-session", "-t", session]);
  }
}
export async function verify(test) {
  for (const [name, formats, explicit] of [
    ["default-json", ["json"], undefined], ["default-jsonc", ["jsonc"], undefined],
    ["both-explicit-json", ["json", "jsonc"], "json"], ["both-explicit-jsonc", ["json", "jsonc"], "jsonc"],
  ]) {
    await test(`cli-${name}-uninstall-preservation-whole-restore-reverse`, async () => {
      const f = await setup(name, formats);
      const selected = explicit ?? formats[0];
      const selectedPath = join(f.target, `opencode.${selected}`);
      const nonselected = new Map();
      for (const format of formats.filter((item) => item !== selected)) {
        nonselected.set(`opencode.${format}`, await readFile(join(f.target, `opencode.${format}`)));
      }
      f.run(f.args("install", explicit));
      const installedText = await readFile(selectedPath, "utf8");
      assert.equal(configValue(installedText).plugins, undefined);
      if (selected === "jsonc") assert(installedText.includes("original root comment"));
      // These edits happen AFTER installation, so uninstall cannot simply restore its backup.
      const external = { package: "external-plugin", options: { nested: [1, 2], enabled: true } };
      let edited = installedText.replace("{", '{\n  "addedAfterInstall": { "keep": [true, "value", 3] },');
      edited = edited.replace('"before"', '"after"');
      edited = edited.replace(/}\s*$/, `${selected === "jsonc" ? ",\n // inside-before-external\n" : ","}"plugins":[${JSON.stringify(external)}${selected === "jsonc" ? "\n /* inside-after-external */\n" : ""}]\n}`);
      await writeFile(selectedPath, edited);
      const expectedConfig = configValue(edited);
      assert.equal(expectedConfig.unrelated, "after");
      assert.deepEqual(expectedConfig.addedAfterInstall, { keep: [true, "value", 3] });
      assert.deepEqual(expectedConfig.plugins, [external]);
      // Uninstall owns only the generated mode/permissions leaves. Preserve any
      // unrelated agent properties, but remove generated-only empty entries.
      if (expectedConfig.agents) {
        for (const [id, agent] of Object.entries(expectedConfig.agents)) {
          delete agent.mode;
          delete agent.permissions;
          if (Object.keys(agent).length === 0) delete expectedConfig.agents[id];
        }
      }
      const beforeFiles = await snapshot(f.target, false);
      const beforeLock = await readFile(f.lockPath);
      const ownedPaths = JSON.parse(beforeLock).resources.map((item) => item.relativePath);
      f.run(f.args("uninstall", explicit));

      // Assert immediately, BEFORE either restore operation can conceal uninstall loss.
      assert(await exists(selectedPath));
      const afterText = await readFile(selectedPath, "utf8");
      assert.deepEqual(configValue(afterText), expectedConfig);
      assert.deepEqual(configValue(afterText).plugins, [external]);
      if (selected === "jsonc") {
        for (const comment of ["// original root comment", "// inside-before-external", "/* inside-after-external */"]) {
          assert(afterText.includes(comment), `lost comment: ${comment}`);
        }
      }
      for (const [path, bytes] of nonselected) assert.deepEqual(await readFile(join(f.target, path)), bytes);
      for (const path of ownedPaths.filter((path) => path !== `opencode.${selected}`)) {
        assert.equal(await exists(join(f.target, path)), false, `managed file remains: ${path}`);
      }
      assert.deepEqual(JSON.parse(await readFile(f.lockPath)).resources, []);
      const postFiles = await snapshot(f.target, false);
      const postLock = await readFile(f.lockPath);
      assert.deepEqual(postFiles.map(([path]) => path).sort(), formats.map((format) => `opencode.${format}`).sort());
      const backupsBeforeRestore = await readdir(join(f.state, "backups"));
      const uninstallIds = backupsBeforeRestore.filter((id) => id.startsWith("uninstall-"));
      assert.equal(uninstallIds.length, 1);
      const restoreArgs = (id) => ["backup", "restore", id, ...f.args("unused", explicit).slice(1)];
      f.run(restoreArgs(uninstallIds[0]));
      assert.deepEqual(await snapshot(f.target, false), beforeFiles);
      assert.deepEqual(await readFile(f.lockPath), beforeLock);
      const reverseIds = (await readdir(join(f.state, "backups"))).filter((id) => !backupsBeforeRestore.includes(id));
      assert.equal(reverseIds.length, 1);
      f.run(restoreArgs(reverseIds[0]));
      assert.deepEqual(await snapshot(f.target, false), postFiles);
      assert.deepEqual(await readFile(f.lockPath), postLock);
    });
  }
  await test("cli-ambiguous-both-configs-full-fixture-no-mutation", async () => {
    const f = await setup("ambiguous", ["json", "jsonc"]);
    const before = await snapshot(f.root);
    f.run(f.args("install"), "Both opencode.json and opencode.jsonc exist; pass --config json or --config jsonc");
    assert.deepEqual(await snapshot(f.root), before);
  });
  await test("cli-project-components-plugins-rejected-full-fixture-no-mutation", async () => {
    const f = await setup("project-plugins-rejected", ["jsonc"]);
    const before = await snapshot(f.root);
    const args = f.args("install");
    args.splice(args.indexOf("--components"), 2, "--components", "plugins");
    f.run(args, "Sky Agents plugins can only be installed globally");
    assert.deepEqual(await snapshot(f.root), before);
  });
  await test("cli-project-default-yes-installs-nonempty-nonplugin-components", async () => {
    const f = await setup("project-default", ["jsonc"]);
    f.run(["install", "--project", f.project, "--state-dir", f.state, "--yes"]);
    const lock = JSON.parse(await readFile(f.lockPath));
    assert.deepEqual(lock.installedComponents, ["configuration", "agents", "skills"]);
    assert.equal(lock.resources.some((resource) => resource.kind === "command" || resource.kind === "native"), false);
    assert.equal(configValue(await readFile(join(f.target, "opencode.jsonc"), "utf8")).plugins, undefined);
  });
  await test("cli-yes-lists-all-unmanaged-collisions-and-makes-no-mutation", async () => {
    const f = await setup("yes-unmanaged-collisions");
    const collisions = ["agents/thalam.md", "skills/diagnose/SKILL.md"];
    for (const path of collisions) { await mkdir(resolve(f.target, path, ".."), { recursive: true }); await writeFile(join(f.target, path), `local-${path}`); }
    const before = await snapshot(f.root);
    const result = f.run(f.args("install"), "Unmanaged existing resource collisions require an interactive decision");
    const output = result.stdout + result.stderr;
    for (const path of collisions) assert(output.includes(path), output);
    assert.deepEqual(await snapshot(f.root), before);
  });
  await test("cli-interactive-prompts-each-collision-default-preserve-before-mutation", async () => {
    const f = await setup("interactive-default-preserve");
    const collisions = ["agents/thalam.md", "skills/diagnose/SKILL.md"];
    for (const path of collisions) { await mkdir(resolve(f.target, path, ".."), { recursive: true }); await writeFile(join(f.target, path), `local-${path}`); }
    const result = await runInteractiveSteps(f, [
      { prompt: collisions[0], keys: ["Enter"] },
      { prompt: collisions[1], keys: ["Enter"] },
      { prompt: "Ready to make OpenCode yours?", keys: ["Enter"] },
    ]);
    assert.equal(result.status, 0, result.output);
    assert(result.output.indexOf(collisions[0]) < result.output.indexOf(collisions[1]), result.output);
    for (const path of collisions) assert.equal(await readFile(join(f.target, path), "utf8"), `local-${path}`);
    const lock = JSON.parse(await readFile(f.lockPath, "utf8"));
    for (const path of collisions) assert.equal(lock.resources.some((item) => item.relativePath === path), false);
  });
  await test("cli-interactive-cancel-after-prior-collision-answer-has-zero-mutation", async () => {
    const f = await setup("interactive-cancel");
    const collisions = ["agents/thalam.md", "skills/diagnose/SKILL.md"];
    for (const path of collisions) { await mkdir(resolve(f.target, path, ".."), { recursive: true }); await writeFile(join(f.target, path), `local-${path}`); }
    const before = await snapshot(f.root);
    const result = await runInteractiveSteps(f, [
      { prompt: collisions[0], keys: ["Down", "Enter"] },
      { prompt: collisions[1], keys: ["C-c"] },
    ]);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(await snapshot(f.root), before);
  });
  await test("cli-global-default-yes-includes-both-plugins-and-no-commands", async () => {
    const f = await setup("global-default");
    f.run(["install", "--global", "--state-dir", f.state, "--yes", "--allow-executable-plugins"]);
    const lock = JSON.parse(await readFile(f.lockPath));
    assert.deepEqual(lock.installedComponents, ["configuration", "agents", "skills", "plugins"]);
    assert.equal(lock.resources.some((resource) => resource.kind === "command"), false);
    const configResource = lock.resources.find((resource) => resource.id === "opencode-config");
    assert(configResource);
    const plugins = configValue(await readFile(join(f.root, "xdg-config", "opencode", configResource.relativePath), "utf8")).plugins;
    assert.deepEqual(plugins.map((plugin) => plugin.package), ["./skynex/plugins/runtime", "./skynex/plugins/sky-agents"]);
  });
  const invalid = [
    ["unknown-flag", ["--not-a-real-flag"], "Unknown flag: --not-a-real-flag"],
    ...["--project", "--state-dir", "--config"].flatMap((flag) => [
      [`${flag}-missing`, [flag], `Missing value for ${flag}`],
      [`${flag}-next-flag`, [flag, "--yes"], `Missing value for ${flag}`],
    ]),
    ["config-invalid", ["--project", ".", "--config", "toml", "--yes"], "--config must be json or jsonc"],
    ["components-empty", ["--project", ".", "--components", "", "--yes"], "Missing value for --components"],
    ["components-unknown", ["--project", ".", "--components", "agents,nope", "--yes"], "--components must be a nonempty comma-separated list"],
    ["components-duplicate", ["--project", ".", "--components", "agents,agents", "--yes"], "--components must not contain duplicates"],
    ["scope-conflict", ["--global", "--project", ".", "--yes"], "--global and --project are mutually exclusive"],
  ];
  for (const [name, args, message] of invalid) {
    await test(`cli-invalid-${name}-full-fixture-no-mutation`, async () => {
      const f = await setup("invalid");
      const before = await snapshot(f.root);
      f.run(["install", ...args], message);
      assert.deepEqual(await snapshot(f.root), before);
    });
  }
  for (const format of ["json", "jsonc"]) {
    for (const pending of [false, true]) {
      await test(`cli-yes-${format}-${pending ? "pending" : "conflict"}-full-fixture-no-mutation`, async () => {
        const f = await setup("yes-conflict", ["json", "jsonc"]);
        f.run(f.args("install", format));
        const lock = JSON.parse(await readFile(f.lockPath));
        const item = lock.resources.find((item) => item.kind === "skill");
        assert(item);
        await writeFile(join(f.target, item.relativePath), "local-conflict");
        const incoming = item.sourceDigest;
        item.sourceDigest = sha("old-upstream");
        item.installedDigest = sha("local-conflict");
        if (pending) {
          item.pendingSourceDigest = incoming;
          item.pendingVersion = item.version;
        }
        await writeFile(f.lockPath, `${JSON.stringify(lock)}\n`);
        const before = await snapshot(f.root);
        const result = f.run(f.args("update", format), "Local changes require an interactive decision");
        assert((result.stdout + result.stderr).includes(item.relativePath));
        assert.deepEqual(await snapshot(f.root), before);
      });
    }
  }
}
