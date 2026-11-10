import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workflow = await readFile(join(root, ".github/workflows/pages.yml"), "utf8");
const failures = [];

function check(label, verify) {
  try { verify(); }
  catch (error) { failures.push(`${label}: ${error.message}`); }
}

const guard = "github.ref == 'refs/heads/main' && (github.event_name != 'workflow_run' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_repository.full_name == github.repository))";

check("main-only and refresh triggers", () => {
  const triggerStart = workflow.indexOf("on:\n");
  const triggerEnd = workflow.indexOf("\n\n", triggerStart);
  const triggerBlock = triggerStart < 0 ? "" : workflow.slice(triggerStart, triggerEnd < 0 ? undefined : triggerEnd).trimEnd();
  assert.equal(triggerBlock, [
    "on:",
    "  push:",
    "    branches: [main]",
    "  workflow_dispatch:",
    "  workflow_run:",
    "    workflows: ['Release npm CLI']",
    "    types: [completed]",
  ].join("\n"), "workflow must accept only main pushes, manual runs, and completed Release npm CLI runs");
  assert.doesNotMatch(workflow, /^\s+tags:/m, "Pages must not deploy directly from tag pushes");
});

check("deploy guards and fixed checkout", () => {
  const guards = [...workflow.matchAll(/^\s+if: \$\{\{ (.*) \}\}$/gm)].map((match) => match[1]);
  assert.deepEqual(guards, [guard, guard],
    "build and deploy jobs must both require main plus a successful same-repository release run");
  assert.match(workflow, /uses: actions\/checkout@[0-9a-f]{40}[\s\S]*?with:\n\s+ref: main\n\s+fetch-depth: 0/,
    "checkout must explicitly use main with full history");
  assert.doesNotMatch(workflow, /head_sha|head_branch|download-artifact|workflow_run\.artifacts/i,
    "the refresh must not check out or consume workflow_run-controlled revisions or artifacts");
});

function mayDeploy({ event, ref, conclusion = "", sameRepository = false }) {
  return ref === "refs/heads/main"
    && (event !== "workflow_run" || (conclusion === "success" && sameRepository));
}

check("event behavior contract", () => {
  for (const [scenario, input, expected] of [
    ["main push", { event: "push", ref: "refs/heads/main" }, true],
    ["manual main", { event: "workflow_dispatch", ref: "refs/heads/main" }, true],
    ["manual tag", { event: "workflow_dispatch", ref: "refs/tags/v0.4.0" }, false],
    ["manual other branch", { event: "workflow_dispatch", ref: "refs/heads/feature" }, false],
    ["successful same-repo release refresh", { event: "workflow_run", ref: "refs/heads/main", conclusion: "success", sameRepository: true }, true],
    ["failed release", { event: "workflow_run", ref: "refs/heads/main", conclusion: "failure", sameRepository: true }, false],
    ["cancelled release", { event: "workflow_run", ref: "refs/heads/main", conclusion: "cancelled", sameRepository: true }, false],
    ["foreign-repository release", { event: "workflow_run", ref: "refs/heads/main", conclusion: "success", sameRepository: false }, false],
    ["workflow run on non-main ref", { event: "workflow_run", ref: "refs/heads/feature", conclusion: "success", sameRepository: true }, false],
  ]) assert.equal(mayDeploy(input), expected, `${scenario} must ${expected ? "deploy" : "not deploy"}`);
});

if (failures.length) {
  console.error(`FAIL Pages workflow contract (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("PASS Pages workflow contract: triggers, guards, fixed checkout, and event scenarios");
}
