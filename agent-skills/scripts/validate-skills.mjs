#!/usr/bin/env node
import { packageRoot, resolvePath, validateSkills } from "./lib/skill-common.mjs";

const root = packageRoot();
const skillsRoot = resolvePath(root, process.argv[2] ?? "./skills");
const failures = validateSkills(skillsRoot, { root });

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Skill validation passed for ${skillsRoot}.`);
}
