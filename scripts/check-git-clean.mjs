import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const allowDirty = process.env.AICF_ALLOW_DIRTY_RELEASE === "1";
const gitDirectory = path.join(process.cwd(), ".git");

if (!existsSync(gitDirectory)) {
  console.log("Git clean check skipped: .git directory is not present.");
  process.exit(0);
}

let status;
try {
  status = execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
} catch (error) {
  console.log(`Git clean check skipped: ${error instanceof Error ? error.message : "git is unavailable"}.`);
  process.exit(0);
}

if (status.trim().length === 0) {
  console.log("Git clean check passed.");
  process.exit(0);
}

if (allowDirty) {
  console.log("Git clean check bypassed because AICF_ALLOW_DIRTY_RELEASE=1.");
  process.exit(0);
}

console.error("Release/source archive requires a clean working tree. Current changes:");
console.error(status.trimEnd());
console.error("Commit, stash, or remove local changes before release, or set AICF_ALLOW_DIRTY_RELEASE=1 for an intentional local-only check.");
process.exit(1);
