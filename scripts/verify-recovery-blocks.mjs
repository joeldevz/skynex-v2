import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, lstat } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as tasks from "../packages/tasks/dist/index.js";
import * as taskNode from "../packages/tasks-node/dist/index.js";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const cli = join(rootDir, "apps/cli/dist/index.js");
const base = "/tmp/opencode";
const REF = { id: "evidence-1", sha256: "a".repeat(64) };
const workflowId = "THALAM-RECOVERY-20261029";
const checkpoint = {
  version: 1, WorkflowID: workflowId, AttemptID: "A2", NodeID: "core-red",
  BaseCandidateOID: "1".repeat(40), Scope: { paths: ["scripts/verify-recovery-blocks.mjs"], acceptance: ["C1"] },
  candidateOid: "2".repeat(40), candidateOidReason: null, manifestRef: null,
  phase: "basis", note: "compatibility", refs: [],
};

async function fixture() {
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "recovery-blocks-"));
  const store = taskNode.createFileTaskStore({ tasksRoot: root });
  const service = tasks.createTaskService({
    store,
    clock: { nowIso: () => "2026-10-29T12:00:00.000Z" },
    ids: { newId: () => "unused" },
  });
  const created = await service.createTask({ title: "Recovery contract task" });
  return { root, store, service, taskId: created.taskId };
}

async function clean(f) { await rm(f.root, { recursive: true, force: true }); }

function append(f, event, revision) {
  return f.service.appendRecoveryEvent(f.taskId, event, { expectedRevision: revision });
}

const baseline = (eventId = "baseline-1", overrides = {}) => ({
  eventId,
  type: "baseline.reconciled",
  payload: {
    WorkflowID: workflowId,
    repairsUsed: 0,
    diagnosesUsed: 0,
    securityExceptionUsed: false,
    evidenceRef: REF,
    ...overrides,
  },
});

const proposal = (eventId = "proposal-1", blockId = "block-1", previousBlockID = null) => ({
  eventId,
  type: "block.proposed",
  payload: {
    BlockID: blockId,
    ProblemIDs: ["problem-1"],
    previousBlockID,
    baseOid: "1".repeat(40),
    scopePaths: ["packages/tasks/src"],
    acceptance: ["C1"],
    strategy: "focused implementation",
    evidenceRef: REF,
  },
});

async function establishAcceptedBlock(f) {
  let rev = 1;
  rev = (await append(f, baseline(), rev)).revision;
  rev = (await append(f, proposal(), rev)).revision;
  rev = (await append(f, {
    eventId: "decision-1", type: "decision.recorded",
    payload: { BlockID: "block-1", proposalEventId: "proposal-1", decision: "accepted", humanRef: REF },
  }, rev)).revision;
  return rev;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cli, "task", "recovery", ...args], {
    cwd, encoding: "utf8", timeout: 20_000,
  });
}

function jsonResult(result) {
  assert.equal(result.signal, null, `CLI signal: ${result.signal}`);
  return JSON.parse(result.stdout);
}

