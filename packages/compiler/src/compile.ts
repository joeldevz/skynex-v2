import type { DesiredArtifact } from "@skynex-internal/domain";
import type { ResourceCatalog } from "@skynex-internal/catalog";
import type { ResourceTransformer } from "./contracts.js";
export function compileCatalog<T>(catalog: ResourceCatalog, transformer: ResourceTransformer<T>, options: T): readonly DesiredArtifact[] { const result = catalog.resources.flatMap((resource) => transformer.transform(resource, options)); const paths = new Set<string>(); for (const artifact of result) { if (paths.has(artifact.relativePath)) throw new Error(`Duplicate output path: ${artifact.relativePath}`); paths.add(artifact.relativePath); } return result; }
