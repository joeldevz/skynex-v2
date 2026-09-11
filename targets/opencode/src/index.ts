import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TargetAdapter } from "@skynex-internal/application";
import type { InstallComponent } from "@skynex-internal/domain";
import { loadCatalog } from "@skynex-internal/catalog";
import { compileCatalog } from "@skynex-internal/compiler";
import { openCodeTransformer } from "./transformer.js";
import { mergeConfig } from "./config-merge.js";
export { mergeConfig } from "./config-merge.js";
export { removeManagedPlugin } from "./config-merge.js";
const canRead = async (path: string): Promise<boolean> => access(path).then(() => true).catch(() => false);
export const openCodeTarget: TargetAdapter = {
  async detect(roots) { const candidates = (await Promise.all(["opencode.json", "opencode.jsonc"].map(async (name) => { const path = join(roots.targetRoot, name); return await canRead(path) ? path : null; }))).filter((p): p is string => p !== null); return { id: "opencode-v2", installed: candidates.length > 0 || await canRead(roots.targetRoot), configPath: candidates.length === 1 ? candidates[0]! : null, configCandidates: candidates, roots, notes: candidates.length > 1 ? ["Both OpenCode config formats exist; choose one explicitly"] : [] }; },
  async desiredArtifacts(roots, components, options) { const detection = await this.detect(roots); const preference = options?.configPreference ?? (detection.configPath?.endsWith(".jsonc") ? "jsonc" : detection.configPath ? "json" : "jsonc"); if (detection.configCandidates.length > 1 && !options?.configPreference) throw new Error("Both opencode config formats exist; select json or jsonc"); const configName = preference === "json" ? "opencode.json" : "opencode.jsonc"; const configPath = join(roots.targetRoot, configName); const configContent = await canRead(configPath) ? await readFile(configPath, "utf8") : "{}\n"; const catalog = await loadCatalog({ manifestPath: new URL("../resources/manifest.json", import.meta.url).pathname }); const selected = components ?? (["configuration", "agents", "skills", "commands", "plugins"] satisfies InstallComponent[]); const artifacts = compileCatalog(catalog, openCodeTransformer, { configContent, components: selected }); return selected.includes("configuration") ? [{ resource: { id: "opencode-config", kind: "configuration", version: catalog.manifest.version }, component: "configuration", relativePath: configName, content: mergeConfig(configContent, selected.includes("plugins")) }, ...artifacts] : artifacts; },
  async verify(_roots, artifacts) { return { ok: artifacts.every((artifact) => artifact.content.length > 0), notes: [`Verified ${artifacts.length} artifacts`] }; },
};
