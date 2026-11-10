import { TaskError } from "./errors.js";
import type { RecoveryEvent, RecoveryEventInput, RecoveryLog, Task } from "./task.js";
import { MAX_TASK_JSON_BYTES } from "./task.js";

export type { RecoveryEventInput } from "./task.js";
export const MAX_RECOVERY_EVENTS = 256;
export const MAX_RECOVERY_EVENT_BYTES = 4096;
export const MAX_RECOVERY_NESTED_BYTES = 8192;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^[a-fA-F0-9]{64}$/;
const OID = /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function fail(message: string): never { throw new TaskError("INVALID_ARGUMENT", message); }

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).length !== allowed.length || Object.keys(value).some((key) => !allowed.includes(key))) fail(`${label} has invalid fields`);
}
function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID.test(value)) fail(`${label} is an invalid ID`);
  return value;
}
function parseText(value: unknown, label: string, maximum = 2000): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) fail(`${label} is invalid`);
  return value;
}
function parseRef(value: unknown, label: string): { readonly id: string; readonly sha256: string } {
  if (!isRecord(value)) fail(`${label} is invalid`);
  assertKeys(value, ["id", "sha256"], label);
  if (typeof value["id"] !== "string" || !ID.test(value["id"]) || typeof value["sha256"] !== "string" || !DIGEST.test(value["sha256"])) fail(`${label} digest/reference is invalid`);
  return { id: value["id"], sha256: value["sha256"] };
}
function parseStringArray(value: unknown, label: string, ids: boolean, paths = false): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) fail(`${label} is invalid`);
  const result = value.map((item) => {
    if (typeof item !== "string" || item.length === 0 || item.length > 240) fail(`${label} is invalid`);
    if (ids && !ID.test(item)) fail(`${label} entries must be valid IDs`);
    if (paths && (item.startsWith("/") || /^[A-Za-z]:/.test(item) || item.includes("\\") || /[\x00-\x1f\x7f]/.test(item) || item.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))) fail(`${label} must contain safe relative paths`);
    return item;
  });
  if (new Set(result).size !== result.length) fail(`${label} entries must be distinct`);
  return result;
}
function parseOutcome(value: unknown, allowed: readonly string[], label: string): string {
  if (typeof value !== "string" || !allowed.includes(value)) fail(`${label} is invalid`);
  return value;
}

