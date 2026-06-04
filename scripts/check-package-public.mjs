import { execFileSync } from "node:child_process";
import { publicArtifactFailures } from "./public-artifact-rules.mjs";

const npmExecPath = process.env.npm_execpath;
const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const args = npmExecPath ? [npmExecPath, "pack", "--dry-run", "--json"] : ["pack", "--dry-run", "--json"];
const output = execFileSync(command, args, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
const packResult = JSON.parse(output)[0];
const files = packResult.files.map((file) => file.path.replaceAll("\\", "/")).sort();
const failures = publicArtifactFailures(files);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Package public hygiene passed with ${files.length} file(s).`);
}