await test("C1 legacy schema 1/2 and checkpoint v1 remain compatible; schema 3 persists recovery through ordinary writes", async () => {
  const parse = tasks.parseTask;
  const common = { id: "sample", title: "Sample", status: "open", revision: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", steps: [] };
  assert.equal(parse(JSON.stringify({ schemaVersion: 1, ...common }), "sample").schemaVersion, 1);
  assert.equal(parse(tasks.serializeTask(parse(JSON.stringify({ schemaVersion: 1, ...common }), "sample")), "sample").schemaVersion, 1);
  assert.equal(parse(JSON.stringify({ schemaVersion: 2, ...common, checkpoint }), "sample").checkpoint.version, 1);
  assert.equal(parse(tasks.serializeTask(parse(JSON.stringify({ schemaVersion: 2, ...common, checkpoint }), "sample")), "sample").checkpoint.version, 1);
  const f = await fixture();
  try {
    let rev = await establishAcceptedBlock(f);
    const persisted = await f.store.read(f.taskId);
    assert.equal(persisted.schemaVersion, 3);
    assert.equal(persisted.recovery.version, 1);
    await f.service.setCheckpoint(f.taskId, checkpoint, { expectedRevision: rev });
    rev += 1;
    await f.service.setReviews(f.taskId, { security: "off" }, { expectedRevision: rev });
    const after = await f.store.read(f.taskId);
    assert.deepEqual(after.recovery, persisted.recovery);
    assert.equal(after.reviews.security, "off");
  } finally { await clean(f); }
});

await test("C2 unknown baseline counters and security state do not permit spending", async () => {
  const f = await fixture();
  try {
    const rev = (await append(f, baseline("baseline-unknown", { repairsUsed: null, diagnosesUsed: null, securityExceptionUsed: null }), 1)).revision;
    await assert.rejects(() => append(f, proposal(), rev), /baseline|known|counter/i);
    assert.equal((await f.store.read(f.taskId)).revision, rev);
  } finally { await clean(f); }
});

await test("C3 decisions gate reservations; first and continued block limits are policy-derived", async () => {
  const f = await fixture();
  try {
    let rev = (await append(f, baseline(), 1)).revision;
    rev = (await append(f, proposal(), rev)).revision;
    const reservation = (id, kind, eventId = `reserve-${id}`) => ({ eventId, type: "attempt.reserved", payload: { BlockID: "block-1", AttemptID: id, NodeID: "core-red", ProblemID: "problem-1", kind, mode: "direct", owner: "core-red" } });
    await assert.rejects(() => append(f, reservation("premature", "repair"), rev), /decision|accepted/i);
    await assert.rejects(() => append(f, { eventId: "wrong-decision", type: "decision.recorded", payload: { BlockID: "block-1", proposalEventId: "other", decision: "accepted", humanRef: REF } }, rev));
    rev = (await append(f, { eventId: "decision-1", type: "decision.recorded", payload: { BlockID: "block-1", proposalEventId: "proposal-1", decision: "accepted", humanRef: REF } }, rev)).revision;
    for (let i = 1; i <= 6; i += 1) {
      rev = (await append(f, reservation(`repair-${i}`, "repair"), rev)).revision;
      rev = (await append(f, { eventId: `start-repair-${i}`, type: "attempt.started", payload: { AttemptID: `repair-${i}`, handle: `repair-handle-${i}` } }, rev)).revision;
      rev = (await append(f, { eventId: `finish-repair-${i}`, type: "attempt.finished", payload: { AttemptID: `repair-${i}`, outcome: "success", evidenceRef: REF } }, rev)).revision;
    }
    for (let i = 1; i <= 3; i += 1) {
      rev = (await append(f, reservation(`diagnosis-${i}`, "diagnosis"), rev)).revision;
      rev = (await append(f, { eventId: `start-diagnosis-${i}`, type: "attempt.started", payload: { AttemptID: `diagnosis-${i}`, handle: `diagnosis-handle-${i}` } }, rev)).revision;
      rev = (await append(f, { eventId: `finish-diagnosis-${i}`, type: "attempt.finished", payload: { AttemptID: `diagnosis-${i}`, outcome: "success", evidenceRef: REF } }, rev)).revision;
    }
    await assert.rejects(() => append(f, reservation("repair-over", "repair"), rev), /budget|limit|capacity/i);
    await assert.rejects(() => append(f, reservation("diagnosis-over", "diagnosis"), rev), /budget|limit|capacity/i);
    const summary = (await f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit: 20 })).summary;
    assert.deepEqual([summary.blocks[0].repairLimit, summary.blocks[0].diagnosisLimit], [6, 3]);
    assert.equal(summary.blocks[0].status, "accepted");
  } finally { await clean(f); }
});