export function parseRecoveryInput(value: unknown): RecoveryEventInput {
  if (!isRecord(value)) fail("Recovery event must be an object");
  assertKeys(value, ["eventId", "type", "payload"], "Recovery event");
  const eventId = parseId(value["eventId"], "eventId");
  const type = value["type"];
  const payload = value["payload"];
  if (!isRecord(payload)) fail("Recovery payload must be an object");
  let parsed: Record<string, unknown>;
  switch (type) {
    case "baseline.reconciled": {
      assertKeys(payload, ["WorkflowID", "repairsUsed", "diagnosesUsed", "securityExceptionUsed", "evidenceRef"], "baseline payload");
      const count = (value: unknown, label: string): number | null => {
        if (value === null) return null;
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(`${label} is invalid`);
        return value;
      };
      const security = payload["securityExceptionUsed"];
      if (security !== null && typeof security !== "boolean") fail("securityExceptionUsed is invalid");
      parsed = { WorkflowID: parseId(payload["WorkflowID"], "WorkflowID"), repairsUsed: count(payload["repairsUsed"], "repairsUsed"), diagnosesUsed: count(payload["diagnosesUsed"], "diagnosesUsed"), securityExceptionUsed: security, evidenceRef: parseRef(payload["evidenceRef"], "evidenceRef") };
      break;
    }
    case "block.proposed": {
      assertKeys(payload, ["BlockID", "ProblemIDs", "previousBlockID", "baseOid", "scopePaths", "acceptance", "strategy", "evidenceRef"], "proposal payload");
      const previous = payload["previousBlockID"];
      if (previous !== null) parseId(previous, "previousBlockID");
      if (typeof payload["baseOid"] !== "string" || !OID.test(payload["baseOid"])) fail("baseOid is invalid");
      parsed = { BlockID: parseId(payload["BlockID"], "BlockID"), ProblemIDs: parseStringArray(payload["ProblemIDs"], "ProblemIDs", true), previousBlockID: previous, baseOid: payload["baseOid"], scopePaths: parseStringArray(payload["scopePaths"], "scopePaths", false, true), acceptance: parseStringArray(payload["acceptance"], "acceptance", true), strategy: parseText(payload["strategy"], "strategy"), evidenceRef: parseRef(payload["evidenceRef"], "evidenceRef") };
      break;
    }
    case "decision.recorded": {
      assertKeys(payload, ["BlockID", "proposalEventId", "decision", "humanRef"], "decision payload");
      parsed = { BlockID: parseId(payload["BlockID"], "BlockID"), proposalEventId: parseId(payload["proposalEventId"], "proposalEventId"), decision: parseOutcome(payload["decision"], ["accepted", "rejected"], "decision"), humanRef: parseRef(payload["humanRef"], "humanRef") };
      break;
    }
    case "attempt.reserved": {
      assertKeys(payload, ["BlockID", "AttemptID", "NodeID", "ProblemID", "kind", "mode", "owner"], "reservation payload");
      parsed = { BlockID: parseId(payload["BlockID"], "BlockID"), AttemptID: parseId(payload["AttemptID"], "AttemptID"), NodeID: parseId(payload["NodeID"], "NodeID"), ProblemID: parseId(payload["ProblemID"], "ProblemID"), kind: parseOutcome(payload["kind"], ["repair", "diagnosis"], "kind"), mode: parseOutcome(payload["mode"], ["direct", "delegated"], "mode"), owner: parseId(payload["owner"], "owner") };
      break;
    }
    case "attempt.started":
      assertKeys(payload, ["AttemptID", "handle"], "start payload");
      parsed = { AttemptID: parseId(payload["AttemptID"], "AttemptID"), handle: parseText(payload["handle"], "handle") };
      break;
    case "attempt.finished":
      assertKeys(payload, ["AttemptID", "outcome", "evidenceRef"], "finish payload");
      parsed = { AttemptID: parseId(payload["AttemptID"], "AttemptID"), outcome: parseOutcome(payload["outcome"], ["success", "failure", "blocked_environment", "blocked_human"], "outcome"), evidenceRef: parseRef(payload["evidenceRef"], "evidenceRef") };
      break;
    case "attempt.uncertain":
      assertKeys(payload, ["AttemptID", "reason"], "uncertain payload");
      parsed = { AttemptID: parseId(payload["AttemptID"], "AttemptID"), reason: parseText(payload["reason"], "reason") };
      break;
    case "attempt.reconciled":
      assertKeys(payload, ["AttemptID", "outcome", "evidenceRef"], "reconciliation payload");
      parsed = { AttemptID: parseId(payload["AttemptID"], "AttemptID"), outcome: parseOutcome(payload["outcome"], ["success", "failure", "not_started", "blocked_environment", "blocked_human"], "outcome"), evidenceRef: parseRef(payload["evidenceRef"], "evidenceRef") };
      break;
    case "attempt.cancelled":
      assertKeys(payload, ["AttemptID", "evidenceRef"], "cancellation payload");
      parsed = { AttemptID: parseId(payload["AttemptID"], "AttemptID"), evidenceRef: parseRef(payload["evidenceRef"], "evidenceRef") };
      break;
    case "block.closed":
      assertKeys(payload, ["BlockID", "reason", "evidenceRef"], "close payload");
      parsed = { BlockID: parseId(payload["BlockID"], "BlockID"), reason: parseOutcome(payload["reason"], ["accepted", "budget", "no_progress", "cancelled", "environment", "human"], "reason"), evidenceRef: parseRef(payload["evidenceRef"], "evidenceRef") };
      break;
    default: return fail("Unknown recovery event type");
  }
  const result = { eventId, type, payload: parsed } as RecoveryEventInput;
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_RECOVERY_EVENT_BYTES) fail("Recovery event exceeds 4096 bytes");
  return result;
}

