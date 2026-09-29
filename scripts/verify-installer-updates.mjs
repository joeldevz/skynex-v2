import { writeFile, rm, mkdir } from "node:fs/promises";
import { createInstallPlan, applyInstallPlan, readInstallLock, readInstallLockSnapshot, prepareUpdatePlan, resolveInstallCollisions } from "../packages/installer/dist/index.js";
import { assert, fixture, readFile, sha, fail, detection, snapshot, exists } from "./verify-installer-support.mjs";

async function setup() {
  const f = await fixture("update");
  let upstream = "v1";
  const adapter = { detect: detection, desiredArtifacts: async () => [{
    resource: { id: "update-resource", kind: "skill", version: upstream },
    component: "skills", relativePath: "skill.md", content: upstream, sourceDigest: sha(upstream),
  }] };
  const plan = () => createInstallPlan(adapter, f.roots);
  const lock = () => readInstallLock(f.roots);
  await applyInstallPlan(await plan());
  await writeFile(f.target("skill.md"), "local-only");
  await applyInstallPlan(prepareUpdatePlan(await plan(), await lock()));
  assert.equal((await lock()).resources[0].installedDigest, sha("local-only"));
  assert.equal((await lock()).resources[0].sourceDigest, sha("v1"));
  upstream = "v2";
  return { ...f, plan, lock };
}
function assertPending(resource) {
  assert.equal(resource.installedDigest, sha("local-only"));
  assert.equal(resource.sourceDigest, sha("v1"));
  assert.equal(resource.version, "v1");
  assert.equal(resource.pendingSourceDigest, sha("v2"));
  assert.equal(resource.pendingVersion, "v2");
}
function assertAccepted(resource) {
  assert.equal(resource.installedDigest, sha("v2"));
  assert.equal(resource.sourceDigest, sha("v2"));
  assert.equal(resource.version, "v2");
  assert.equal(resource.pendingSourceDigest, undefined);
  assert.equal(resource.pendingVersion, undefined);
}
export async function verify(test) {
  for (const decision of ["overwrite", "preserve"]) {
    await test(`update-unmanaged-collision-${decision}-requires-explicit-choice`, async () => {
      const f = await fixture(`update-collision-${decision}`);
      let artifacts = [{ resource: { id: "existing", kind: "skill", version: "1" }, component: "skills", relativePath: "skills/existing.md", content: "existing" }];
      const adapter = { detect: detection, desiredArtifacts: async () => artifacts };
      await applyInstallPlan(await createInstallPlan(adapter, f.roots));
      const path = "skills/new.md";
      artifacts = [...artifacts, { resource: { id: "new", kind: "skill", version: "1" }, component: "skills", relativePath: path, content: "new" }];
      await mkdir(f.target("skills"), { recursive: true });
      await writeFile(f.target(path), "new");
      const base = await createInstallPlan(adapter, f.roots);
      assert.equal(base.operations.find((item) => item.relativePath === path).kind, "conflict");
      const before = await snapshot(f.root);
      const prior = await readInstallLock(f.roots);
      await fail(() => applyInstallPlan(prepareUpdatePlan(base, prior)), "Unresolved update conflict");
      assert.deepEqual(await snapshot(f.root), before);
      const plan = prepareUpdatePlan(resolveInstallCollisions(base, new Map([[path, decision]])), prior);
      await applyInstallPlan(plan);
      assert.equal(await readFile(f.target(path), "utf8"), "new");
      assert.equal((await readInstallLock(f.roots)).resources.some((item) => item.relativePath === path), decision === "overwrite");
    });
  }
  for (const decision of ["skip", "keep-local"]) {
    await test(`update-${decision}-actual-callback-and-pending`, async () => {
      const f = await setup();
      let calls = 0;
      const plan = prepareUpdatePlan(await f.plan(), await f.lock(), (operation, reason) => {
        calls++;
        assert.equal(reason, "conflict");
        assert.notEqual(operation.currentDigest, operation.desiredDigest);
        return decision;
      });
      assert.equal(calls, 1);
      assert.equal(plan.operations[0].decision, decision);
      assert.equal(plan.operations[0].kind, "unchanged");
      await applyInstallPlan(plan);
      assert.equal(await readFile(f.target("skill.md"), "utf8"), "local-only");
      assertPending((await f.lock()).resources[0]);
      const before = await snapshot(f.root);
      await fail(async () => applyInstallPlan(await f.plan()), "Customized managed resource");
      assert.deepEqual(await snapshot(f.root), before);
    });
  }
  await test("update-accept-pending-replaces-before-apply", async () => {
    const f = await setup();
    await applyInstallPlan(prepareUpdatePlan(await f.plan(), await f.lock(), () => "keep-local"));
    assertPending((await f.lock()).resources[0]);
    const before = await snapshot(f.root);
    await fail(async () => applyInstallPlan(prepareUpdatePlan(await f.plan(), await f.lock())), "Unresolved update conflict");
    assert.deepEqual(await snapshot(f.root), before);
    let calls = 0;
    const accepted = prepareUpdatePlan(await f.plan(), await f.lock(), (operation, reason) => {
      calls++;
      assert.equal(reason, "pending");
      assert.notEqual(operation.currentDigest, operation.desiredDigest);
      return "accept-upstream";
    });
    assert.equal(calls, 1);
    assert.equal(accepted.operations[0].decision, "accept-upstream");
    assert.equal(accepted.operations[0].kind, "replace");
    assert.equal(await readFile(f.target("skill.md"), "utf8"), "local-only");
    await applyInstallPlan(accepted);
    assert.equal(await readFile(f.target("skill.md"), "utf8"), "v2");
    assertAccepted((await f.lock()).resources[0]);
  });
  await test("update-converged-clears-pending-without-choice", async () => {
    const f = await setup();
    await applyInstallPlan(prepareUpdatePlan(await f.plan(), await f.lock(), () => "skip"));
    assertPending((await f.lock()).resources[0]);
    await writeFile(f.target("skill.md"), "v2");
    const plan = prepareUpdatePlan(await f.plan(), await f.lock(), () => assert.fail("converged callback invoked"));
    assert.equal(plan.operations[0].kind, "unchanged");
    await applyInstallPlan(plan);
    assert.equal(await readFile(f.target("skill.md"), "utf8"), "v2");
    assertAccepted((await f.lock()).resources[0]);
  });
  await test("update-reviewed-lock-only-change-refused-exact-bytes", async () => {
    const f = await setup();
    const reviewed = await readInstallLockSnapshot(f.roots, new Map([["update-resource", "skill.md"]]));
    const plan = prepareUpdatePlan(await f.plan(), reviewed.lock, () => "accept-upstream", sha(reviewed.bytes));
    const replacement = { ...reviewed.lock, installedAt: new Date(0).toISOString() };
    const replacementBytes = Buffer.from(`${JSON.stringify(replacement)}\n`);
    await writeFile(f.lockPath, replacementBytes);
    const targetBytes = await readFile(f.target("skill.md"));
    await fail(() => applyInstallPlan(plan), "Lock changed");
    assert.deepEqual(await readFile(f.lockPath), replacementBytes);
    assert.deepEqual(await readFile(f.target("skill.md")), targetBytes);
  });
  await test("legacy-lock-unknown-resource-tolerated-catalog-id-path-mismatch-refused", async () => {
    const f = await setup();
    const legacy = await f.lock();
    // A resource removed upstream is tolerated as prior state (no ownership of any
    // catalog path is granted by an unknown id/path).
    legacy.resources[0] = { ...legacy.resources[0], id: "agents.removed", relativePath: "agents/removed.md" };
    const bytes = Buffer.from(`${JSON.stringify(legacy)}\n`);
    await writeFile(f.lockPath, bytes);
    const snapshot = await readInstallLockSnapshot(f.roots, new Map([["agents.thalam", "agents/thalam.md"]]));
    assert(snapshot);
    assert.equal(snapshot.lock.resources[0].id, "agents.removed");
    assert.deepEqual(await readFile(f.lockPath), bytes);
    // A known catalog id pointing at a different path is still refused as tampered.
    const forged = await f.lock();
    forged.resources[0] = { ...forged.resources[0], id: "agents.thalam", relativePath: "agents/thalam-elsewhere.md" };
    const forgedBytes = Buffer.from(`${JSON.stringify(forged)}\n`);
    await writeFile(f.lockPath, forgedBytes);
    await fail(() => readInstallLockSnapshot(f.roots, new Map([["agents.thalam", "agents/thalam.md"]])), "does not match the installed catalog");
    assert.deepEqual(await readFile(f.lockPath), forgedBytes);
  });
  await test("update-target-reedit-and-missing-file-refused", async () => {
    const f = await setup();
    const plan = prepareUpdatePlan(await f.plan(), await f.lock(), () => "keep-local");
    const lockBytes = await readFile(f.lockPath);
    await writeFile(f.target("skill.md"), "edited-again");
    await fail(() => applyInstallPlan(plan), "Target changed after planning");
    assert.equal(await readFile(f.target("skill.md"), "utf8"), "edited-again");
    assert.deepEqual(await readFile(f.lockPath), lockBytes);
    await rm(f.target("skill.md"));
    await fail(async () => prepareUpdatePlan(await f.plan(), await f.lock()), "Managed resource is missing");
    assert.deepEqual(await readFile(f.lockPath), lockBytes);
    assert.equal(await exists(f.target("skill.md")), false);
  });
  await test("update-removes-resource-dropped-from-upstream", async () => {
    const f = await fixture("update-remove");
    const make = (relativePath, content) => ({ resource: { id: relativePath === "keep.md" ? "keep" : "drop", kind: "skill", version: "1" }, component: "skills", relativePath, content, sourceDigest: sha(content) });
    let resources = [make("keep.md", "keep"), make("drop.md", "drop")];
    const adapter = { detect: detection, desiredArtifacts: async () => resources };
    await applyInstallPlan(await createInstallPlan(adapter, f.roots));
    assert.equal(await exists(f.target("drop.md")), true);
    assert((await readInstallLock(f.roots)).resources.some((resource) => resource.relativePath === "drop.md"));
    resources = [make("keep.md", "keep")];
    const plan = await createInstallPlan(adapter, f.roots);
    const removal = plan.operations.find((operation) => operation.kind === "remove");
    assert(removal && removal.relativePath === "drop.md");
    await applyInstallPlan(prepareUpdatePlan(plan, await readInstallLock(f.roots)));
    assert.equal(await exists(f.target("drop.md")), false);
    const after = await readInstallLock(f.roots);
    assert(!after.resources.some((resource) => resource.relativePath === "drop.md"));
    assert(after.resources.some((resource) => resource.relativePath === "keep.md"));
  });
}
