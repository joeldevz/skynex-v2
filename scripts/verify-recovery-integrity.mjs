import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import * as tasks from "../packages/tasks/dist/index.js";
import * as taskNode from "../packages/tasks-node/dist/index.js";

const REF = { id: "evidence-1", sha256: "a".repeat(64) };
const workflowId = "THALAM-RECOVERY-20261029";
const now = "2026-10-29T12:00:00.000Z";

async function fixture() {
  await mkdir("/tmp/opencode", { recursive: true });
  const root = await mkdtemp(join("/tmp/opencode", "recovery-integrity-"));
  const store = taskNode.createFileTaskStore({ tasksRoot: root });
  const service = tasks.createTaskService({
    store,
    clock: { nowIso: () => now },
    ids: { newId: () => "unused" },
  });
  const { taskId } = await service.createTask({ title: "Recovery integrity" });
  return { root, store, service, taskId, path: join(root, taskId, "task.json") };
}

async function clean(f) { await rm(f.root, { recursive: true, force: true }); }
function append(f, event, revision) { return f.service.appendRecoveryEvent(f.taskId, event, { expectedRevision: revision }); }
function baseline(eventId = "baseline-1", overrides = {}) {
  return { eventId, type: "baseline.reconciled", payload: { WorkflowID: workflowId, repairsUsed: 0, diagnosesUsed: 0, securityExceptionUsed: false, evidenceRef: REF, ...overrides } };
}
function proposal(eventId = "proposal-1", blockId = "block-1", previousBlockID = null) {
  return { eventId, type: "block.proposed", payload: { BlockID: blockId, ProblemIDs: ["problem-1"], previousBlockID, baseOid: "1".repeat(40), scopePaths: ["packages/tasks/src"], acceptance: ["C1"], strategy: "focused implementation", evidenceRef: REF } };
}
function decision(blockId = "block-1", proposalEventId = "proposal-1", choice = "accepted", eventId = "decision-1") {
  return { eventId, type: "decision.recorded", payload: { BlockID: blockId, proposalEventId, decision: choice, humanRef: REF } };
}
function reservation(attemptId = "attempt-1") {
  return { eventId: `reserve-${attemptId}`, type: "attempt.reserved", payload: { BlockID: "block-1", AttemptID: attemptId, NodeID: "core-red", ProblemID: "problem-1", kind: "repair", mode: "direct", owner: "core-red" } };
}
async function establishAccepted(f) {
  let rev = (await append(f, baseline(), 1)).revision;
  rev = (await append(f, proposal(), rev)).revision;
  rev = (await append(f, decision(), rev)).revision;
  return rev;
}

