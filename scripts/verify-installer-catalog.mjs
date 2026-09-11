import { cp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadCatalog, validateManifest } from "../packages/catalog/dist/index.js";
import { createInstallPlan, applyInstallPlan } from "../packages/installer/dist/index.js";
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
  for (const kind of ["agent", "skill", "command", "native", "hook", "mcp", "configuration"]) {
    await test(`collision-${kind}-plan-and-apply-no-mutation`, async () => {
      const f = await fixture(`collision-${kind}`);
      const path = `${kind}/owned`;
      const artifact = { resource: { id: `fixture-${kind}`, kind, version: "1" },
        component: "configuration", relativePath: path, content: "upstream" };
      const adapter = { detect: detection, desiredArtifacts: async () => [artifact] };
      // Plan before a competing unmanaged writer, then prove both entry points refuse.
      const plan = await createInstallPlan(adapter, f.roots);
      await mkdir(f.target(kind));
      await writeFile(f.target(path), "local");
      const before = await snapshot(f.root);
      await fail(() => createInstallPlan(adapter, f.roots), "Unmanaged existing resource collision");
      assert.deepEqual(await snapshot(f.root), before);
      // An apply-time plan with observed local bytes must not bypass ownership checks.
      const observed = { ...plan, operations: plan.operations.map((item) => ({
        ...item, kind: "replace", currentDigest: sha("local"),
      })) };
      await fail(() => applyInstallPlan(observed), "Unmanaged existing resource collision");
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
      const message = `Unmanaged existing resource collision: ${path}`;
      await fail(() => createInstallPlan(adapter, f.roots), message);
      assert.deepEqual(await snapshot(f.root), before);
      // Exercise apply independently with an unchanged operation whose observed
      // digest equals desired. Keep the genuine adapter-derived map untouched.
      const observedPlan = { ...initialPlan, operations: initialPlan.operations.map((item) => ({
        ...item, kind: "unchanged", currentDigest: sha(content),
      })) };
      assert.equal(observedPlan.operations[0].currentDigest, observedPlan.operations[0].desiredDigest);
      assert.equal(observedPlan.operations[0].previous, undefined);
      await fail(() => applyInstallPlan(observedPlan), message);
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
        await fail(() => createInstallPlan(adapter, f.roots), "Unmanaged existing resource collision");
        assert.deepEqual(await snapshot(f.root), before);
      });
    }
  }
  for (const path of ["commands/skynex-doctor.md", "skynex/plugins/runtime/index.ts", "skynex/plugins/runtime/prompt.ts"]) {
    await test(`collision-real-destination-${path}`, async () => {
      const f = await fixture("real-collision");
      const artifacts = (await openCodeTarget.desiredArtifacts(f.roots)).filter((item) => item.relativePath === path);
      assert.equal(artifacts.length, 1, `actual catalog destination missing: ${path}`);
      await mkdir(dirname(f.target(path)), { recursive: true });
      await writeFile(f.target(path), "local");
      const before = await snapshot(f.root);
      await fail(() => createInstallPlan({ detect: openCodeTarget.detect, desiredArtifacts: async () => artifacts }, f.roots), "Unmanaged existing resource collision");
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
