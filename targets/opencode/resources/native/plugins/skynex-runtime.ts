import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { markSkynexPrompt } from "./prompt.ts";

interface SkynexPluginContext {
  location?: { directory?: string };
  storage: {
    set(key: string, value: unknown): Promise<void>;
  };
  session: {
    hook(
      name: "prompt",
      callback: (event: { metadata: Record<string, unknown> }) => void,
    ): Promise<unknown>;
    hook(
      name: "context",
      callback: (event: { system: { type?: string; text?: string }[] }) => void,
    ): Promise<unknown>;
  };
  tool: {
    hook(
      name: "execute.before",
      callback: (event: { tool: string; input: Record<string, unknown> }) => void,
    ): Promise<unknown>;
  };
}

const namespaceCache = new Map<string, string>();

const normalizeNamespace = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 64);

const namespaceForDirectory = (directory: string): string => {
  const cached = namespaceCache.get(directory);
  if (cached !== undefined) return cached;
  let name = basename(directory);
  try {
    const result = spawnSync(
      "git",
      ["-C", directory, "-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"],
      {
        encoding: "utf8",
        timeout: 2000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1" },
      },
    );
    if (result.status === 0 && result.stdout.trim()) name = basename(result.stdout.trim());
  } catch {
    // Fall back to the working directory name if git cannot be queried.
  }
  const namespace = normalizeNamespace(name);
  namespaceCache.set(directory, namespace);
  return namespace;
};

export default {
  id: "skynex.runtime",
  async setup(context: SkynexPluginContext) {
    const directory = context.location?.directory ?? process.cwd();
    const namespace = namespaceForDirectory(directory);
    await context.storage.set("installed", { version: "0.1.0" });
    await context.session.hook("prompt", markSkynexPrompt);
    await context.session.hook("context", async (event) => {
      try {
        const text = "Skynex enforces this repository's Neurox namespace automatically on project-scoped calls (save, context, session_start, and recall with an explicit namespace).";
        if (!event.system.some((entry) => entry.text === text)) {
          event.system.push({ type: "text", text });
        }
      } catch {
        // Namespace context is best-effort and must not interrupt the session.
      }
    });
    await context.tool.hook("execute.before", async (event) => {
      try {
        const input = event.input;
        if (event.tool === "neurox_save" || event.tool === "neurox_context" || event.tool === "neurox_session_start") {
          if (!(event.tool === "neurox_save" && input.observation_type === "preference" && (input.namespace === undefined || input.namespace === "default"))) {
            input.namespace = namespace;
          }
        } else if (event.tool === "neurox_recall" && typeof input.namespace === "string" && input.namespace.length > 0 && input.namespace !== "default") {
          input.namespace = namespace;
        }
      } catch {
        // Namespace enforcement is best-effort and must not interrupt tool execution.
      }
    });
  },
};
