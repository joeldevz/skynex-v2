import { applyEdits, createScanner, getNodeValue, modify, parse, parseTree, printParseErrorCode, type Node, type ParseError, type FormattingOptions } from "jsonc-parser";
const formatting: FormattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };
const enum JsoncToken { CommaToken = 5, EndOfFile = 17 }
export function mergeConfig(source: string, includePlugin = true): string {
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
    if (!plugins.some((entry) => entry === "./skynex/plugins/runtime" || (typeof entry === "object" && entry !== null && (entry as { package?: unknown }).package === "./skynex/plugins/runtime"))) {
      const index = plugins.length;
      result = applyEdits(result, modify(result, ["plugins", index], { package: "./skynex/plugins/runtime", options: { managedBy: "skynex" } }, { isArrayInsertion: true, formattingOptions: formatting }));
    }
  }
  return result.endsWith("\n") ? result : `${result}\n`;
}

export function removeManagedPlugin(source: string): string {
  const errors: ParseError[] = [];
  const parsed = parse(source, errors) as Record<string, unknown> | undefined;
  if (errors.length) throw new Error(`Invalid OpenCode JSON/C: ${errors.map((error) => `${printParseErrorCode(error.error)} at ${error.offset}`).join(", ")}`);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("OpenCode configuration must be a JSON object");
  const plugins = parsed.plugins;
  if (plugins === undefined) return source;
  if (!Array.isArray(plugins)) throw new Error("OpenCode 'plugins' must be an array");
  const tree = parseTree(source, errors);
  const pluginsNode = tree?.children?.find((child) => child.type === "property" && child.children?.[0]?.value === "plugins")?.children?.[1];
  if (!pluginsNode || !pluginsNode.children) return source;
  const managed = pluginsNode.children.filter((node) => {
    const value = getNodeValue(node);
    return value === "./skynex/plugins/runtime" || (typeof value === "object" && value !== null && value.package === "./skynex/plugins/runtime");
  });
  const result = removeManagedArrayEntries(source, pluginsNode, new Set(managed));
  return result.endsWith("\n") ? result : `${result}\n`;
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
