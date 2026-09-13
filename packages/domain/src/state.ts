import type { InstallScope } from "./install.js";
import type { InstallComponent } from "./resources.js";
import type { CanonicalResourceIdentity, ResourceOrigin } from "./resources.js";
export interface ManagedResourceState extends CanonicalResourceIdentity { readonly origin: ResourceOrigin; readonly relativePath: string; readonly sourceDigest: string; readonly installedDigest: string; readonly pendingSourceDigest?: string; readonly pendingVersion?: string; }
export interface InstallLock { readonly schemaVersion: 1; readonly target: "opencode-v2"; readonly scope: InstallScope; readonly targetRoot: string; readonly stateRoot: string; readonly installedAt: string; readonly transactionId: string; readonly resources: readonly ManagedResourceState[]; readonly installedComponents?: readonly InstallComponent[]; }
export interface BackupManifest {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly createdAt: string;
  readonly target: string;
  readonly scope: InstallScope;
  readonly priorLock: { readonly present: boolean; readonly digest: string | null; readonly snapshot: string | null };
  readonly resultingLockDigest: string | null;
  readonly files: readonly { readonly relativePath: string; readonly priorDigest: string | null; readonly snapshot: boolean; readonly resultingDigest: string | null; readonly resource?: ManagedResourceState; }[];
}
export interface BackupSummary { readonly transactionId: string; readonly createdAt: string; readonly fileCount: number; readonly corrupt?: string; }
