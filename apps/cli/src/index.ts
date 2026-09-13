#!/usr/bin/env node
import { relative, resolve } from "node:path";
import * as p from "@clack/prompts";
import type { InstallComponent, InstallRoots, InstallScope, OpenCodeConfigPreference } from "@skynex-internal/domain";
import { applyInstallPlan, applyUninstallPlan, createInstallPlan, createUninstallPlan, listBackups, prepareUpdatePlan, readInstallLock, readInstallLockSnapshot, restoreBackup } from "@skynex-internal/installer";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getManagedAgents, openCodeTarget, removeManagedPlugin } from "@skynex-internal/target-opencode";
import { createProfileApplyService, createProfileStore, resolveGlobalSkynexRoots, type ProfileApplyRoots } from "@skynex-internal/sky-agents";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const command = args[0]?.startsWith("-") ? undefined : args[0];
const positionalOffset = command === "backup" && ["list", "restore"].includes(args[1] ?? "") ? (args[1] === "restore" ? 3 : 2) : 1;
const has = (flag: string): boolean => args.includes(flag);
const valueOf = (flag: string): string | undefined => {
  const index = args.lastIndexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
const scopeComponents = (scope: InstallScope): readonly InstallComponent[] => scope === "project"
  ? ["configuration", "agents", "skills"]
  : ["configuration", "agents", "skills", "plugins"];
const knownFlags = new Set(["--", "--global", "--project", "--state-dir", "--config", "--name", "--components", "--dry-run", "--yes", "--allow-executable-plugins", "--help", "-h", "--version", "-v", "--json"]);
const valueFlags = new Set(["--project", "--state-dir", "--config", "--name", "--components"]);
for (let index = positionalOffset; index < args.length; index += 1) {
  const argument = args[index]!;
  if (argument.startsWith("-") && !knownFlags.has(argument)) throw new Error(`Unknown flag: ${argument}`);
  if (!valueFlags.has(argument)) continue;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`Missing value for ${argument}`);
  index += 1;
}
if (has("--global") && args.includes("--project")) throw new Error("--global and --project are mutually exclusive");

const help = `Skynex v2

Usage:
  skynex install [--global | --project <dir>] [--components <list>] [--dry-run] [--yes]
  skynex update  [--global | --project <dir>] [--components <list>] [--dry-run] [--yes]
  skynex uninstall [--global | --project <dir>] [--dry-run] [--yes]
  skynex backup list|restore <transaction-id>
  skynex profile apply --name <profile> --global [--config json|jsonc]
  skynex doctor  [--global | --project <dir>] [--json]

Options:
  --global         Install into ~/.config/opencode (required for profile apply)
  --project <dir>  Install into <dir>/.opencode
  --state-dir <p>  Override Skynex state root (useful for isolated testing)
  --config <format> Select json or jsonc when both config files exist
  --components <list> Comma-separated configuration,agents,skills,commands,plugins (plugins are global-only)
  --dry-run        Preview without writing
  --yes            Apply without the confirmation prompt (safe changes only)
  --allow-executable-plugins  Allow plugin installation with --yes
  -h, --help       Show help
  -v, --version    Show version`;

const roots = (projectOverride?: string): InstallRoots => {
  const project = projectOverride ?? valueOf("--project");
  const scope: InstallScope = project ? "project" : "global";
  const globalRoots = resolveGlobalSkynexRoots();
  const targetRoot = project ? resolve(project, ".opencode") : globalRoots.configRoot;
  const stateRoot = resolve(valueOf("--state-dir") ?? (project ? resolve(project, ".skynex") : globalRoots.stateRoot));
  return { scope, targetRoot, stateRoot };
};

if (has("--help") || has("-h") || (!command && !has("--version") && !has("-v"))) {
  console.log(help);
  process.exit(0);
}
if (has("--version") || has("-v")) {
  console.log("0.1.0");
  process.exit(0);
}
if (command === "profile" && args[1] === "apply" && (!has("--global") || has("--project"))) throw new Error("Profile apply requires --global and does not accept --project")
if (command === "profile" && args[1] === "apply" && has("--state-dir")) throw new Error("Profile apply uses the global Skynex profile store and does not accept --state-dir")

