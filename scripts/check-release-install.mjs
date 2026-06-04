import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const keepTmp = process.env.AICF_KEEP_TMP === "1";
const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const npmArgs = (...args) => npmExecPath ? [npmExecPath, ...args] : args;
const repoRoot = process.cwd();
let tarballPath;
let tempDirectory;

try {
  const packOutput = execFileSync(npmCommand, npmArgs("pack", "--json"), {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const packResult = JSON.parse(packOutput)[0];
  tarballPath = path.resolve(repoRoot, packResult.filename);
  tempDirectory = await mkdtemp(path.join(tmpdir(), "aicf-release-install-"));

  execFileSync(npmCommand, npmArgs("init", "-y"), {
    cwd: tempDirectory,
    stdio: "ignore"
  });
  execFileSync(npmCommand, npmArgs("install", "--omit=dev", tarballPath), {
    cwd: tempDirectory,
    stdio: "pipe"
  });
  execFileSync(process.execPath, [
    "-e",
    "import('ai-capability-framework').then((m) => { if (!m.loadManifests || !m.decideCapability) throw new Error('Missing expected exports'); })"
  ], {
    cwd: tempDirectory,
    stdio: "pipe"
  });
  execFileSync(npmCommand, npmArgs("exec", "--", "aicf", "--help"), {
    cwd: tempDirectory,
    stdio: "pipe"
  });

  console.log(`Release install smoke test passed in ${tempDirectory}.`);
} finally {
  if (!keepTmp && tempDirectory) {
    await rm(tempDirectory, { force: true, recursive: true });
  }

  if (!keepTmp && tarballPath) {
    await rm(tarballPath, { force: true });
  }
}
