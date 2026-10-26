import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryUrl = "https://github.com/joeldevz/skynex-v2";
const verifiedActions = new Map([
  ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
  ["pnpm/action-setup", "ea17c68df8912ef543352723c149a84f56e3d413"],
  ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
  ["actions/upload-artifact", "cf430e030ddbb5b0abf93d22962f4752f3646cd9"],
  ["actions/download-artifact", "9000827ccba6bdab643e8b6fd33ac0654aef8333"],
]);
const failures = [];

function check(label, verify) {
  try { verify(); }
  catch (error) { failures.push(`${label}: ${error.message}`); }
}

function stripComment(line) {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === '"' && ch === "\\") { i++; continue; }
    if (quote && ch === quote) { quote = ""; continue; }
    if (!quote && (ch === '"' || ch === "'")) { quote = ch; continue; }
    if (!quote && ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function keyValue(text) {
  const trimmed = text.trim();
  const listItem = trimmed.startsWith("- ");
  const body = listItem ? trimmed.slice(2).trimStart() : trimmed;
  const match = body.match(/^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*:\s*(.*?)\s*$/);
  if (!match) return null;
  return { key: match[1] ?? match[2] ?? match[3], value: match[4], listItem };
}

function parseLines(text) {
  return text.split(/\r?\n/).map((source, index) => {
    const contentWithIndent = stripComment(source);
    const indentation = contentWithIndent.match(/^ */)[0].length;
    const content = contentWithIndent.slice(indentation);
    const parsed = keyValue(content);
    return { index, source, content, indentation, parsed,
      effectiveIndentation: indentation + (parsed?.listItem ? 2 : 0) };
  });
}

function scalar(value = "") {
  const text = value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
    return text.slice(1, -1);
  return text;
}

function splitFlow(text) {
  const parts = [];
  let start = 0, quote = "", depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === '"' && ch === "\\") { i++; continue; }
    if (quote && ch === quote) { quote = ""; continue; }
    if (!quote && (ch === '"' || ch === "'")) { quote = ch; continue; }
    if (quote) continue;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  if (text.slice(start).trim()) parts.push(text.slice(start).trim());
  return parts;
}

function flowMap(value) {
  const text = value.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  const entries = splitFlow(text.slice(1, -1)).filter(Boolean).map((entry) => {
    const separator = entry.indexOf(":");
    assert(separator >= 0, `invalid inline mapping entry: ${entry}`);
    return [scalar(entry.slice(0, separator)), scalar(entry.slice(separator + 1))];
  });
  return new Map(entries);
}

function flowList(value) {
  const text = value.trim();
  if (!text.startsWith("[") || !text.endsWith("]")) return null;
  return splitFlow(text.slice(1, -1)).map(scalar).filter(Boolean);
}

function findTop(lines, key) {
  return lines.find((line) => line.indentation === 0 && line.parsed?.key === key) ?? null;
}

function blockLines(lines, header) {
  if (!header) return [];
  const headerIndex = lines.findIndex((line) => line.index === header.index);
  if (headerIndex < 0) return [];
  const result = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.content.trim() && line.indentation <= header.indentation) break;
    result.push(line);
  }
  return result;
}

function childRows(lines, header) {
  if (!header) return [];
  const block = blockLines(lines, header).filter((line) => line.content.trim() && line.parsed);
  if (!block.length) return [];
  const indentation = Math.min(...block.map((line) => line.effectiveIndentation));
  return block.filter((line) => line.effectiveIndentation === indentation);
}

function rowValue(lines, row) {
  const value = row?.parsed?.value ?? "";
  if (!/^[|>][+-]?$/.test(value.trim())) return value;
  const rowIndex = lines.findIndex((line) => line.index === row.index);
  const parts = [];
  for (const line of lines.slice(rowIndex + 1)) {
    if (line.content.trim() && line.indentation <= row.indentation) break;
    parts.push(line.content.trim() ? line.content : "");
  }
  return parts.join("\n");
}

function mapping(lines, header) {
  const inline = flowMap(header?.parsed?.value ?? "");
  if (inline) return inline;
  return new Map(childRows(lines, header).map((row) => [row.parsed.key, scalar(row.parsed.value)]));
}

