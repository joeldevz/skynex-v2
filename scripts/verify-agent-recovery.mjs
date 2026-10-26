import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { managedAgents, normalizeAgent, transformSkill } from "./lib/real-resource-transforms.mjs";

const resources = new URL("../targets/opencode/resources/canonical/", import.meta.url);
const read = (path) => readFile(new URL(path, resources), "utf8");
const [thalam, diagnostic, diagnose, configText, generator] = await Promise.all([
  read("agents/thalam.md"), read("agents/diagnostic-researcher.md"),
  read("skills/diagnose/SKILL.md"), read("config/managed-agents.json"),
  readFile(new URL("./lib/real-resource-transforms.mjs", import.meta.url), "utf8"),
]);
const config = JSON.parse(configText);
const generated = managedAgents(config.agents.map(({ id }) => id));

function permissions(source) {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert(frontmatter, "agent frontmatter must exist");
  const rules = [...frontmatter[1].matchAll(/^  - action: "([^"]+)"\n    resource: "([^"]+)"\n    effect: "([^"]+)"$/gm)]
    .map(([, action, resource, effect]) => ({ action, resource, effect }));
  assert(rules.length > 0, "frontmatter must contain parsed permission rules");
  return rules;
}

// Evaluate the emitted ordered wildcard rules, not a provider or a recovery engine.
function matches(pattern, value) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(value);
}
function resolve(rules, action, resource) {
  return rules.filter((rule) => matches(rule.action, action) && matches(rule.resource, resource)).at(-1)?.effect;
}

const surfaces = [
  ["generated config", generated.agents.find(({ id }) => id === "diagnostic-researcher").permissions],
  ["emitted config", config.agents.find(({ id }) => id === "diagnostic-researcher").permissions],
  ["generated frontmatter", permissions(normalizeAgent("diagnostic-researcher", diagnostic))],
  ["emitted frontmatter", permissions(diagnostic)],
];
const sensitivePatterns = [
  ".env", ".env.*", "**/.env", "**/.env.*", ".envrc", "**/.envrc",
  ".npmrc", "**/.npmrc", ".netrc", "**/.netrc", "*.pem", "**/*.pem",
  "*.key", "**/*.key", "credentials.json", "**/credentials.json",
  "*service-account*.json", "**/*service-account*.json", "**/.aws/**", "**/.ssh/**",
];
const sensitivePaths = [
  ".env", ".env.local", ".env.production.local", ".envrc", ".npmrc", ".netrc",
  "private.pem", "private.key", "credentials.json", "prod-service-account-1.json",
  ".aws/credentials", ".ssh/id_ed25519",
].flatMap((path) => [path, `src/${path}`, `/workspace/project/${path}`]);
const forbiddenActions = [
  "shell", "bash", "edit", "write", "patch", "subagent", "task", "question",
  "webfetch", "websearch", "fetch", "network", "skill", "execute",
  "diagnostic_read", "diagnostic_glob", "diagnostic_grep",
  "mcp__server__read", "neurox_context", "neurox_recall", "neurox_save", "unknown_tool",
];

