#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifests } from "./loader.js";
import { buildRegistry, formatInspection, inspectRegistry } from "./registry.js";
import type { AicfDiagnostic } from "./types.js";
import { validateManifests } from "./validator.js";

interface WritableLike {
  write(message: string): unknown;
}

export interface CliRunOptions {
  stderr?: WritableLike;
  stdout?: WritableLike;
}

export async function runCli(argv: string[], options: CliRunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const [command, targetPath = "examples"] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    stdout.write(helpText());
    return command ? 0 : 1;
  }

  if (command !== "validate" && command !== "inspect") {
    stderr.write(`Unknown command "${command}".\n\n${helpText()}`);
    return 1;
  }

  const loadResult = await loadManifests({ path: targetPath });
  const validation = validateManifests(loadResult.manifests);
  const errors = [...loadResult.errors, ...validation.errors];

  if (errors.length > 0) {
    stderr.write(formatDiagnostics(errors));
    return 1;
  }

  if (command === "validate") {
    stdout.write(`Validated ${loadResult.manifests.length} manifest(s).\n`);
    return 0;
  }

  const registry = buildRegistry(loadResult.manifests);
  stdout.write(formatInspection(inspectRegistry(registry)));
  return 0;
}

function helpText(): string {
  return [
    "Usage: aicf <command> [path]",
    "",
    "Commands:",
    "  validate [path]  Validate AICF manifests. Defaults to examples.",
    "  inspect [path]   Print a registry summary. Defaults to examples.",
    ""
  ].join("\n");
}

function formatDiagnostics(errors: AicfDiagnostic[]): string {
  return errors
    .map((error) => {
      const kind = error.kind ? ` ${error.kind}` : "";
      const id = error.id ? ` ${error.id}` : "";
      return `${error.path}:${kind}${id}: ${error.message}`;
    })
    .join("\n")
    .concat("\n");
}

if (isDirectCliRun()) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

function isDirectCliRun(): boolean {
  const invokedPath = process.argv[1];
  if (!invokedPath) {
    return false;
  }

  return path.resolve(invokedPath) === fileURLToPath(import.meta.url);
}