type BlockStatus = "proposed" | "accepted" | "rejected" | "closed";
type AttemptState = "reserved" | "started" | "uncertain" | "finished" | "cancelled" | "reconciled";
interface Baseline { readonly WorkflowID: string; readonly repairsUsed: number | null; readonly diagnosesUsed: number | null; readonly securityExceptionUsed: boolean | null; }
interface BlockState { readonly BlockID: string; readonly proposalEventId: string; readonly ProblemIDs: readonly string[]; readonly repairLimit: number; readonly diagnosisLimit: number; status: BlockStatus; repairsUsed: number; diagnosesUsed: number; }
interface AttemptStateEntry { readonly AttemptID: string; readonly BlockID: string; readonly kind: "repair" | "diagnosis"; state: AttemptState; started: boolean; }
interface ReplayState { baseline: Baseline | null; readonly blocks: BlockState[]; readonly attempts: AttemptStateEntry[]; readonly eventById: Map<string, RecoveryEventInput>; }
const emptyState = (): ReplayState => ({ baseline: null, blocks: [], attempts: [], eventById: new Map() });
function findBlock(state: ReplayState, blockId: unknown): BlockState | undefined { return state.blocks.find((block) => block.BlockID === blockId); }
function findAttempt(state: ReplayState, attemptId: unknown): AttemptStateEntry | undefined { return state.attempts.find((attempt) => attempt.AttemptID === attemptId); }
function activeAttempt(state: ReplayState, blockId: string): boolean { return state.attempts.some((attempt) => attempt.BlockID === blockId && ["reserved", "started", "uncertain"].includes(attempt.state)); }
function charge(state: ReplayState, attempt: AttemptStateEntry, delta: -1 | 1): void {
  const block = findBlock(state, attempt.BlockID);
  if (!block) fail("Attempt references an unknown block");
  if (attempt.kind === "repair") block.repairsUsed += delta; else block.diagnosesUsed += delta;
}
function baselineFrom(payload: Extract<RecoveryEventInput, { type: "baseline.reconciled" }>['payload']): Baseline {
  return { WorkflowID: payload.WorkflowID, repairsUsed: payload.repairsUsed, diagnosesUsed: payload.diagnosesUsed, securityExceptionUsed: payload.securityExceptionUsed };
}

