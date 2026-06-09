#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  expectedSkillNames,
  forbiddenPathFailures,
  normalizePath,
  packageRoot
} from "./lib/skill-common.mjs";

const root = packageRoot();
const keepTmp = process.env.AICF_KEEP_TMP === "1";
const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const npmArgs = (...args) => npmExecPath ? [npmExecPath, ...args] : args;
let tempDirectory;

try {
  tempDirectory = await mkdtemp(path.join(tmpdir(), "aicf-agent-skills-release-install-"));
  const packDirectory = path.join(tempDirectory, "pack");
  const consumerDirectory = path.join(tempDirectory, "consumer");
  await mkdir(packDirectory, { recursive: true });
  await mkdir(consumerDirectory, { recursive: true });

  execFileSync(npmCommand, npmArgs("pack", "--pack-destination", packDirectory, "--json"), {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const tarball = readdirSync(packDirectory)
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => path.join(packDirectory, file))[0];
  if (!tarball) {
    throw new Error("npm pack did not produce an agent-skills tarball.");
  }

  execFileSync(npmCommand, npmArgs("init", "-y"), {
    cwd: consumerDirectory,
    stdio: "ignore"
  });
  execFileSync(npmCommand, npmArgs("install", "--omit=dev", tarball), {
    cwd: consumerDirectory,
    stdio: "pipe"
  });

  const listOutput = execFileSync(npmCommand, npmArgs("exec", "--", "aicf-skills", "list"), {
    cwd: consumerDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  for (const skillName of expectedSkillNames) {
    if (!listOutput.includes(`${skillName}\t`)) {
      throw new Error(`Installed aicf-skills list output is missing ${skillName}.`);
    }
  }

  execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const pkg = require("@aicf/agent-skills/package.json");
      if (pkg.name !== "@aicf/agent-skills") throw new Error("Unexpected installed package name.");
      if (!pkg.bin?.["aicf-skills"]) throw new Error("Missing installed aicf-skills bin metadata.");
    `
  ], {
    cwd: consumerDirectory,
    stdio: "pipe"
  });

  const installedRoot = path.join(consumerDirectory, "node_modules", "@aicf", "agent-skills");
  const requiredFiles = [
    ".codex-plugin/plugin.json",
    "skills/README.md",
    "README.md",
    "LICENSE",
    "scripts/aicf-skills.mjs"
  ];
  for (const file of requiredFiles) {
    if (!existsSync(path.join(installedRoot, file))) {
      throw new Error(`Installed package missing required file: ${file}`);
    }
  }

  const installedFiles = walkFiles(installedRoot).map((file) => normalizePath(path.relative(installedRoot, file)));
  for (const skillName of expectedSkillNames) {
    if (!installedFiles.includes(`skills/${skillName}/SKILL.md`)) {
      throw new Error(`Installed package missing skill file: skills/${skillName}/SKILL.md`);
    }
  }

  for (const file of installedFiles) {
    const lower = file.toLowerCase();
    if (
      file.startsWith("tests/")
      || file.includes("/tests/")
      || file.startsWith("node_modules/")
      || file.includes("/node_modules/")
      || lower.includes("provider-payload")
      || lower.includes("raw-payload")
      || lower.includes(`raw-${"prompt"}`)
      || lower.includes("raw-trace")
      || /(^|\/)traces?(\/|$)/u.test(lower)
      || /(^|\/)prompts?(\/|$)/u.test(lower)
      || lower.endsWith(".log")
    ) {
      throw new Error(`Installed package contains forbidden file: ${file}`);
    }
    const forbidden = forbiddenPathFailures(file, "installed package");
    if (forbidden.length > 0) {
      throw new Error(forbidden.join("\n"));
    }
  }

  console.log(`Agent skills release install smoke test passed in ${consumerDirectory}.`);
} finally {
  if (!keepTmp && tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function walkFiles(directory) {
  const files = [];
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}
