import { rm } from "node:fs/promises";
import { fixtures, results, test } from "./verify-installer-support.mjs";

try {
  for (const module of ["transactions", "updates", "catalog", "cli"]) {
    const { verify } = await import(`./verify-installer-${module}.mjs`);
    await verify(test);
  }
  console.log(JSON.stringify({ ok: true, node: process.version, cases: results }));
} finally {
  for (const root of fixtures) await rm(root, { recursive: true, force: true });
}
