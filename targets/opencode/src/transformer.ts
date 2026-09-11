import type { LoadedResource, DesiredArtifact, InstallComponent } from "@skynex-internal/domain";
import type { ResourceTransformer } from "@skynex-internal/compiler";
import { mergeConfig } from "./config-merge.js";
export interface OpenCodeTransformOptions { readonly configContent?: string; readonly configPreference?: "json" | "jsonc"; readonly components?: readonly InstallComponent[]; }
export const openCodeTransformer: ResourceTransformer<OpenCodeTransformOptions> = { targetId: "opencode-v2", transform(resource: LoadedResource, options) { if (options.components && !options.components.includes(resource.component)) return []; return resource.targets.map((target): DesiredArtifact => ({ resource, component: resource.component, relativePath: target.relativePath, content: resource.kind === "configuration" ? mergeConfig(options.configContent ?? "{}\n") : resource.content, sourceDigest: resource.digest })); } };
