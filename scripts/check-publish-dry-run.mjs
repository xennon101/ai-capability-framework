import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function runPublishDryRun(options = {}) {
  const root = options.root ? path.resolve(options.root) : repoRoot;
  const exec = options.exec ?? defaultExec;
  const failures = [];
  const commands = [];

  const rootPackage = readJson(path.join(root, "package.json"), failures, "package.json");
  const agentPackage = readJson(path.join(root, "agent-skills", "package.json"), failures, "agent-skills/package.json");
  if (!rootPackage || !agentPackage) {
    return { ok: false, distTag: "unknown", commands, failures };
  }

  const distTag = distTagForVersion(rootPackage.version);
  if (rootPackage.name !== "ai-capability-framework") {
    failures.push("Root package name must be ai-capability-framework.");
  }
  if (agentPackage.name !== "@aicf/agent-skills") {
    failures.push("Agent skills package name must be @aicf/agent-skills.");
  }
  if (rootPackage.version !== agentPackage.version) {
    failures.push("Root and agent-skills versions must match for dry-run publish.");
  }
  if (rootPackage.publishConfig?.access !== "public" || agentPackage.publishConfig?.access !== "public") {
    failures.push("Both packages must set publishConfig.access to public.");
  }

  if (failures.length > 0) {
    return { ok: false, distTag, commands, failures };
  }

  for (const command of [
    ["npm", ["publish", "--dry-run", "--access", "public", "--tag", distTag]],
    ["npm", ["publish", "./agent-skills", "--dry-run", "--access", "public", "--tag", distTag]]
  ]) {
    const [bin, args] = command;
    commands.push(`${bin} ${args.join(" ")}`);
    try {
      exec(bin, args, { cwd: root });
    } catch (error) {
      failures.push(`Publish dry-run command failed: ${bin} ${args.join(" ")}: ${safeMessage(error)}`);
    }
  }

  return {
    ok: failures.length === 0,
    distTag,
    commands,
    failures
  };
}

export function formatPublishDryRunReport(report) {
  const lines = [];
  lines.push(`Publish dry-run ${report.ok ? "passed" : "failed"}.`);
  lines.push(`Dist tag: ${report.distTag}.`);
  lines.push("");
  lines.push("Commands:");
  for (const command of report.commands) {
    lines.push(`- ${command}`);
  }
  if (report.failures.length > 0) {
    lines.push("");
    lines.push("Failures:");
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }
  return lines.join("\n");
}

export function distTagForVersion(version) {
  return typeof version === "string" && version.includes("-") ? "next" : "latest";
}

function readJson(file, failures, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    failures.push(`Unable to read ${label}: ${safeMessage(error)}`);
    return undefined;
  }
}

function defaultExec(command, args, options = {}) {
  if (command === "npm" && process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: options.cwd ?? repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  }

  return execFileSync(process.platform === "win32" && command === "npm" ? "npm.cmd" : command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function safeMessage(error) {
  return String(error?.stderr ?? error?.message ?? error).replace(/\s+/g, " ").trim().slice(0, 220);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes("--json");
  const report = runPublishDryRun();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatPublishDryRunReport(report));
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}