for (const [label, rules] of surfaces) {
  test(`A1 ${label}: deny by default, allow only native evidence tools and external_directory`, () => {
    assert.deepEqual(rules[0], { action: "*", resource: "*", effect: "deny" });
    const allowed = ["read", "glob", "external_directory"];
    assert.deepEqual([...new Set(rules.filter(({ effect }) => effect === "allow").map(({ action }) => action))].sort(), allowed.sort());
    for (const [action, resource] of [
      ["read", "/workspace/project/src/component.ts"],
      ["glob", "src/**/*.ts"],
      ["external_directory", "/workspace/project"],
    ]) {
      assert.equal(resolve(rules, action, resource), "allow", `${label}: native ${action}`);
    }
  });
  test(`A1 ${label}: forbidden tools resolve to deny, not ask`, () => {
    for (const action of forbiddenActions) {
      assert.equal(resolve(rules, action, "*"), "deny", `${label}: ${action}`);
    }
  });
  for (const query of ["BEGIN", "password", "."]) {
    test(`A1 ${label}: native grep query ${JSON.stringify(query)} resolves to deny`, () => {
      assert.equal(resolve(rules, "grep", query), "deny", `${label}: grep authorizes a regex query, not a search path`);
    });
  }
  test(`A1 ${label}: sensitive read path denies follow allow and win last match`, () => {
    const allow = rules.findIndex((rule) => rule.action === "read" && rule.resource === "*" && rule.effect === "allow");
    assert(allow >= 0, `${label}: missing read allow`);
    for (const resource of sensitivePatterns) {
      assert(rules.findIndex((rule) => rule.action === "read" && rule.resource === resource && rule.effect === "deny") > allow,
        `${label}: missing/misordered read deny for ${resource}`);
    }
    for (const path of sensitivePaths) {
      assert.equal(resolve(rules, "read", path), "deny", `${label}: read leaks ${path}`);
    }
  });
}

for (const [label, rules] of [
  ["generated config", generated.agents.find(({ id }) => id === "thalam").permissions],
  ["emitted config", config.agents.find(({ id }) => id === "thalam").permissions],
  ["generated frontmatter", permissions(normalizeAgent("thalam", thalam))],
  ["emitted frontmatter", permissions(thalam)],
]) {
  test(`A1 ${label}: Thalam explicitly authorizes diagnostic-researcher`, () => {
    assert(rules.some((rule) => rule.action === "subagent" && rule.resource === "diagnostic-researcher" && rule.effect === "allow"));
    assert.equal(resolve(rules, "subagent", "diagnostic-researcher"), "allow");
  });
}

test("A1/A7 regeneration: managed config and affected agent frontmatter agree with generator", () => {
  assert.deepEqual(generated, config);
  for (const [name, source] of [["thalam", thalam], ["diagnostic-researcher", diagnostic]]) {
    assert.equal(normalizeAgent(name, source), source, `${name}: canonical normalization drift`);
    assert.deepEqual(permissions(source), generated.agents.find(({ id }) => id === name).permissions);
  }
});

