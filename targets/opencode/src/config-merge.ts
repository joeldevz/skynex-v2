import { applyEdits, createScanner, getNodeValue, modify, parse, parseTree, printParseErrorCode, type Node, type ParseError, type FormattingOptions } from "jsonc-parser";
const formatting: FormattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };
const enum JsoncToken { CommaToken = 5, EndOfFile = 17 }
export const MANAGED_PLUGINS = ["./skynex/plugins/runtime", "./skynex/plugins/sky-agents"] as const;
export interface ManagedAgent { readonly id: string; readonly mode: string; readonly permissions: readonly Record<string, string>[]; }
export function parseManagedAgents(source: string): readonly ManagedAgent[] {
  const policy = JSON.parse(source) as { agents?: unknown };
  if (!Array.isArray(policy.agents)) throw new Error("Managed agent policy must contain an agents array");
  return policy.agents.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Managed agent policy contains an invalid agent");
    const agent = entry as Record<string, unknown>;
    if (typeof agent.id !== "string" || typeof agent.mode !== "string" || !Array.isArray(agent.permissions)) throw new Error("Managed agent policy contains an invalid agent");
    return { id: agent.id, mode: agent.mode, permissions: agent.permissions as readonly Record<string, string>[] };
  });
}
export function mergeConfig(source: string, includePlugin = true, managedAgents: readonly ManagedAgent[] = []): string {
  const errors: ParseError[] = [];
  const parsed = parse(source, errors) as Record<string, unknown> | undefined;
  if (errors.length) throw new Error(`Invalid OpenCode JSON/C: ${errors.map((error) => `${printParseErrorCode(error.error)} at ${error.offset}`).join(", ")}`);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("OpenCode configuration must be a JSON object");
  let result = source.trim() ? source : "{}\n";
  if (!("$schema" in parsed)) result = applyEdits(result, modify(result, ["$schema"], "https://opencode.ai/config.json", { formattingOptions: formatting }));
  if (includePlugin) {
    const current = parse(result) as Record<string, unknown>;
    if (current.plugins !== undefined && !Array.isArray(current.plugins)) throw new Error("OpenCode 'plugins' must be an array");
    const plugins = Array.isArray(current.plugins) ? current.plugins : [];
     for (const plugin of MANAGED_PLUGINS) {
       const entries = (parse(result) as Record<string, unknown>).plugins;
       const list = Array.isArray(entries) ? entries : [];
       if (!list.some((entry) => entry === plugin || (typeof entry === "object" && entry !== null && (entry as { package?: unknown }).package === plugin))) {
         const value = { package: plugin, options: { managedBy: "skynex" } };
         result = applyEdits(result, modify(result, ["plugins", list.length], value, { isArrayInsertion: true, formattingOptions: formatting }));
       }
     }
  }
  result = mergeManagedAgents(result, managedAgents);
  return result.endsWith("\n") ? result : `${result}\n`;
}

function mergeManagedAgents(source: string, managedAgents: readonly ManagedAgent[]): string {
  if (!managedAgents.length) return source;
  const parsed = parse(source) as Record<string, unknown>;
  if (parsed.agents !== undefined && (typeof parsed.agents !== "object" || parsed.agents === null || Array.isArray(parsed.agents))) throw new Error("OpenCode 'agents' must be an object");
  let result = source;
  const agents = parsed.agents && typeof parsed.agents === "object" ? parsed.agents as Record<string, unknown> : {};
  for (const managed of managedAgents) {
    const existing = agents[managed.id];
    if (existing === undefined) {
      result = applyEdits(result, modify(result, ["agents", managed.id], { mode: managed.mode, permissions: managed.permissions }, { formattingOptions: formatting }));
      agents[managed.id] = { mode: managed.mode, permissions: managed.permissions };
      continue;
    }
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) throw new Error(`Unmanaged OpenCode agent conflict: ${managed.id}`);
    const object = existing as Record<string, unknown>;
    if (object.mode !== undefined && object.mode !== managed.mode) throw new Error(`Unmanaged OpenCode agent conflict: ${managed.id}.mode`);
    if (object.permissions !== undefined && JSON.stringify(object.permissions) !== JSON.stringify(managed.permissions)) throw new Error(`Unmanaged OpenCode agent conflict: ${managed.id}.permissions`);
    if (object.mode === undefined) result = applyEdits(result, modify(result, ["agents", managed.id, "mode"], managed.mode, { formattingOptions: formatting }));
    if (object.permissions === undefined) result = applyEdits(result, modify(result, ["agents", managed.id, "permissions"], managed.permissions, { formattingOptions: formatting }));
  }
  return result;
}

