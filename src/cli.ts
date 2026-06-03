#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decideCapability } from "./decision.js";
import { loadManifests } from "./loader.js";
import { buildRegistry, formatInspection, inspectRegistry } from "./registry.js";
import type { AicfDiagnostic, DecisionRequest } from "./types.js";
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
  const [command] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    stdout.write(helpText());
    return command ? 0 : 1;
  }

  if (command !== "validate" && command !== "inspect" && command !== "decide") {
    stderr.write(`Unknown command "${command}".\n\n${helpText()}`);
    return 1;
  }

  const parsedArgs = parseCommandArgs(argv.slice(1));
  if (parsedArgs.error) {
    stderr.write(`${parsedArgs.error}\n\n${helpText()}`);
    return 1;
  }

  const targetPath = parsedArgs.targetPath ?? "examples";
  const loadResult = await loadManifests({ path: targetPath });
  const validation = validateManifests(loadResult.manifests);
  const errors = [...loadResult.errors, ...validation.errors];

  if (errors.length > 0) {
    stderr.write(formatDiagnostics(errors));
    return 1;
  }

  const registry = buildRegistry(loadResult.manifests);

  if (command === "validate") {
    stdout.write(`Validated ${loadResult.manifests.length} manifest(s).\n`);
    return 0;
  }

  if (command === "decide") {
    if (!parsedArgs.requestPath) {
      stderr.write("Missing required --request <decision.json>.\n");
      return 1;
    }

    const request = await readDecisionRequest(parsedArgs.requestPath);
    if (!request.ok) {
      stderr.write(`${request.error}\n`);
      return 1;
    }

    const requestError = validateDecisionRequestShape(request.value);
    if (requestError) {
      stderr.write(`${requestError}\n`);
      return 1;
    }

    if (!registry.capabilityById.has(request.value.capabilityId)) {
      stderr.write(`Unknown capability id "${request.value.capabilityId}".\n`);
      return 1;
    }

    stdout.write(`${JSON.stringify(decideCapability(registry, request.value), null, 2)}\n`);
    return 0;
  }

  stdout.write(formatInspection(inspectRegistry(registry)));
  return 0;
}

function helpText(): string {
  return [
    "Usage: aicf <command> [path]",
    "",
    "Commands:",
    "  decide <path> --request <file>  Evaluate a decision request.",
    "  validate [path]  Validate AICF manifests. Defaults to examples.",
    "  inspect [path]   Print a registry summary. Defaults to examples.",
    ""
  ].join("\n");
}

function parseCommandArgs(args: string[]): {
  error?: string;
  requestPath?: string;
  targetPath?: string;
} {
  let requestPath: string | undefined;
  let targetPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--request") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --request." };
      }

      requestPath = nextArg;
      index += 1;
      continue;
    }

    if (arg?.startsWith("--")) {
      return { error: `Unknown option "${arg}".` };
    }

    if (targetPath) {
      return { error: `Unexpected argument "${arg}".` };
    }

    targetPath = arg;
  }

  return {
    requestPath,
    targetPath
  };
}

async function readDecisionRequest(filePath: string): Promise<
  | { ok: true; value: DecisionRequest }
  | { error: string; ok: false }
> {
  try {
    const content = await readFile(filePath, "utf8");
    return {
      ok: true,
      value: JSON.parse(content) as DecisionRequest
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to read decision request.",
      ok: false
    };
  }
}

function validateDecisionRequestShape(value: DecisionRequest): string | null {
  if (typeof value !== "object" || value === null) {
    return "Decision request must be a JSON object.";
  }

  if (typeof value.capabilityId !== "string" || value.capabilityId.length === 0) {
    return "Decision request requires capabilityId.";
  }

  if (value.operation !== "select" && value.operation !== "prepare" && value.operation !== "commit") {
    return "Decision request operation must be select, prepare, or commit.";
  }

  if (typeof value.context !== "object" || value.context === null) {
    return "Decision request requires context.";
  }

  if (!Array.isArray(value.context.permissions) || value.context.permissions.some((permission) => typeof permission !== "string")) {
    return "Decision request context.permissions must be an array of strings.";
  }

  if (!["A0", "A1", "A2", "A3", "A4", "A5"].includes(value.context.autonomyTier)) {
    return "Decision request context.autonomyTier must be A0, A1, A2, A3, A4, or A5.";
  }

  return null;
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
