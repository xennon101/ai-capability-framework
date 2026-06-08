#!/usr/bin/env node
import { packageRoot, publicPackageFailures, resolvePath } from "./lib/skill-common.mjs";

const root = resolvePath(packageRoot(), process.argv[2] ?? ".");
const failures = publicPackageFailures(root);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Skills package public hygiene passed for ${root}.`);
}