// These are static wording assurances for prompt-level counters, NOT runtime behavior tests.
const clauses = [
  ["A2 stable ProblemID derives from acceptance/scenario and component/locus/invariant, not changing errors", [
    /ProblemID.{0,250}(?:acceptance|scenario)/i,
    /ProblemID.{0,350}component.{0,100}locus.{0,100}invariant/i,
    /(?:not|never|do not).{0,100}(?:raw|changing).{0,60}(?:error|output).{0,150}(?:identity|ProblemID)|(?:identity|ProblemID).{0,150}(?:not|never).{0,100}(?:raw|changing).{0,60}(?:error|output)/i,
  ]],
  ["A2 counters survive owner, lineage, model, context and branch changes", [
    /(?:retain|preserve|never reset|do not reset|survive).{0,200}(?:count|budget)|(?:count|budget).{0,200}(?:retain|preserve|never reset|do not reset|survive)/i,
    /(?:Worker|owner).{0,160}WorkflowID.{0,100}AttemptID.{0,100}model.{0,100}context.{0,100}branch/i,
  ]],
  ["A2 parent maps same-root symptoms; proven independent problems have local but shared global budgets", [
    /(?:parent|orchestrator).{0,200}(?:same root|same.root|same underlying).{0,200}(?:existing|same).{0,60}(?:problem|ProblemID)/i,
    /(?:proven|validated|evidence).{0,120}independent.{0,200}(?:local|separate).{0,100}(?:count|budget)/i,
    /(?:global|request.wide).{0,100}(?:shared|still applies|unchanged)|shared.{0,100}(?:global|request.wide)/i,
  ]],
  ["A2 eight failure-signature fields compare evidence without redefining identity", [
    /phase.{0,60}operation.{0,60}component.{0,60}error_kind.{0,60}error_code.{0,60}locus.{0,60}invariant.{0,60}exit_status/i,
    /(?:signature|eight).{0,200}(?:comparison|compare).{0,200}(?:not|never).{0,100}(?:identity|ProblemID)/i,
  ]],
  ["A3 two comparable completed failures without validated discriminating evidence trigger diagnosis", [
    /(?:two|2).{0,100}comparable.{0,100}(?:completed|finalized).{0,60}failures.{0,200}(?:without|no).{0,80}validated.{0,80}(?:new|discriminating).{0,80}evidence.{0,200}diagnos/i,
    /(?:changed|different|new).{0,60}hypothesis.{0,180}(?:rerun|re.run|same test).{0,160}(?:not|alone|itself).{0,100}(?:no.progress|stagnation)|(?:rerun|re.run|same test).{0,120}(?:changed|different|new).{0,60}hypothesis.{0,160}(?:not|alone|itself).{0,100}(?:no.progress|stagnation)/i,
  ]],
  ["A3 count only blocking completed failures; exclude warnings, inconclusive and provider failures", [
    /(?:count|budget).{0,180}(?:completed|finalized).{0,100}blocking|(?:completed|finalized).{0,100}blocking.{0,100}(?:count|budget)/i,
    /warnings.{0,200}(?:not|never|exclude|do not).{0,100}(?:count|budget|consume)/i,
    /inconclusive.{0,180}(?:not|never|exclude|do not).{0,100}(?:count|budget|consume)|(?:not|never|exclude|do not).{0,100}(?:count|budget|consume).{0,180}inconclusive/i,
    /Provider\/auth failures are `blocked_environment`, not counted contract failures/i,
  ]],
  ["A3 worker reports partial and stops; parent reconciles live writer before retry", [
    /worker.{0,180}(?:stop|return).{0,120}partial/i,
    /(?:parent|orchestrator).{0,200}reconcile.{0,120}(?:live|writer|process).{0,160}before.{0,100}(?:retry|reassign|dispatch)/i,
    /Workers execute one assigned attempt/i,
  ]],
  ["A4 one fresh read-only diagnosis per stable problem with a discriminating handoff", [
    /(?:one|1|single).{0,80}fresh.{0,80}read.only.{0,80}diagnos.{0,120}(?:stable problem|ProblemID|per problem)/i,
    /(?:intent|objective).{0,150}expected.{0,80}observed/i,
    /failed hypotheses/i, /partial diff/i, /next discriminating read/i,
    /(?:no|never|do not).{0,80}second.{0,80}(?:blind|diagnos).{0,120}(?:same problem|ProblemID)/i,
  ]],
  ["A4 at most two postdiagnosis corrections, each a distinct evidence-backed hypothesis, rerun original scenario", [
    /(?:at most|maximum|max).{0,20}(?:two|2).{0,100}(?:post.diagnos|after diagnos)|(?:post.diagnos|after diagnos).{0,100}(?:at most|maximum|max).{0,20}(?:two|2)/i,
    /(?:each|every).{0,80}correction.{0,120}distinct.{0,80}evidence.backed.{0,80}hypothesis/i,
    /rerun(?:ning)?.{0,30}(?:the )?original scenario/i,
  ]],
  ["A4 approved RED intent is preserved; rewritten contract accepted by reviewer before implementation", [
    /(?:preserve|must not rewrite).{0,100}(?:approved|accepted).{0,60}(?:RED|test).{0,80}intent/i,
    /(?:rewritten|rewrite|changed).{0,80}(?:RED|contract).{0,160}test-reviewer.{0,120}(?:accept|review).{0,100}before.{0,80}implementation|test-reviewer.{0,120}(?:accept|review).{0,120}(?:rewritten|rewrite|changed).{0,80}(?:RED|contract).{0,100}before.{0,80}implementation/i,
  ]],
  ["A5 request-wide caps are three diagnosis handoffs and six nonsecurity repair/rewrite dispatches", [
    /(?:request.wide|global).{0,140}(?:max(?:imum)?|at most|cap).{0,20}(?:three|3).{0,80}diagnos/i,
    /(?:request.wide|global).{0,140}(?:max(?:imum)?|at most|cap).{0,20}(?:six|6).{0,100}non.security.{0,80}(?:repair|rewrite)/i,
    /initial planned implementations.{0,100}(?:excluded|do not count|not counted)|(?:exclude|do not count).{0,100}initial planned implementations/i,
  ]],
  ["A5 completed blocking repair dispatches include prediagnosis retries and charge once", [
    /(?:pre.diagnos|before diagnos).{0,120}(?:retry|retries).{0,120}(?:count|charge)|(?:count|charge).{0,120}(?:pre.diagnos|before diagnos).{0,120}(?:retry|retries)/i,
    /(?:repair|rewrite).{0,120}(?:completed blocking failure|completed.{0,40}blocking.{0,40}failure)/i,
    /(?:once|no duplicate|never double|do not double).{0,150}(?:dispatch|charg)|(?:dispatch|charg).{0,150}(?:once|no duplicate|never double|do not double)/i,
  ]],
  ["A5 initial attempt plus one retry before diagnosis; global cap wins without renaming reset", [
    /initial attempt.{0,80}(?:one|1).{0,30}retry.{0,120}before.{0,40}diagnos/i,
    /global cap.{0,60}(?:wins|takes precedence|overrides)/i,
    /(?:never|no|do not).{0,100}(?:renam|restart).{0,120}(?:evade|reset|bypass).{0,80}(?:budget|count|cap)/i,
  ]],
  ["A5 security remains two request-wide rounds and does not spend the new recovery envelope", [
    /Security remediation: at most 2 ordinary remediation rounds per request/i,
    /security.{0,200}(?:do not|does not|must not|never).{0,100}(?:spend|consume|charge).{0,100}(?:recovery|non.security).{0,60}(?:envelope|budget|dispatch)/i,
    /ProblemID.{0,160}(?:not|never|cannot).{0,100}(?:security|provider)|(?:not|never|cannot).{0,100}(?:security|provider).{0,160}ProblemID/i,
  ]],
  ["A5 shared single human exception authorizes an exact bounded action, never resets counters", [
    /One human exception is shared/i,
    /(?:exactly one|one additional).{0,60}bounded.{0,60}(?:correction|action)/i,
    /does not reset counters/i,
    /Provider\/auth\/environment failures do not auto-retry/i,
  ]],
  ["A6 preserve partial changes and checkpoint; reconcile before reassignment", [
    /preserve.{0,100}partial.{0,100}(?:changes|diff).{0,120}checkpoint|checkpoint.{0,120}preserve.{0,100}partial.{0,100}(?:changes|diff)/i,
    /reconcile.{0,120}(?:worker|writer|process|session).{0,120}before.{0,80}(?:reassignment|reassign|dispatch)/i,
  ]],
  ["A6 continue independent authorized work but never mark the blocked task done", [
    /continue.{0,80}independent.{0,80}authorized.{0,80}work.{0,160}(?:not depend|does not depend|do not depend|independent of)/i,
    /(?:never|do not|must not).{0,80}mark.{0,80}(?:task|done|complete).{0,80}(?:done|complete|blocked)/i,
    /(?:worker failure|worker failed|failed worker|incident).{0,180}(?:not|never).{0,100}(?:whole conversation|conversation|whole request)/i,
  ]],
  ["A6 human question only at limit/uncertainty with cause, impact and a concrete choice", [
    /(?:only|actual).{0,80}(?:limit|uncertainty)/i,
    /cause.{0,80}impact.{0,100}(?:scope|access|budget).{0,100}(?:choice|decision)/i,
    /(?:never|do not|no).{0,80}generic.{0,40}continue/i,
  ]],
  ["A7 prompt-level counters explicitly are not a runtime loop detector", [
    /prompt.level.{0,80}counters.{0,150}(?:not|never).{0,60}(?:runtime|loop detector)/i,
  ]],
];