function applyEvent(state: ReplayState, event: RecoveryEventInput): void {
  if (state.eventById.has(event.eventId)) fail("Recovery eventId must be unique");
  switch (event.type) {
    case "baseline.reconciled": {
      const payload = event.payload;
      if (state.blocks.length > 0) fail("Baseline reconciliation must precede block proposals");
      const next = baselineFrom(payload);
      const previous = state.baseline;
      if (previous) {
        if (next.WorkflowID !== previous.WorkflowID) fail("WorkflowID is immutable");
        for (const key of ["repairsUsed", "diagnosesUsed"] as const) if (previous[key] !== null && (next[key] === null || next[key]! < previous[key]!)) fail(`Baseline ${key} cannot decrease or become unknown`);
        if (previous.securityExceptionUsed !== null && next.securityExceptionUsed === null) fail("Known security baseline cannot become unknown");
        if (previous.securityExceptionUsed === true && next.securityExceptionUsed !== true) fail("Security baseline cannot reset");
      }
      state.baseline = next;
      break;
    }
    case "block.proposed": {
      const payload = event.payload;
      const baseline = state.baseline;
      if (!baseline || baseline.repairsUsed === null || baseline.diagnosesUsed === null || baseline.securityExceptionUsed === null) fail("A fully known baseline is required before proposing a block");
      const previous = state.blocks.at(-1);
      if (previous ? previous.status !== "closed" || payload.previousBlockID !== previous.BlockID : payload.previousBlockID !== null) fail("Proposal predecessor must be null for the first block or the previous closed block");
      if (state.blocks.some((block) => block.BlockID === payload.BlockID)) fail("BlockID must be unique");
      const first = previous === undefined;
      state.blocks.push({ BlockID: payload.BlockID, proposalEventId: event.eventId, ProblemIDs: payload.ProblemIDs, status: "proposed", repairLimit: first ? Math.max(0, 6 - baseline.repairsUsed) : 2, diagnosisLimit: first ? Math.max(0, 3 - baseline.diagnosesUsed) : 1, repairsUsed: 0, diagnosesUsed: 0 });
      break;
    }
    case "decision.recorded": {
      const payload = event.payload;
      const block = findBlock(state, payload.BlockID);
      const proposal = state.eventById.get(payload.proposalEventId);
      if (!block || block.status !== "proposed" || !proposal || proposal.type !== "block.proposed" || proposal.payload.BlockID !== payload.BlockID || block.proposalEventId !== payload.proposalEventId) fail("Decision must match an undecided proposal");
      block.status = payload.decision;
      break;
    }
    case "attempt.reserved": {
      const payload = event.payload;
      const block = findBlock(state, payload.BlockID);
      if (!block || block.status !== "accepted") fail("Attempts require an accepted block");
      if (state.attempts.some((attempt) => attempt.AttemptID === payload.AttemptID)) fail("AttemptID must be unique across recovery history");
      if (!block.ProblemIDs.includes(payload.ProblemID)) fail("ProblemID is not in the proposal");
      const used = payload.kind === "repair" ? block.repairsUsed : block.diagnosesUsed;
      const limit = payload.kind === "repair" ? block.repairLimit : block.diagnosisLimit;
      if (used >= limit) fail("Recovery budget limit exceeded");
      const attempt: AttemptStateEntry = { AttemptID: payload.AttemptID, BlockID: payload.BlockID, kind: payload.kind, state: "reserved", started: false };
      state.attempts.push(attempt);
      charge(state, attempt, 1);
      break;
    }
    case "attempt.started": {
      const payload = event.payload;
      const attempt = findAttempt(state, payload.AttemptID);
      if (!attempt || attempt.state !== "reserved") fail("Only a reserved attempt can start");
      attempt.state = "started"; attempt.started = true; break;
    }
    case "attempt.finished": {
      const payload = event.payload;
      const attempt = findAttempt(state, payload.AttemptID);
      if (!attempt || attempt.state !== "started") fail("Only a started attempt can finish");
      attempt.state = "finished"; break;
    }
    case "attempt.uncertain": {
      const payload = event.payload;
      const attempt = findAttempt(state, payload.AttemptID);
      if (!attempt || (attempt.state !== "reserved" && attempt.state !== "started")) fail("Only a reserved or started attempt can become uncertain");
      attempt.state = "uncertain"; break;
    }
    case "attempt.reconciled": {
      const payload = event.payload;
      const attempt = findAttempt(state, payload.AttemptID);
      if (!attempt || attempt.state !== "uncertain") fail("Only an uncertain attempt can be reconciled");
      if (payload.outcome === "not_started") {
        if (attempt.started) fail("Started attempt cannot be reconciled as not_started");
        charge(state, attempt, -1);
      }
      attempt.state = "reconciled"; break;
    }
    case "attempt.cancelled": {
      const payload = event.payload;
      const attempt = findAttempt(state, payload.AttemptID);
      if (!attempt || attempt.state !== "reserved") fail("Only a reserved attempt can be cancelled");
      charge(state, attempt, -1); attempt.state = "cancelled"; break;
    }
    case "block.closed": {
      const payload = event.payload;
      const block = findBlock(state, payload.BlockID);
      if (!block || block.status === "closed") fail("Block is not open");
      if (block.status === "rejected" && payload.reason === "accepted") fail("A rejected block cannot close as accepted");
      if (activeAttempt(state, block.BlockID)) fail("Block has nonterminal attempts");
      block.status = "closed"; break;
    }
  }
  state.eventById.set(event.eventId, event);
}

