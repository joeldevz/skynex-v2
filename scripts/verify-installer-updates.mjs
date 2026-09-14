import { writeFile, rm } from "node:fs/promises";
import { createInstallPlan, applyInstallPlan, readInstallLock, readInstallLockSnapshot, prepareUpdatePlan } from "../packages/installer/dist/index.js";
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
  await test("project-rename-does-not-migrate-legacy-lock-ownership", async () => {
    const f = await setup();
    const legacy = await f.lock();
    legacy.resources[0] = { ...legacy.resources[0], id: "agents.skynex-orchestrator", relativePath: "agents/skynex-orchestrator.md" };
    const bytes = Buffer.from(`${JSON.stringify(legacy)}\n`);
    await writeFile(f.lockPath, bytes);
    await fail(() => readInstallLockSnapshot(f.roots, new Map([["agents.thalam", "agents/thalam.md"]])), "does not match the installed catalog");
    assert.deepEqual(await readFile(f.lockPath), bytes);
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
}