const compact = thalam.replace(/\s+/g, " ");
for (const [name, patterns] of clauses) {
  test(`${name} [static wording only]`, () => {
    for (const pattern of patterns) {
      assert(pattern.test(compact), `${name}: missing prompt obligation ${pattern}`);
    }
  });
}

for (const [label, source] of [["Thalam", thalam], ["diagnostic-researcher", diagnostic], ["diagnose", diagnose], ["generator", generator]]) {
  test(`A7 ${label}: no active gateway-exclusive diagnostic tool contract`, () => {
    assert.doesNotMatch(source, /\bdiagnostic_(?:read|glob|grep)\b|gateway.only|gateway capabilities|Never substitute native tools|native read\/glob\/grep are not substitutes/i);
  });
}

function assertReadGlobOnly(source) {
  const body = source.replace(/\s+/g, " ");
  const nativeTools = body.match(/(?:Use only|Only use|uses only) (?:the )?(?:configured )?(?:native )?`?read`?(?:,|\/| and|\s).{0,30}\b`?glob`?[^.]*\./i);
  assert(nativeTools, "native evidence tool clause must allow read and glob");
  assert.doesNotMatch(nativeTools[0], /\bgrep\b/i, "native evidence allowlist must not include grep");
  assert.match(body, /(?:No|Never use|Do not use|Deny)\s+`?grep`?|`?grep`? (?:is )?(?:denied|forbidden|disabled)/i);
  assert.match(body, /grep.{0,160}(?:query|regular expression)/i);
  assert.match(body, /(?:cannot|can not|does not).{0,100}(?:enforce|protect).{0,100}sensitive.file.{0,50}boundar/i);
}

