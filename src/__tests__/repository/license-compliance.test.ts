import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { evaluateLicense, runLicenseCheck } from "../../../scripts/check-licenses.mjs";

describe("dependency license compliance", () => {
  it("passes allowed licenses and simple allowed SPDX expressions", async () => {
    const root = await createFixture({
      rootPackages: [
        ["node_modules/mit-lib", "mit-lib", "1.0.0", "MIT"],
        ["node_modules/apache-lib", "apache-lib", "1.0.0", "Apache-2.0"],
        ["node_modules/bsd2-lib", "bsd2-lib", "1.0.0", "BSD-2-Clause"],
        ["node_modules/bsd3-lib", "bsd3-lib", "1.0.0", "BSD-3-Clause"],
        ["node_modules/isc-lib", "isc-lib", "1.0.0", "ISC"],
        ["node_modules/cc0-lib", "cc0-lib", "1.0.0", "CC0-1.0"],
        ["node_modules/unlicense-lib", "unlicense-lib", "1.0.0", "Unlicense"],
        ["node_modules/blueoak-lib", "blueoak-lib", "1.0.0", "BlueOak-1.0.0"],
        ["node_modules/expression-lib", "expression-lib", "1.0.0", "(MIT OR Apache-2.0)"]
      ],
      agentPackages: [["node_modules/yaml", "yaml", "2.9.0", "ISC"]]
    });

    const report = runLicenseCheck({ root });

    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("fails blocked, unknown, unlicensed, and missing licenses", async () => {
    const root = await createFixture({
      rootPackages: [
        ["node_modules/gpl-lib", "gpl-lib", "1.0.0", "GPL-3.0-only"],
        ["node_modules/agpl-lib", "agpl-lib", "1.0.0", "AGPL-3.0-only"],
        ["node_modules/lgpl-lib", "lgpl-lib", "1.0.0", "LGPL-2.1-or-later"],
        ["node_modules/sspl-lib", "sspl-lib", "1.0.0", "SSPL-1.0"],
        ["node_modules/busl-lib", "busl-lib", "1.0.0", "BUSL-1.1"],
        ["node_modules/unlicensed-lib", "unlicensed-lib", "1.0.0", "UNLICENSED"],
        ["node_modules/unknown-lib", "unknown-lib", "1.0.0", "unknown"],
        ["node_modules/missing-lib", "missing-lib", "1.0.0", undefined]
      ]
    });

    const report = runLicenseCheck({ root });

    expect(report.ok).toBe(false);
    expect(report.failures.join("\n")).toContain("GPL-3.0-only is disallowed by default");
    expect(report.failures.join("\n")).toContain("AGPL-3.0-only is disallowed by default");
    expect(report.failures.join("\n")).toContain("LGPL-2.1-or-later is disallowed by default");
    expect(report.failures.join("\n")).toContain("SSPL-1.0 is disallowed by default");
    expect(report.failures.join("\n")).toContain("BUSL-1.1 is disallowed by default");
    expect(report.failures.join("\n")).toContain("UNLICENSED packages are not allowed");
    expect(report.failures.join("\n")).toContain("license is missing or unknown");
  });

  it("fails mixed expressions when any token is disallowed or not allowed", () => {
    expect(evaluateLicense("(MIT OR Apache-2.0)").allowed).toBe(true);
    expect(evaluateLicense("(MIT OR GPL-3.0-only)").allowed).toBe(false);
    expect(evaluateLicense("(MIT OR MPL-2.0)").allowed).toBe(false);
  });

  it("accepts exact documented exceptions and rejects stale mismatches", async () => {
    const root = await createFixture({
      rootPackages: [["node_modules/special-lib", "special-lib", "1.0.0", "MPL-2.0"]],
      exceptions: [
        exceptionFor({
          package: "special-lib",
          version: "1.0.0",
          license: "MPL-2.0",
          scope: "root"
        })
      ]
    });

    const passing = runLicenseCheck({ root });
    expect(passing.ok).toBe(true);

    const staleRoot = await createFixture({
      rootPackages: [["node_modules/special-lib", "special-lib", "1.0.1", "MPL-2.0"]],
      exceptions: [
        exceptionFor({
          package: "special-lib",
          version: "1.0.0",
          license: "MPL-2.0",
          scope: "root"
        })
      ]
    });

    const stale = runLicenseCheck({ root: staleRoot });
    expect(stale.ok).toBe(false);
    expect(stale.failures.join("\n")).toContain("does not match the current lockfiles");
  });

  it("includes the agent-skills lockfile in the compliance gate", async () => {
    const root = await createFixture({
      agentPackages: [["node_modules/copyleft-agent-lib", "copyleft-agent-lib", "1.0.0", "LGPL-3.0-only"]]
    });

    const report = runLicenseCheck({ root });

    expect(report.ok).toBe(false);
    expect(report.failures.join("\n")).toContain("agent-skills/package-lock.json");
    expect(report.failures.join("\n")).toContain("copyleft-agent-lib@1.0.0");
  });

  it("fails malformed exception documents safely", async () => {
    const root = await createFixture({
      rootPackages: [["node_modules/special-lib", "special-lib", "1.0.0", "MPL-2.0"]],
      rawExceptionDoc: "# Bad exceptions\n\n```json\n{ invalid\n```\n"
    });

    const report = runLicenseCheck({ root });

    expect(report.ok).toBe(false);
    expect(report.failures.join("\n")).toContain("malformed JSON");
  });
});

async function createFixture(options: {
  rootPackages?: Array<[string, string, string, string | undefined]>;
  agentPackages?: Array<[string, string, string, string | undefined]>;
  exceptions?: unknown[];
  rawExceptionDoc?: string;
}) {
  const root = await mkdtemp(path.join(tmpdir(), "aicf-license-check-"));
  await mkdir(path.join(root, "agent-skills"), { recursive: true });
  await mkdir(path.join(root, "docs", "public"), { recursive: true });

  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "ai-capability-framework", version: "1.0.0-rc.4", license: "MIT" })
  );
  await writeFile(
    path.join(root, "agent-skills", "package.json"),
    JSON.stringify({ name: "@aicf/agent-skills", version: "1.0.0-rc.4", license: "MIT" })
  );
  await writeFile(
    path.join(root, "package-lock.json"),
    JSON.stringify(lockfile("ai-capability-framework", options.rootPackages ?? []), null, 2)
  );
  await writeFile(
    path.join(root, "agent-skills", "package-lock.json"),
    JSON.stringify(lockfile("@aicf/agent-skills", options.agentPackages ?? []), null, 2)
  );
  await writeFile(
    path.join(root, "docs", "public", "license-exceptions.md"),
    options.rawExceptionDoc ?? exceptionDocument(options.exceptions ?? [])
  );

  return root;
}

function lockfile(name: string, packages: Array<[string, string, string, string | undefined]>) {
  const entries: Record<string, unknown> = {
    "": {
      name,
      version: "1.0.0-rc.4",
      license: "MIT"
    }
  };
  for (const [lockPath, _name, version, license] of packages) {
    entries[lockPath] = {
      version,
      ...(license === undefined ? {} : { license })
    };
  }
  return {
    name,
    version: "1.0.0-rc.4",
    lockfileVersion: 3,
    packages: entries
  };
}

function exceptionDocument(exceptions: unknown[]) {
  return `# Dependency License Exceptions\n\n\`\`\`json\n${JSON.stringify({ exceptions }, null, 2)}\n\`\`\`\n`;
}

function exceptionFor(input: { package: string; version: string; license: string; scope: string }) {
  return {
    ...input,
    reason: "Reviewed fixture exception.",
    approved_by: "AICF maintainers",
    approved_at: "2026-06-08",
    review_by: "2027-06-08",
    constraints: "Fixture only."
  };
}
