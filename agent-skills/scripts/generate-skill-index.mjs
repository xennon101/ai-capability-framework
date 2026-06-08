#!/usr/bin/env node
import {
  generateSkillIndex,
  packageRoot,
  readText,
  resolvePath,
  writeText
} from "./lib/skill-common.mjs";

const root = packageRoot();
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const positional = args.filter((arg) => arg !== "--check");
const skillsRoot = resolvePath(root, positional[0] ?? "./skills");
const outputPath = resolvePath(root, positional[1] ?? "./docs/skill-index.md");
const fixturePath = resolvePath(root, "./tests/fixtures/trigger-prompts.json");
const expected = generateSkillIndex(skillsRoot, fixturePath);

if (checkOnly) {
  const actual = readText(outputPath);
  if (actual !== expected) {
    console.error(`${outputPath} is stale. Run npm run index.`);
    process.exitCode = 1;
  } else {
    console.log(`Skill index is current: ${outputPath}.`);
  }
} else {
  writeText(outputPath, expected);
  console.log(`Generated ${outputPath}.`);
}
