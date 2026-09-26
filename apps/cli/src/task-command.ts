import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TaskError, asTaskError, createTaskService, isTaskError } from "@skynex-internal/tasks";
import type { StepDraft, StepStatus, TaskErrorCode, TaskListEntry } from "@skynex-internal/tasks";
import { createFileTaskStore, resolveTasksRoot, systemClock, uuidIds } from "@skynex-internal/tasks-node";

export interface TaskCliOptions {
  readonly cwd: string;
  readonly out?: (text: string) => void;
  readonly err?: (text: string) => void;
}

type CommandLabel =
  | "task.init"
  | "task.list"
  | "task.status"
  | "task.next.show"
  | "task.next.add"
  | "task.next.done";

const HELP_FLAGS = ["--help", "-h"] as const;
const VALUE_FLAGS = new Set<string>([
  "--tasks-root",
  "--task",
  "--scope",
  "--done-when",
  "--evidence",
  "--instruction-file",
  "--instruction",
  "--depends-on",
  "--expected-revision",
]);
const KNOWN_FLAGS = new Set<string>([...HELP_FLAGS, "--json", ...VALUE_FLAGS]);
const COMMON_FLAGS = ["--tasks-root", "--json", ...HELP_FLAGS];

const ALLOWED_FLAGS: Readonly<Record<CommandLabel, ReadonlySet<string>>> = {
  "task.init": new Set(COMMON_FLAGS),
  "task.list": new Set(COMMON_FLAGS),
  "task.status": new Set([...COMMON_FLAGS, "--task"]),
  "task.next.show": new Set([...COMMON_FLAGS, "--task"]),
  "task.next.add": new Set([
    ...COMMON_FLAGS,
    "--task",
    "--scope",
    "--done-when",
    "--evidence",
    "--instruction-file",
    "--instruction",
    "--depends-on",
    "--expected-revision",
  ]),
  "task.next.done": new Set([...COMMON_FLAGS, "--task", "--expected-revision"]),
};

const EXIT_CODES: Readonly<Record<TaskErrorCode, number>> = {
  INVALID_ARGUMENT: 2,
  NO_ACTIVE_TASK: 3,
  AMBIGUOUS_TASK: 3,
  TASK_NOT_FOUND: 3,
  STEP_NOT_FOUND: 3,
  REVISION_CONFLICT: 4,
  LOCKED: 4,
  INVALID_PATH: 5,
  FILE_TOO_LARGE: 5,
  UNSUPPORTED_SCHEMA: 5,
  LEGACY_FORMAT: 5,
  INVALID_SLUG: 5,
  TASK_EXISTS: 6,
  IO_ERROR: 1,
};

const HELP_TEXT = `Usage: skynex task <command> [options]

Commands:
  skynex task init <title> [--tasks-root <dir>] [--json]
  skynex task list [--tasks-root <dir>] [--json]
  skynex task status [--task <id>] [--tasks-root <dir>] [--json]
  skynex task next show [<stepId>] [--task <id>] [--tasks-root <dir>] [--json]
  skynex task next add <title> --scope <t> --done-when <t> --evidence <t> [--instruction-file <p> | --instruction <t>] [--depends-on <stepId>]... [--task <id>] [--expected-revision <n>] [--tasks-root <dir>] [--json]
  skynex task next done <stepId> [--task <id>] [--expected-revision <n>] [--tasks-root <dir>] [--json]

Options:
  --tasks-root <dir>  Override the .skynex/tasks root (useful for isolated testing)
  --task <id>         Select an existing task; required for status/next without a bound context
  --json              Emit a single JSON object on stdout
  -h, --help          Show this help
`;

interface ParsedFlags {
  readonly values: ReadonlyMap<string, readonly string[]>;
  readonly positionals: readonly string[];
}

function tokenize(tokens: readonly string[]): ParsedFlags {
  const values = new Map<string, string[]>();
  const positionals: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.startsWith("-")) {
      if (!KNOWN_FLAGS.has(token)) {
        throw new TaskError("INVALID_ARGUMENT", `Unknown flag: ${token}`);
      }
      if (!VALUE_FLAGS.has(token)) {
        values.set(token, []);
        continue;
      }
      const value = tokens[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new TaskError("INVALID_ARGUMENT", `Missing value for ${token}`);
      }
      const bucket = values.get(token) ?? [];
      bucket.push(value);
      values.set(token, bucket);
      index += 1;
      continue;
    }
    positionals.push(token);
  }
  return { values, positionals };
}