function replay(events: readonly RecoveryEvent[]): ReplayState {
  if (events.length === 0) fail("Recovery history requires a baseline event");
  const state = emptyState();
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index + 1) fail("Recovery history sequence must be consecutive");
    applyEvent(state, { eventId: event.eventId, type: event.type, payload: event.payload } as RecoveryEventInput);
  }
  if (!state.baseline) fail("Recovery history requires a baseline event");
  return state;
}

export interface RecoverySummary {
  readonly WorkflowID: string | null; readonly baselineKnown: boolean; readonly repairsUsed: number | null; readonly diagnosesUsed: number | null; readonly securityExceptionUsed: boolean | null;
  readonly blocks: readonly { readonly BlockID: string; readonly status: BlockStatus; readonly repairLimit: number; readonly diagnosisLimit: number; readonly repairsUsed: number; readonly diagnosesUsed: number }[];
  readonly attempts: readonly { readonly AttemptID: string; readonly state: AttemptState }[];
}
export interface RecoveryPage { readonly events: readonly RecoveryEvent[]; readonly nextSequence: number | null; readonly summary: RecoverySummary; }
function buildSummary(state: ReplayState): RecoverySummary {
  const baseline = state.baseline;
  const repairs = state.blocks.reduce((total, block) => total + block.repairsUsed, 0);
  const diagnoses = state.blocks.reduce((total, block) => total + block.diagnosesUsed, 0);
  return { WorkflowID: baseline?.WorkflowID ?? null, baselineKnown: baseline !== null && baseline.repairsUsed !== null && baseline.diagnosesUsed !== null && baseline.securityExceptionUsed !== null, repairsUsed: baseline?.repairsUsed === null || !baseline ? null : baseline.repairsUsed + repairs, diagnosesUsed: baseline?.diagnosesUsed === null || !baseline ? null : baseline.diagnosesUsed + diagnoses, securityExceptionUsed: baseline?.securityExceptionUsed ?? null, blocks: state.blocks.map(({ BlockID, status, repairLimit, diagnosisLimit, repairsUsed, diagnosesUsed }) => ({ BlockID, status, repairLimit, diagnosisLimit, repairsUsed, diagnosesUsed })), attempts: state.attempts.map(({ AttemptID, state: attemptState }) => ({ AttemptID, state: attemptState })) };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function wrapperBytes(event: RecoveryEvent): number {
  return Buffer.byteLength(JSON.stringify(event), "utf8");
}
function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return false;
  const milliseconds = value.includes(".") ? value.replace(/\.(\d{1,3})Z$/, (_match, fraction: string) => `.${fraction.padEnd(3, "0")}Z`) : value.replace(/Z$/, ".000Z");
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === milliseconds;
}
function futureSlots(state: ReplayState): number {
  let slots = 0;
  for (const block of state.blocks) {
    if (block.status === "proposed") slots += 2;
    else if (block.status === "accepted" || block.status === "rejected") slots += 1;
  }
  for (const attempt of state.attempts) {
    if (attempt.state === "reserved") slots += 3;
    else if (attempt.state === "started") slots += 2;
    else if (attempt.state === "uncertain") slots += 1;
  }
  return slots;
}
export function recoveryReserveBytes(events: readonly RecoveryEvent[]): number {
  if (events.length === 0) return 0;
  return futureSlots(replay(events)) * MAX_RECOVERY_NESTED_BYTES;
}