export function removeManagedPlugin(source: string, managedAgents: readonly ManagedAgent[] = [], managedPlugins: readonly string[] = [...MANAGED_PLUGINS]): string {
  const errors: ParseError[] = [];
  const parsed = parse(source, errors) as Record<string, unknown> | undefined;
  if (errors.length) throw new Error(`Invalid OpenCode JSON/C: ${errors.map((error) => `${printParseErrorCode(error.error)} at ${error.offset}`).join(", ")}`);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("OpenCode configuration must be a JSON object");
  const plugins = parsed.plugins;
  let result = source;
  if (plugins === undefined) return removeManagedAgents(result, managedAgents);
  if (!Array.isArray(plugins)) throw new Error("OpenCode 'plugins' must be an array");
  const tree = parseTree(source, errors);
  const pluginsNode = tree?.children?.find((child) => child.type === "property" && child.children?.[0]?.value === "plugins")?.children?.[1];
  if (!pluginsNode || !pluginsNode.children) return removeManagedAgents(result, managedAgents);
  const managed = pluginsNode.children.filter((node) => {
    const value = getNodeValue(node);
     return managedPlugins.some((plugin) => value === plugin || (typeof value === "object" && value !== null && value.package === plugin));
  });
  result = removeManagedArrayEntries(result, pluginsNode, new Set(managed));
  result = removeManagedAgents(result, managedAgents);
  return result.endsWith("\n") ? result : `${result}\n`;
}

function removeManagedAgents(source: string, managedAgents: readonly ManagedAgent[]): string {
  let result = source;
  for (const managed of managedAgents) {
    const parsed = parse(result) as Record<string, unknown>;
    if (!parsed.agents || typeof parsed.agents !== "object" || Array.isArray(parsed.agents)) continue;
    const existing = (parsed.agents as Record<string, unknown>)[managed.id];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) continue;
    const object = existing as Record<string, unknown>;
    if (object.mode === managed.mode) result = applyEdits(result, modify(result, ["agents", managed.id, "mode"], undefined, { formattingOptions: formatting }));
    if (JSON.stringify(object.permissions) === JSON.stringify(managed.permissions)) result = applyEdits(result, modify(result, ["agents", managed.id, "permissions"], undefined, { formattingOptions: formatting }));
    const after = parse(result) as Record<string, unknown>;
    const agentMap = after.agents && typeof after.agents === "object" && !Array.isArray(after.agents) ? after.agents as Record<string, unknown> : undefined;
    const agent = agentMap?.[managed.id];
    if (agent && typeof agent === "object" && Object.keys(agent).length === 0) result = applyEdits(result, modify(result, ["agents", managed.id], undefined, { formattingOptions: formatting }));
  }
  return result;
}

function removeManagedArrayEntries(source: string, array: Node, managed: ReadonlySet<Node>): string {
  const children = array.children ?? [];
  if (!children.some((child) => managed.has(child))) return source;
  const survivors = children.filter((child) => !managed.has(child));
  const lastSurvivor = survivors.at(-1);
  const separators = children.map((child, index) => ({
    child,
    offset: separatorInGap(source, child.offset + child.length, children[index + 1]?.offset ?? array.offset + array.length - 1),
  })).filter((entry): entry is { child: Node; offset: number } => entry.offset !== undefined);
  const ranges = new Map<number, { offset: number; length: number; content: string }>();
  for (const child of children) if (managed.has(child)) ranges.set(child.offset, { offset: child.offset, length: child.length, content: "" });
  for (const separator of separators) {
    if (managed.has(separator.child) || separator.child === lastSurvivor) ranges.set(separator.offset, { offset: separator.offset, length: 1, content: "" });
  }
  return applyEdits(source, [...ranges.values()].sort((a, b) => a.offset - b.offset));
}

function separatorInGap(source: string, start: number, end: number): number | undefined {
  if (end <= start) return undefined;
  const scanner = createScanner(source.slice(start, end), false);
  let token: number;
  while ((token = scanner.scan()) !== (JsoncToken.EndOfFile as unknown as typeof token)) {
    if ((token as unknown as JsoncToken) === JsoncToken.CommaToken) return start + scanner.getTokenOffset();
  }
  return undefined;
}
