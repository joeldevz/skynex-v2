export type ResourceKind = "agent" | "skill" | "command" | "hook" | "mcp" | "configuration" | "native";
export type ResourceOrigin = "canonical" | "native";
export type InstallComponent = "configuration" | "agents" | "skills" | "commands" | "plugins";
export interface CanonicalResourceIdentity { readonly id: string; readonly kind: ResourceKind; readonly version: string; }
export interface CatalogResource extends CanonicalResourceIdentity {
  readonly origin: ResourceOrigin; readonly sourcePath: string; readonly component: InstallComponent;
  readonly targets: readonly { readonly id: "opencode-v2"; readonly relativePath: string }[];
}
export interface LoadedResource extends CatalogResource { readonly content: string; readonly digest: string; }
export interface DesiredArtifact { readonly resource: CanonicalResourceIdentity; readonly component: InstallComponent; readonly relativePath: string; readonly content: string; readonly sourceDigest?: string; }
