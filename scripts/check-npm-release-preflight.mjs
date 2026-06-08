import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedPackages = [
  { key: "root", name: "ai-capability-framework", packagePath: "package.json", requiredExistingPackage: true },
  { key: "agent-skills", name: "@aicf/agent-skills", packagePath: "agent-skills/package.json", requiredExistingPackage: false }
];

export function runNpmReleasePreflight(options = {}) {
  const root = options.root ? path.resolve(options.root) : repoRoot;
  const strict = Boolean(options.strict);
  const exec = options.exec ?? defaultExec;
  const failures = [];
  const warnings = [];
  const packages = [];

  for (const expected of expectedPackages) {
    const packageJson = readJson(path.join(root, expected.packagePath));
    const summary = {
      key: expected.key,
      name: packageJson.name,
      version: packageJson.version,
      expectedName: expected.name,
      access: packageJson.publishConfig?.access,
      distTag: distTagForVersion(packageJson.version),
      packageExists: false,
      targetVersionPublished: false,
      ownersVerified: false
    };
    packages.push(summary);

    if (packageJson.name !== expected.name) {
      failures.push(`${expected.packagePath} must use package name ${expected.name}.`);
    }
    if (packageJson.private !== false) {
      failures.push(`${expected.packagePath} must keep private set to false.`);
    }
    if (packageJson.publishConfig?.access !== "public") {
      failures.push(`${expected.packagePath} must use publishConfig.access public.`);
    }
    if (!isSemverLike(packageJson.version)) {
      failures.push(`${expected.packagePath} version must be semver-like.`);
    }
  }

  const versions = new Set(packages.map((pkg) => pkg.version));
  if (versions.size > 1) {
    failures.push("Root and agent-skills package versions must match before release.");
  }

  const rootDistTag = packages[0]?.distTag;
  for (const pkg of packages) {
    if (pkg.distTag !== rootDistTag) {
      failures.push("Root and agent-skills packages must resolve to the same npm dist tag.");
    }
  }

  const whoami = runNpm(exec, ["whoami"]);
  if (!whoami.ok) {
    const message = "npm whoami did not return an authenticated user; trusted publishing or npm ownership must be verified before tagging.";
    if (strict) failures.push(message);
    else warnings.push(message);
  }

  for (const expected of expectedPackages) {
    const pkg = packages.find((candidate) => candidate.key === expected.key);
    if (!pkg) continue;

    const packageView = npmJson(exec, ["view", pkg.name, "name", "version", "dist-tags", "--json"]);
    if (!packageView.ok) {
      if (isNpmNotFound(packageView)) {
        const message = `${pkg.name} is not published yet; complete npm package/scope trusted-publishing setup before tagging.`;
        if (expected.requiredExistingPackage || strict) failures.push(message);
        else warnings.push(message);
      } else {
        failures.push(`Unable to verify npm package ${pkg.name}: ${safeError(packageView)}`);
      }
    } else {
      pkg.packageExists = true;
      pkg.registryVersion = packageView.value?.version;
      pkg.registryDistTags = packageView.value?.["dist-tags"] ?? {};
    }

    const versionView = npmJson(exec, ["view", `${pkg.name}@${pkg.version}`, "version", "--json"]);
    if (versionView.ok) {
      pkg.targetVersionPublished = true;
      failures.push(`${pkg.name}@${pkg.version} is already published. Bump versions before tagging.`);
    } else if (!isNpmNotFound(versionView)) {
      failures.push(`Unable to verify target version ${pkg.name}@${pkg.version}: ${safeError(versionView)}`);
    }

    if (pkg.packageExists) {
      const ownerView = runNpm(exec, ["owner", "ls", pkg.name]);
      if (ownerView.ok && ownerView.stdout.trim().length > 0) {
        pkg.ownersVerified = true;
      } else {
        const message = `Unable to verify npm owners for ${pkg.name}; run npm owner ls ${pkg.name} before tagging.`;
        if (strict) failures.push(message);
        else warnings.push(message);
      }
    }
  }

  return {
    ok: failures.length === 0,
    strict,
    expectedDistTag: rootDistTag ?? "unknown",
    packages,
    warnings,
    failures
  };
}

export function formatNpmReleasePreflightReport(report) {
  const lines = [];
  lines.push(`npm release preflight ${report.ok ? "passed" : "failed"}.`);
  lines.push(`Expected dist tag: ${report.expectedDistTag}.`);
  lines.push("");
  for (const pkg of report.packages) {
    lines.push(`- ${pkg.name}@${pkg.version}:`);
    lines.push(`  - access: ${pkg.access ?? "missing"}`);
    lines.push(`  - package exists on npm: ${pkg.packageExists ? "yes" : "no"}`);
    lines.push(`  - target version already published: ${pkg.targetVersionPublished ? "yes" : "no"}`);
    lines.push(`  - owners verified: ${pkg.ownersVerified ? "yes" : "no"}`);
  }
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

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function isSemverLike(version) {
  return typeof version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
}

function distTagForVersion(version) {
  return typeof version === "string" && version.includes("-") ? "next" : "latest";
}

function npmJson(exec, args) {
  const result = runNpm(exec, args);
  if (!result.ok) return result;
  try {
    return { ...result, value: JSON.parse(result.stdout) };
  } catch {
    return { ...result, ok: false, stderr: "npm returned non-JSON output." };
  }
}

function runNpm(exec, args) {
  try {
    const stdout = exec("npm", args);
    return { ok: true, stdout, stderr: "", status: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? error.message ?? ""),
      status: typeof error.status === "number" ? error.status : 1
    };
  }
}

function defaultExec(command, args) {
  if (command === "npm" && process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  }

  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32" && command === "npm",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function isNpmNotFound(result) {
  const text = `${result.stdout}\n${result.stderr}`;
  return result.status === 1 && (/E404|404 Not Found|not found/i.test(text) || /No match found/i.test(text));
}

function safeError(result) {
  const text = `${result.stderr || result.stdout || "unknown npm error"}`.replace(/\s+/g, " ").trim();
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const strict = process.argv.includes("--strict");
  const json = process.argv.includes("--json");
  const report = runNpmReleasePreflight({ strict });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatNpmReleasePreflightReport(report));
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}
