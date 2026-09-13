import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve("targets/opencode/resources");
const sha = (v) => createHash("sha256").update(v).digest("hex");
const cases = [];
async function test(name, fn) { await fn(); cases.push(name); console.log(`PASS ${name}`); }
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
  assert(!agents.some(x => /advisor|manager|linear/.test(x.id)));
  const skillLeaves = manifest.resources.filter(x => x.kind === "skill");
  assert.equal(skillLeaves.length, 24);
  const top = new Set(skillLeaves.map(x => x.sourcePath.split("/")[2]));
  assert.equal(top.size, 11); assert(top.has("_shared"));
});
await test("catalog-every-leaf-owned-and-digested", async () => {
  const declared = new Set(manifest.resources.map(x => x.sourcePath));
  async function walk(dir, prefix) { for (const e of await readdir(dir,{withFileTypes:true})) { const p=join(dir,e.name), r=`${prefix}/${e.name}`; if(e.isDirectory()) await walk(p,r); else assert(declared.has(r),`undeclared ${r}`); } }
  await walk(join(root,"canonical"),"canonical"); await walk(join(root,"native"),"native");
});
await test("provenance-hashes-and-portability", async () => {
  assert.equal(provenance.generated.length, 59);
  for (const e of provenance.generated) { assert(!e.source.startsWith("/")); assert(!e.target.startsWith("/")); assert.equal(sha(await readFile(join(root,e.target))),e.generatedSha256); }
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
await test("managed-config-safe-values", async () => {
  const c=JSON.parse(await readFile(join(root,"canonical/config/managed-agents.json")));
  assert.equal(Object.keys(c.agents).length,13); assert(!/(model|provider|mcp)/i.test(JSON.stringify(c)));
  for(const a of Object.values(c.agents)){ assert.equal(a.permissions[0].effect,"deny"); assert(["all","subagent"].includes(a.mode)); }
  const sensitive=[".env",".env.*","**/.env","**/.env.*",".npmrc","**/.npmrc",".netrc","**/.netrc","*.pem","**/*.pem","*.key","**/*.key","credentials.json","**/credentials.json","*service-account*.json","**/*service-account*.json","**/.aws/**","**/.ssh/**"];
  for(const a of Object.values(c.agents).filter(a=>a.permissions.some(p=>p.action==="read"&&p.effect==="allow"))){const allow=a.permissions.findIndex(p=>p.action==="read"&&p.resource==="*"&&p.effect==="allow");for(const resource of sensitive){const deny=a.permissions.findIndex(p=>p.action==="read"&&p.resource===resource&&p.effect==="deny");assert(deny>allow,`missing or misordered sensitive read deny: ${resource}`)}}
});
await test("resources-have-no-placeholders-or-commands", async () => {
  assert.equal(manifest.resources.filter(x=>x.kind==="command").length,0);
  for(const e of provenance.generated){ const s=await readFile(join(root,e.target),"utf8"); assert(!/(?:^|\n)\s*(?:TODO|PLACEHOLDER)\b|safe-install|skynex-doctor/.test(s)); }
});
await test("catalog-exact-category-counts",async()=>{
  const counts=Object.fromEntries(["agent","skill","configuration","native","hook","mcp","command"].map(k=>[k,manifest.resources.filter(x=>x.kind===k).length]));
  assert.deepEqual(counts,{agent:13,skill:24,configuration:1,native:20,hook:1,mcp:0,command:0});
  assert.equal(counts.native+counts.hook,21);
  assert.equal(manifest.resources.length,59);
});
await test("tdd-and-diagnosis-routing-semantics",async()=>{
  const tdd=await readFile(join(root,"canonical/skills/tdd-discipline/SKILL.md"),"utf8");
  const diagnose=await readFile(join(root,"canonical/skills/diagnose/SKILL.md"),"utf8");
  for(const marker of ["red","green","refactor"]) assert(new RegExp(`\\b${marker}\\b`,"i").test(tdd),`missing ${marker}`);
  assert(/test-engineer/.test(tdd)&&/coder/.test(tdd));
  assert(/diagnostic-researcher/.test(diagnose));
  assert(!/shell fallback|fallback to shell/i.test(diagnose));
});
if (process.argv.includes("--source-root")) {
  const source=process.argv[process.argv.indexOf("--source-root")+1];
  await test("optional-source-provenance-matches",async()=>{ for(const e of provenance.generated.filter(x=>x.sourceSha256)){ const p=join(source,e.source); const st=await lstat(p); assert(st.isFile()&&!st.isSymbolicLink()); assert.equal(sha(await readFile(p)),e.sourceSha256); } });
}
const after=await treeDigest(globalPaths); assert.equal(after,before);
console.log(JSON.stringify({ok:true,cases:cases.length,globalSentinel:before,unchanged:true}));