await test("I1/C5/C8 persisted history validates event relationships on parse and real-store read without rewriting bytes", async () => {
  const f = await fixture();
  try {
    await establishAccepted(f);
    const validBytes = await readFile(f.path);
    const validText = validBytes.toString("utf8");
    assert.equal(tasks.parseTask(validText, f.taskId).recovery.events.length, 3, "a valid snapshot must round-trip");
    const validSnapshot = JSON.parse(validText);
    const scenarios = [
      {
        name: "decision references missing proposal",
        pattern: /proposal|decision|recovery|history/i,
        mutate(snapshot) { snapshot.recovery.events[2].payload.proposalEventId = "missing-proposal"; },
      },
      {
        name: "first proposal references nonexistent predecessor",
        pattern: /previous|predecessor|block|recovery|history/i,
        mutate(snapshot) { snapshot.recovery.events[1].payload.previousBlockID = "missing-block"; },
      },
      {
        name: "started attempt has no reservation",
        pattern: /reservation|attempt|recovery|history/i,
        mutate(snapshot, pushEvent) { pushEvent(snapshot, "attempt.started", { AttemptID: "orphan", handle: "h" }, "orphan-start"); },
      },
      {
        name: "seven completed repair reservations exceed the block limit",
        pattern: /budget|limit|repair|recovery|history/i,
        mutate(snapshot, pushEvent) {
          for (let i = 1; i <= 7; i += 1) {
            const attemptId = `overquota-${i}`;
            pushEvent(snapshot, "attempt.reserved", { BlockID: "block-1", AttemptID: attemptId, NodeID: "core-red", ProblemID: "problem-1", kind: "repair", mode: "direct", owner: "core-red" }, `overquota-reserve-${i}`);
            pushEvent(snapshot, "attempt.started", { AttemptID: attemptId, handle: "h" }, `overquota-start-${i}`);
            pushEvent(snapshot, "attempt.finished", { AttemptID: attemptId, outcome: "success", evidenceRef: REF }, `overquota-finish-${i}`);
          }
        },
      },
      {
        name: "started uncertain attempt cannot reconcile as not_started",
        pattern: /started|not_started|reconcil|attempt|recovery|history/i,
        mutate(snapshot, pushEvent) {
          pushEvent(snapshot, "attempt.reserved", { BlockID: "block-1", AttemptID: "started-uncertain", NodeID: "core-red", ProblemID: "problem-1", kind: "repair", mode: "direct", owner: "core-red" }, "started-uncertain-reserve");
          pushEvent(snapshot, "attempt.started", { AttemptID: "started-uncertain", handle: "h" }, "started-uncertain-start");
          pushEvent(snapshot, "attempt.uncertain", { AttemptID: "started-uncertain", reason: "worker outcome unknown" }, "started-uncertain-uncertain");
          pushEvent(snapshot, "attempt.reconciled", { AttemptID: "started-uncertain", outcome: "not_started", evidenceRef: REF }, "started-uncertain-reconcile");
        },
      },
    ];
    const pushEvent = (snapshot, type, payload, eventId) => {
      snapshot.recovery.events.push({ sequence: snapshot.recovery.events.length + 1, eventId, at: now, type, payload });
    };
    for (const scenario of scenarios) {
      const corrupted = structuredClone(validSnapshot);
      scenario.mutate(corrupted, pushEvent);
      const invalidBytes = Buffer.from(`${JSON.stringify(corrupted, null, 2)}\n`);
      await writeFile(f.path, invalidBytes);
      const storedBytes = await readFile(f.path);
      assert.throws(
        () => tasks.parseTask(storedBytes.toString("utf8"), f.taskId),
        scenario.pattern,
        `${scenario.name}: parseTask must reject semantically invalid history`,
      );
      await assert.rejects(
        () => f.store.read(f.taskId),
        scenario.pattern,
        `${scenario.name}: real store read must reject semantically invalid history`,
      );
      assert.deepEqual(await readFile(f.path), storedBytes, `${scenario.name}: rejected history must not be rewritten`);
    }
  } finally { await clean(f); }
});

await test("I2/C2 unknown baseline can reconcile to known values and then permits ordinary spending", async () => {
  const f = await fixture();
  try {
    let rev = (await append(f, baseline("baseline-unknown", { repairsUsed: null, diagnosesUsed: null, securityExceptionUsed: null }), 1)).revision;
    rev = (await append(f, baseline("baseline-known", { repairsUsed: 2, diagnosesUsed: 1, securityExceptionUsed: true }), rev)).revision;
    const summary = (await f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit: 20 })).summary;
    assert.equal(summary.baselineKnown, true);
    assert.equal(summary.WorkflowID, workflowId);
    assert.deepEqual([summary.repairsUsed, summary.diagnosesUsed, summary.securityExceptionUsed], [2, 1, true]);
    rev = (await append(f, proposal(), rev)).revision;
    assert.equal((await f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit: 20 })).events.length, 3);
  } finally { await clean(f); }
});

await test("I2/C2 baseline reconciliation preserves workflow identity, known counters, and a true security state", async () => {
  const f = await fixture();
  try {
    let rev = (await append(f, baseline("baseline-1", { repairsUsed: 2, diagnosesUsed: 1, securityExceptionUsed: true }), 1)).revision;
    const before = await readFile(f.path);
    for (const event of [
      baseline("workflow-change", { WorkflowID: "OTHER-WORKFLOW", repairsUsed: 2, diagnosesUsed: 1, securityExceptionUsed: true }),
      baseline("counter-decrease", { repairsUsed: 1, diagnosesUsed: 1, securityExceptionUsed: true }),
      baseline("known-to-unknown", { repairsUsed: null, diagnosesUsed: 1, securityExceptionUsed: true }),
      baseline("security-reset", { repairsUsed: 2, diagnosesUsed: 1, securityExceptionUsed: false }),
    ]) {
      await assert.rejects(() => append(f, event, rev), /workflow|baseline|counter|security|decrease|reset|invalid/i);
      assert.deepEqual(await readFile(f.path), before);
    }
  } finally { await clean(f); }
});