await test("C3 rejected decisions cannot reserve; cancelled unstarted attempts refund and continuation is limited to 2/1", async () => {
  const denied = await fixture();
  try {
    let rev = (await append(denied, baseline(), 1)).revision;
    rev = (await append(denied, proposal(), rev)).revision;
    const reserve = { eventId: "reserve-denied", type: "attempt.reserved", payload: { BlockID: "block-1", AttemptID: "denied-attempt", NodeID: "core-red", ProblemID: "problem-1", kind: "repair", mode: "direct", owner: "core-red" } };
    await assert.rejects(() => append(denied, reserve, rev), /decision|accepted/i);
    rev = (await append(denied, { eventId: "decision-rejected", type: "decision.recorded", payload: { BlockID: "block-1", proposalEventId: "proposal-1", decision: "rejected", humanRef: REF } }, rev)).revision;
    await assert.rejects(() => append(denied, reserve, rev), /decision|accepted|rejected/i);
  } finally { await clean(denied); }

  const f = await fixture();
  try {
    let rev = await establishAcceptedBlock(f);
    rev = (await append(f, { eventId: "reserve-1", type: "attempt.reserved", payload: { BlockID: "block-1", AttemptID: "attempt-1", NodeID: "core-red", ProblemID: "problem-1", kind: "repair", mode: "direct", owner: "core-red" } }, rev)).revision;
    rev = (await append(f, { eventId: "cancel-1", type: "attempt.cancelled", payload: { AttemptID: "attempt-1", evidenceRef: REF } }, rev)).revision;
    assert.equal((await f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit: 20 })).summary.blocks[0].repairsUsed, 0);
    rev = (await append(f, { eventId: "close-1", type: "block.closed", payload: { BlockID: "block-1", reason: "accepted", evidenceRef: REF } }, rev)).revision;
    rev = (await append(f, proposal("proposal-2", "block-2", "block-1"), rev)).revision;
    rev = (await append(f, { eventId: "decision-2", type: "decision.recorded", payload: { BlockID: "block-2", proposalEventId: "proposal-2", decision: "accepted", humanRef: REF } }, rev)).revision;
    for (const [id, kind] of [["continuation-repair-1", "repair"], ["continuation-repair-2", "repair"], ["continuation-diagnosis-1", "diagnosis"]]) {
      rev = (await append(f, { eventId: `reserve-${id}`, type: "attempt.reserved", payload: { BlockID: "block-2", AttemptID: id, NodeID: "core-red", ProblemID: "problem-1", kind, mode: "delegated", owner: "coder" } }, rev)).revision;
      rev = (await append(f, { eventId: `start-${id}`, type: "attempt.started", payload: { AttemptID: id, handle: `handle-${id}` } }, rev)).revision;
      rev = (await append(f, { eventId: `finish-${id}`, type: "attempt.finished", payload: { AttemptID: id, outcome: "success", evidenceRef: REF } }, rev)).revision;
    }
    await assert.rejects(() => append(f, { eventId: "continuation-repair-over", type: "attempt.reserved", payload: { BlockID: "block-2", AttemptID: "continuation-repair-over", NodeID: "core-red", ProblemID: "problem-1", kind: "repair", mode: "direct", owner: "core-red" } }, rev), /budget|limit|capacity/i);
    await assert.rejects(() => append(f, { eventId: "continuation-diagnosis-over", type: "attempt.reserved", payload: { BlockID: "block-2", AttemptID: "continuation-diagnosis-over", NodeID: "core-red", ProblemID: "problem-1", kind: "diagnosis", mode: "direct", owner: "core-red" } }, rev), /budget|limit|capacity/i);
    const summary = (await f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit: 20 })).summary;
    assert.deepEqual([summary.blocks[1].repairLimit, summary.blocks[1].diagnosisLimit], [2, 1]);
  } finally { await clean(f); }
});

await test("C4 delegated and direct attempts charge equally; uncertain started work blocks closure without refund", async () => {
  const f = await fixture();
  try {
    let rev = await establishAcceptedBlock(f);
    for (const [attemptId, mode, owner] of [["attempt-direct", "direct", "core-red"], ["attempt-delegated", "delegated", "coder"]]) {
      const before = (await f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit: 20 })).summary.blocks[0].repairsUsed;
      rev = (await append(f, { eventId: `reserve-${attemptId}`, type: "attempt.reserved", payload: { BlockID: "block-1", AttemptID: attemptId, NodeID: mode === "direct" ? "core-red" : "worker-1", ProblemID: "problem-1", kind: "repair", mode, owner } }, rev)).revision;
      const after = (await f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit: 20 })).summary.blocks[0].repairsUsed;
      assert.equal(after - before, 1, `${mode} reservation must consume exactly one repair`);
    }
    rev = (await append(f, { eventId: "started-direct", type: "attempt.started", payload: { AttemptID: "attempt-direct", handle: "direct-handle" } }, rev)).revision;
    rev = (await append(f, { eventId: "finished-direct", type: "attempt.finished", payload: { AttemptID: "attempt-direct", outcome: "failure", evidenceRef: REF } }, rev)).revision;
    rev = (await append(f, { eventId: "started-delegated", type: "attempt.started", payload: { AttemptID: "attempt-delegated", handle: "worker-handle" } }, rev)).revision;
    rev = (await append(f, { eventId: "uncertain-delegated", type: "attempt.uncertain", payload: { AttemptID: "attempt-delegated", reason: "worker ended without outcome" } }, rev)).revision;
    await assert.rejects(() => append(f, { eventId: "cancel-started", type: "attempt.cancelled", payload: { AttemptID: "attempt-delegated", evidenceRef: REF } }, rev));
    await assert.rejects(() => append(f, { eventId: "reconcile-not-started", type: "attempt.reconciled", payload: { AttemptID: "attempt-delegated", outcome: "not_started", evidenceRef: REF } }, rev));
    await assert.rejects(() => append(f, { eventId: "close-1", type: "block.closed", payload: { BlockID: "block-1", reason: "human", evidenceRef: REF } }, rev), /terminal|active|uncertain/i);
    const summary = (await f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit: 20 })).summary;
    assert.equal(summary.blocks[0].repairsUsed, 2);
    assert.deepEqual(summary.attempts.map(({ state }) => state), ["finished", "uncertain"]);
  } finally { await clean(f); }
});

