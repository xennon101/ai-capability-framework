import { execFileSync } from "node:child_process";
import { publicArtifactFailures } from "./public-artifact-rules.mjs";

const tracked = gitFiles(["ls-files", "-z"]);
const untracked = gitFiles(["ls-files", "--others", "--exclude-standard", "-z"]);
const files = [...tracked, ...untracked].filter(Boolean).sort();
const failures = publicArtifactFailures(files, {
  allowGithub: true,
  allowScripts: true,
  allowSource: true
});

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Workspace public hygiene passed with ${files.length} visible file(s).`);
}

function gitFiles(args) {
  const output = execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return output.split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/"));
}
