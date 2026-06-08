#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  packageRoot,
  resolvePath,
  skillSummaries
} from "./lib/skill-common.mjs";

const command = process.argv[2] ?? "help";
const root = packageRoot();

switch (command) {
  case "validate":
    run("validate-skills.mjs", ["./skills"]);
    break;
  case "check-public":
    run("check-skills-public.mjs", ["."]);
    break;
  case "check-triggers":
    run("check-trigger-coverage.mjs", ["./skills", "./tests/fixtures/trigger-prompts.json"]);
    break;
  case "index":
    run("generate-skill-index.mjs", ["./skills", "./docs/skill-index.md"]);
    break;
  case "install":
    run("install-skills.mjs", process.argv.slice(3));
    break;
  case "list":
    list();
    break;
  default:
    console.log("Usage: aicf-skills <validate|check-public|check-triggers|index|install|list>");
    process.exitCode = command === "help" ? 0 : 1;
}

function run(script, args) {
  const result = spawnSync(process.execPath, [resolvePath(root, `./scripts/${script}`), ...args], {
    cwd: root,
    stdio: "inherit"
  });
  process.exitCode = result.status ?? 1;
}

function list() {
  const skills = skillSummaries(resolvePath(root, "./skills"));
  if (skills.length === 0) {
    console.log("No AICF Agent Skills are installed in this package yet.");
    return;
  }
  for (const skill of skills) console.log(`${skill.name}\t${skill.description}`);
}
