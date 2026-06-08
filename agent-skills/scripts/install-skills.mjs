#!/usr/bin/env node
import { installSkills, packageRoot, resolvePath } from "./lib/skill-common.mjs";

const args = process.argv.slice(2);
const target = valueAfter(args, "--target");
const force = args.includes("--force");
const allowOutside = args.includes("--allow-outside");
const root = packageRoot();

try {
  const result = installSkills({
    skillsRoot: resolvePath(root, "./skills"),
    target,
    force,
    allowOutside,
    root
  });
  if (result.installed.length === 0) {
    console.log(`No skills to install into ${result.target}.`);
  } else {
    console.log(`Installed ${result.installed.length} skill(s) into ${result.target}: ${result.installed.join(", ")}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
