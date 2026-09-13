import { mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { executeTransaction, restoreBackup, assertSafeRoot, createInstallPlan, applyInstallPlan, createUninstallPlan, applyUninstallPlan, readInstallLock } from "../packages/installer/dist/index.js";
import { openCodeTarget, removeManagedPlugin } from "../targets/opencode/dist/index.js";
import { parse } from "../targets/opencode/node_modules/jsonc-parser/lib/umd/main.js";
import { assert, fixture, readFile, join, sha, fail, exists, detection, snapshot } from "./verify-installer-support.mjs";

export async function verify(test) {
  const f = await fixture("transactions");
  const { roots, target, lockPath } = f;
  await mkdir(roots.stateRoot);
  const resource = (path, id = `fixture-${path.replaceAll("/", "-")}`) => ({
    id, kind: "configuration", version: "1.0.0", origin: "canonical",
    relativePath: path, sourceDigest: sha("source"), installedDigest: sha("source"),
  });
  const operation = (path, content, prior, id) => ({
    kind: "replace", artifact: { resource: resource(path, id), component: "configuration", relativePath: path, content },
    relativePath: path, destination: target(path), currentDigest: prior === null ? null : sha(prior),
    desiredDigest: sha(content), expectedPriorDigest: prior === null ? null : sha(prior),
  });
  const plan = (id, operations = [operation("managed.txt", "new", "old")]) => ({
    id, createdAt: new Date().toISOString(), target: { id: "opencode-v2", roots }, operations,
    allowedResources: operations.map((item) => ({ id: item.artifact.resource.id, relativePath: item.relativePath })),
  });
  const lock = (transactionId) => `${JSON.stringify({ schemaVersion: 1, target: "opencode-v2", ...roots,
    installedAt: new Date().toISOString(), transactionId, resources: [resource("managed.txt")] })}\n`;
  const catalogMap = new Map([["fixture-managed.txt", "managed.txt"]]);
  const leasePath = join(roots.stateRoot, ".installer.lock");
  let replacementLock;

  await test("api-project-default-plan-is-scope-aware", async () => {
    const api = await fixture("api-project-default");
    const projectRoots = { ...api.roots, scope: "project" };
    const defaultPlan = await createInstallPlan(openCodeTarget, projectRoots, undefined, { configPreference: "jsonc" });
    assert.deepEqual(defaultPlan.selectedComponents, ["configuration", "agents", "skills"]);
    assert.equal(defaultPlan.operations.some((item) => item.artifact.component === "plugins" || item.artifact.component === "commands"), false);
    await fail(() => createInstallPlan(openCodeTarget, projectRoots, ["plugins"], { configPreference: "jsonc" }), "only be installed globally");
  });

  await test("transaction-lease-exact-restore-and-reverse", async () => {
    await writeFile(target("managed.txt"), "old");
    const previousLock = '{"unrelated":"preserve","resources":[]}\n';
    await writeFile(lockPath, previousLock);
    replacementLock = lock("fixture-replace");
    let leaseSeen = false;
    await executeTransaction({ plan: plan("fixture-replace"), lockBytes: replacementLock,
      verify: async () => { leaseSeen = await exists(leasePath); } });
    assert.equal(leaseSeen, true);
    assert.equal(await readFile(target("managed.txt"), "utf8"), "new");
    const restored = await restoreBackup(roots, "fixture-replace", catalogMap);
    assert(restored.restored.includes("managed.txt"));
    assert.equal(await readFile(target("managed.txt"), "utf8"), "old");
    assert.equal(await readFile(lockPath, "utf8"), previousLock);
    assert(await exists(join(roots.stateRoot, "backups", restored.transactionId, "manifest.json")));
    await restoreBackup(roots, restored.transactionId, catalogMap);
    assert.equal(await readFile(target("managed.txt"), "utf8"), "new");
    assert.equal(await readFile(lockPath, "utf8"), replacementLock);
    await fail(() => restoreBackup(roots, "fixture-replace", new Map([["fixture-managed.txt", "other.txt"]])), "trusted catalog");
    assert.equal(await readFile(target("managed.txt"), "utf8"), "new");
    assert.equal(await readFile(lockPath, "utf8"), replacementLock);
  });
  await test("transaction-verification-rollback-and-contender-isolation", async () => {
    const beforeLock = await readFile(lockPath);
    await writeFile(target("managed.txt"), "old");
    await fail(() => executeTransaction({ plan: plan("fixture-verify-fail"), lockBytes: lock("fixture-verify-fail"),
      verify: async () => {
        assert(await exists(leasePath));
        throw new Error("injected verification failure");
      } }), "injected verification failure");
    assert.equal(await readFile(target("managed.txt"), "utf8"), "old");
    assert.deepEqual(await readFile(lockPath), beforeLock);
    await writeFile(leasePath, "winner");
    await fail(() => executeTransaction({ plan: plan("fixture-contender"), lockBytes: lock("fixture-contender") }), "active");
    assert.equal(await readFile(leasePath, "utf8"), "winner");
    assert.deepEqual(await readFile(lockPath), beforeLock);
    assert.equal(await readFile(target("managed.txt"), "utf8"), "old");
    await rm(leasePath);
  });
  await test("transaction-local-edit-ownership-and-corrupt-snapshot", async () => {
    const beforeLock = await readFile(lockPath);
    await writeFile(target("managed.txt"), "local");
    await fail(() => executeTransaction({ plan: plan("fixture-local"), lockBytes: lock("fixture-local") }), "changed");
    assert.equal(await readFile(target("managed.txt"), "utf8"), "local");
    assert.deepEqual(await readFile(lockPath), beforeLock);
    await fail(() => executeTransaction({ plan: plan("fixture-bad-owner", [operation("../escape", "bad", null, "INVALID!")]) }), "Invalid managed path");
    await writeFile(target("managed.txt"), "old");
    const corruptLock = lock("fixture-corrupt");
    const backup = await executeTransaction({ plan: plan("fixture-corrupt"), lockBytes: corruptLock });
    await writeFile(join(backup.backupRoot, "files", "managed.txt"), "corrupt");
    await fail(() => restoreBackup(roots, "fixture-corrupt", catalogMap), "Backup digest mismatch");
    assert.equal(await readFile(target("managed.txt"), "utf8"), "new");
    assert.equal(await readFile(lockPath, "utf8"), corruptLock);
    const wrongOwner = plan("fixture-wrong-owner", [operation("managed.txt", "bad", "new")]);
    wrongOwner.allowedResources = [{ id: "fixture-managed.txt", relativePath: "other.txt" }];
    await fail(() => executeTransaction({ plan: wrongOwner }), "Resource ownership mismatch");
    assert.equal(await readFile(target("managed.txt"), "utf8"), "new");
    assert.equal(await readFile(lockPath, "utf8"), corruptLock);
  });
  await test("transaction-ancestor-and-backup-symlinks", async () => {
    const outside = join(f.root, "outside");
    await mkdir(outside);
    const unsafe = join(f.root, "unsafe");
    await symlink(outside, unsafe);
    await fail(() => assertSafeRoot(unsafe), "Unsafe root ancestor");
    await fail(() => assertSafeRoot(join(unsafe, "intermediate", "target")), "Unsafe root ancestor");
    await rm(join(roots.stateRoot, "backups"), { recursive: true });
    await symlink(outside, join(roots.stateRoot, "backups"));
    const before = await snapshot(outside);
    await fail(() => executeTransaction({ plan: plan("fixture-backup-link"), lockBytes: lock("fixture-backup-link") }), "Unsafe backup root");
    assert.deepEqual(await snapshot(outside), before);
    await rm(join(roots.stateRoot, "backups"));
    await mkdir(join(roots.stateRoot, "backups"));
  });
  await test("transaction-prior-lock-read-failure-and-commit-recovery", async () => {
    await writeFile(target("managed.txt"), "old");
    const beforeLock = await readFile(lockPath);
    await fail(() => executeTransaction({ plan: plan("fixture-read-fail", []) }, {
      readLock: async () => { throw Object.assign(new Error("injected read failure"), { code: "EACCES" }); },
    }), "injected read failure");
    assert.deepEqual(await readFile(lockPath), beforeLock);
    assert.equal(await exists(leasePath), false);
    await fail(() => executeTransaction({ plan: plan("fixture-lock-fail"), lockBytes: lock("fixture-lock-fail") }, {
      beforeLockCommit: async () => {
        assert(await exists(leasePath));
        assert.equal(await readFile(target("managed.txt"), "utf8"), "new");
        throw new Error("injected lock commit failure");
      },
    }), "injected lock commit failure");
    assert.equal(await readFile(target("managed.txt"), "utf8"), "old");
    assert.deepEqual(await readFile(lockPath), beforeLock);
    const backupRoot = join(roots.stateRoot, "backups", "fixture-lock-fail");
    assert.deepEqual(JSON.parse(await readFile(join(backupRoot, "recovery.json"), "utf8")), {
      transactionId: "fixture-lock-fail", status: "rolled-back", restoredPaths: ["managed.txt"],
      unreconciledPaths: [], lockPath, backupRoot,
    });
    assert.equal(await exists(leasePath), false);
  });
  await test("transaction-absent-lock-restore-and-reverse", async () => {
    await rm(lockPath);
    const bytes = lock("fixture-absent-lock");
    await executeTransaction({ plan: plan("fixture-absent-lock"), lockBytes: bytes });
    const undo = await restoreBackup(roots, "fixture-absent-lock", catalogMap);
    assert.equal(await readFile(target("managed.txt"), "utf8"), "old");
    assert.equal(await exists(lockPath), false);
    await restoreBackup(roots, undo.transactionId, catalogMap);
    assert.equal(await readFile(target("managed.txt"), "utf8"), "new");
    assert.equal(await readFile(lockPath, "utf8"), bytes);
  });

  await test("state-typed-malformed-ownership-and-api-uninstall-restore", async () => {
    const api = await fixture("typed-state");
    const adapter = { detect: detection, desiredArtifacts: async () => [{
      resource: { id: "api-resource", kind: "configuration", version: "1.0.0" },
      component: "configuration", relativePath: "owned.txt", content: "canonical",
    }] };
    await applyInstallPlan(await createInstallPlan(adapter, api.roots));
    await writeFile(api.target("owned.txt"), "local edit");
    const editedPlan = await createInstallPlan(adapter, api.roots);
    const bytes = await readFile(api.lockPath);
    async function rejectedState(value, message) {
      const invalid = JSON.stringify(value);
      await writeFile(api.lockPath, invalid);
      await fail(() => applyInstallPlan(editedPlan), message);
      assert.equal(await readFile(api.target("owned.txt"), "utf8"), "local edit");
      assert.equal(await readFile(api.lockPath, "utf8"), invalid);
    }
    await fail(() => applyInstallPlan(editedPlan), "Locally edited managed resource");
    assert.equal(await readFile(api.target("owned.txt"), "utf8"), "local edit");
    assert.deepEqual(await readFile(api.lockPath), bytes);
    await rejectedState({ ...JSON.parse(bytes), schemaVersion: 99 }, "Malformed or scope-bound install lock");
    for (const [field, value] of [
      ["id", null], ["version", 7], ["relativePath", null], ["relativePath", 7],
      ["relativePath", ["owned.txt"]], ["relativePath", undefined], ["sourceDigest", {}],
      ["installedDigest", 3], ["kind", null], ["origin", ["canonical"]],
      ...["pendingSourceDigest", "pendingVersion"].flatMap((field) => [null, 7, [], {}].map((value) => [field, value])),
    ]) {
      const valueLock = JSON.parse(bytes);
      valueLock.resources[0][field] = value;
      await rejectedState(valueLock, field.startsWith("pending") ? "Malformed pending" : "Malformed lock resource");
    }
    const wrongPath = JSON.parse(bytes);
    wrongPath.resources[0].relativePath = "other.txt";
    await rejectedState(wrongPath, "identity/path");
    for (const change of [{ relativePath: "other.txt" }, { id: "api-resource-other" }]) {
      const duplicate = JSON.parse(bytes);
      duplicate.resources.push({ ...duplicate.resources[0], ...change });
      await rejectedState(duplicate, "Duplicate lock resource ownership");
    }
    await writeFile(api.lockPath, bytes);
    await writeFile(api.target("owned.txt"), "canonical");
    // Trust comes from the fixture adapter, never from persisted lock.resources.
    const map = new Map((await adapter.desiredArtifacts(api.roots)).map((item) => [item.resource.id, item.relativePath]));
    const uninstall = createUninstallPlan({ roots: api.roots, lock: await readInstallLock(api.roots), allowedResources: map });
    await applyUninstallPlan(uninstall, map);
    assert.equal(await exists(api.target("owned.txt")), false);
    const emptyLock = await readFile(api.lockPath);
    assert.deepEqual(JSON.parse(emptyLock).resources, []);
    const backup = join(api.roots.stateRoot, "backups", uninstall.id);
    const manifest = JSON.parse(await readFile(join(backup, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.priorLock, { present: true, digest: sha(bytes), snapshot: "lock.json" });
    assert.deepEqual(await readFile(join(backup, "lock.json")), bytes);
    assert.equal(await readFile(join(backup, "files", "owned.txt"), "utf8"), "canonical");
    assert.equal(manifest.files[0].priorDigest, sha("canonical"));
    const undo = await restoreBackup(api.roots, uninstall.id, map);
    assert.equal(await readFile(api.target("owned.txt"), "utf8"), "canonical");
    assert.deepEqual(await readFile(api.lockPath), bytes);
    await restoreBackup(api.roots, undo.transactionId, map);
    assert.equal(await exists(api.target("owned.txt")), false);
    assert.deepEqual(await readFile(api.lockPath), emptyLock);
  });
  await test("real-install-metadata-absent-lock-restore-partial-ownership", async () => {
    const real = await fixture("real-api");
    real.roots.scope = "global";
    const initial = '{\n  // Keep comment\n  "unrelated": "preserve-me",\n  "plugins": ["external-plugin"]\n}\n';
    await writeFile(real.target("opencode.jsonc"), initial);
    const initialFiles = await snapshot(real.roots.targetRoot, false);
    const full = await createInstallPlan(openCodeTarget, real.roots, undefined, { configPreference: "jsonc" });
    assert(full.allowedResources.length > 0);
    const map = new Map(full.allowedResources.map((entry) => [entry.id, entry.relativePath]));
    await applyInstallPlan(full);
    const installedFiles = await snapshot(real.roots.targetRoot, false);
    const installedLock = await readFile(real.lockPath);
    assert.equal(JSON.parse(installedLock).resources.length, full.allowedResources.length);
    const manifest = JSON.parse(await readFile(join(real.roots.stateRoot, "backups", full.id, "manifest.json"), "utf8"));
    for (const entry of manifest.files) {
      assert.equal(entry.resource.relativePath, entry.relativePath);
      assert.equal(entry.resource.installedDigest, entry.resultingDigest);
      assert.match(entry.resource.kind, /^(agent|skill|command|hook|mcp|configuration|native)$/);
      assert.match(entry.resource.origin, /^(canonical|native)$/);
      assert.equal(entry.resultingDigest, sha(await readFile(real.target(entry.relativePath))));
    }
    assert.notEqual(await readFile(real.target("opencode.jsonc"), "utf8"), initial);
    const undo = await restoreBackup(real.roots, full.id, map);
    assert.deepEqual(await snapshot(real.roots.targetRoot, false), initialFiles);
    assert.equal(await exists(real.lockPath), false);
    const reverse = await restoreBackup(real.roots, undo.transactionId, map);
    assert(reverse.restored.length > 0);
    assert.deepEqual(await snapshot(real.roots.targetRoot, false), installedFiles);
    assert.deepEqual(await readFile(real.lockPath), installedLock);
    const partial = await createInstallPlan(openCodeTarget, real.roots, ["agents"], { configPreference: "jsonc" });
    assert.equal(partial.allowedResources.length, full.allowedResources.length);
    await applyInstallPlan(partial);
    const after = await readInstallLock(real.roots);
    const selected = new Set(partial.operations.map((item) => item.artifact.resource.id));
    for (const resource of JSON.parse(installedLock).resources.filter((item) => !selected.has(item.id))) {
      assert.deepEqual(after.resources.find((item) => item.id === resource.id), resource);
    }
    assert.deepEqual(await snapshot(real.roots.targetRoot, false), installedFiles);
  });
  // Use an actual catalog skill identity, but forge its persisted path
  // and digest to point at an unrelated local file. The independent map is built
  // before reading the lock and is never derived from the forged resources.
  async function forgedUninstallFixture() {
    const api = await fixture("forged-uninstall");
    const artifacts = await openCodeTarget.desiredArtifacts(api.roots, ["configuration", "agents", "skills", "commands"]);
    const allowedResources = new Map(artifacts.map((item) => [item.resource.id, item.relativePath]));
    const representativeId = "skills.diagnose";
    assert.equal(allowedResources.get(representativeId), "skills/diagnose/SKILL.md");
    await applyInstallPlan(await createInstallPlan(openCodeTarget, api.roots, ["skills"]));
    const validLock = await readInstallLock(api.roots, allowedResources);
    const validPlan = createUninstallPlan({ roots: api.roots, lock: validLock, allowedResources });
    const unrelatedPath = "unrelated-notes.txt";
    const unrelatedBytes = Buffer.from("Unmanaged local notes must survive.\n");
    await writeFile(api.target(unrelatedPath), unrelatedBytes);
    const forgedLock = structuredClone(validLock);
    const resource = forgedLock.resources.find((item) => item.id === representativeId);
    assert(resource);
    resource.relativePath = unrelatedPath;
    resource.installedDigest = sha(unrelatedBytes);
    resource.sourceDigest = sha(unrelatedBytes);
    const badLockBytes = Buffer.from(`${JSON.stringify(forgedLock)}\n`);
    await writeFile(api.lockPath, badLockBytes);
    // Raw state parsing is not ownership authorization and may return this lock.
    assert.deepEqual(await readInstallLock(api.roots), forgedLock);
    const forgedEntries = [...allowedResources].map(([id, relativePath]) => ({
      id, relativePath: id === representativeId ? unrelatedPath : relativePath,
    }));
    const forgedPlan = { ...validPlan, allowedResources: forgedEntries, operations: [{
      kind: "remove", artifact: { resource, component: "skills", relativePath: unrelatedPath, content: "" },
      relativePath: unrelatedPath, destination: api.target(unrelatedPath),
      currentDigest: sha(unrelatedBytes), desiredDigest: "", expectedPriorDigest: sha(unrelatedBytes),
    }] };
    return { ...api, representativeId, allowedResources, forgedLock, badLockBytes, forgedPlan, validPlan, unrelatedPath, unrelatedBytes };
  }
  async function assertUninstallRefused(api, action, message) {
    const before = await snapshot(api.root);
    await fail(action, message);
    assert.deepEqual(await snapshot(api.root), before);
    assert.deepEqual(await readFile(api.lockPath), api.badLockBytes);
    assert.deepEqual(await readFile(api.target(api.unrelatedPath)), api.unrelatedBytes);
    assert.equal(await exists(join(api.roots.stateRoot, ".installer.lock")), false);
  }
  await test("uninstall-create-forged-lock-path-independent-catalog-refused", async () => {
    const api = await forgedUninstallFixture();
    await assertUninstallRefused(api, async () => createUninstallPlan({
      roots: api.roots, lock: api.forgedLock, allowedResources: api.allowedResources,
    }), `Lock resource identity/path does not match the installed catalog: ${api.representativeId}`);
  });
  await test("uninstall-apply-forged-plan-map-independent-catalog-refused", async () => {
    const api = await forgedUninstallFixture();
    await assertUninstallRefused(api, () => applyUninstallPlan(api.forgedPlan, api.allowedResources),
      "Uninstall plan trusted resource ownership map does not match supplied map");
  });
  await test("uninstall-apply-forged-operation-independent-catalog-refused", async () => {
    const api = await forgedUninstallFixture();
    const plan = { ...api.forgedPlan, allowedResources: api.validPlan.allowedResources };
    await assertUninstallRefused(api, () => applyUninstallPlan(plan, api.allowedResources),
      `Resource ownership mismatch: ${api.representativeId}`);
  });
  await test("uninstall-apply-valid-plan-forged-current-lock-refused", async () => {
    const api = await forgedUninstallFixture();
    await assertUninstallRefused(api, () => applyUninstallPlan(api.validPlan, api.allowedResources),
      "Lock resource identity/path does not match the installed catalog");
  });
  for (const entrypoint of ["create", "apply"]) {
    await test(`uninstall-${entrypoint}-missing-map-preserves-forged-lock`, async () => {
      const api = await forgedUninstallFixture();
      const action = entrypoint === "create"
        ? async () => createUninstallPlan({ roots: api.roots, lock: api.forgedLock })
        : () => applyUninstallPlan(api.forgedPlan);
      await assertUninstallRefused(api, action, "Trusted resource ownership map is required for uninstall");
    });
    await test(`uninstall-${entrypoint}-missing-map-creates-no-state`, async () => {
      const api = await fixture("uninstall-no-map");
      const emptyLock = { schemaVersion: 1, target: "opencode-v2", ...api.roots,
        installedAt: new Date(0).toISOString(), transactionId: "fixture-no-map", resources: [] };
      const emptyPlan = { id: "uninstall-no-map", createdAt: new Date(0).toISOString(),
        target: { id: "opencode-v2", roots: api.roots }, operations: [], allowedResources: [] };
      const before = await snapshot(api.root);
      const action = entrypoint === "create"
        ? async () => createUninstallPlan({ roots: api.roots, lock: emptyLock })
        : () => applyUninstallPlan(emptyPlan);
      await fail(action, "Trusted resource ownership map is required for uninstall");
      assert.deepEqual(await snapshot(api.root), before);
      assert.equal(await exists(api.roots.stateRoot), false);
      assert.equal(await exists(api.lockPath), false);
      assert.equal(await exists(join(api.roots.stateRoot, ".installer.lock")), false);
    });
  }
  await test("jsonc-owned-array-separators-and-comments", async () => {
    const managed = '{ "package": "./skynex/plugins/runtime", "options": { "managedBy": "skynex" } }';
    for (const [plugins, expected] of [
      [`[${managed}]`, []], [`[${managed},"external"]`, ["external"]],
      [`["external",${managed}]`, ["external"]], [`[${managed},${managed}]`, []],
      [`["external",${managed},${managed}]`, ["external"]],
      [`[ /* lead */ ${managed} /* middle */ , /* external gap */ { "package": "external", "options": { "nested": [1, 2] } } /* tail */ ]`, [{ package: "external", options: { nested: [1, 2] } }]]
    ]) {
      const jsonc = `{\n // root-before\n "before": { "nested": [1, 2] },\n "plugins": ${plugins},\n // root-after\n "after": "preserved"\n}\n`;
      const cleaned = removeManagedPlugin(jsonc);
      const errors = [];
      const value = parse(cleaned, errors);
      assert.deepEqual(errors, []);
      assert.deepEqual(value, { before: { nested: [1, 2] }, plugins: expected, after: "preserved" });
      assert(cleaned.includes("root-before") && cleaned.includes("root-after"));
      if (plugins.includes("external gap")) assert(cleaned.includes("external gap") && cleaned.includes("tail"));
    }
  });
}
