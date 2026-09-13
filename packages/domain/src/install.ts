import type { DesiredArtifact, InstallComponent } from "./resources.js";
import type { ManagedResourceState } from "./state.js";
export type InstallScope = "global" | "project";
export interface InstallRoots { readonly scope: InstallScope; readonly targetRoot: string; readonly stateRoot: string; }
export type UpdateDecision = "accept-upstream" | "keep-local" | "resolve-conflict" | "skip" | "adopt" | "remove" | "preserve";
export type InstallOperationKind = "create" | "replace" | "preserve" | "remove" | "restore" | "unchanged" | "conflict";
export interface InstallOperation { readonly kind: InstallOperationKind; readonly artifact: DesiredArtifact; readonly relativePath: string; readonly destination: string; readonly currentDigest: string | null; readonly desiredDigest: string; readonly expectedPriorDigest?: string | null; readonly decision?: UpdateDecision; readonly previous?: ManagedResourceState; }
export interface InstallationPlan { readonly id: string; readonly createdAt: string; readonly target: { readonly id: string; readonly roots: InstallRoots }; readonly operations: readonly InstallOperation[]; readonly allowedResources?: readonly { readonly id: string; readonly relativePath: string }[]; readonly selectedComponents?: readonly InstallComponent[]; }
export interface InstallationPlan { readonly updateMode?: boolean; readonly expectedPreviousLockDigest?: string | null; }
export type InstallPlan = InstallationPlan;
export interface TransactionResult { readonly transactionId: string; readonly changed: number; readonly backupRoot: string | null; readonly lockPath: string; readonly restoredPaths: readonly string[]; readonly unreconciledPaths: readonly string[]; readonly warnings: readonly string[]; }
