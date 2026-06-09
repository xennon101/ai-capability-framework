import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function runReleaseTagAlignment(options = {}) {
  const root = options.root ? path.resolve(options.root) : repoRoot;
  const exec = options.exec ?? defaultExec;
  const requireGit = Boolean(options.requireGit ?? process.env.AICF_REQUIRE_GIT_RELEASE_CHECK === "1");
  const warnings = [];
  const failures = [];

  const rootPackage = readJson(path.join(root, "package.json"), failures, "package.json");
  const agentPackage = readJson(path.join(root, "agent-skills", "package.json"), failures, "agent-skills/package.json");
  const plugin = readJson(path.join(root, "agent-skills", ".codex-plugin", "plugin.json"), failures, "agent-skills/.codex-plugin/plugin.json");
  if (!rootPackage || !agentPackage || !plugin) {
    return { ok: false, version: "unknown", tag: "unknown", warnings, failures };
  }

  const version = rootPackage.version;
  const tag = `v${version}`;
  if (agentPackage.version !== version) {
    failures.push(`agent-skills package version ${agentPackage.version} does not match root package version ${version}.`);
  }
  if (plugin.version !== version) {
    failures.push(`agent-skills plugin version ${plugin.version} does not match root package version ${version}.`);
  }
  if (failures.length > 0) {
    return { ok: false, version, tag, warnings, failures };
  }

  if (!hasGit(root, exec)) {
    const message = "Git metadata is unavailable; skipping release tag alignment check.";
    if (requireGit) failures.push(message);
    else warnings.push(message);
    return { ok: failures.length === 0, version, tag, warnings, failures };
  }

  const headSha = git(exec, root, ["rev-parse", "HEAD"]).trim();
  const tagLookup = tryGit(exec, root, ["rev-list", "-n", "1", `refs/tags/${tag}`]);
  if (!tagLookup.ok) {
    return { ok: true, version, tag, headSha, tagSha: undefined, warnings, failures };
  }

  const tagSha = tagLookup.stdout.trim();
  if (tagSha !== headSha) {
    failures.push(`Version ${version} is already tagged at ${shortSha(tagSha)}, but HEAD is ${shortSha(headSha)}. Bump the package, agent-skills, and plugin versions before releasing.`);
  }

  return {
    ok: failures.length === 0,
    version,
    tag,
    headSha,
    tagSha,
    warnings,
    failures
  };
}

export function formatReleaseTagAlignmentReport(report) {
  const lines = [];
  lines.push(`Release tag alignment ${report.ok ? "passed" : "failed"}.`);
  lines.push(`Version: ${report.version}.`);
  lines.push(`Expected tag: ${report.tag}.`);
  if (report.headSha) lines.push(`HEAD: ${shortSha(report.headSha)}.`);
  if (report.tagSha) lines.push(`Tag target: ${shortSha(report.tagSha)}.`);
  if (report.warnings.length > 0) {
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

function hasGit(root, exec) {
  if (!existsSync(path.join(root, ".git"))) {
    return false;
  }
  return tryGit(exec, root, ["rev-parse", "--git-dir"]).ok;
}

function git(exec, root, args) {
  return exec("git", args, { cwd: root });
}

function tryGit(exec, root, args) {
  try {
    return { ok: true, stdout: git(exec, root, args), stderr: "" };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? error.message ?? "")
    };
  }
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
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function shortSha(value) {
  return String(value ?? "").slice(0, 7);
}

function safeMessage(error) {
  return String(error?.stderr ?? error?.message ?? error).replace(/\s+/g, " ").trim().slice(0, 220);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes("--json");
  const report = runReleaseTagAlignment();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReleaseTagAlignmentReport(report));
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}