function listValues(lines, header) {
  if (!header) return [];
  const inline = flowList(header.parsed.value ?? "");
  if (inline) return inline;
  const items = blockLines(lines, header).filter((line) => /^-\s+/.test(line.content.trim()));
  if (!items.length) return [];
  const indentation = Math.min(...items.map((line) => line.indentation));
  return items.filter((line) => line.indentation === indentation)
    .map((line) => scalar(line.content.trim().replace(/^-\s+/, "")));
}

function parseWorkflow(text) {
  const lines = parseLines(text);
  const jobsHeader = findTop(lines, "jobs");
  assert(jobsHeader, "workflow has no jobs map");
  const rows = childRows(lines, jobsHeader);
  assert(rows.length > 0, "workflow has no jobs");
  const jobs = rows.map((row) => {
    const jobLines = [row, ...blockLines(lines, row)];
    const fields = new Map(childRows(lines, row).map((field) => [field.parsed.key, field]));
    const stepsHeader = fields.get("steps");
    const block = blockLines(jobLines, stepsHeader);
    const markers = block.filter((line) => /^-\s+/.test(line.content.trim()));
    const markerIndent = markers.length ? Math.min(...markers.map((line) => line.indentation)) : -1;
    const starts = markers.filter((line) => line.indentation === markerIndent);
    const steps = starts.map((start, index) => {
      const end = starts[index + 1]?.index ?? Infinity;
      const stepLines = block.filter((line) => line.index >= start.index && line.index < end);
      const directIndent = markerIndent + 2;
      const fields = new Map(stepLines.filter((line) => line.parsed && line.effectiveIndentation === directIndent)
        .map((line) => [line.parsed.key, line]));
      const withHeader = fields.get("with");
      const withValues = flowMap(withHeader?.parsed.value ?? "")
        ?? new Map(childRows(stepLines, withHeader).map((line) => [line.parsed.key, scalar(rowValue(stepLines, line))]));
      const envHeader = fields.get("env");
      const env = flowMap(envHeader?.parsed.value ?? "")
        ?? new Map(childRows(stepLines, envHeader).map((line) => [line.parsed.key, scalar(rowValue(stepLines, line))]));
      const runRows = [...fields.values()].filter((line) => line.parsed.key === "run");
      return { index, fields, uses: scalar(fields.get("uses")?.parsed.value ?? ""),
        run: runRows.map((line) => scalar(rowValue(stepLines, line))).join("\n"), with: withValues, env };
    });
    const envHeader = fields.get("env");
    const env = flowMap(envHeader?.parsed.value ?? "")
      ?? new Map(childRows(jobLines, envHeader).map((line) => [line.parsed.key, scalar(rowValue(jobLines, line))]));
    return { id: row.parsed.key, row, lines: jobLines, fields, steps, env };
  });
  return { lines, jobs };
}

