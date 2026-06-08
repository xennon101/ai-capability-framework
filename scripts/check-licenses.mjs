import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const allowedLicenses = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0"
]);

const disallowedLicensePattern = /^(?:AGPL|GPL|LGPL|SSPL|BUSL)(?:[-\d.]|$)/iu;
const supportedScopes = new Set(["root", "agent-skills", "any"]);

const defaultLockfiles = [
  {
    scope: "root",
    lockPath: "package-lock.json",
    packagePath: "package.json",
    expectedName: "ai-capability-framework"
  },
  {
    scope: "agent-skills",
    lockPath: "agent-skills/package-lock.json",
    packagePath: "agent-skills/package.json",
    expectedName: "@aicf/agent-skills"
  }
];

export function runLicenseCheck(options = {}) {
  const root = options.root ? path.resolve(options.root) : repoRoot;
  const exceptionPath = options.exceptionPath
    ? path.resolve(options.exceptionPath)
    : path.join(root, "docs", "public", "license-exceptions.md");
  const failures = [];
  const warnings = [];
  const checkedPackages = [];
  const usedExceptionKeys = new Set();

  const exceptions = loadLicenseExceptions(exceptionPath, failures);

  for (const lockfile of options.lockfiles ?? defaultLockfiles) {
    const packageJson = readJson(path.join(root, lockfile.packagePath), failures, `${lockfile.packagePath} package metadata`);
    const lock = readJson(path.join(root, lockfile.lockPath), failures, `${lockfile.lockPath} lockfile`);
    if (!packageJson || !lock) continue;

    validateLockfileRoot(lockfile, packageJson, lock, failures);

    const packages = lock.packages;
    if (!packages || typeof packages !== "object") {
      failures.push(`${lockfile.lockPath} must contain a packages object.`);
      continue;
    }

    for (const [lockPath, entry] of Object.entries(packages).sort(([a], [b]) => a.localeCompare(b))) {
      if (!entry || typeof entry !== "object") {
        failures.push(`${lockfile.lockPath}:${lockPath || "<root>"} must be an object package entry.`);
        continue;
      }

      const packageName = lockPath === "" ? packageJson.name : packageNameFromLockPath(lockPath);
      const version = String(entry.version ?? (lockPath === "" ? packageJson.version : ""));
      const rawLicense = entry.license;
      const license = typeof rawLicense === "string" && rawLicense.trim() ? rawLicense.trim() : "unknown";
      const record = {
        scope: lockfile.scope,
        path: lockPath || "<root>",
        package: packageName,
        version,
        license
      };
      checkedPackages.push(record);

      const verdict = evaluateLicense(license);
      if (verdict.allowed) continue;

      const exception = findException(exceptions, record);
      if (exception) {
        usedExceptionKeys.add(exceptionKey(exception));
        continue;
      }

      failures.push(
        `${lockfile.lockPath}:${record.path} ${record.package}@${record.version} uses ${license}; ${verdict.reason}.`
      );
    }
  }

  for (const exception of exceptions) {
    if (!usedExceptionKeys.has(exceptionKey(exception))) {
      failures.push(
        `License exception for ${exception.package}@${exception.version} (${exception.license}, ${exception.scope}) does not match the current lockfiles.`
      );
    }
  }

  return {
    ok: failures.length === 0,
    allowedLicenses: [...allowedLicenses].sort(),
    checkedPackageCount: checkedPackages.length,
    checkedPackages,
    exceptionCount: exceptions.length,
    exceptions,
    warnings,
    failures
  };
}

