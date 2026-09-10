export type ResourceKind =
  | "agent"
  | "skill"
  | "command"
  | "hook"
  | "mcp"
  | "configuration"
  | "native";

export type UpdateDecision =
  | "accept-upstream"
  | "keep-local"
  | "resolve-conflict"
  | "skip";

export interface CanonicalResourceIdentity {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly version: string;
}

export interface InstalledResourceState extends CanonicalResourceIdentity {
  readonly sourceDigest: string;
  readonly installedDigest: string;
  readonly destination: string;
}

export interface ResourceUpdate {
  readonly resource: CanonicalResourceIdentity;
  readonly previousSourceDigest: string | null;
  readonly localDigest: string | null;
  readonly nextSourceDigest: string;
  readonly locallyModified: boolean;
  readonly decision?: UpdateDecision;
}
