import { lstat, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url)); const dist=resolve(root,"dist");
if(dirname(dist)!==root) throw new Error("unsafe dist path");
const stat=await lstat(dist).catch(e=>e.code==="ENOENT"?null:Promise.reject(e)); if(stat?.isSymbolicLink()) throw new Error("refusing symlink dist");
await rm(dist,{recursive:true,force:true});