export function formatLicenseCheckReport(report) {
  const lines = [];
  lines.push(`Dependency license check ${report.ok ? "passed" : "failed"}.`);
  lines.push(`Checked packages: ${report.checkedPackageCount}.`);
  lines.push(`Approved exceptions: ${report.exceptionCount}.`);
  lines.push(`Allowed licenses: ${report.allowedLicenses.join(", ")}.`);
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

export function evaluateLicense(license) {
  if (typeof license !== "string" || !license.trim() || license.trim().toLowerCase() === "unknown") {
    return { allowed: false, reason: "license is missing or unknown" };
  }

  const normalized = license.trim();
  if (normalized === "UNLICENSED") {
    return { allowed: false, reason: "UNLICENSED packages are not allowed" };
  }

  if (allowedLicenses.has(normalized)) {
    return { allowed: true, reason: "allowed" };
  }

  const tokens = licenseTokens(normalized);
  if (tokens.length === 0) {
    return { allowed: false, reason: "license expression is not parseable" };
  }

  const disallowed = tokens.find((token) => token === "UNLICENSED" || disallowedLicensePattern.test(token));
  if (disallowed) {
    return { allowed: false, reason: `${disallowed} is disallowed by default` };
  }

  const unknown = tokens.find((token) => !allowedLicenses.has(token));
  if (unknown) {
    return { allowed: false, reason: `${unknown} is not in the default allow-list` };
  }

  return { allowed: true, reason: "allowed expression" };
}

function loadLicenseExceptions(file, failures) {
  if (!existsSync(file)) {
    failures.push(`Missing license exception policy: ${path.relative(repoRoot, file).replaceAll("\\", "/")}`);
    return [];
  }

  const content = readFileSync(file, "utf8");
  const match = /```json\s*\r?\n([\s\S]*?)\r?\n```/u.exec(content);
  if (!match) {
    failures.push("docs/public/license-exceptions.md must contain a fenced json block.");
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch (error) {
    failures.push(`docs/public/license-exceptions.md has malformed JSON: ${safeMessage(error)}`);
    return [];
  }

  if (!parsed || !Array.isArray(parsed.exceptions)) {
    failures.push("docs/public/license-exceptions.md JSON must contain an exceptions array.");
    return [];
  }

  const exceptions = [];
  const seen = new Set();
  for (const [index, exception] of parsed.exceptions.entries()) {
    const prefix = `license exception ${index + 1}`;
    if (!exception || typeof exception !== "object") {
      failures.push(`${prefix} must be an object.`);
      continue;
    }

    const normalized = {
      package: stringField(exception, "package", prefix, failures),
      version: stringField(exception, "version", prefix, failures),
      license: stringField(exception, "license", prefix, failures),
      scope: stringField(exception, "scope", prefix, failures),
      reason: stringField(exception, "reason", prefix, failures),
      approved_by: stringField(exception, "approved_by", prefix, failures),
      approved_at: stringField(exception, "approved_at", prefix, failures),
      review_by: stringField(exception, "review_by", prefix, failures),
      constraints: stringField(exception, "constraints", prefix, failures)
    };

    if (normalized.scope && !supportedScopes.has(normalized.scope)) {
      failures.push(`${prefix} scope must be root, agent-skills, or any.`);
    }
    for (const field of ["approved_at", "review_by"]) {
      if (normalized[field] && !/^\d{4}-\d{2}-\d{2}$/.test(normalized[field])) {
        failures.push(`${prefix} ${field} must be YYYY-MM-DD.`);
      }
    }
    const key = exceptionKey(normalized);
    if (seen.has(key)) {
      failures.push(`${prefix} duplicates another license exception.`);
    }
    seen.add(key);
    exceptions.push(normalized);
  }
  return exceptions;
}

function validateLockfileRoot(lockfile, packageJson, lock, failures) {
  const rootEntry = lock.packages?.[""];
  if (!rootEntry || typeof rootEntry !== "object") {
    failures.push(`${lockfile.lockPath} must contain a root packages[\"\"] entry.`);
    return;
  }

  if (packageJson.name !== lockfile.expectedName) {
    failures.push(`${lockfile.packagePath} must use package name ${lockfile.expectedName}.`);
  }
  for (const field of ["name", "version", "license"]) {
    if (rootEntry[field] !== packageJson[field]) {
      failures.push(`${lockfile.lockPath} root ${field} must match ${lockfile.packagePath}.`);
    }
  }
  if (packageJson.license !== "MIT") {
    failures.push(`${lockfile.packagePath} license must remain MIT.`);
  }
}

function findException(exceptions, record) {
  return exceptions.find(
    (exception) =>
      exception.package === record.package
      && exception.version === record.version
      && exception.license === record.license
      && (exception.scope === record.scope || exception.scope === "any")
  );
}

function licenseTokens(license) {
  if (/SEE LICENSE IN|LicenseRef|https?:/iu.test(license)) {
    return [];
  }
  return license
    .replace(/[()]/gu, " ")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !["AND", "OR", "WITH"].includes(token));
}

function packageNameFromLockPath(lockPath) {
  const parts = lockPath.split("node_modules/");
  const packagePath = parts[parts.length - 1];
  const segments = packagePath.split("/").filter(Boolean);
  if (segments[0]?.startsWith("@")) {
    return `${segments[0]}/${segments[1] ?? ""}`;
  }
  return segments[0] ?? lockPath;
}

function readJson(file, failures, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    failures.push(`Unable to read ${label}: ${safeMessage(error)}`);
    return undefined;
  }
}

function stringField(value, field, prefix, failures) {
  if (typeof value[field] !== "string" || value[field].trim().length === 0) {
    failures.push(`${prefix} must include ${field}.`);
    return "";
  }
  return value[field].trim();
}

function exceptionKey(exception) {
  return `${exception.scope}:${exception.package}:${exception.version}:${exception.license}`;
}

function safeMessage(error) {
  return String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 180);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes("--json");
  const report = runLicenseCheck();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatLicenseCheckReport(report));
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}
