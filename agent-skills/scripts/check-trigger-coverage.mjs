#!/usr/bin/env node
import { checkTriggerCoverage, packageRoot, resolvePath } from "./lib/skill-common.mjs";

const root = packageRoot();
const skillsRoot = resolvePath(root, process.argv[2] ?? "./skills");
const fixturePath = resolvePath(root, process.argv[3] ?? "./tests/fixtures/trigger-prompts.json");

try {
  const { failures, warnings } = checkTriggerCoverage(skillsRoot, fixturePath);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Trigger coverage check passed.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
