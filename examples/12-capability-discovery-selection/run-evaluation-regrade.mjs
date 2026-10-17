import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { regradeSavedCampaign } from "./evaluation/regrade.mjs";

export function writeOfflineRegrade(inputPath, outputPath) {
  const input = fs.realpathSync(inputPath),
    output = path.resolve(outputPath);
  const parent = fs.realpathSync(path.dirname(output));
  if (path.dirname(output) !== parent)
    throw new Error("Output parent must be a real directory.");
  execFileSync("git", ["check-ignore", "--quiet", "--", output], { stdio: "ignore" });
  const { value, evidence } = regradeSavedCampaign(input);
  const inside = (target, directory) => {
    const relative = path.relative(directory, target);
    return (
      relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  };
  if (
    inside(output, evidence.directory) ||
    inside(evidence.directory, output) ||
    [evidence.reportPath, input].some((source) => inside(source, output))
  )
    throw new Error("Output must be separate from source evidence and input files.");
  const serialized = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(serialized) > 16 * 1024 * 1024)
    throw new Error("Regrade report exceeds its bound.");
  const name = "regrade.json",
    target = path.join(output, name);
  if (fs.existsSync(output)) {
    if (
      fs.lstatSync(output).isSymbolicLink() ||
      fs.readdirSync(output).join() !== name ||
      fs.readFileSync(target, "utf8") !== serialized
    )
      throw new Error("Conflicting output already exists.");
  } else {
    const temporary = fs.mkdtempSync(output + ".pending-");
    try {
      fs.writeFileSync(path.join(temporary, name), serialized, { flag: "wx" });
      fs.renameSync(temporary, output);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  return {
    reportFingerprint: value.reportFingerprint,
    original: value.original,
    revised: value.revised,
    executionUsage: value.executionUsage
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--output")
      throw new Error("Explicit input and output required.");
    console.log(JSON.stringify(writeOfflineRegrade(args[1], args[3]), null, 2));
  } catch {
    console.error(
      "Offline regrade refused: check pinned evidence, complete workflow facts and a separate ignored output directory. No provider work was attempted."
    );
    process.exitCode = 1;
  }
}
