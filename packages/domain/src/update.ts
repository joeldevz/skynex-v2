import type { DesiredArtifact } from "./resources.js";
import type { ManagedResourceState } from "./state.js";
export type ComparisonKind = "create" | "unchanged" | "upstream-only" | "local-only" | "converged" | "conflict" | "unmanaged-collision";
export interface UpdateCandidate { readonly artifact: DesiredArtifact; readonly previous: ManagedResourceState | null; readonly localDigest: string | null; readonly comparison: ComparisonKind; readonly decision?: import("./install.js").UpdateDecision; }