await test("I3/C3 a first proposal cannot cite a nonexistent predecessor", async () => {
  const f = await fixture();
  try {
    const rev = (await append(f, baseline(), 1)).revision;
    await assert.rejects(() => append(f, proposal("proposal-first", "block-first", "missing-block"), rev), /previous|predecessor|continuation|block/i);
    assert.equal((await f.store.read(f.taskId)).recovery.events.length, 1);
  } finally { await clean(f); }
});

await test("I3/C3 a rejected proposal can be cancelled closed without attempts, then continued", async () => {
  const f = await fixture();
  try {
    let rev = (await append(f, baseline(), 1)).revision;
    rev = (await append(f, proposal(), rev)).revision;
    rev = (await append(f, decision("block-1", "proposal-1", "rejected"), rev)).revision;
    rev = (await append(f, { eventId: "close-rejected", type: "block.closed", payload: { BlockID: "block-1", reason: "cancelled", evidenceRef: REF } }, rev)).revision;
    rev = (await append(f, proposal("proposal-2", "block-2", "block-1"), rev)).revision;
    assert.equal((await f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit: 20 })).summary.blocks[1].BlockID, "block-2");
  } finally { await clean(f); }
});

await test("I4/C5 strict recovery inputs reject noncanonical IDs, enum arrays, malformed arrays, and unsafe paths", async () => {
  const event = baseline();
  const bad = [
    { ...event, payload: { ...event.payload, evidenceRef: { id: 123, sha256: "a".repeat(64) } } },
    { eventId: "bad-outcome", type: "attempt.finished", payload: { AttemptID: "a1", outcome: ["success"], evidenceRef: REF } },
    { ...proposal(), payload: { ...proposal().payload, ProblemIDs: [17] } },
    { ...proposal(), payload: { ...proposal().payload, ProblemIDs: ["bad id"] } },
    { ...proposal(), payload: { ...proposal().payload, acceptance: [null] } },
    { ...proposal(), payload: { ...proposal().payload, acceptance: ["bad id"] } },
    ...["C:\\work\\repo", "\\\\server\\share", "safe\u0001path"].map((scope) => ({ ...proposal(), payload: { ...proposal().payload, scopePaths: [scope] } })),
  ];
  for (const input of bad) assert.throws(() => tasks.parseRecoveryInput(input), /invalid|safe|field|id|outcome|ProblemIDs|acceptance/i);
  assert.throws(() => tasks.parseRecoveryLog({ version: 1, unexpected: true, events: [] }), /invalid|field|schema|recovery/i);
});

await test("I6/C5 persisted recovery wrapper enforces bounded timestamps while accepting service ISO timestamps", async () => {
  const f = await fixture();
  try {
    await append(f, baseline(), 1);
    const valid = await readFile(f.path, "utf8");
    assert.equal(tasks.parseTask(valid, f.taskId).recovery.events[0].at, now);
    const corrupted = JSON.parse(valid);
    corrupted.recovery.events[0].at = "x".repeat(5000);
    await writeFile(f.path, JSON.stringify(corrupted));
    await assert.rejects(() => f.store.read(f.taskId), /timestamp|date|wrapper|invalid|size|bound/i);
  } finally { await clean(f); }
});

await test("I5/C7 attempt admission reserves future event slots as well as bytes", async () => {
  const f = await fixture();
  try {
    let rev = 1;
    for (let i = 0; i < 252; i += 1) rev = (await append(f, baseline(`baseline-${i + 1}`), rev)).revision;
    rev = (await append(f, proposal(), rev)).revision;
    rev = (await append(f, decision(), rev)).revision;
    assert.equal((await f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit: 100 })).events.length, 100);
    const before = await readFile(f.path);
    await assert.rejects(() => append(f, reservation(), rev), /event|slot|capacity|limit|history/i);
    assert.deepEqual(await readFile(f.path), before, "refused reservation must not change the task snapshot");
  } finally { await clean(f); }
});