await test("C5 exact duplicate is idempotent, divergent reuse and stale revisions reject; strict event IDs and payload fields", async () => {
  const f = await fixture();
  try {
    const event = baseline();
    const first = await append(f, event, 1);
    const duplicate = await append(f, event, first.revision);
    assert.equal(duplicate.changed, false);
    assert.equal(duplicate.revision, first.revision);
    await assert.rejects(() => append(f, baseline("baseline-1", { repairsUsed: 1 }), first.revision), /event|duplicate|reuse|different/i);
    await assert.rejects(() => append(f, baseline("baseline-2"), 1), /revision|stale/i);
    await assert.rejects(() => append(f, { ...baseline("bad-key"), unexpected: true }, first.revision), /field|key|invalid/i);
    await assert.rejects(() => append(f, { eventId: "bad-ref", type: "baseline.reconciled", payload: { ...event.payload, evidenceRef: { id: "bad/ref", sha256: "short" } } }, first.revision), /reference|digest|invalid/i);
    await assert.rejects(() => append(f, { eventId: "bad-id!", type: "baseline.reconciled", payload: event.payload }, first.revision), /event|id|invalid/i);
    await assert.rejects(() => append(f, { eventId: "extra-payload", type: "baseline.reconciled", payload: { ...event.payload, surprise: true } }, first.revision), /field|key|invalid/i);

    let rev = first.revision;
    rev = (await append(f, proposal(), rev)).revision;
    rev = (await append(f, { eventId: "decision-1", type: "decision.recorded", payload: { BlockID: "block-1", proposalEventId: "proposal-1", decision: "accepted", humanRef: REF } }, rev)).revision;
    rev = (await append(f, { eventId: "reserve-reused", type: "attempt.reserved", payload: { BlockID: "block-1", AttemptID: "same-attempt", NodeID: "core-red", ProblemID: "problem-1", kind: "repair", mode: "direct", owner: "core-red" } }, rev)).revision;
    rev = (await append(f, { eventId: "cancel-reused", type: "attempt.cancelled", payload: { AttemptID: "same-attempt", evidenceRef: REF } }, rev)).revision;
    rev = (await append(f, { eventId: "close-1", type: "block.closed", payload: { BlockID: "block-1", reason: "accepted", evidenceRef: REF } }, rev)).revision;
    rev = (await append(f, proposal("proposal-2", "block-2", "block-1"), rev)).revision;
    rev = (await append(f, { eventId: "decision-2", type: "decision.recorded", payload: { BlockID: "block-2", proposalEventId: "proposal-2", decision: "accepted", humanRef: REF } }, rev)).revision;
    await assert.rejects(() => append(f, { eventId: "reserve-reused-again", type: "attempt.reserved", payload: { BlockID: "block-2", AttemptID: "same-attempt", NodeID: "core-red", ProblemID: "problem-1", kind: "repair", mode: "direct", owner: "core-red" } }, rev), /attempt|reuse|duplicate|id/i);
  } finally { await clean(f); }
});

await test("C6 history pagination is bounded and returns a continuation sequence", async () => {
  const f = await fixture();
  try {
    let rev = 1;
    for (const [index, event] of [baseline(), proposal(), { eventId: "decision-1", type: "decision.recorded", payload: { BlockID: "block-1", proposalEventId: "proposal-1", decision: "accepted", humanRef: REF } }].entries()) {
      rev = (await append(f, event, rev)).revision;
    }
    const page = await f.service.getRecoveryHistory(f.taskId, { afterSequence: 1, limit: 1 });
    assert.deepEqual(page.events.map(({ sequence }) => sequence), [2]);
    assert.equal(page.nextSequence, 2);
    for (const limit of [0, 101, 1.5, -1]) {
      await assert.rejects(() => f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit }), /limit|integer|invalid/i);
    }
    for (const afterSequence of [-1, 0.5]) {
      await assert.rejects(() => f.service.getRecoveryHistory(f.taskId, { afterSequence, limit: 20 }), /sequence|integer|invalid/i);
    }
  } finally { await clean(f); }
});