function labelFor(argv: readonly string[]): CommandLabel | "task" {
  const first = argv[0];
  if (first === "init") return "task.init";
  if (first === "list") return "task.list";
  if (first === "status") return "task.status";
  if (first === "next") {
    const sub = argv[1];
    if (sub === "show") return "task.next.show";
    if (sub === "add") return "task.next.add";
    if (sub === "done") return "task.next.done";
  }
  return "task";
}

function resolveCommand(argv: readonly string[]): CommandLabel {
  const first = argv[0];
  if (first === "init" || first === "list" || first === "status") return `task.${first}`;
  if (first === "next") {
    const sub = argv[1];
    if (sub === "show" || sub === "add" || sub === "done") return `task.next.${sub}`;
    throw new TaskError("INVALID_ARGUMENT", `Unknown task subcommand: ${argv.slice(0, 2).join(" ")}`);
  }
  throw new TaskError("INVALID_ARGUMENT", `Unknown task command: ${String(first)}`);
}

function assertAllowedFlags(label: CommandLabel, values: ParsedFlags["values"]): void {
  const allowed = ALLOWED_FLAGS[label];
  for (const flag of values.keys()) {
    if (!allowed.has(flag)) {
      throw new TaskError("INVALID_ARGUMENT", `Flag ${flag} is not valid for ${label}`);
    }
  }
}

function lastValue(values: ParsedFlags["values"], flag: string): string | undefined {
  const bucket = values.get(flag);
  if (bucket === undefined || bucket.length === 0) return undefined;
  return bucket[bucket.length - 1];
}

function requiredValue(values: ParsedFlags["values"], flag: string): string {
  const value = lastValue(values, flag);
  if (value === undefined || value.length === 0) {
    throw new TaskError("INVALID_ARGUMENT", `Missing required ${flag}`);
  }
  return value;
}

function parseExpectedRevision(values: ParsedFlags["values"]): number | undefined {
  const raw = lastValue(values, "--expected-revision");
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw)) {
    throw new TaskError("INVALID_ARGUMENT", "--expected-revision must be a positive integer");
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TaskError("INVALID_ARGUMENT", "--expected-revision must be a positive integer");
  }
  return parsed;
}

function expectAtMost(positionals: readonly string[], maximum: number): void {
  if (positionals.length > maximum) {
    throw new TaskError("INVALID_ARGUMENT", `Unexpected argument: ${positionals[maximum]}`);
  }
}

function statusIcon(status: StepStatus): string {
  switch (status) {
    case "done":
      return "✓";
    case "in_progress":
      return "▶";
    case "blocked":
      return "!";
    case "pending":
      return "○";
  }
}

function serializeListEntry(entry: TaskListEntry): Record<string, unknown> {
  if (entry.format === "task") {
    return {
      id: entry.id,
      format: entry.format,
      title: entry.title ?? null,
      status: entry.status ?? null,
      revision: entry.revision ?? null,
      stepCount: entry.stepCount ?? 0,
      doneCount: entry.doneCount ?? 0,
      nextStepId: entry.nextStepId ?? null,
    };
  }
  const output: Record<string, unknown> = { id: entry.id, format: entry.format };
  if (entry.note !== undefined) output["note"] = entry.note;
  return output;
}

function humanListLine(entry: TaskListEntry): string {
  if (entry.format === "task") {
    const next = entry.nextStepId ?? "-";
    const done = entry.doneCount ?? 0;
    const total = entry.stepCount ?? 0;
    return `${entry.id}  ${entry.status ?? "unknown"}  r${entry.revision ?? 0}  ${done}/${total}  next:${next}`;
  }
  return entry.note === undefined ? `${entry.id}  ${entry.format}` : `${entry.id}  ${entry.format}  ${entry.note}`;
}

