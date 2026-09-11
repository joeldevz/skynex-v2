import type { DesiredArtifact, LoadedResource } from "@skynex-internal/domain";
export interface ResourceTransformer<TOptions> { readonly targetId: string; transform(resource: LoadedResource, options: TOptions): readonly DesiredArtifact[]; }