await test("C7 pending events reserve task capacity; ordinary mutation cannot consume terminal reserve", async () => {
  const f = await fixture();
  try {
    let rev = await establishAcceptedBlock(f);
    const taskPath = join(f.root, f.taskId, "task.json");
    rev = (await append(f, { eventId: "reserve-existing", type: "attempt.reserved", payload: { BlockID: "block-1", AttemptID: "attempt-existing", NodeID: "node-1", ProblemID: "problem-1", kind: "repair", mode: "direct", owner: "owner" } }, rev)).revision;
    let refused = false;
    for (let i = 0; i < 100; i += 1) {
      const before = await readFile(taskPath);
      try {
        const result = await f.service.addStep(f.taskId, {
          title: `Capacity step ${String(i + 1).padStart(3, "0")}`,
          scope: "s".repeat(2000), doneWhen: "d".repeat(2000), expectedEvidence: "e".repeat(2000),
        }, { expectedRevision: rev });
        rev = result.revision;
      } catch (error) {
        assert.match(String(error?.message ?? error), /capacity|size|large|reserve|FILE_TOO_LARGE/i);
        assert.deepEqual(await readFile(taskPath), before, "rejected ordinary mutation must leave task.json unchanged");
        refused = true;
        break;
      }
    }
    assert.equal(refused, true, "valid bounded step additions must reach the reserved-capacity boundary");
    await assert.rejects(() => append(f, { eventId: "reserve-extra", type: "attempt.reserved", payload: { BlockID: "block-1", AttemptID: "attempt-extra", NodeID: "node-1", ProblemID: "problem-1", kind: "repair", mode: "direct", owner: "owner" } }, rev), /capacity|size|large|reserve|FILE_TOO_LARGE/i);
    rev = (await append(f, { eventId: "start-existing", type: "attempt.started", payload: { AttemptID: "attempt-existing", handle: "task-capacity-test" } }, rev)).revision;
    rev = (await append(f, { eventId: "finish-existing", type: "attempt.finished", payload: { AttemptID: "attempt-existing", outcome: "success", evidenceRef: REF } }, rev)).revision;
    rev = (await append(f, { eventId: "close-existing", type: "block.closed", payload: { BlockID: "block-1", reason: "accepted", evidenceRef: REF } }, rev)).revision;
    const history = await f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit: 100 });
    assert.equal(history.summary.blocks[0].status, "closed");
    assert.equal(history.summary.attempts[0].state, "finished");
    assert.equal((await f.store.read(f.taskId)).revision, rev);
  } finally { await clean(f); }
});

await test("C8 real file store uses task.json snapshot and fails closed on existing lock and symlink without mutation", async () => {
  const f = await fixture();
  try {
    let rev = await establishAcceptedBlock(f);
    const path = join(f.root, f.taskId, "task.json");
    const before = await readFile(path);
    const lockPath = join(f.root, f.taskId, ".task.lock");
    const lockBytes = Buffer.from("owned by another writer");
    await writeFile(lockPath, lockBytes);
    await assert.rejects(() => append(f, { eventId: "close-1", type: "block.closed", payload: { BlockID: "block-1", reason: "human", evidenceRef: REF } }, rev), /lock/i);
    assert.deepEqual(await readFile(path), before);
    assert.deepEqual(await readFile(lockPath), lockBytes);
    const target = join(f.root, "external");
    await mkdir(target);
    await writeFile(join(target, "task.json"), "sentinel");
    await rm(join(f.root, f.taskId), { recursive: true, force: true });
    await symlink(target, join(f.root, f.taskId));
    await assert.rejects(() => f.service.getRecoveryHistory(f.taskId, { afterSequence: 0, limit: 20 }));
    assert.equal(await readFile(join(target, "task.json"), "utf8"), "sentinel");
    assert.equal((await lstat(join(f.root, f.taskId))).isSymbolicLink(), true);
  } finally { await clean(f); }
});

await test("C9 isolated CLI records and paginates metadata without task execution or security-toggle changes", async () => {
  const f = await fixture();
  try {
    const before = await f.service.getReviews(f.taskId);
    const event = baseline();
    const recorded = runCli(["record", "--event", JSON.stringify(event), "--task", f.taskId, "--expected-revision", "1", "--tasks-root", f.root, "--json"], f.root);
    assert.equal(recorded.status, 0, recorded.stderr);
    const envelope = jsonResult(recorded);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.taskId, f.taskId);
    assert.equal(envelope.revision, 2);
    const history = runCli(["history", "--task", f.taskId, "--after-sequence", "0", "--limit", "20", "--tasks-root", f.root, "--json"], f.root);
    assert.equal(history.status, 0, history.stderr);
    const page = jsonResult(history);
    assert.equal(page.ok, true);
    assert.equal(page.events.length, 1);
    assert.equal((await f.service.getReviews(f.taskId)).reviews.security, before.reviews.security);
    assert.deepEqual((await f.store.read(f.taskId)).steps, []);
  } finally { await clean(f); }
});