async function readInstructionBody(cwd: string, filePath: string): Promise<string> {
  try {
    return await readFile(resolve(cwd, filePath), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const message = error instanceof Error ? error.message : String(error);
    throw new TaskError("INVALID_ARGUMENT", `Unable to read --instruction-file ${filePath}: ${code ?? message}`);
  }
}

/**
 * Run the `skynex task` subcommands.
 *
 * Returns the process exit code instead of calling `process.exit`. When `--json` is
 * active a single JSON object is written to `out`; diagnostics stay on `err`.
 */
export async function runTaskCommand(argv: readonly string[], options?: TaskCliOptions): Promise<number> {
  const cwd = options?.cwd ?? process.cwd();
  const out = options?.out ?? ((text: string): void => { process.stdout.write(text); });
  const err = options?.err ?? ((text: string): void => { process.stderr.write(text); });
  const json = argv.includes("--json");
  let label: CommandLabel | "task" = labelFor(argv);

  try {
    const firstToken = argv[0];
    if (firstToken === undefined || firstToken === "--help" || firstToken === "-h") {
      out(HELP_TEXT);
      return 0;
    }

    const commandLabel = resolveCommand(argv);
    label = commandLabel;
    const tokens = commandLabel === "task.next.show" || commandLabel === "task.next.add" || commandLabel === "task.next.done"
      ? argv.slice(2)
      : argv.slice(1);
    const parsed = tokenize(tokens);
    if (parsed.values.has("--help") || parsed.values.has("-h")) {
      out(HELP_TEXT);
      return 0;
    }
    assertAllowedFlags(commandLabel, parsed.values);

    const tasksRootOverride = lastValue(parsed.values, "--tasks-root");
    const tasksRoot = resolveTasksRoot({
      cwd,
      ...(tasksRootOverride === undefined ? {} : { override: tasksRootOverride }),
    });
    const store = createFileTaskStore({ tasksRoot });
    const service = createTaskService({ store, clock: systemClock, ids: uuidIds });

    if (commandLabel === "task.init") {
      expectAtMost(parsed.positionals, 1);
      const title = parsed.positionals[0];
      if (title === undefined) {
        throw new TaskError("INVALID_ARGUMENT", "Missing task title");
      }
      const result = await service.createTask({ title });
      if (json) {
        out(`${JSON.stringify({
          ok: true,
          command: commandLabel,
          tasksRoot,
          taskId: result.taskId,
          title: result.task.title,
          revision: result.task.revision,
          status: result.task.status,
          indexPath: "task.json",
          instructionPaths: [...result.instructionPaths],
        })}\n`);
      } else {
        out(`Task ${result.taskId} created (revision ${result.task.revision})  steps: ${result.task.steps.length}  index: task.json\n`);
      }
      return 0;
    }

    if (commandLabel === "task.list") {
      expectAtMost(parsed.positionals, 0);
      const tasks = await service.listTasks();
      if (json) {
        out(`${JSON.stringify({
          ok: true,
          command: commandLabel,
          tasksRoot,
          tasks: tasks.map(serializeListEntry),
        })}\n`);
      } else if (tasks.length > 0) {
        out(`${tasks.map(humanListLine).join("\n")}\n`);
      }
      return 0;
    }

    if (commandLabel === "task.status") {
      expectAtMost(parsed.positionals, 0);
      const taskId = lastValue(parsed.values, "--task") ?? null;
      const view = await service.getStatus(taskId);
      if (json) {
        out(`${JSON.stringify({
          ok: true,
          command: commandLabel,
          tasksRoot,
          taskId: view.taskId,
          title: view.title,
          status: view.status,
          revision: view.revision,
          nextStepId: view.nextStepId,
          blockedStepIds: [...view.blockedStepIds],
          steps: view.steps.map((step) => ({
            id: step.id,
            title: step.title,
            status: step.status,
            dependsOn: [...step.dependsOn],
          })),
        })}\n`);
      } else {
        const lines = [
          `Objetivo: ${view.title}`,
          `Estado: ${view.status} (revision ${view.revision})`,
        ];
        const next = view.steps.find((step) => step.id === view.nextStepId);
        lines.push(next === undefined ? "Siguiente: -" : `Siguiente: ${next.id} ${next.title}`);
        for (const step of view.steps) {
          lines.push(`${statusIcon(step.status)} ${step.id}  ${step.title}`);
        }
        if (view.blockedStepIds.length > 0) {
          lines.push(`Bloqueos: ${view.blockedStepIds.join(", ")}`);
        }
        out(`${lines.join("\n")}\n`);
      }
      return 0;
    }

    if (commandLabel === "task.next.show") {
      expectAtMost(parsed.positionals, 1);
      const taskId = lastValue(parsed.values, "--task") ?? null;
      const stepId = parsed.positionals[0] ?? null;
      const view = await service.readStepInstruction(taskId, stepId);
      if (json) {
        out(`${JSON.stringify({
          ok: true,
          command: commandLabel,
          tasksRoot,
          taskId: view.taskId,
          stepId: view.stepId,
          revision: view.revision,
          status: view.status,
          title: view.title,
          instructionPath: view.instructionPath,
          instruction: view.instruction,
        })}\n`);
      } else {
        out(view.instruction);
      }
      return 0;
    }

    if (commandLabel === "task.next.add") {
      expectAtMost(parsed.positionals, 1);
      const title = parsed.positionals[0];
      if (title === undefined || title.trim().length === 0) {
        throw new TaskError("INVALID_ARGUMENT", "Missing step title");
      }
      const taskId = lastValue(parsed.values, "--task") ?? null;
      const scope = requiredValue(parsed.values, "--scope");
      const doneWhen = requiredValue(parsed.values, "--done-when");
      const expectedEvidence = requiredValue(parsed.values, "--evidence");
      const dependsOn = parsed.values.get("--depends-on") ?? [];
      const instructionFile = lastValue(parsed.values, "--instruction-file");
      const instructionText = lastValue(parsed.values, "--instruction");
      if (instructionFile !== undefined && instructionText !== undefined) {
        throw new TaskError("INVALID_ARGUMENT", "--instruction-file and --instruction are mutually exclusive");
      }
      let instruction: string | undefined;
      if (instructionFile !== undefined) {
        instruction = await readInstructionBody(cwd, instructionFile);
      } else if (instructionText !== undefined) {
        instruction = instructionText;
      }
      const expectedRevision = parseExpectedRevision(parsed.values);
      const draft: StepDraft = {
        title,
        scope,
        doneWhen,
        expectedEvidence,
        ...(dependsOn.length === 0 ? {} : { dependsOn: [...dependsOn] }),
        ...(instruction === undefined ? {} : { instruction }),
      };
      const result = await service.addStep(
        taskId,
        draft,
        expectedRevision === undefined ? undefined : { expectedRevision },
      );
      if (json) {
        out(`${JSON.stringify({
          ok: true,
          command: commandLabel,
          tasksRoot,
          taskId: result.taskId,
          stepId: result.stepId,
          instructionPath: result.instructionPath,
          revision: result.revision,
        })}\n`);
      } else {
        out(`${result.stepId} added (revision ${result.revision})\n`);
      }
      return 0;
    }

    // commandLabel === "task.next.done"
    expectAtMost(parsed.positionals, 1);
    const stepId = parsed.positionals[0];
    if (stepId === undefined) {
      throw new TaskError("INVALID_ARGUMENT", "Missing step id");
    }
    const taskId = lastValue(parsed.values, "--task") ?? null;
    const expectedRevision = parseExpectedRevision(parsed.values);
    const result = await service.markStepDone(
      taskId,
      stepId,
      expectedRevision === undefined ? undefined : { expectedRevision },
    );
    if (json) {
      out(`${JSON.stringify({
        ok: true,
        command: commandLabel,
        tasksRoot,
        taskId: result.taskId,
        stepId: result.stepId,
        previousStatus: result.previousStatus,
        status: result.status,
        declared: result.declared,
        approved: result.approved,
        changed: result.changed,
        revision: result.revision,
      })}\n`);
    } else {
      out(`${result.stepId} declarado done (no aprobado, revision ${result.revision})\n`);
    }
    return 0;
  } catch (error) {
    const taskError = isTaskError(error) ? error : asTaskError(error);
    const exitCode = EXIT_CODES[taskError.code] ?? 1;
    if (json) {
      out(`${JSON.stringify({
        ok: false,
        command: label,
        code: taskError.code,
        message: taskError.message,
      })}\n`);
    } else {
      err(`${taskError.message}\n`);
    }
    return exitCode;
  }
}