const run = async (): Promise<void> => {
  const spinner = p.spinner();
  let spinnerActive = false;
  const startSpinner = (message: string): void => {
    spinner.start(message);
    spinnerActive = true;
  };
  const stopSpinner = (message: string): void => {
    spinner.stop(message);
    spinnerActive = false;
  };
  p.intro("SKYNEX  /  SETUP");

  let installRoots: InstallRoots;
  const explicitProject = valueOf("--project");
  if (explicitProject || has("--global") || command === "doctor" || has("--yes") || has("--dry-run")) {
    installRoots = roots();
  } else {
    const scope = await p.select<InstallScope>({
      message: "Where should Skynex live?",
      options: [
        { value: "global", label: "Everywhere", hint: "your global OpenCode setup" },
        { value: "project", label: "This project", hint: "only the current folder" },
      ],
      initialValue: "global",
    });
    if (p.isCancel(scope)) {
      p.cancel("Nothing changed");
      return;
    }
    installRoots = roots(scope === "project" ? process.cwd() : undefined);
  }

  startSpinner("Inspecting your OpenCode setup");
  const detection = await openCodeTarget.detect(installRoots);
  stopSpinner(detection.installed ? "OpenCode configuration found" : "Fresh OpenCode configuration");

  const requestedConfig = valueOf("--config");
  if (requestedConfig !== undefined && requestedConfig !== "json" && requestedConfig !== "jsonc") throw new Error("--config must be json or jsonc");
  let configPreference: OpenCodeConfigPreference | undefined = requestedConfig as OpenCodeConfigPreference | undefined;
  const catalogResourcesFor = async (roots: InstallRoots, components: readonly InstallComponent[]): Promise<Map<string, string>> =>
    new Map((await openCodeTarget.desiredArtifacts(roots, components, configPreference ? { configPreference } : undefined)).map((artifact) => [artifact.resource.id, artifact.relativePath]));
const needsConfig = command === "install" || command === "update" || command === "uninstall" || command === "profile" || (command === "backup" && args[1] === "restore");
  if (needsConfig && detection.configCandidates.length > 1 && !configPreference) {
    if (has("--yes") || has("--dry-run")) throw new Error("Both opencode.json and opencode.jsonc exist; pass --config json or --config jsonc");
    const choice = await p.select<OpenCodeConfigPreference>({
      message: "Two OpenCode configs found. Which one should Skynex manage?",
      options: [
        { value: "jsonc", label: "opencode.jsonc", hint: "preserves comments" },
        { value: "json", label: "opencode.json", hint: "strict JSON" },
      ],
      initialValue: "jsonc",
    });
    if (p.isCancel(choice)) { p.cancel("Nothing changed"); return; }
    configPreference = choice;
  }

  if (command === "doctor") {
    if (has("--json")) { console.log(JSON.stringify({ ok: true, scope: installRoots.scope, targetRoot: installRoots.targetRoot, stateRoot: installRoots.stateRoot, config: detection.configPath })); return; }
    p.note([
      `Scope       ${installRoots.scope}`,
      `Target      ${installRoots.targetRoot}`,
      `State       ${installRoots.stateRoot}`,
      `Config      ${detection.configPath ?? "not created"}`,
    ].join("\n"), "Installation health");
    p.outro("No files changed");
    return;
  }
  if (command === "profile") {
    if (args[1] !== "apply") throw new Error("Use 'skynex profile apply --name <profile>'");
    if (has("--yes")) throw new Error("Profile apply requires the interactive confirmation prompt; --yes is not accepted");
    const name = valueOf("--name"); if (!name) throw new Error("Missing --name");
    const preference = configPreference ?? (detection.configPath?.endsWith(".jsonc") ? "jsonc" : "json");
    if (!detection.configPath) throw new Error("No OpenCode configuration found");
    const service = createProfileApplyService(installRoots as ProfileApplyRoots, createProfileStore(resolve(installRoots.stateRoot, "profiles")));
    const plan = await service.preview(name, preference);
    p.note(plan.changes.length ? plan.changes.map((change) => `${change.agent}: ${change.from ?? "(unset)"} → ${change.to}`).join("\n") : "No model assignments change", "Profile apply preview");
    if (has("--dry-run")) { p.outro("Preview complete · no files changed"); return; }
    const answer = await p.confirm({ message: `Apply profile '${name}' to ${plan.configPath}?`, initialValue: false });
    if (p.isCancel(answer) || !answer) { p.cancel("Nothing changed"); return; }
    await service.apply(plan, service.authorize(plan.planDigest));
    p.outro(`Applied profile '${name}' (${plan.changes.length} model assignments)`);
    return;
  }
  if (command === "backup") {
    const action = args[1];
    if (action === "list") {
      const backups = await listBackups(installRoots);
      p.note(backups.length ? backups.map((item) => item.corrupt ? `! ${item.transactionId} · ${item.corrupt}` : `• ${item.transactionId} · ${item.fileCount} files`).join("\n") : "No backups yet", "Backups");
      p.outro("No files changed");
      return;
    }
    if (action === "restore") {
      const transactionId = args[2];
      if (!transactionId) throw new Error("Missing backup transaction ID");
      if (has("--dry-run")) { p.outro(`Would restore backup ${transactionId} · no files changed`); return; }
      if (!has("--yes")) {
        const answer = await p.confirm({ message: `Restore backup ${transactionId}?`, initialValue: false });
        if (p.isCancel(answer) || !answer) { p.cancel("Nothing changed"); return; }
      }
      const catalogResources = await catalogResourcesFor(installRoots, scopeComponents(installRoots.scope));
      const result = await restoreBackup(installRoots, transactionId, catalogResources);
      p.outro(`Restored ${result.restored.length} files`);
      return;
    }
    throw new Error("Use 'skynex backup list' or 'skynex backup restore <transaction-id>'");
  }
  if (command === "uninstall") {
    const uncheckedLock = await readInstallLock(installRoots);
    if (!uncheckedLock) throw new Error("Skynex is not installed in this scope");
    const installedComponents = uncheckedLock.installedComponents ?? scopeComponents(installRoots.scope);
    const catalogResources = await catalogResourcesFor(installRoots, installedComponents);
    const lock = await readInstallLock(installRoots, catalogResources);
    if (!lock) throw new Error("Skynex is not installed in this scope");
    p.note(lock.resources.map((item) => `- ${item.relativePath}`).join("\n"), "Managed resources to remove");
    if (has("--dry-run")) { p.outro("Preview complete · no files changed"); return; }
    if (!has("--yes")) {
      const answer = await p.confirm({ message: "Remove these managed resources?", initialValue: false });
      if (p.isCancel(answer) || !answer) { p.cancel("Nothing changed"); return; }
    }
    const detectedConfigPath = detection.configPath ? relative(installRoots.targetRoot, detection.configPath) : undefined;
    const configPath = configPreference === "json" ? "opencode.json" : configPreference === "jsonc" ? "opencode.jsonc" : detectedConfigPath;
    const configResource = lock.resources.find((resource) => resource.id === "opencode-config" && resource.relativePath === configPath);
    const ownsConfiguration = lock.installedComponents?.includes("configuration") ?? lock.resources.some((resource) => resource.id === "opencode-config");
    const ownsPlugins = lock.installedComponents?.includes("plugins") ?? lock.resources.some((resource) => resource.kind === "native" && resource.id.includes("plugin"));
    const managedAgents = ownsConfiguration ? await getManagedAgents() : [];
    const managedPlugins = ownsPlugins ? ["./skynex/plugins/runtime", "./skynex/plugins/sky-agents"] : [];
    const config = configResource && configPath ? { resourceId: configResource.id, relativePath: configPath, currentContent: await readFile(resolve(installRoots.targetRoot, configPath), "utf8"), removeManagedRegistration: (source: string) => removeManagedPlugin(source, managedAgents, managedPlugins) } : undefined;
    await applyUninstallPlan(createUninstallPlan({ roots: installRoots, lock, allowedResources: catalogResources, ...(config ? { config } : {}) }), catalogResources);
    p.outro("Skynex managed resources removed");
    return;
  }
  if (command !== "install" && command !== "update") throw new Error(`Unknown command: ${command}`);

  const requestedComponents = valueOf("--components");
  const knownComponents = new Set<InstallComponent>(["configuration", "agents", "skills", "commands", "plugins"]);
  let selectedComponents: readonly InstallComponent[] = scopeComponents(installRoots.scope);
  if (requestedComponents !== undefined) {
    const components = requestedComponents.split(",");
    if (components.some((component) => !component || !knownComponents.has(component as InstallComponent))) {
      throw new Error("--components must be a nonempty comma-separated list of configuration,agents,skills,commands,plugins");
    }
    if (new Set(components).size !== components.length) throw new Error("--components must not contain duplicates");
    selectedComponents = components as InstallComponent[];
  } else if (!has("--yes") && !has("--dry-run")) {
    const componentOptions = [
      { value: "configuration" as const, label: "Foundation", hint: "managed state and installation notes" },
      { value: "agents" as const, label: "Agents", hint: "focused Skynex collaborators" },
      { value: "skills" as const, label: "Skills", hint: "reusable working methods" },
      ...(installRoots.scope === "global"
        ? [{ value: "plugins" as const, label: "Runtime plugins", hint: "global OpenCode 2 integration" }]
        : []),
    ];
    const components = await p.multiselect<InstallComponent>({
      message: "Choose what to bring into OpenCode",
      options: componentOptions,
      initialValues: [...scopeComponents(installRoots.scope)],
      required: true,
    });
    if (p.isCancel(components)) {
      p.cancel("Nothing changed");
      return;
    }
    selectedComponents = components;
  }
  if (installRoots.scope === "project" && selectedComponents.includes("plugins")) {
    throw new Error("Sky Agents plugins can only be installed globally");
  }

  startSpinner("Preparing a safe installation plan");
  let plan;
  try {
    plan = await createInstallPlan(
      openCodeTarget,
      installRoots,
      selectedComponents,
      configPreference ? { configPreference } : undefined,
    );
    stopSpinner("Plan ready");
  } catch (error) {
    if (spinnerActive) stopSpinner("Plan could not be created");
    throw error;
  }
  if (command === "update") {
    const lockSnapshot = await readInstallLockSnapshot(installRoots, new Map((plan.allowedResources ?? []).map((entry) => [entry.id, entry.relativePath])));
    const lock = lockSnapshot?.lock;
    if (!lock) throw new Error("Run 'skynex install' before updating this scope");
    const updateBasePlan = plan;
    plan = prepareUpdatePlan(updateBasePlan, lock, undefined, lockSnapshot ? sha256(lockSnapshot.bytes) : null);
    const conflicts = plan.operations.filter((operation) => operation.kind === "conflict");
    const reviewable = plan.operations.filter((operation) => operation.kind === "conflict" || (operation.kind === "replace" && ["agents", "skills"].includes(operation.artifact.component)));
    if (reviewable.length) {
      if (conflicts.length && (has("--yes") || has("--dry-run"))) throw new Error(`Local changes require an interactive decision: ${conflicts.map((item) => item.artifact.relativePath).join(", ")}`);
      if (has("--dry-run") || has("--yes")) {
        // Upstream-only agent/skill changes are safe under --yes; conflicts are rejected above.
      } else {
      const decisions = new Map<string, "accept-upstream" | "keep-local" | "skip">();
      for (const conflict of reviewable) {
        let localText = "(file unavailable)";
        try { localText = (await readFile(conflict.destination, "utf8")).slice(0, 4000); } catch { /* diagnostic only */ }
        p.note(`--- local\n${localText}\n--- upstream\n${conflict.artifact.content.slice(0, 4000)}`, `Diff: ${conflict.artifact.resource.id}`);
        const choice = await p.select<"accept" | "keep" | "skip" | "resolve">({
          message: `${conflict.artifact.resource.id} has an upstream change`,
          options: [
            { value: "keep", label: "Keep my version", hint: "skip this upstream change" },
            { value: "accept", label: "Accept upstream", hint: "replace the local version" },
            { value: "skip", label: "Skip this resource", hint: "leave it pending for later" },
            { value: "resolve", label: "Resolve later", hint: "cancel safely; edit and re-run" },
          ],
          initialValue: "keep",
        });
        if (p.isCancel(choice)) { p.cancel("Nothing changed"); return; }
        if (choice === "resolve") { p.cancel(`Update cancelled safely. Edit ${conflict.relativePath} and re-run update.`); return; }
        decisions.set(conflict.relativePath, choice === "keep" ? "keep-local" : choice === "skip" ? "skip" : "accept-upstream");
      }
      plan = prepareUpdatePlan(updateBasePlan, lock, (operation) => decisions.get(operation.relativePath) ?? "keep-local", lockSnapshot ? sha256(lockSnapshot.bytes) : null);
      }
    }
  }
  const creates = plan.operations.filter((item) => item.kind === "create").length;
  const replaces = plan.operations.filter((item) => item.kind === "replace").length;
  const unchanged = plan.operations.filter((item) => item.kind === "unchanged").length;
  p.note([
    `+ ${creates} new`,
    `~ ${replaces} updates`,
    `= ${unchanged} unchanged`,
    "",
    ...plan.operations.map((item) => `${item.kind === "create" ? "+" : item.kind === "replace" ? "~" : "="} ${item.destination}`),
  ].join("\n"), "Your installation");
  if (plan.operations.some((item) => item.artifact.component === "plugins" && item.kind !== "unchanged")) p.log.warn("This installs executable OpenCode 2 plugin and hook code from the verified Skynex catalog.");

  if (has("--dry-run")) {
    p.outro("Preview complete · no files changed");
    return;
  }

  let approved = has("--yes");
  if (has("--yes") && plan.operations.some((item) => item.artifact.component === "plugins" && item.kind !== "unchanged") && !has("--allow-executable-plugins")) throw new Error("Installing executable plugins noninteractively requires --allow-executable-plugins");
  if (!approved) {
    const answer = await p.confirm({ message: "Ready to make OpenCode yours?", initialValue: true });
    if (p.isCancel(answer) || !answer) {
      p.cancel("Nothing changed");
      process.exit(0);
    }
    approved = true;
  }

  if (approved) {
    startSpinner("Installing Skynex");
    let result;
    try {
      result = await applyInstallPlan(plan);
      stopSpinner("Installation verified");
    } catch (error) {
      if (spinnerActive) stopSpinner("Installation stopped safely");
      throw error;
    }
    p.note([
      `${result.changed} file${result.changed === 1 ? "" : "s"} installed`,
      `Lockfile ${result.lockPath}`,
      result.backupRoot ? `Backup   ${result.backupRoot}` : "Backup   not needed",
    ].join("\n"), "Ready");
    p.outro("Done. OpenCode is ready with Skynex.");
  }
};

run().catch((error: unknown) => {
  p.log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
