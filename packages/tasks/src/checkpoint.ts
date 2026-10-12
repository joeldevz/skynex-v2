import { TaskError } from "./errors.js";

/** Recovery metadata only: none of these values authorize or execute work. */
export interface RecoveryCheckpoint {
  readonly version: 1;
  readonly WorkflowID: string;
  readonly AttemptID: string;
  readonly NodeID: string;
  readonly BaseCandidateOID: string;
  readonly Scope: { readonly paths: readonly string[]; readonly acceptance: readonly string[] };
  readonly candidateOid: string | null;
  readonly candidateOidReason: string | null;
  readonly manifestRef: CheckpointRef | null;
  readonly phase: "basis" | "handoff" | "frozen" | "final" | "interrupted";
  readonly note: string;
  readonly refs: readonly CheckpointRef[];
}

export interface CheckpointRef {
  readonly id: string;
  readonly sha256: string;
}

export const MAX_CHECKPOINT_BYTES = 32 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OID = /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/;
const DIGEST = /^[a-fA-F0-9]{64}$/;
const PHASES: readonly RecoveryCheckpoint["phase"][] = ["basis", "handoff", "frozen", "final", "interrupted"];

function invalid(message: string): never {
  throw new TaskError("INVALID_ARGUMENT", `Invalid checkpoint: ${message}`);
}

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("expected an object");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key)) ||
      Object.keys(record).some((key) => !keys.includes(key))) invalid("missing or unknown fields");
  return record;
}

function matching(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || pattern.exec(value)?.[0] !== value) invalid(label);
  return value;
}

function text(value: unknown, maximum: number, label: string, nonempty = false): string {
  if (typeof value !== "string" || value.length > maximum || (nonempty && value.trim().length === 0)) invalid(label);
  return value;
}

function array<T>(value: unknown, maximum: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > maximum) invalid("array limit or type");
  return Array.from(value, parse);
}

function ref(value: unknown): CheckpointRef {
  const raw = fields(value, ["id", "sha256"]);
  return { id: matching(raw["id"], ID, "reference id"), sha256: matching(raw["sha256"], DIGEST, "reference digest") };
}

function path(value: unknown): string {
  const result = text(value, 240, "scope path", true);
  if (/^[A-Za-z]:/.test(result) || result.includes("\\") || /[\u0000-\u001f\u007f-\u009f]/.test(result) ||
      result.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) invalid("relative scope path");
  return result;
}

/** Validate untrusted input and return a detached, canonical copy. References stay opaque. */
export function parseCheckpoint(value: unknown): RecoveryCheckpoint {
  const raw = fields(value, ["version", "WorkflowID", "AttemptID", "NodeID", "BaseCandidateOID", "Scope", "candidateOid",
    "candidateOidReason", "manifestRef", "phase", "note", "refs"]);
  if (raw["version"] !== 1) invalid("unsupported version");
  const scope = fields(raw["Scope"], ["paths", "acceptance"]);
  const candidateOid = raw["candidateOid"] === null ? null : matching(raw["candidateOid"], OID, "candidate OID");
  const manifestRef = raw["manifestRef"] === null ? null : ref(raw["manifestRef"]);
  const candidateOidReason = candidateOid === null ? text(raw["candidateOidReason"], 200, "candidate reason", true) : null;
  if (candidateOid === null && manifestRef === null) invalid("null candidate requires a manifest");
  if (candidateOid !== null && raw["candidateOidReason"] !== null) invalid("present candidate requires null reason");
  const phase = raw["phase"];
  if (typeof phase !== "string" || !(PHASES as readonly string[]).includes(phase)) invalid("phase");
  const refs = array(raw["refs"], 20, ref);
  if (new Set(refs.map((item) => item.id)).size !== refs.length) invalid("duplicate reference ids");
  const checkpoint: RecoveryCheckpoint = {
    version: 1,
    WorkflowID: matching(raw["WorkflowID"], ID, "WorkflowID"),
    AttemptID: matching(raw["AttemptID"], ID, "AttemptID"),
    NodeID: matching(raw["NodeID"], ID, "NodeID"),
    BaseCandidateOID: matching(raw["BaseCandidateOID"], OID, "basis OID"),
    Scope: { paths: array(scope["paths"], 64, path), acceptance: array(scope["acceptance"], 32, (item) => matching(item, ID, "acceptance id")) },
    candidateOid, candidateOidReason, manifestRef, phase: phase as RecoveryCheckpoint["phase"],
    note: text(raw["note"], 1000, "note"), refs,
  };
  if (new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength > MAX_CHECKPOINT_BYTES) {
    throw new TaskError("FILE_TOO_LARGE", `Checkpoint exceeds ${MAX_CHECKPOINT_BYTES} bytes`);
  }
  return checkpoint;
}

export function sameCheckpoint(left: RecoveryCheckpoint | undefined, right: RecoveryCheckpoint | undefined): boolean {
  return JSON.stringify(left === undefined ? null : parseCheckpoint(left)) === JSON.stringify(right === undefined ? null : parseCheckpoint(right));
}
