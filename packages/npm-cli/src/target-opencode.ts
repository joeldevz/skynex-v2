import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TargetAdapter } from "@skynex-internal/application";
import type { InstallComponent } from "@skynex-internal/domain";
import { loadCatalog } from "@skynex-internal/catalog";
import { compileCatalog } from "@skynex-internal/compiler";
import { openCodeTransformer } from "../../../targets/opencode/src/transformer.js";
import { mergeConfig, parseManagedAgents, type ManagedAgent } from "../../../targets/opencode/src/config-merge.js";
export { mergeConfig, removeManagedPlugin } from "../../../targets/opencode/src/config-merge.js";
export type { ManagedAgent } from "../../../targets/opencode/src/config-merge.js";
const manifestPath = fileURLToPath(new URL("./resources/manifest.json", import.meta.url));
const catalog = () => loadCatalog({ manifestPath });
export async function getManagedAgents(): Promise<readonly ManagedAgent[]> { const c = await catalog(); const policy = c.resources.find((r) => r.id === "opencode-config"); return policy ? parseManagedAgents(policy.content) : []; }
const canRead = (path: string): Promise<boolean> => access(path).then(() => true).catch(() => false);
export const openCodeTarget: TargetAdapter = {
 async detect(roots) { const candidates = (await Promise.all(["opencode.json", "opencode.jsonc"].map(async name => { const path = join(roots.targetRoot,name); return await canRead(path) ? path : null; }))).filter((p): p is string => p !== null); return { id:"opencode-v2", installed:candidates.length>0 || await canRead(roots.targetRoot), configPath:candidates.length===1?candidates[0]!:null, configCandidates:candidates, roots, notes:candidates.length>1?["Both OpenCode config formats exist; choose one explicitly"]:[] }; },
 async desiredArtifacts(roots, components, options) { const selected = components ?? (roots.scope === "project" ? ["configuration","agents","skills"] : ["configuration","agents","skills","plugins"] satisfies InstallComponent[]); if (roots.scope === "project" && selected.includes("plugins")) throw new Error("Sky Agents can only be installed globally"); const detection=await this.detect(roots); const preference=options?.configPreference ?? (detection.configPath?.endsWith(".jsonc")?"jsonc":detection.configPath?"json":"jsonc"); if(detection.configCandidates.length>1&&!options?.configPreference) throw new Error("Both OpenCode config formats exist; select json or jsonc"); const configName=preference==="json"?"opencode.json":"opencode.jsonc"; const configPath=join(roots.targetRoot,configName); const configContent=await canRead(configPath)?await readFile(configPath,"utf8"):"{}\n"; const c=await catalog(); const policy=c.resources.find(r=>r.id==="opencode-config"); const includeConfiguration=selected.includes("configuration"), includePlugins=selected.includes("plugins"); const managedAgents: readonly ManagedAgent[]=includeConfiguration&&policy?parseManagedAgents(policy.content):[]; const artifacts=compileCatalog(c,openCodeTransformer,{configContent,components:selected}); return includeConfiguration||includePlugins?[{resource:{id:"opencode-config",kind:"configuration",version:c.manifest.version},component:"configuration",relativePath:configName,content:mergeConfig(configContent,includePlugins,managedAgents)},...artifacts]:artifacts; },
 async verify(_roots, artifacts) { return {ok:artifacts.every(a=>a.content.length>0),notes:[`Verified ${artifacts.length} artifacts`]}; }
};
