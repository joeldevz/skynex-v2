import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { managedAgents } from "./lib/real-resource-transforms.mjs";

const root = resolve("targets/opencode/resources");
const sha = (v) => createHash("sha256").update(v).digest("hex");
const cases = [];
const policyOnly = process.argv.includes("--policy-only");
async function test(name, fn) {
  if (policyOnly && name !== "managed-config-external-directory-policy") return;
  await fn(); cases.push(name); console.log(`PASS ${name}`);
}
async function treeDigest(paths) {
  const rows = [];
  async function walk(path) {
    const info = await lstat(path).catch((e) => e.code === "ENOENT" ? null : Promise.reject(e));
    if (!info) return rows.push([path, "absent"]);
    if (info.isSymbolicLink()) return rows.push([path, "symlink"]);
    if (info.isDirectory()) { rows.push([path, "dir"]); for (const n of (await readdir(path)).sort()) await walk(join(path, n)); }
    else rows.push([path, "file", sha(await readFile(path))]);
  }
  for (const path of paths) await walk(path);
  return sha(JSON.stringify(rows));
}
const globalPaths = [join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"), "opencode", "agents"), join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"), "opencode", "skills"), join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"), "opencode", "plugins"), join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"), "opencode", "opencode.json"), join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"), "opencode", "opencode.jsonc")];
const before = await treeDigest(globalPaths);
const manifest = JSON.parse(await readFile(join(root, "manifest.json")));
const provenance = JSON.parse(await readFile(join(root, "provenance.json")));
await test("catalog-exact-agent-and-skill-inventory", async () => {
  const agents = manifest.resources.filter(x => x.kind === "agent");
  assert.equal(agents.length, 13); assert(agents.some(x => x.id.endsWith("mentor")));
  assert(agents.some(x => x.id === "agents.thalam" && x.sourcePath === "canonical/agents/thalam.md" && x.targets.some(t => t.relativePath === "agents/thalam.md")));
  assert(!agents.some(x => /skynex-orchestrator/.test(`${x.id} ${x.sourcePath} ${JSON.stringify(x.targets)}`)));
  assert(!agents.some(x => /advisor|manager|linear/.test(x.id)));
  const skillLeaves = manifest.resources.filter(x => x.kind === "skill");
  assert.equal(skillLeaves.length, 25);
  const top = new Set(skillLeaves.map(x => x.sourcePath.split("/")[2]));
  assert.equal(top.size, 12); assert(top.has("_shared")); assert(top.has("skynex-tasks"));
});
await test("catalog-every-leaf-owned-and-digested", async () => {
  const declared = new Set(manifest.resources.map(x => x.sourcePath));
  const retired = new Set(["native/plugins/skynex-tasks/tasks.js","native/plugins/skynex-tasks/tasks-node.js",...(["errors.js","index.js","instruction.js","ports.js","schema.js","service.js","slug.js","task.js"].map(name=>`native/plugins/skynex-tasks/tasks-core/${name}`)),...(["fs-safe.js","index.js","roots.js","store.js","system.js"].map(name=>`native/plugins/skynex-tasks/tasks-node-core/${name}`))]);
  async function walk(dir, prefix) { for (const e of await readdir(dir,{withFileTypes:true})) { const p=join(dir,e.name), r=`${prefix}/${e.name}`, info=await lstat(p); assert(!info.isSymbolicLink(),`resource symlink ${r}`); if(info.isDirectory()) await walk(p,r); else { assert(info.isFile(),`unexpected resource type ${r}`); assert(declared.has(r)||retired.has(r),`undeclared ${r}`); } } }
  await walk(join(root,"canonical"),"canonical"); await walk(join(root,"native"),"native");
});
await test("provenance-hashes-and-portability", async () => {
   assert.equal(provenance.generated.length, 66);
   for (const e of provenance.generated) { assert(!e.source.startsWith("/")); assert(!e.target.startsWith("/")); assert.equal(sha(await readFile(join(root,e.target))),e.generatedSha256); }
   assert.equal(new Set(provenance.generated.map(e => e.target)).size, provenance.generated.length);
   assert.deepEqual(new Set(provenance.generated.map(e => e.target)), new Set(manifest.resources.map(e => e.sourcePath)));
   for (const e of manifest.resources.filter(e => e.generatedSha256)) assert.equal(sha(await readFile(join(root,e.sourcePath))),e.generatedSha256);
  assert(!JSON.stringify(provenance).includes("/home/"));
});
await test("vendored-jsonc-parser-provenance", async () => {
  const records=provenance.generated.filter(x=>x.transformation==="vendored-jsonc-parser-3.3.1");
  assert.equal(records.length,8);
  for(const e of records){
    assert.equal(e.package,"jsonc-parser"); assert.equal(e.packageVersion,"3.3.1");
    assert.match(e.packageIntegrity,/^sha512-/); assert.equal(e.upstreamRepository,"https://github.com/microsoft/node-jsonc-parser");
    assert.equal(e.upstreamTag,"v3.3.1"); assert.equal(e.npmTarball,"https://registry.npmjs.org/jsonc-parser/-/jsonc-parser-3.3.1.tgz");
    assert.equal(e.sourceSha256,e.generatedSha256); assert.equal(e.sourceReferences.length,1);
    assert.match(e.sourceReferences[0].path,/^npm:jsonc-parser@3\.3\.1\/(?:lib\/esm\/|LICENSE\.md)/);
    assert.equal(e.sourceReferences[0].sha256,e.generatedSha256);
  }
});
await test("native-sky-agents-imports-are-runtime-relative", async () => {
  const nativeSkyRoot=join(root,"native/plugins/sky-agents");
  const sources=[];
  async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else if(/\.tsx?$/.test(e.name))sources.push([p,await readFile(p,"utf8")]);}}
  await walk(nativeSkyRoot);
  for(const [path,source] of sources) assert(!/\bfrom\s+["']jsonc-parser["']/.test(source),`bare jsonc-parser import: ${path}`);
  const profileApply=await readFile(join(nativeSkyRoot,"core/profile-apply.ts"),"utf8");
  assert.equal(profileApply.split('from "../vendor/jsonc-parser/main.js"').length-1,1);
});
await test("skynex-tasks-session-sidebar-contract-and-portable-imports", async () => {
  const tui = await readFile(join(root,"native/plugins/skynex-tasks/tui.tsx"),"utf8");
  const pkg = JSON.parse(await readFile(join(root,"native/plugins/skynex-tasks/package.json"),"utf8"));
  const server = await readFile(join(root,"native/plugins/skynex-tasks/index.ts"),"utf8");
  const controller = await readFile(join(root,"native/plugins/skynex-tasks/controller.ts"),"utf8");
  const snapshot = await readFile(join(root,"native/plugins/skynex-tasks/snapshot.ts"),"utf8");
  assert.match(tui,/append:\s*"sidebar\.content"/);
  assert.match(tui,/sessionID=\{slot\.sessionID\}/);
  assert.match(tui,/createEffect\(\(\) => controller\.setSession\(props\.sessionID\)\)/);
  assert.match(tui,/onCleanup\(\(\) => controller\.dispose\(\)\)/);
  // L1-L5 retain compact progress while rendering the entire ordered step list.
  assert.match(tui,/task\.total - task\.doneCount/);
  assert.match(tui,/\$\{task\.doneCount\}\/\$\{task\.total\}/);
  assert.doesNotMatch(tui,/shortTitle\(item\(\)\.title\)/);
  assert.match(tui,/step\.id === \(item\(\)\.current\?\.id \?\? item\(\)\.next\?\.id\)/);
  assert.match(tui,/<Show when=\{active\} fallback=\{label\}><strong>\{label\}<\/strong><\/Show>/);
  assert.match(tui,/<For each=\{item\(\)\.steps\}/);
  assert.match(tui,/<scrollbox maxHeight=\{10\}/);
  assert.match(tui,/flexShrink=\{0\}/);
  assert.match(tui,/done: "✓", pending: "○", in_progress: "→", blocked: "!"/);
  assert.match(tui,/shortTitle\(step\.title\)/);
  assert.match(tui,/Lista pendiente de actualizar/);
  assert.match(tui,/Sin pasos/);
  assert.doesNotMatch(tui,/task\?\.current \?\? task\?\.next/);
  assert.match(tui,/item\(\)\.blockers\.length > 0/);
  assert.doesNotMatch(tui,/(?:item\(\)(?:\.task)?|task)\.(?:id|status)\b/);
  assert.match(tui,/Sin tarea asignada/); assert.match(tui,/onMouseDown=\{toggle\}/); assert.doesNotMatch(tui,/updatedAt|instantánea CLI|Publicado:/);
  assert.match(controller,/setInterval\(callback, 4000\)/);
  assert.match(controller,/clock\.stop\(timer\)/);
  assert.match(snapshot,/getSessionTask:/);
  assert.equal(pkg.exports["./tui"],"./tui.tsx");
  assert.equal(pkg.exports["."],"./index.ts");
  assert.match(server,/export default/);
  assert.match(tui,/from "\.\/snapshot\.ts"/);
  assert.match(tui,/from "\.\/controller\.ts"/);
  assert.match(server,/name: "skynex_task_update"/);
  assert.match(server,/event\.agent === "thalam"/);
  assert.match(server,/skynex task status --task <id> --json/);
  for (const method of ["get", "set", "remove"]) assert(server.includes(`ctx.storage.${method}(`));
  const gate = await readFile(join(root,"native/plugins/skynex-tasks/review-gate.ts"),"utf8");
  // E3: review-gate.ts is the only module allowed to touch the system, via node:child_process only.
  assert.deepEqual([...gate.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(m => m[1]), ["node:child_process"]);
  assert.doesNotMatch(gate,/node:(?!child_process)|readFile|readdir|writeFile|\bspawn\b|\bexec\(|execSync|shell:\s*true|Bun\.|\beval\(/);
  assert.match(gate,/shell: false, timeout: 2000, maxBuffer: 65536/);
  assert.match(server,/from "\.\/review-gate\.ts"/); assert.match(server,/ctx\.tool\.hook\("execute\.before"/);
  const active = new Map([["index.ts", server], ["tui.tsx", tui], ["snapshot.ts", snapshot], ["controller.ts", controller]]);
  for (const [name, source] of [...active, ["review-gate.ts", gate]]) {
    const path = `native/plugins/skynex-tasks/${name}`;
    const entry = manifest.resources.find(e => e.sourcePath === path);
    assert(entry, `missing active resource: ${path}`);
    assert.equal(entry.targets[0].relativePath, `skynex/plugins/skynex-tasks/${name}`);
    const record = provenance.generated.find(e => e.target === path);
    assert.equal(record.source, path); assert.equal(record.sourceSha256, sha(source));
  }
  for (const [name, source] of active) {
    assert.doesNotMatch(source,/node:|tasks-node|tasks-core|\.\/tasks\.js|child_process|readFile|readdir|Bun\.|\beval\(|\bexec\(/);
    assert.doesNotMatch(source,/session\.panel|keymap|palette|session\.root|listTasks|getTask\(/);
    for (const [, dependency] of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      const hostImport = name === "tui.tsx" && ["solid-js", "@opencode/plugin/tui"].includes(dependency);
      const gateImport = name === "index.ts" && dependency === "./review-gate.ts";
      assert(hostImport || gateImport || (dependency.startsWith("./") && active.has(dependency.slice(2))), `unexpected active import: ${name} -> ${dependency}`);
    }
  }
});
await test("skynex-tasks-filesystem-reader-prototype-is-excluded-from-resources", async () => {
  const prototypeSource = /^native\/plugins\/skynex-tasks\/(?:tasks\.js|tasks-node\.js|tasks-core\/|tasks-node-core\/)/;
  const prototypeTarget = /^skynex\/plugins\/skynex-tasks\/(?:tasks\.js|tasks-node\.js|tasks-core\/|tasks-node-core\/)/;
  const prototypeId = /^skynex-tasks-(?:tasks-js|tasks-node-js|core-|node-core-)/;
  for (const entry of manifest.resources) {
    assert(!prototypeId.test(entry.id), `historical reader catalog id: ${entry.id}`);
    assert(!prototypeSource.test(entry.sourcePath), `historical reader catalog source: ${entry.sourcePath}`);
    for (const target of entry.targets ?? []) {
      assert(!prototypeTarget.test(target.relativePath), `historical reader catalog target: ${target.relativePath}`);
    }
  }
  for (const entry of provenance.generated) {
    assert(!prototypeTarget.test(entry.target), `historical reader provenance target: ${entry.target}`);
  }
});
await test("managed-config-external-directory-policy", async () => {
  const c=JSON.parse(await readFile(join(root,"canonical/config/managed-agents.json")));
  const generated=managedAgents(c.agents.map(a=>a.id));
  for(const [label,agents] of [["source transform",generated.agents],["emitted configuration",c.agents]]) {
    for(const agent of agents) {
      const external=agent.permissions.filter(p=>p.action==="external_directory");
      assert(external.length>0,`${label}: ${agent.id} must declare external_directory policy`);
      assert(external.every(p=>p.effect==="ask"),`${label}: ${agent.id} must ask for external_directory; got ${JSON.stringify(external)}`);
      assert(!external.some(p=>p.effect==="allow"),`${label}: ${agent.id} must not automatically allow external_directory`);
    }
  }
  assert.equal(c.agents.length,13); const thalam=c.agents.find(a=>a.id==="thalam"); assert(thalam); assert(!c.agents.some(a=>a.id==="skynex-orchestrator")); assert.equal(thalam.mode,"all"); assert(!/(model|provider|mcp)/i.test(JSON.stringify(c)));
  for(const a of c.agents){ assert.equal(a.permissions[0].effect,"ask"); assert(["all","subagent"].includes(a.mode)); }
  const sensitive=[".env",".env.*","**/.env","**/.env.*",".npmrc","**/.npmrc",".netrc","**/.netrc","*.pem","**/*.pem","*.key","**/*.key","credentials.json","**/credentials.json","*service-account*.json","**/*service-account*.json","**/.aws/**","**/.ssh/**"];
  for(const a of c.agents.filter(a=>a.permissions.some(p=>p.action==="read"&&p.effect==="allow"))){const allow=a.permissions.findIndex(p=>p.action==="read"&&p.resource==="*"&&p.effect==="allow");for(const resource of sensitive){const deny=a.permissions.findIndex(p=>p.action==="read"&&p.resource===resource&&p.effect==="deny");assert(deny>allow,`missing or misordered sensitive read deny: ${resource}`)}}
});
await test("thalam-canonical-heading-and-source-provenance",async()=>{
  const source=await readFile(join(root,"canonical/agents/thalam.md"),"utf8");
  assert.match(source,/^# Thalam\s*$/m);
  const record=provenance.generated.find(x=>x.target==="canonical/agents/thalam.md");
  assert(record); assert.equal(record.source,"agents/skynex-orchestrator.md");
  assert(!provenance.generated.some(x=>x.target==="canonical/agents/skynex-orchestrator.md"));
});
await test("resources-have-no-placeholders-or-commands", async () => {
  assert.equal(manifest.resources.filter(x=>x.kind==="command").length,0);
  for(const e of provenance.generated){ const s=await readFile(join(root,e.target),"utf8"); assert(!/(?:^|\n)\s*(?:TODO|PLACEHOLDER)\b|safe-install|skynex-doctor/.test(s)); }
});
await test("catalog-exact-category-counts",async()=>{
   const counts=Object.fromEntries(["agent","skill","configuration","native","hook","mcp","command"].map(k=>[k,manifest.resources.filter(x=>x.kind===k).length]));
    assert.deepEqual(counts,{agent:13,skill:25,configuration:1,native:26,hook:1,mcp:0,command:0});
    assert.equal(counts.native+counts.hook,27);
    assert.equal(manifest.resources.length,66);
});
await test("tdd-and-diagnosis-routing-semantics",async()=>{
  const tdd=await readFile(join(root,"canonical/skills/tdd-discipline/SKILL.md"),"utf8");
  const diagnose=await readFile(join(root,"canonical/skills/diagnose/SKILL.md"),"utf8");
  for(const marker of ["red","green","refactor"]) assert(new RegExp(`\\b${marker}\\b`,"i").test(tdd),`missing ${marker}`);
  assert(/test-engineer/.test(tdd)&&/coder/.test(tdd));
  assert(/diagnostic-researcher/.test(diagnose));
  assert(!/shell fallback|fallback to shell/i.test(diagnose));
});
await test("thalam-automatically-routes-multistep-work-to-tasks-skill",async()=>{
  const thalam=await readFile(join(root,"canonical/agents/thalam.md"),"utf8");
  const tasks=await readFile(join(root,"canonical/skills/skynex-tasks/SKILL.md"),"utf8");
  const resource=manifest.resources.find(x=>x.id==="skills.skynex-tasks");
  assert(resource); assert.equal(resource.kind,"skill");
  assert.match(resource.targets[0].relativePath,/^skills\/skynex-tasks\/SKILL\.md$/);
  assert.match(thalam,/MUST invoke the\s+`skynex-tasks` skill/i);
  assert.match(thalam,/Automatic Tasks quick procedure/);
  assert.match(thalam,/use `tools\.shell` with commands `skynex task list`/);
  assert.match(thalam,/verify\s+`skynex task list` reports the intended project's/);
  assert.match(thalam,/Do not merely mention or describe an available skill/i);
  assert.match(tasks,/more than one genuine[\s\S]*deliverable step/i);
  assert.match(tasks,/skynex task list/);
  assert.match(tasks,/fallback was used/);
  assert.match(tasks,/not a scheduler, workflow engine/);
});
await test("jev-classifier-wiring",async()=>{
  const runtime=await readFile(join(root,"native/plugins/skynex-runtime.ts"),"utf8");
  assert(/skynex_classify/.test(runtime)&&/api\.typesafe\.ai/.test(runtime));
  assert(/TYPESAFE_INTEGRATION_ID/.test(runtime)&&/connection\.resolve/.test(runtime));
  assert(/options\.classifier/.test(runtime)&&/SKYNEX_CLASSIFIER/.test(runtime));
  assert(!/skynex_route/.test(runtime)&&!/switchModel/.test(runtime));
  const managed=JSON.parse(await readFile(join(root,"canonical/config/managed-agents.json"),"utf8"));
  const thalam=managed.agents.find(a=>a.id==="thalam");
  assert(thalam.permissions.some(p=>p.action==="skynex_classify"&&p.effect==="allow"));
  assert(!managed.agents.some(a=>a.permissions.some(p=>p.action==="skynex_route")));
  for(const id of managed.agents.map(a=>a.id)){
    const file=await readFile(join(root,`canonical/agents/${id}.md`),"utf8");
    const fm=file.match(/^---\n([\s\S]*?)\n---\n/);
    assert(fm,`missing frontmatter: ${id}`);
    assert(!/:\s*\*/.test(fm[1]),`unquoted YAML scalar in ${id}`);
  }
});
if (process.argv.includes("--source-root")) {
  const source=process.argv[process.argv.indexOf("--source-root")+1];
  await test("optional-source-provenance-matches",async()=>{ for(const e of provenance.generated.filter(x=>x.sourceSha256)){ const p=join(source,e.source); const st=await lstat(p); assert(st.isFile()&&!st.isSymbolicLink()); assert.equal(sha(await readFile(p)),e.sourceSha256); } });
}
const after=await treeDigest(globalPaths); assert.equal(after,before);
console.log(JSON.stringify({ok:true,cases:cases.length,globalSentinel:before,unchanged:true}));
