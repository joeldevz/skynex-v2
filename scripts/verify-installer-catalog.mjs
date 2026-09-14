import { cp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadCatalog, validateManifest } from "../packages/catalog/dist/index.js";
import { createInstallPlan, applyInstallPlan, createUninstallPlan, applyUninstallPlan, resolveInstallCollisions } from "../packages/installer/dist/index.js";
import { openCodeTarget } from "../targets/opencode/dist/index.js";
import { assert, fresh, fixture, readFile, join, sha, fail, detection, snapshot, exists } from "./verify-installer-support.mjs";

const source = resolve("targets/opencode/resources");
async function clone() {
  const root = await fresh("catalog");
  const catalog = join(root, "resources");
  await cp(source, catalog, { recursive: true });
  return { root, catalog, manifestPath: join(catalog, "manifest.json") };
}
async function assertDigests(catalog, root) {
  assert(catalog.resources.length > 0);
  assert.equal(catalog.resources.length, catalog.manifest.resources.length);
  for (const resource of catalog.resources) {
    const bytes = await readFile(join(root, resource.sourcePath));
    assert.equal(resource.content, bytes.toString("utf8"));
    assert.equal(resource.digest, sha(bytes));
  }
}
export async function verify(test) {
  await test("collision-plan-discovers-all-unmanaged-without-mutation", async () => {
    const f = await fixture("collision-discovery");
    const artifacts = ["agents/first.md", "skills/second/SKILL.md"].map((relativePath, index) => ({
      resource: { id: `collision-${index}`, kind: index ? "skill" : "agent", version: "1" },
      component: index ? "skills" : "agents", relativePath, content: `upstream-${index}`,
    }));
    for (const artifact of artifacts) {
      await mkdir(dirname(f.target(artifact.relativePath)), { recursive: true });
      await writeFile(f.target(artifact.relativePath), `local-${artifact.resource.id}`);
    }
    const before = await snapshot(f.root);
    const plan = await createInstallPlan({ detect: detection, desiredArtifacts: async () => artifacts }, f.roots);
    assert.deepEqual(plan.operations.map((item) => [item.relativePath, item.kind, item.currentDigest]), [
      [artifacts[0].relativePath, "conflict", sha("local-collision-0")],
      [artifacts[1].relativePath, "conflict", sha("local-collision-1")],
    ]);
    assert.deepEqual(await snapshot(f.root), before);
  });
  await test("collision-unresolved-apply-fails-without-mutation", async () => {
    const f = await fixture("collision-unresolved");
    const artifact = { resource: { id: "collision", kind: "agent", version: "1" }, component: "agents", relativePath: "agents/collision.md", content: "upstream" };
    await mkdir(dirname(f.target(artifact.relativePath)), { recursive: true });
    await writeFile(f.target(artifact.relativePath), "local");
    const before = await snapshot(f.root);
    const plan = await createInstallPlan({ detect: detection, desiredArtifacts: async () => [artifact] }, f.roots);
    await fail(() => applyInstallPlan(plan), "Unresolved collision");
    assert.deepEqual(await snapshot(f.root), before);
  });
  for (const variant of ["manual", "spread", "tampered"]) {
    await test(`collision-${variant}-resolved-plan-is-rejected-without-mutation`, async () => {
      const f = await fixture(`collision-${variant}-authorization`);
      const artifact = { resource: { id: "collision", kind: "agent", version: "1" }, component: "agents", relativePath: "agents/collision.md", content: "upstream" };
      await mkdir(dirname(f.target(artifact.relativePath)), { recursive: true });
      await writeFile(f.target(artifact.relativePath), "local");
      const base = await createInstallPlan({ detect: detection, desiredArtifacts: async () => [artifact] }, f.roots);
      const resolved = resolveInstallCollisions(base, new Map([[artifact.relativePath, "overwrite"]]));
      const plan = variant === "manual"
        ? { ...base, operations: base.operations.map((item) => ({ ...item, kind: "replace", decision: "accept-upstream" })) }
        : variant === "spread"
          ? { ...resolved }
          : { ...resolved, operations: resolved.operations.map((item) => ({ ...item, desiredDigest: sha("tampered") })) };
      const before = await snapshot(f.root);
      await fail(() => applyInstallPlan(plan), "authorized collision plan");
      assert.deepEqual(await snapshot(f.root), before);
    });
  }
  await test("collision-resolver-rejects-fabricated-plan-without-mutation", async () => {
    const f = await fixture("collision-fabricated-resolver");
    const artifact = { resource: { id: "collision", kind: "agent", version: "1" }, component: "agents", relativePath: "agents/collision.md", content: "upstream" };
    await mkdir(dirname(f.target(artifact.relativePath)), { recursive: true });
    await writeFile(f.target(artifact.relativePath), "local");
    const planned = await createInstallPlan({ detect: detection, desiredArtifacts: async () => [artifact] }, f.roots);
    const fabricated = { ...planned };
    const before = await snapshot(f.root);
    assert.throws(() => resolveInstallCollisions(fabricated, new Map([[artifact.relativePath, "overwrite"]])), /planner-created plan/);
    assert.deepEqual(await snapshot(f.root), before);
  });
  await test("collision-resolver-rejects-preauthorization-tamper-without-mutation", async () => {
    const f = await fixture("collision-preauthorization-tamper");
    const artifact = { resource: { id: "collision", kind: "agent", version: "1" }, component: "agents", relativePath: "agents/collision.md", content: "upstream" };
    await mkdir(dirname(f.target(artifact.relativePath)), { recursive: true });
    await writeFile(f.target(artifact.relativePath), "local");
    const planned = await createInstallPlan({ detect: detection, desiredArtifacts: async () => [artifact] }, f.roots);
    planned.operations[0].artifact.content = "tampered";
    planned.operations[0].desiredDigest = sha("tampered");
    const before = await snapshot(f.root);
    assert.throws(() => resolveInstallCollisions(planned, new Map([[artifact.relativePath, "overwrite"]])), /unchanged planner-created plan/);
    assert.deepEqual(await snapshot(f.root), before);
  });
  await test("collision-overwrite-snapshots-writes-and-records-ownership", async () => {
    const f = await fixture("collision-overwrite");
    const artifact = { resource: { id: "collision", kind: "agent", version: "1" }, component: "agents", relativePath: "agents/collision.md", content: "upstream" };
    await mkdir(dirname(f.target(artifact.relativePath)), { recursive: true });
    await writeFile(f.target(artifact.relativePath), "old-local-bytes");
    const base = await createInstallPlan({ detect: detection, desiredArtifacts: async () => [artifact] }, f.roots);
    const plan = resolveInstallCollisions(base, new Map([[artifact.relativePath, "overwrite"]]));
    const result = await applyInstallPlan(plan);
    assert.equal(await readFile(f.target(artifact.relativePath), "utf8"), "upstream");
    const lock = JSON.parse(await readFile(f.lockPath, "utf8"));
    assert.equal(lock.resources.find((item) => item.id === artifact.resource.id)?.installedDigest, sha("upstream"));
    assert(result.backupRoot);
    assert((await snapshot(result.backupRoot)).some((entry) => entry[1] === "file" && Buffer.from(entry[2], "base64").toString() === "old-local-bytes"));
  });
  await test("collision-preserve-is-unowned-and-survives-uninstall", async () => {
    const f = await fixture("collision-preserve");
    const artifact = { resource: { id: "collision", kind: "agent", version: "1" }, component: "agents", relativePath: "agents/collision.md", content: "upstream" };
    await mkdir(dirname(f.target(artifact.relativePath)), { recursive: true });
    await writeFile(f.target(artifact.relativePath), "local");
    const base = await createInstallPlan({ detect: detection, desiredArtifacts: async () => [artifact] }, f.roots);
    const plan = resolveInstallCollisions(base, new Map([[artifact.relativePath, "preserve"]]));
    await applyInstallPlan(plan);
    assert.equal(await readFile(f.target(artifact.relativePath), "utf8"), "local");
    const lock = JSON.parse(await readFile(f.lockPath, "utf8"));
    assert.equal(lock.resources.some((item) => item.relativePath === artifact.relativePath), false);
    const allowed = new Map(plan.allowedResources.map((item) => [item.id, item.relativePath]));
    await applyUninstallPlan(createUninstallPlan({ roots: f.roots, lock, allowedResources: allowed }), allowed);
    assert.equal(await readFile(f.target(artifact.relativePath), "utf8"), "local");
  });
  await test("collision-mixed-decisions-stale-digest-are-atomic", async () => {
    const f = await fixture("collision-stale");
    const artifacts = ["agents/overwrite.md", "skills/preserve/SKILL.md"].map((relativePath, index) => ({ resource: { id: `mixed-${index}`, kind: index ? "skill" : "agent", version: "1" }, component: index ? "skills" : "agents", relativePath, content: `upstream-${index}` }));
    for (const artifact of artifacts) { await mkdir(dirname(f.target(artifact.relativePath)), { recursive: true }); await writeFile(f.target(artifact.relativePath), `local-${artifact.resource.id}`); }
    const base = await createInstallPlan({ detect: detection, desiredArtifacts: async () => artifacts }, f.roots);
    const plan = resolveInstallCollisions(base, new Map(artifacts.map((item, index) => [item.relativePath, index ? "preserve" : "overwrite"])));
    await writeFile(f.target(artifacts[1].relativePath), "stale-after-plan");
    const before = await snapshot(f.root);
    await fail(() => applyInstallPlan(plan), `Target changed after planning: ${artifacts[1].relativePath}`);
    assert.deepEqual(await snapshot(f.root), before);
  });
  for (const kind of ["agent", "skill", "command", "native", "hook", "mcp", "configuration"]) {
    await test(`collision-${kind}-plan-and-apply-no-mutation`, async () => {
      const f = await fixture(`collision-${kind}`);
      const path = `${kind}/owned`;
      const artifact = { resource: { id: `fixture-${kind}`, kind, version: "1" },
        component: "configuration", relativePath: path, content: "upstream" };
      const adapter = { detect: detection, desiredArtifacts: async () => [artifact] };
      // Plan before a competing unmanaged writer, then prove apply still refuses.
      const plan = await createInstallPlan(adapter, f.roots);
      await mkdir(f.target(kind));
      await writeFile(f.target(path), "local");
      const before = await snapshot(f.root);
      const collisionPlan = await createInstallPlan(adapter, f.roots);
      assert.equal(collisionPlan.operations[0].kind, "conflict");
      assert.equal(collisionPlan.operations[0].currentDigest, sha("local"));
      assert.deepEqual(await snapshot(f.root), before);
      await fail(() => applyInstallPlan(collisionPlan), "Unresolved");
      assert.deepEqual(await snapshot(f.root), before);
    });
  }
  for (const kind of ["agent", "skill", "command", "native", "hook", "mcp", "configuration"]) {
    await test(`collision-identical-${kind}-plan-and-apply-no-adoption`, async () => {
      const f = await fixture(`identical-${kind}`);
      const path = `${kind}/unowned`;
      const content = "Identical bytes do not establish ownership.\n";
      const artifact = { resource: { id: `fixture-identical-${kind}`, kind, version: "1" },
        component: "configuration", relativePath: path, content };
      const adapter = { detect: detection, desiredArtifacts: async () => [artifact] };
      // Obtain the independent trusted ownership map from the fixture adapter
      // while the destination is absent, before introducing the unowned file.
      const initialPlan = await createInstallPlan(adapter, f.roots);
      assert.deepEqual(initialPlan.allowedResources, [{ id: artifact.resource.id, relativePath: path }]);
      await mkdir(f.target(kind));
      await writeFile(f.target(path), content);
      assert.equal(sha(await readFile(f.target(path))), initialPlan.operations[0].desiredDigest);
      const before = await snapshot(f.root);
      const collisionPlan = await createInstallPlan(adapter, f.roots);
      assert.equal(collisionPlan.operations[0].kind, "conflict");
      assert.equal(collisionPlan.operations[0].currentDigest, collisionPlan.operations[0].desiredDigest);
      assert.equal(collisionPlan.operations[0].decision, undefined);
      assert.deepEqual(await snapshot(f.root), before);
      await fail(() => applyInstallPlan(collisionPlan), "Unresolved");
      assert.deepEqual(await snapshot(f.root), before);
      assert.deepEqual(await readFile(f.target(path)), Buffer.from(content));
      assert.equal(await exists(f.roots.stateRoot), false);
      assert.equal(await exists(f.lockPath), false);
      assert.equal(await exists(join(f.roots.stateRoot, ".installer.lock")), false);
    });
  }
  await test("owned-identical-real-reinstall-remains-unchanged", async () => {
    const f = await fixture("owned-identical-reinstall");
    const options = { configPreference: "jsonc" };
    f.roots.scope = "global";
    const initialPlan = await createInstallPlan(openCodeTarget, f.roots, undefined, options);
    await applyInstallPlan(initialPlan);
    const priorLock = JSON.parse(await readFile(f.lockPath, "utf8"));
    assert.equal(priorLock.resources.length, initialPlan.allowedResources.length);
    // A reinstall must preserve unrelated files as well as every owned file.
    await writeFile(f.target("unrelated-notes.txt"), "Keep these unmanaged notes.\n");
    const beforeTarget = await snapshot(f.roots.targetRoot);
    const reinstall = await createInstallPlan(openCodeTarget, f.roots, undefined, options);
    assert(reinstall.operations.length > 0);
    assert.deepEqual(reinstall.allowedResources, initialPlan.allowedResources);
    for (const operation of reinstall.operations) {
      assert.equal(operation.kind, "unchanged");
      assert.equal(operation.currentDigest, operation.desiredDigest);
      assert.deepEqual(operation.previous, priorLock.resources.find((item) => item.id === operation.artifact.resource.id));
      assert(operation.previous);
    }
    const result = await applyInstallPlan(reinstall);
    assert.equal(result.changed, 0);
    assert.deepEqual(await snapshot(f.roots.targetRoot), beforeTarget);
    assert.deepEqual(JSON.parse(await readFile(f.lockPath, "utf8")).resources, priorLock.resources);
    assert.equal(await exists(join(f.roots.stateRoot, ".installer.lock")), false);
  });
  for (const format of ["json", "jsonc"]) {
    await test(`collision-exact-shared-config-${format}-exception`, async () => {
      const f = await fixture("shared-config");
      const path = `opencode.${format}`;
      const artifact = { resource: { id: "opencode-config", kind: "configuration", version: "1" },
        component: "configuration", relativePath: path, content: '{"upstream":true}\n' };
      const adapter = { detect: detection, desiredArtifacts: async () => [artifact] };
      await writeFile(f.target(path), '{"local":true}\n');
      const plan = await createInstallPlan(adapter, f.roots);
      assert.equal(plan.operations[0].kind, "replace");
      await applyInstallPlan(plan);
      assert.equal(await readFile(f.target(path), "utf8"), artifact.content);
    });
    for (const mismatch of ["id", "kind", "component", "target", "path"]) {
      await test(`collision-shared-config-${format}-wrong-${mismatch}-refused`, async () => {
        const f = await fixture("not-shared-config");
        const path = mismatch === "path" ? `other.${format}` : `opencode.${format}`;
        const artifact = { resource: { id: "opencode-config", kind: "configuration", version: "1" },
          component: "configuration", relativePath: path, content: "upstream" };
        if (mismatch === "id") artifact.resource.id = "generic-config";
        if (mismatch === "kind") artifact.resource.kind = "agent";
        if (mismatch === "component") artifact.component = "agents";
        const adapter = { detect: async (roots) => ({ ...await detection(roots), id: mismatch === "target" ? "other" : "opencode-v2" }),
          desiredArtifacts: async () => [artifact] };
        await writeFile(f.target(path), "local");
        const before = await snapshot(f.root);
        const collisionPlan = await createInstallPlan(adapter, f.roots);
        assert.equal(collisionPlan.operations[0].kind, "conflict");
        await fail(() => applyInstallPlan(collisionPlan), "Unresolved collision");
        assert.deepEqual(await snapshot(f.root), before);
      });
    }
  }
  for (const path of ["skills/diagnose/SKILL.md", "skynex/plugins/sky-agents/index.ts", "skynex/plugins/sky-agents/core/storage.ts"]) {
    await test(`collision-real-destination-${path}`, async () => {
      const f = await fixture("real-collision");
      f.roots.scope = "global";
      const artifacts = (await openCodeTarget.desiredArtifacts(f.roots)).filter((item) => item.relativePath === path);
      assert.equal(artifacts.length, 1, `actual catalog destination missing: ${path}`);
      await mkdir(dirname(f.target(path)), { recursive: true });
      await writeFile(f.target(path), "local");
      const before = await snapshot(f.root);
      const collisionPlan = await createInstallPlan({ detect: openCodeTarget.detect, desiredArtifacts: async () => artifacts }, f.roots);
      assert.equal(collisionPlan.operations[0].kind, "conflict");
      await fail(() => applyInstallPlan(collisionPlan), "Unresolved collision");
      assert.deepEqual(await snapshot(f.root), before);
    });
  }
  await test("catalog-valid-content-and-digests", async () => {
    const f = await clone();
    await assertDigests(await loadCatalog(f), f.catalog);
  });
  async function assertInvalidEnum(f, manifest, resourceId) {
    await writeFile(f.manifestPath, `${JSON.stringify(manifest)}\n`);
    // Include empty installer roots in the full directory-and-byte snapshot.
    await mkdir(join(f.root, "target"));
    await mkdir(join(f.root, "state"));
    const before = await snapshot(f.root);
    const message = `Invalid or duplicate resource: ${resourceId}`;
    await fail(async () => validateManifest(manifest), message);
    assert.deepEqual(await snapshot(f.root), before);
    await fail(() => loadCatalog(f), message);
    assert.deepEqual(await snapshot(f.root), before);
  }
  for (const field of ["kind", "origin", "component"]) {
    for (const invalidType of ["null", "array", "number", "object", "missing"]) {
      await test(`catalog-enum-${field}-${invalidType}-rejected-without-writes`, async () => {
        const f = await clone();
        await assertDigests(await loadCatalog(f), f.catalog);
        const manifest = JSON.parse(await readFile(f.manifestPath, "utf8"));
        const resource = manifest.resources[0];
        const validValue = resource[field];
        assert.equal(typeof validValue, "string");
        const invalidValues = { null: null, array: [validValue], number: 7, object: { value: validValue } };
        if (invalidType === "missing") delete resource[field];
        else resource[field] = invalidValues[invalidType];
        await assertInvalidEnum(f, manifest, resource.id);
      });
    }
  }
  for (const bypass of ["kind-array-canonical-origin", "native-origin-array"]) {
    await test(`catalog-enum-${bypass}-rejected-without-writes`, async () => {
      const f = await clone();
      await assertDigests(await loadCatalog(f), f.catalog);
      const manifest = JSON.parse(await readFile(f.manifestPath, "utf8"));
      const resource = manifest.resources.find((item) => item.kind === "native");
      assert(resource);
      if (bypass === "kind-array-canonical-origin") {
        // Previously string coercion accepted the array, then strict equality
        // skipped the native-kind/origin consistency rule entirely.
        resource.kind = ["native"];
        resource.origin = "canonical";
      } else resource.origin = ["native"];
      await assertInvalidEnum(f, manifest, resource.id);
    });
  }
  for (const [name, path] of [
    ["manifest", "manifest.json"], ["root", "."], ["canonical", "canonical"],
    ["native", "native"], ["nested", "canonical/agents"],
    ["leaf", "canonical/agents/skynex-orchestrator.md"],
  ]) {
    await test(`catalog-valid-${name}-symlink-specifically-refused`, async () => {
      const f = await clone();
      // Validate before substitution, and copy exact originals outside the catalog.
      await assertDigests(await loadCatalog(f), f.catalog);
      const original = join(f.catalog, path);
      const outside = join(f.root, "outside");
      await cp(original, outside, { recursive: true });
      const beforeOutside = await snapshot(outside);
      await rm(original, { recursive: true });
      await symlink(outside, original);
      const before = await snapshot(f.root);
      await fail(() => loadCatalog(f), "Unsafe symlink in catalog");
      assert.deepEqual(await snapshot(outside), beforeOutside);
      assert.deepEqual(await snapshot(f.root), before);
    });
  }
  await test("catalog-valid-ancestor-symlink-specifically-refused", async () => {
    const f = await clone();
    await assertDigests(await loadCatalog(f), f.catalog);
    const alias = join(f.root, "alias");
    await symlink(f.root, alias);
    const before = await snapshot(f.root);
    await fail(() => loadCatalog({ manifestPath: join(alias, "resources", "manifest.json") }), "Unsafe symlink in catalog");
    assert.deepEqual(await snapshot(f.root), before);
  });
  await test("catalog-optional-native-absent-without-declaration", async () => {
    const f = await clone();
    const manifest = JSON.parse(await readFile(f.manifestPath, "utf8"));
    manifest.resources = manifest.resources.filter((item) => item.origin !== "native");
    await writeFile(f.manifestPath, JSON.stringify(manifest));
    await rm(join(f.catalog, "native"), { recursive: true });
    await assertDigests(await loadCatalog(f), f.catalog);
  });
  await test("catalog-declared-missing-file-refused", async () => {
    const f = await clone();
    await rm(join(f.catalog, "canonical/agents/skynex-orchestrator.md"));
    await assert.rejects(() => loadCatalog(f), (error) => error.code === "ENOENT");
  });
  await test("catalog-declared-native-root-missing-refused", async () => {
    const f = await clone();
    await rm(join(f.catalog, "native"), { recursive: true });
    await assert.rejects(() => loadCatalog(f), (error) => error.code === "ENOENT");
  });
  await test("catalog-nondirectory-source-refused", async () => {
    const f = await clone();
    await rm(join(f.catalog, "canonical/agents"), { recursive: true });
    await writeFile(join(f.catalog, "canonical/agents"), "not-dir");
    await fail(() => loadCatalog(f), "Undeclared catalog files");
  });
}
