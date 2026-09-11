import type { DesiredArtifact, InstallComponent, InstallRoots } from "@skynex-internal/domain";

export interface TargetDetection {
  readonly id: string;
  readonly installed: boolean;
  readonly configPath: string | null;
  readonly configCandidates: readonly string[];
  readonly roots: InstallRoots;
  readonly notes: readonly string[];
}

export interface TargetAdapter {
  detect(roots: InstallRoots): Promise<TargetDetection>;
  desiredArtifacts(
    roots: InstallRoots,
    components?: readonly InstallComponent[],
    options?: { readonly configPreference?: "json" | "jsonc" },
  ): Promise<readonly DesiredArtifact[]>;
  verify?(roots: InstallRoots, artifacts: readonly DesiredArtifact[]): Promise<{ readonly ok: boolean; readonly notes: readonly string[] }>;
}

export interface CatalogPort { load(): Promise<unknown>; }
export interface InstallationStatePort { read(): Promise<unknown>; write(value: unknown): Promise<void>; }
export interface ManagedFileReader { read(path: string): Promise<Buffer | null>; }
