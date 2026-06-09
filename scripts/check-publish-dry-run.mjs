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
  const registryChecks = [];
  const warnings = [];

  const rootPackage = readJson(path.join(root, "package.json"), failures, "package.json");
  const agentPackage = readJson(path.join(root, "agent-skills", "package.json"), failures, "agent-skills/package.json");
  if (!rootPackage || !agentPackage) {
    return { ok: false, distTag: "unknown", commands, registryChecks, warnings, failures, skipped: false };
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
    return { ok: false, distTag, commands, registryChecks, warnings, failures, skipped: false };
  }

  const published = [
    checkPublishedVersion(exec, root, rootPackage.name, rootPackage.version, registryChecks, failures),
    checkPublishedVersion(exec, root, agentPackage.name, agentPackage.version, registryChecks, failures)
  ];

  if (failures.length > 0) {
    return { ok: false, distTag, commands, registryChecks, warnings, failures, skipped: false };
  }

  const publishedCount = published.filter(Boolean).length;
  if (publishedCount === published.length) {
    warnings.push(`Both packages at ${rootPackage.version} are already published; publish dry-runs are skipped.`);
    return { ok: true, distTag, commands, registryChecks, warnings, failures, skipped: true };
  }
  if (publishedCount > 0) {
    failures.push(
      "Only one target package version is already published. Treat this as a partial-publish state and use the release recovery docs before retrying."
    );
    return { ok: false, distTag, commands, registryChecks, warnings, failures, skipped: false };
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
    registryChecks,
    warnings,
    skipped: false,
    failures
  };
}

export function formatPublishDryRunReport(report) {
  const lines = [];
  lines.push(`Publish dry-run ${report.ok ? "passed" : "failed"}.`);
  lines.push(`Dist tag: ${report.distTag}.`);
  if (report.skipped) {
    lines.push("Status: skipped because the current version is already published for both packages.");
  }
  if (report.registryChecks?.length > 0) {
    lines.push("");
    lines.push("Registry checks:");
    for (const check of report.registryChecks) lines.push(`- ${check}`);
  }
  lines.push("");
  lines.push("Commands:");
  for (const command of report.commands) {
    lines.push(`- ${command}`);
  }
  if (report.commands.length === 0) {
    lines.push("- none");
  }
  if (report.warnings?.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
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

function checkPublishedVersion(exec, root, packageName, version, registryChecks, failures) {
  const args = ["view", `${packageName}@${version}`, "version", "--json"];
  registryChecks.push(`npm ${args.join(" ")}`);
  try {
    exec("npm", args, { cwd: root });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    failures.push(`Unable to determine npm publication state for ${packageName}@${version}: ${safeMessage(error)}`);
    return false;
  }
}

function isNotFoundError(error) {
  const text = String(`${error?.status ?? ""} ${error?.stderr ?? ""} ${error?.message ?? ""}`);
  return text.includes("E404") || text.includes("404") || text.includes("No match found");
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
