import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDirectory = path.join(repoRoot, "dist-source");
const outputPath = path.join(outputDirectory, "ai-capability-framework-source.zip");
const allowDirty = process.env.AICF_ALLOW_DIRTY_SOURCE_ARCHIVE === "1";

if (!existsSync(path.join(repoRoot, ".git"))) {
  console.error("Source archive creation requires Git metadata. Use a repository checkout, not an extracted source archive.");
  process.exit(1);
}

try {
  execFileSync("git", ["--version"], {
    stdio: ["ignore", "ignore", "pipe"]
  });
} catch {
  console.error("Source archive creation requires the git command.");
  process.exit(1);
}

const status = execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});

if (status.trim().length > 0 && !allowDirty) {
  console.error("Refusing to create a source archive from a dirty working tree:");
  console.error(status.trimEnd());
  console.error("Commit or remove changes first, or set AICF_ALLOW_DIRTY_SOURCE_ARCHIVE=1 for a local-only smoke check.");
  process.exit(1);
}

if (status.trim().length > 0) {
  console.warn("Creating source archive from HEAD while working tree is dirty because AICF_ALLOW_DIRTY_SOURCE_ARCHIVE=1.");
  console.warn("Uncommitted and untracked files will not be included.");
}

mkdirSync(outputDirectory, { recursive: true });
execFileSync("git", [
  "archive",
  "--format=zip",
  "--output",
  outputPath,
  "HEAD"
], {
  stdio: ["ignore", "pipe", "pipe"]
});

console.log(`Created source archive: ${path.relative(repoRoot, outputPath).replaceAll("\\", "/")}`);