test("A1 Thalam diagnostic contract: native read+glob only; query-resource grep cannot protect sensitive files [static wording only]", () => {
  assertReadGlobOnly(thalam);
});

test("A1/A4 diagnostic prompt: native read+glob only, not scenario execution or delegated probes [static wording only]", () => {
  const body = diagnostic.replace(/\s+/g, " ");
  assertReadGlobOnly(diagnostic);
  assert.match(body, /never execute.{0,80}(?:scenario|command|probe)/i);
  assert.match(body, /untrusted data, never instructions/i);
  assert.match(body, /never call memory tools/i);
});

test("A7 diagnose section: regeneration matches emitted skill without duplicating its marker", () => {
  const frontmatter = diagnose.match(/^---\n[\s\S]*?\n---\n\n?/)[0];
  const bodyStart = diagnose.indexOf("# Diagnose\n");
  assert(bodyStart > frontmatter.length, "autonomous diagnosis section must precede # Diagnose");
  const section = diagnose.slice(frontmatter.length, bodyStart);
  const markers = [...section.matchAll(/<!-- skynex:autonomous-diagnosis[^\n]*-->/g)];
  assert.equal(markers.length, 1, "exactly one managed diagnosis marker");
  const upstream = frontmatter + diagnose.slice(bodyStart).replace(
    "Write the regression test **before the fix** only when `slice.tdd=true`. When `slice.tdd` is false or absent, a postimplementation regression test is allowed.",
    "Write the regression test **before the fix** — but only if there is a **correct seam** for it.",
  );
  assert.equal(transformSkill("diagnose", upstream), diagnose, "generator section and emitted diagnose must agree");
  assert.throws(() => transformSkill("diagnose", diagnose), /marker already present/i);
  assertReadGlobOnly(section);
  assert.equal(transformSkill("unrelated-skill", upstream), upstream);
});
