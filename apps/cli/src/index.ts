#!/usr/bin/env node
import * as p from "@clack/prompts";

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log(`Skynex v2

Usage:
  skynex [command]

Commands (planned):
  install    Install resources for a target engine
  update     Review and apply upstream resource changes
  doctor     Inspect the local installation

Options:
  -h, --help     Show help
  -v, --version  Show version`);
  process.exit(0);
}

if (args.has("--version") || args.has("-v")) {
  console.log("0.0.0");
  process.exit(0);
}

p.intro("Skynex v2");
p.note(
  "Architecture bootstrap complete. Installation commands will arrive in the first vertical slice.",
  "OpenCode 2 installer",
);
p.outro("Run skynex --help to inspect the planned command surface.");
