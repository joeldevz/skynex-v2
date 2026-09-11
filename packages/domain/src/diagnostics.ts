export type DiagnosticSeverity = "error" | "warning" | "info";
export interface Diagnostic { readonly severity: DiagnosticSeverity; readonly code: string; readonly message: string; readonly path?: string; }
export interface DoctorReport { readonly ok: boolean; readonly diagnostics: readonly Diagnostic[]; readonly pendingUpdates: number; readonly managedFiles: number; readonly backups: number; }