function fieldValue(fields, key) { return scalar(fields.get(key)?.parsed?.value ?? ""); }
function stepInput(step, key) { return step.with.get(key) ?? ""; }
function normalizedRun(run) {
  return run.split(/\r?\n/).map((line) => stripComment(line).trim()).filter(Boolean).join("\n");
}
function shellWords(line) {
  return [...line.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g)]
    .map((match) => (match[1] ?? match[2] ?? match[3]).replace(/\\(["\\])/g, "$1"));
}
function commandLines(job) {
  return job.steps.flatMap((step) => normalizedRun(step.run).split("\n").filter(Boolean));
}
function jobIsPublisher(job) { return commandLines(job).some((line) => /^npm\s+publish(?:\s|$)/.test(line)); }
function jobIsRelease(job) { return commandLines(job).some((line) => /^gh\s+release\s+create(?:\s|$)/.test(line)); }
function uploadSteps(job) { return job.steps.filter((step) => step.uses.startsWith("actions/upload-artifact@")); }
function downloadSteps(job) { return job.steps.filter((step) => step.uses.startsWith("actions/download-artifact@")); }
function needsFor(job, lines) {
  const header = job.fields.get("needs");
  if (!header) return [];
  const raw = scalar(header.parsed.value);
  if (raw) return flowList(raw) ?? [raw];
  return listValues(job.lines, header);
}
function hasUnconditionalFailure(jobOrStep) {
  const fields = jobOrStep.fields;
  const continuation = scalar(fields.get("continue-on-error")?.parsed?.value ?? "");
  return !fields.has("if") && (!fields.has("continue-on-error") || continuation === "false");
}

function repositoryValue(repository) {
  const raw = typeof repository === "string" ? repository : repository?.url;
  assert.equal(typeof raw, "string", "packages/npm-cli/package.json must include repository.url");
  return raw.replace(/^git\+/, "").replace(/\.git\/?$/, "").replace(/\/$/, "");
}

async function releaseVerifierEnforcesRepository(verifierSource, packageManifest) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "skynex-packed-repository-contract-"));
  try {
    const packageRoot = join(fixtureRoot, "packages/npm-cli");
    const verifierPath = join(fixtureRoot, "scripts/verify-npm-cli-package.mjs");
    const manifestPath = join(packageRoot, "package.json");
    await mkdir(join(packageRoot, "scripts"), { recursive: true });
    await mkdir(join(fixtureRoot, "scripts"), { recursive: true });
    await writeFile(verifierPath, verifierSource);

    const fixtureManifest = {
      ...packageManifest,
      repository: { type: "git", url: repositoryUrl },
    };
    await writeFile(manifestPath, `${JSON.stringify(fixtureManifest, null, 2)}\n`);
    await writeFile(join(packageRoot, "scripts/build-distribution.mjs"), "process.exit(0);\n");
    await writeFile(join(packageRoot, "README.md"), "fixture\n");
    await writeFile(join(packageRoot, "LICENSE"), "fixture\n");

    for (const path of [
      "apps/cli/src", "packages/npm-cli/src", "packages/catalog/src", "packages/compiler/src",
      "packages/application/src", "packages/domain/src", "packages/installer/src",
      "packages/sky-agents/src", "packages/tasks/src", "packages/tasks-node/src",
      "targets/opencode/src", "targets/opencode/resources/templates",
    ]) await mkdir(join(fixtureRoot, path), { recursive: true });
    const resourcesRoot = join(fixtureRoot, "targets/opencode/resources");
    await writeFile(join(resourcesRoot, "manifest.json"), '{"resources":[]}\n');
    await writeFile(join(resourcesRoot, "provenance.json"), '{"generated":[]}\n');
    await writeFile(join(resourcesRoot, "templates/.gitkeep"), "");

    const distRoot = join(packageRoot, "dist");
    const distResources = join(distRoot, "resources");
    await mkdir(join(distResources, "templates"), { recursive: true });
    await writeFile(join(distRoot, "cli.js"), "#!/usr/bin/env node\n");
    await chmod(join(distRoot, "cli.js"), 0o755);
    await writeFile(join(distResources, "manifest.json"), '{"resources":[]}\n');
    await writeFile(join(distResources, "provenance.json"), '{"generated":[]}\n');
    await writeFile(join(distResources, "templates/.gitkeep"), "");
    await chmod(distResources, 0o755);
    await chmod(join(distResources, "templates"), 0o755);

    const npmLookup = spawnSync("which", ["npm"], { encoding: "utf8", timeout: 5000 });
    assert.equal(npmLookup.error, undefined, `could not resolve npm for the isolated --contract fixture: ${npmLookup.error ?? ""}`);
    assert.equal(npmLookup.status, 0, `npm is required by the actual --contract verifier: ${npmLookup.stderr}`);
    const realNpm = npmLookup.stdout.trim();
    assert(realNpm.startsWith("/"), `npm resolution must produce an absolute executable path, got ${realNpm}`);

    const tamperBin = join(fixtureRoot, "tamper-bin");
    await mkdir(tamperBin);
    const wrongUrl = "https://github.com/untrusted/skynex-v2";
    const npmWrapper = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const realNpm = ${JSON.stringify(realNpm)};
const manifestPath = ${JSON.stringify(manifestPath)};
const args = process.argv.slice(2);
if (args[0] !== "pack") {
  const result = spawnSync(realNpm, args, { stdio: "inherit" });
  if (result.error) { console.error(result.error); process.exitCode = 1; }
  else process.exitCode = result.status ?? 1;
} else {
  const original = readFileSync(manifestPath);
  try {
    const manifest = JSON.parse(original.toString("utf8"));
    manifest.repository = { type: "git", url: ${JSON.stringify(wrongUrl)} };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\\n");
    const result = spawnSync(realNpm, args, { stdio: "inherit" });
    if (result.error) { console.error(result.error); process.exitCode = 1; }
    else process.exitCode = result.status ?? 1;
  } finally { writeFileSync(manifestPath, original); }
}
`;
    const npmWrapperPath = join(tamperBin, "npm");
    await writeFile(npmWrapperPath, npmWrapper);
    await chmod(npmWrapperPath, 0o755);

    const runContract = (env = process.env) => spawnSync(process.execPath, [verifierPath, "--contract"], {
      cwd: fixtureRoot, env, encoding: "utf8", timeout: 45000, maxBuffer: 2 * 1024 * 1024,
    });
    const correct = runContract();
    const tampered = runContract({ ...process.env, PATH: `${tamperBin}${delimiter}${process.env.PATH ?? ""}` });
    const output = (result) => `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().slice(0, 1400);
    for (const [label, result] of [["correct repository", correct], ["tampered packed repository", tampered]]) {
      assert.equal(result.error, undefined, `${label} --contract process did not complete: ${result.error ?? ""}`);
      assert.equal(result.signal, null, `${label} --contract process was terminated by ${result.signal}`);
      assert.notEqual(result.status, null, `${label} --contract process has no exit status`);
    }
    assert.equal(correct.status, 0,
      `correct repository URL must pass the actual --contract verifier; exit ${correct.status}: ${output(correct)}`);
    assert.match(correct.stdout, /PASS full npm CLI verifier contract entrypoint/,
      "correct repository fixture must complete the actual packed-package --contract path");
    assert.notEqual(tampered.status, 0,
      "the packed-package verifier accepted an archive whose repository URL changed after source validation");
    assert.match(output(tampered), /repository/i,
      `rejection of the altered packed package must identify its repository mismatch: ${output(tampered)}`);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

function workflowEvents(lines) {
  const on = findTop(lines, "on");
  assert(on, "workflow must declare triggers");
  const inlineList = flowList(on.parsed.value);
  if (inlineList) return inlineList;
  const inlineMapping = flowMap(on.parsed.value);
  if (inlineMapping) return [...inlineMapping.keys()];
  return childRows(lines, on).map((row) => row.parsed.key);
}

function releaseTagTrigger(workflow) {
  const on = findTop(workflow.lines, "on");
  assert(on && !on.parsed.value.trim(), "release workflow must use a trigger map");
  const events = childRows(workflow.lines, on);
  assert.deepEqual(events.map((row) => row.parsed.key), ["push"], "release workflow must trigger only on push");
  const pushFields = childRows(workflow.lines, events[0]);
  assert.deepEqual(pushFields.map((row) => row.parsed.key), ["tags"], "push trigger must have only a tag filter");
  assert.deepEqual(listValues(workflow.lines, pushFields[0]), ["v*"], "release workflow must trigger only on pushed v* tags");
}

function expectedVersionGuard(step) {
  const lines = normalizedRun(step.run).split("\n");
  return step.fields.get("shell") && scalar(step.fields.get("shell").parsed.value) === "bash"
    && JSON.stringify(lines) === JSON.stringify([
      'tag_version="${GITHUB_REF_NAME#v}"',
      'package_version="$(node -p \'require("./packages/npm-cli/package.json").version\')"',
      'if [[ "$tag_version" != "$package_version" ]]; then',
      'echo "Tag version does not match package version" >&2',
      "exit 1",
      "fi",
    ]);
}

function parseActionPin(uses) {
  const match = uses.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([0-9a-f]{40})$/);
  assert(match, `third-party action must use an approved full commit SHA: ${uses}`);
  const expected = verifiedActions.get(match[1]);
  assert(expected, `action is not in the verified official action allowlist: ${match[1]}`);
  assert.equal(match[2], expected, `${match[1]} must use its verified official commit ${expected}`);
}

function permissionsRecord(job) {
  const header = job.fields.get("permissions");
  return header ? Object.fromEntries(mapping(job.lines, header).entries().sort(([a], [b]) => a.localeCompare(b))) : null;
}

function publisherTarget(job) {
  const publishSteps = job.steps.filter((step) => normalizedRun(step.run).split("\n").some((line) => /^npm\s+publish(?:\s|$)/.test(line)));
  assert.equal(publishSteps.length, 1, "npm publisher must have exactly one publish step");
  const step = publishSteps[0];
  assert.equal(normalizedRun(step.run).split("\n").length, 1, "npm publish must be an unconditional direct command");
  const words = shellWords(normalizedRun(step.run));
  assert.deepEqual(words.slice(0, 2), ["npm", "publish"], "npm publication must use the documented npm CLI OIDC path");
  const target = words[2] ?? "";
  assert.match(target, /^\.\/[^/]+\.tgz$/, "npm publish must consume one local .tgz file");
  assert(words.includes("--provenance"), "npm publish must request provenance for Trusted Publishing OIDC");
  assert(!words.includes("--dry-run"), "release publisher must perform the tag-triggered npm publish");
  return target;
}

function releaseTarget(job) {
  const releaseSteps = job.steps.filter((step) => normalizedRun(step.run).split("\n").some((line) => /^gh\s+release\s+create(?:\s|$)/.test(line)));
  assert.equal(releaseSteps.length, 1, "GitHub Release job must create exactly one release");
  const step = releaseSteps[0];
  assert.equal(normalizedRun(step.run).split("\n").length, 1, "GitHub Release creation must be a direct command");
  const words = shellWords(normalizedRun(step.run));
  assert.deepEqual(words.slice(0, 3), ["gh", "release", "create"]);
  const tag = words[3] ?? "";
  assert(["$GITHUB_REF_NAME", "${GITHUB_REF_NAME}", "${{ github.ref_name }}"].includes(tag),
    "GitHub Release must use the pushed tag as its release tag");
  const assets = words.slice(4).filter((word) => /\.tgz$/i.test(word));
  assert.equal(assets.length, 1, "GitHub Release must attach exactly one .tgz asset");
  return assets[0];
}

function artifactPaths(value) {
  const inline = flowList(value);
  if (inline) return inline;
  return value.split(/\r?\n/).map((line) => line.trim().replace(/^[-]\s+/, "")).filter(Boolean);
}

function checksumCreationStep(job, tarballName, sidecarName) {
  const candidates = job.steps.filter((step) => normalizedRun(step.run).split("\n")
    .some((line) => /\bsha256sum\b/.test(line)));
  assert.equal(candidates.length, 1, "build must create exactly one SHA-256 sidecar for the release tarball");
  const step = candidates[0];
  assert.deepEqual(shellWords(normalizedRun(step.run)), [
    "cd", "/tmp/opencode/skynex-pack", "&&", "sha256sum", "--", tarballName, ">", sidecarName,
  ], "build must hash the exact packed .tgz into its matching .tgz.sha256 sidecar");
  assert(hasUnconditionalFailure(step), "tarball checksum creation must fail the build if hashing fails");
  return step;
}

function checksumCheckStep(job, sidecarName) {
  const candidates = job.steps.filter((step) => normalizedRun(step.run).split("\n")
    .some((line) => /\bsha256sum\b/.test(line)));
  assert.equal(candidates.length, 1, `${job.id} must verify exactly one downloaded SHA-256 sidecar`);
  const step = candidates[0];
  assert.deepEqual(shellWords(normalizedRun(step.run)), ["sha256sum", "--check", "--", sidecarName],
    `${job.id} must check the sidecar bound to the exact downloaded tarball filename`);
  assert(hasUnconditionalFailure(step), `${job.id} checksum verification must fail closed on a changed tarball`);
  return step;
}

function allActions(workflow) {
  return workflow.jobs.flatMap((job) => job.steps.map((step) => step.uses).filter(Boolean));
}

async function readInputs() {
  const paths = {
    package: join(root, "packages/npm-cli/package.json"),
    rootPackage: join(root, "package.json"),
    verifier: join(root, "scripts/verify-npm-cli-package.mjs"),
    release: join(root, ".github/workflows/release.yml"),
    ci: join(root, ".github/workflows/ci.yml"),
  };
  const [packageText, rootPackageText, verifier, release, ci] = await Promise.all([
    readFile(paths.package, "utf8"), readFile(paths.rootPackage, "utf8"),
    readFile(paths.verifier, "utf8"),
    readFile(paths.release, "utf8").catch((error) => error.code === "ENOENT" ? null : Promise.reject(error)),
    readFile(paths.ci, "utf8"),
  ]);
  return { packageJson: JSON.parse(packageText), rootPackage: JSON.parse(rootPackageText), verifier, release, ci };
}

const inputs = await readInputs();
const packageManifest = inputs.packageJson;
const releaseFileName = `skynex-ai-cli-${packageManifest.version}.tgz`;

check("R1 package metadata", () => {
  assert.match(packageManifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "release package version must be stable semver");
  assert.equal(repositoryValue(packageManifest.repository), repositoryUrl,
    `packages/npm-cli/package.json repository must identify ${repositoryUrl}`);
});

try {
  await releaseVerifierEnforcesRepository(inputs.verifier, packageManifest);
} catch (error) {
  failures.push(`R1 actual packed-package repository verifier: ${error.message}`);
}

if (inputs.release === null) {
  failures.push("R2-R5 release workflow: .github/workflows/release.yml is missing");
} else {
  let workflow;
  try { workflow = parseWorkflow(inputs.release); }
  catch (error) { failures.push(`R2-R5 release workflow structure: ${error.message}`); }

  if (workflow) {
    const publishers = workflow.jobs.filter(jobIsPublisher);
    const releases = workflow.jobs.filter(jobIsRelease);
    const artifactJobs = workflow.jobs.filter((job) => uploadSteps(job).length > 0);
    const publisher = publishers[0];
    const release = releases[0];
    const build = artifactJobs[0];

    check("R2 release trigger", () => releaseTagTrigger(workflow));
    check("R2 tag/version failure guard", () => {
      assert.match(packageManifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "package version must be stable semver");
      assert.equal(publishers.length, 1, "workflow must have exactly one npm publisher");
      assert(build, "workflow must have a pre-publication build/verification job");
      assert(hasUnconditionalFailure(build), "version-check job must not be conditionally skipped or continue on error");
      const guards = build.steps.filter(expectedVersionGuard);
      assert.equal(guards.length, 1,
        "build job must explicitly exit 1 when GITHUB_REF_NAME with leading v removed differs from package.json version");
      assert(hasUnconditionalFailure(guards[0]), "tag/version guard step must be unconditional and fail its job");
      assert(guards[0].index < build.steps.findIndex((step) => uploadSteps({ steps: [step] }).length),
        "tag/version mismatch must fail before artifact upload");
      assert(publisher && needsFor(publisher).includes(build.id),
        "npm publisher must depend on the guarded build job so a mismatch blocks publication");
      assert(hasUnconditionalFailure(publisher), "npm publisher must not bypass failed dependencies");
      assert.notEqual(scalar(publisher.fields.get("continue-on-error")?.parsed?.value ?? ""), "true",
        "npm publisher must not treat a failed dependency as success");
    });

    check("R3 verified action pins", () => {
      const actions = allActions(workflow);
      assert(actions.length > 0, "release workflow must use approved artifact-transfer actions");
      for (const action of actions) parseActionPin(action);
    });

    check("R4 isolated effective permissions", () => {
      assert.equal(publishers.length, 1, "workflow must have exactly one npm publisher job");
      assert.equal(releases.length, 1, "workflow must have exactly one GitHub Release asset job");
      assert.notEqual(publisher.id, release.id, "npm publisher and GitHub Release must be separate jobs");
      assert.deepEqual(permissionsRecord(publisher), { contents: "read", "id-token": "write" },
        "npm publisher permissions must be contents:read and id-token:write only");
      assert.deepEqual(permissionsRecord(release), { contents: "write" },
        "GitHub Release asset job must have contents:write only and no id-token:write");
      const workflowPermissions = findTop(workflow.lines, "permissions");
      assert(workflowPermissions, "workflow must declare deny-by-default top-level permissions: {}");
      assert.equal(scalar(workflowPermissions.parsed.value), "{}",
        "workflow-level permissions must be explicitly empty, not inherited from repository defaults");
      assert.deepEqual(Object.fromEntries(mapping(workflow.lines, workflowPermissions)), {},
        "workflow-level permissions must grant no permissions");
      const verificationJobs = workflow.jobs.filter((job) => job.id !== publisher.id && job.id !== release.id);
      assert(verificationJobs.length > 0 && verificationJobs.every((job) =>
        JSON.stringify(permissionsRecord(job)) === JSON.stringify({ contents: "read" })),
      "every build/verification job must have contents:read only");
    });

    check("R5 shared verified tarball and OIDC", () => {
      assert.equal(publishers.length, 1, "one npm publisher is required");
      assert.equal(releases.length, 1, "one GitHub Release asset job is required");
      assert.equal(artifactJobs.length, 1, "exactly one job may upload the release tarball artifact");
      assert(build && build.id !== publisher.id && build.id !== release.id,
        "tarball build/verification must be separate from both publishers");
      assert.equal(uploadSteps(build).length, 1, "exactly one tarball artifact may be uploaded");
      const upload = uploadSteps(build)[0];
      const artifactName = stepInput(upload, "name");
      const uploadedPaths = artifactPaths(stepInput(upload, "path"));
      const tarballPath = `/tmp/opencode/skynex-pack/${releaseFileName}`;
      const sidecarName = `${releaseFileName}.sha256`;
      const sidecarPath = `/tmp/opencode/skynex-pack/${sidecarName}`;
      assert.match(artifactName, /^[A-Za-z0-9_.-]+$/, "artifact must have one explicit stable name");
      assert.deepEqual(uploadedPaths, [tarballPath, sidecarPath],
        "one artifact must upload only the exact verified .tgz and its matching SHA-256 sidecar together");
      assert.equal(stepInput(upload, "if-no-files-found"), "error", "artifact upload must fail if the tarball is absent");
      assert.match(inputs.rootPackage.scripts?.["pack:cli"] ?? "", /--pack-destination\s+\/tmp\/opencode\/skynex-pack(?:\s|$)/,
        "root pack:cli script must emit the tarball into the checked release directory");
      const packSteps = build.steps.filter((step) => ["pnpm pack:cli", "pnpm run pack:cli"].includes(normalizedRun(step.run)));
      assert.equal(packSteps.length, 1, "build job must execute pnpm pack:cli exactly once");
      assert(hasUnconditionalFailure(packSteps[0]), "packing must run unconditionally and fail the build on error");

      assert.equal(publishers.length, 1);
      assert.equal(releases.length, 1);
      const verifierScript = inputs.rootPackage.scripts?.["verify:package:release"];
      assert.equal(verifierScript, "node scripts/verify-npm-cli-package.mjs --release",
        "root release verifier script must invoke the packed-package release verifier");
      const verifierSteps = build.steps.filter((step) => [
        "pnpm verify:package:release", "pnpm run verify:package:release",
        "node scripts/verify-npm-cli-package.mjs --release",
      ].includes(normalizedRun(step.run)));
      assert.equal(verifierSteps.length, 1, "build job must execute the actual packed-package release verifier exactly once");
      assert(hasUnconditionalFailure(verifierSteps[0]), "packed-package release verifier must execute unconditionally and fail the build on error");
      assert(packSteps[0].index < verifierSteps[0].index && verifierSteps[0].index < upload.index,
        "pack and packed-package verification must both run before the artifact is uploaded");
      assert(hasUnconditionalFailure(upload), "artifact upload must not be conditionally skipped or ignore failures");
      const checksumCreation = checksumCreationStep(build, releaseFileName, sidecarName);
      assert(verifierSteps[0].index < checksumCreation.index && checksumCreation.index < upload.index,
        "SHA-256 sidecar must be created from the already verified tarball before the pair is uploaded");

      for (const consumer of [publisher, release]) {
        assert(hasUnconditionalFailure(consumer), `${consumer.id} must not conditionally bypass its verified build dependency`);
        assert.equal(downloadSteps(consumer).length, 1, `${consumer.id} must download the shared artifact exactly once`);
        const download = downloadSteps(consumer)[0];
        assert.equal(stepInput(download, "name"), artifactName, `${consumer.id} must download uploaded artifact ${artifactName}`);
        assert.equal(stepInput(download, "path"), ".", `${consumer.id} must download the single tarball at the workspace root`);
        assert(needsFor(consumer).includes(build.id), `${consumer.id} must depend on verified tarball job ${build.id}`);
        assert(hasUnconditionalFailure(download), `${consumer.id} artifact download must run unconditionally and fail on error`);
        assert(!consumer.steps.some((step) => /\b(?:npm|pnpm)\s+pack\b/i.test(normalizedRun(step.run))),
          `${consumer.id} must consume, not rebuild, the downloaded tarball`);
      }

      const publishedTarget = publisherTarget(publisher);
      const releasedTarget = releaseTarget(release);
      const publishStep = publisher.steps.find((step) => normalizedRun(step.run).startsWith("npm publish"));
      const releaseStep = release.steps.find((step) => normalizedRun(step.run).startsWith("gh release create"));
      const publisherChecksum = checksumCheckStep(publisher, sidecarName);
      const releaseChecksum = checksumCheckStep(release, sidecarName);
      assert(downloadSteps(publisher)[0].index < publishStep.index,
        "npm publish must run only after downloading the shared artifact");
      assert(downloadSteps(release)[0].index < releaseStep.index,
        "GitHub Release creation must run only after downloading the shared artifact");
      assert(downloadSteps(publisher)[0].index < publisherChecksum.index && publisherChecksum.index < publishStep.index,
        "npm publisher must verify the downloaded tarball after download and before npm publish");
      assert(downloadSteps(release)[0].index < releaseChecksum.index && releaseChecksum.index < releaseStep.index,
        "GitHub Release job must verify the downloaded tarball after download and before attaching it");
      assert.equal(publishedTarget, `./${basename(tarballPath)}`,
        "npm publish must consume the exact filename bound by the uploaded checksum sidecar");
      assert.equal(releasedTarget, publishedTarget,
        "GitHub Release and npm publish must consume the same uploaded .tgz path");
      assert(hasUnconditionalFailure(publishStep),
        "npm publish step must not be conditionally skipped or ignore failure");
      const nodeSetup = publisher.steps.find((step) => step.uses === `actions/setup-node@${verifiedActions.get("actions/setup-node")}`);
      assert(nodeSetup && stepInput(nodeSetup, "node-version") === "24",
        "npm publisher must use the approved Node 24 runtime for current npm Trusted Publishing OIDC");
      assert(!/\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b|auth[_-]?token/i.test(workflow.lines.map((line) => line.content).join("\n")),
        "release workflow must not configure npm auth-token keys or long-lived npm tokens (case-insensitive)");
      assert(!/\bsecrets\s*\./i.test(publisher.lines.map((line) => line.content).join("\n")),
        "npm publisher job must not reference any GitHub secret");
      assert(!/\bsecrets\s*\./i.test(release.lines.map((line) => line.content).join("\n")),
        "GitHub Release job must not substitute a long-lived secret for the scoped github.token");
      const githubTokenJobs = workflow.jobs.filter((job) => /\$\{\{\s*github\.token\s*\}\}/i.test(
        job.lines.map((line) => line.content).join("\n")));
      assert.deepEqual(githubTokenJobs.map((job) => job.id), [release.id],
        "github.token may be referenced only by the separately permission-scoped GitHub Release job");
      assert.equal((release.lines.map((line) => line.content).join("\n").match(/\$\{\{\s*github\.token\s*\}\}/gi) ?? []).length, 1,
        "GitHub Release must use github.token only for its scoped GH_TOKEN authentication");
      assert(release.env.get("GH_TOKEN") === "${{ github.token }}"
        || release.steps.some((step) => step.env.get("GH_TOKEN") === "${{ github.token }}"),
      "GitHub Release job must authenticate gh with its scoped github.token, not an npm secret");
    });
  }
}

check("R6 root CI reachable hook", () => {
  const ci = parseWorkflow(inputs.ci);
  const triggers = findTop(ci.lines, "on");
  const events = workflowEvents(ci.lines);
  assert.deepEqual(events, ["push", "pull_request"],
    "root CI must retain normal push and pull_request triggers");
  assert.deepEqual(flowList(triggers?.parsed.value ?? ""), ["push", "pull_request"],
    "root CI push and pull_request triggers must be unfiltered so release-contract changes cannot be suppressed");
  const verifierJobs = ci.jobs.filter((job) => job.steps.some((step) =>
    normalizedRun(step.run) === "node scripts/verify-release-workflow.mjs"));
  assert(verifierJobs.length > 0, "root CI must invoke node scripts/verify-release-workflow.mjs");
  const byId = new Map(ci.jobs.map((job) => [job.id, job]));
  const visited = new Set();
  const visit = (job) => {
    assert(!visited.has(job.id), `CI dependency cycle reaches ${job.id}`);
    visited.add(job.id);
    assert(hasUnconditionalFailure(job), `CI job ${job.id} must not have a conditional skip or continue-on-error`);
    for (const dependency of needsFor(job)) {
      assert(byId.has(dependency), `CI job ${job.id} has an unknown dependency ${dependency}`);
      visit(byId.get(dependency));
    }
    visited.delete(job.id);
  };
  for (const job of verifierJobs) {
    visit(job);
    const steps = job.steps.filter((step) => normalizedRun(step.run) === "node scripts/verify-release-workflow.mjs");
    assert(steps.every(hasUnconditionalFailure), "root CI verifier step must be unconditional and propagate failures");
  }
});

if (failures.length) {
  console.error(`FAIL release workflow contract\n${failures.map((failure) => ` - ${failure}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("PASS release workflow contract (R1-R6)");
}