export function appendRecovery(task: Task, inputValue: unknown, expectedRevision: number, at: string): Task {
  if (task.revision !== expectedRevision) throw new TaskError("REVISION_CONFLICT", `Expected revision ${expectedRevision} but current revision is ${task.revision}`);
  const input = parseRecoveryInput(inputValue);
  if (!validTimestamp(at)) fail("Recovery event timestamp must be a valid ISO timestamp");
  const old = task.recovery?.events ?? [];
  const state = old.length === 0 ? emptyState() : replay(old);
  const existing = old.find((event) => event.eventId === input.eventId);
  if (existing) {
    if (canonical({ type: existing.type, payload: existing.payload }) === canonical({ type: input.type, payload: input.payload })) return task;
    fail("eventId reuse with different event");
  }
  if (old.length >= MAX_RECOVERY_EVENTS) fail("Recovery event capacity exceeded");
  applyEvent(state, input);
  const nextEvent: RecoveryEvent = { sequence: old.length + 1, eventId: input.eventId, at, type: input.type, payload: input.payload };
  const events = [...old, nextEvent];
  if (wrapperBytes(nextEvent) > MAX_RECOVERY_EVENT_BYTES || wrapperBytes(nextEvent) > MAX_RECOVERY_NESTED_BYTES) fail("Recovery event wrapper exceeds capacity");
  if (events.length + futureSlots(state) > MAX_RECOVERY_EVENTS) fail("Recovery event slot capacity exceeded");
  const projected = { ...task, schemaVersion: 3 as const, recovery: { version: 1 as const, events } };
  if (Buffer.byteLength(JSON.stringify(projected, null, 2), "utf8") + futureSlots(state) * MAX_RECOVERY_NESTED_BYTES > MAX_TASK_JSON_BYTES) fail("Task recovery capacity reserve exceeded");
  return projected;
}

export function parseRecoveryLog(value: unknown): RecoveryLog {
  if (!isRecord(value)) throw new TaskError("UNSUPPORTED_SCHEMA", "Recovery log must be an object");
  try { assertKeys(value, ["version", "events"], "Recovery log"); } catch { throw new TaskError("UNSUPPORTED_SCHEMA", "Recovery log has invalid fields"); }
  if (value["version"] !== 1 || !Array.isArray(value["events"]) || value["events"].length > MAX_RECOVERY_EVENTS) throw new TaskError("UNSUPPORTED_SCHEMA", "Invalid schema 3 recovery log");
  const events: RecoveryEvent[] = [];
  const ids = new Set<string>();
  for (const [index, item] of value["events"].entries()) {
    if (!isRecord(item)) throw new TaskError("UNSUPPORTED_SCHEMA", "Invalid recovery event wrapper");
    try { assertKeys(item, ["sequence", "eventId", "at", "type", "payload"], "Recovery wrapper"); } catch { throw new TaskError("UNSUPPORTED_SCHEMA", "Recovery wrapper has invalid fields"); }
    if (item["sequence"] !== index + 1 || typeof item["eventId"] !== "string" || ids.has(item["eventId"])) throw new TaskError("UNSUPPORTED_SCHEMA", "Invalid or duplicate recovery sequence/eventId");
    const at = item["at"];
    if (!validTimestamp(at)) throw new TaskError("UNSUPPORTED_SCHEMA", "Recovery event timestamp is invalid or unbounded");
    let input: RecoveryEventInput;
    try { input = parseRecoveryInput({ eventId: item["eventId"], type: item["type"], payload: item["payload"] }); } catch (error) { throw new TaskError("UNSUPPORTED_SCHEMA", error instanceof Error ? error.message : "Invalid recovery event"); }
    const event: RecoveryEvent = { sequence: index + 1, eventId: input.eventId, at, type: input.type, payload: input.payload };
    if (wrapperBytes(event) > MAX_RECOVERY_EVENT_BYTES || Buffer.byteLength(JSON.stringify(event, null, 2), "utf8") > MAX_RECOVERY_NESTED_BYTES) throw new TaskError("UNSUPPORTED_SCHEMA", "Recovery event wrapper exceeds storage bounds");
    events.push(event); ids.add(input.eventId);
  }
  try { replay(events); } catch (error) { throw new TaskError("UNSUPPORTED_SCHEMA", error instanceof Error ? error.message : "Invalid recovery history"); }
  return { version: 1, events };
}

export function getRecoveryPage(log: RecoveryLog, afterSequence: number, limit: number): RecoveryPage {
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) fail("afterSequence must be a nonnegative integer");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("limit must be an integer from 1 to 100");
  const events = log.events.filter((event) => event.sequence > afterSequence).slice(0, limit);
  const last = events.at(-1)?.sequence ?? afterSequence;
  return { events, nextSequence: log.events.some((event) => event.sequence > last) ? last : null, summary: buildSummary(replay(log.events)) };
}
