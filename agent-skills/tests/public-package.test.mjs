import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  expectedSkillNames,
  forbiddenPathFailures,
  npmPackFiles,
  packageRoot,
  publicPackageFailures,
  readJson
} from "../scripts/lib/skill-common.mjs";

const root = packageRoot();

test("package and plugin metadata point to skills", () => {
  const pkg = readJson(path.join(root, "package.json"));
  const plugin = readJson(path.join(root, ".codex-plugin", "plugin.json"));
  assert.equal(pkg.bin["aicf-skills"], "scripts/aicf-skills.mjs");
  assert.equal(pkg.publishConfig.access, "public");
  assert.equal(pkg.scripts["check:index"], "node scripts/generate-skill-index.mjs ./skills ./docs/skill-index.md --check");
  assert.equal(pkg.scripts["check:release"], "node scripts/check-release-readiness.mjs");
  assert.equal(plugin.skills, "./skills/");
  assert.equal(plugin.version, pkg.version);
  assert.equal(plugin.license, "MIT");
  assert.equal(plugin.interface.composerIcon, "./assets/aicf-agent-skills-icon.svg");
  assert.equal(plugin.interface.logo, "./assets/aicf-agent-skills-logo.svg");
});

test("public package scan passes for current package", () => {
  assert.deepEqual(publicPackageFailures(root), []);
});

test("forbidden files and secret-like strings are detected", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "aicf-public-scan-"));
  try {
    writeFileSync(path.join(temp, "package.json"), JSON.stringify({ name: "scan", version: "1.0.0", files: ["."] }), "utf8");
    writeFileSync(path.join(temp, "README.md"), "OPENAI_API_KEY=example\n", "utf8");
    mkdirSync(path.join(temp, "dist"));
    writeFileSync(path.join(temp, "dist", "output.txt"), "generated\n", "utf8");
    const failures = publicPackageFailures(temp).join("\n");
    assert.match(failures, /OpenAI key marker/);
    assert.match(forbiddenPathFailures("dist/output.txt").join("\n"), /forbidden path included/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("npm dry-run excludes forbidden files", () => {
  const files = npmPackFiles(root);
  assert.ok(files.includes("README.md"));
  assert.ok(files.includes(".codex-plugin/plugin.json"));
  assert.ok(files.includes("docs/skill-index.md"));
  assert.ok(files.includes("assets/aicf-agent-skills-icon.svg"));
  assert.ok(files.includes("scripts/check-release-readiness.mjs"));
  for (const skillName of expectedSkillNames) {
    assert.ok(files.includes(`skills/${skillName}/SKILL.md`), `${skillName} should be packed`);
  }
  assert.ok(files.every((file) => forbiddenPathFailures(file).length === 0));
  assert.ok(files.every((file) => !file.startsWith("tests/")), "tests should not be packed");
  assert.ok(files.every((file) => !file.includes("node_modules/")), "dependencies should not be packed");
  assert.ok(files.every((file) => !file.startsWith(".agents/")), "local skill mirrors should not be packed");
});

test("CLI dispatcher lists and installs package skills", () => {
  const listOutput = execFileSync(process.execPath, ["scripts/aicf-skills.mjs", "list"], {
    cwd: root,
    encoding: "utf8"
  });
  for (const skillName of expectedSkillNames) {
    assert.match(listOutput, new RegExp(`${skillName}\\t`));
  }

  const temp = mkdtempSync(path.join(os.tmpdir(), "aicf-install-skills-"));
  try {
    const output = execFileSync(process.execPath, ["scripts/install-skills.mjs", "--target", temp, "--force", "--allow-outside"], {
      cwd: root,
      encoding: "utf8"
    });
    assert.match(output, /Installed 17 skill\(s\)/);
    assert.deepEqual(readdirSync(temp).sort(), [...expectedSkillNames].sort());
    assert.ok(!existsSync(path.join(temp, "package.json")));
    assert.ok(!existsSync(path.join(temp, ".codex-plugin")));
    assert.ok(!existsSync(path.join(temp, "tests")));
    assert.ok(!existsSync(path.join(temp, "node_modules")));
    for (const skillName of expectedSkillNames) {
      assert.ok(existsSync(path.join(temp, skillName, "SKILL.md")), `${skillName} should be installed`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("release readiness script passes for the current package", () => {
  const output = execFileSync(process.execPath, ["scripts/check-release-readiness.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.match(output, /Agent skills release readiness passed/);
});
