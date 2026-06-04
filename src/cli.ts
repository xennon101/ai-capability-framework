#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAiSdkTools } from "./ai-sdk.js";
import { buildAnthropicClaudeTools } from "./anthropic-claude.js";
import { decideCapability } from "./decision.js";
import { formatEvalSuiteResult, loadEvalResults, runEvalSuite } from "./eval-runner.js";
import { buildGeminiFunctionDeclarations } from "./gemini.js";
import { buildLangChainToolDescriptors } from "./langchain.js";
import { loadManifests } from "./loader.js";
import { buildMcpToolDescriptors } from "./mcp.js";
import { buildOpenAIResponsesTools } from "./openai-responses.js";
import { buildRegistry, formatInspection, inspectRegistry } from "./registry.js";
import { buildSemanticKernelFunctions } from "./semantic-kernel.js";
import type { AicfDiagnostic, DecisionRequest } from "./types.js";
import { validateManifests, validatePublicFixtures } from "./validator.js";

interface WritableLike {
  write(message: string): unknown;
}

export interface CliRunOptions {
  stderr?: WritableLike;
  stdout?: WritableLike;
}

type AdapterCliCommand =
  | "ai-sdk-tools"
  | "anthropic-tools"
  | "gemini-tools"
  | "langchain-tools"
  | "mcp-tools"
  | "openai-tools"
  | "semantic-kernel-functions";

interface AdapterCliToolset {
  diagnostics: AicfDiagnostic[];
  functionDeclarations?: unknown[];
  functions?: unknown[];
  tools?: Record<string, unknown> | unknown[];
}

const adapterCommands = new Set<string>([
  "ai-sdk-tools",
  "anthropic-tools",
  "gemini-tools",
  "langchain-tools",
  "mcp-tools",
  "openai-tools",
  "semantic-kernel-functions"
]);

export async function runCli(argv: string[], options: CliRunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const [command] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    stdout.write(helpText());
    return command ? 0 : 1;
  }

  if (command !== "validate" && command !== "inspect" && command !== "decide" && command !== "eval" && !adapterCommands.has(command)) {
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
  const fixtureValidation = validatePublicFixtures(loadResult.fixtures);
  const errors = [...loadResult.errors, ...validation.errors, ...fixtureValidation.errors];

  if (errors.length > 0) {
    stderr.write(formatDiagnostics(errors));
    return 1;
  }

  const registry = buildRegistry(loadResult.manifests);

  if (command === "validate") {
    stdout.write(`Validated ${loadResult.manifests.length} manifest(s) and ${loadResult.fixtures.length} fixture(s).\n`);
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

  if (adapterCommands.has(command)) {
    if (!parsedArgs.contextPath) {
      stderr.write("Missing required --context <context.json>.\n");
      return 1;
    }

    const context = await readToolContext(parsedArgs.contextPath);
    if (!context.ok) {
      stderr.write(`${context.error}\n`);
      return 1;
    }

    const contextError = validateToolContextShape(context.value, adapterLabel(command as AdapterCliCommand));
    if (contextError) {
      stderr.write(`${contextError}\n`);
      return 1;
    }

    const toolset = buildAdapterCliToolset(command as AdapterCliCommand, registry, {
      context: context.value,
      includeDeprecated: parsedArgs.includeDeprecated,
      includeDisabledForTests: parsedArgs.includeDisabledForTests,
      includeDraft: parsedArgs.includeDraft,
      includeExperimental: parsedArgs.includeExperimental,
      includeRestricted: parsedArgs.includeRestricted
    });
    const fatalDiagnostics = toolset.diagnostics.filter((diagnostic) => diagnostic.code === "tool_name_collision");

    if (fatalDiagnostics.length > 0) {
      stderr.write(formatDiagnostics(fatalDiagnostics));
      return 1;
    }

    stdout.write(`${JSON.stringify(toolset, null, 2)}\n`);

    if (adapterExportedCount(toolset) === 0) {
      stderr.write(`No ${adapterLabel(command as AdapterCliCommand)} tools were exportable.\n`);
      return 1;
    }

    return 0;
  }

  if (command === "eval") {
    if (!parsedArgs.resultsPath) {
      stderr.write("Missing required --results <results.json>.\n");
      return 1;
    }

    if (parsedArgs.format !== "text" && parsedArgs.format !== "json") {
      stderr.write("Eval format must be text or json.\n");
      return 1;
    }

    const evalResults = await loadEvalResults(parsedArgs.resultsPath);
    if (evalResults.errors.length > 0) {
      stderr.write(formatDiagnostics(evalResults.errors));
      return 1;
    }

    const suite = runEvalSuite(registry, evalResults.results);
    if (parsedArgs.format === "json") {
      stdout.write(`${JSON.stringify(suite, null, 2)}\n`);
    } else {
      stdout.write(formatEvalSuiteResult(suite));
    }

    return suite.passed ? 0 : 1;
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
    "  eval <path> --results <file> [--format text|json]  Run deterministic evals.",
    "  ai-sdk-tools <path> --context <file>  Export Vercel AI SDK tool descriptors.",
    "  anthropic-tools <path> --context <file>  Export Anthropic Claude tool definitions.",
    "  gemini-tools <path> --context <file>  Export Gemini function declarations.",
    "  langchain-tools <path> --context <file>  Export LangChain/LangGraph tool descriptors.",
    "  mcp-tools <path> --context <file>  Export Model Context Protocol tool descriptors.",
    "  openai-tools <path> --context <file>  Export OpenAI Responses function tools.",
    "  semantic-kernel-functions <path> --context <file>  Export Semantic Kernel function metadata.",
    "  validate [path]  Validate AICF manifests. Defaults to examples.",
    "  inspect [path]   Print a registry summary. Defaults to examples.",
    "",
    "Adapter options: --include-restricted --include-deprecated --include-draft --include-experimental",
    ""
  ].join("\n");
}

function parseCommandArgs(args: string[]): {
  contextPath?: string;
  error?: string;
  format?: "json" | "text" | string;
  includeDeprecated?: boolean;
  includeDisabledForTests?: boolean;
  includeDraft?: boolean;
  includeExperimental?: boolean;
  includeRestricted?: boolean;
  requestPath?: string;
  resultsPath?: string;
  targetPath?: string;
} {
  let contextPath: string | undefined;
  let format = "text";
  let includeDeprecated = false;
  let includeDisabledForTests = false;
  let includeDraft = false;
  let includeExperimental = false;
  let includeRestricted = false;
  let requestPath: string | undefined;
  let resultsPath: string | undefined;
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

    if (arg === "--results") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --results." };
      }

      resultsPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--format") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --format." };
      }

      format = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--context") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --context." };
      }

      contextPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--include-restricted") {
      includeRestricted = true;
      continue;
    }

    if (arg === "--include-deprecated") {
      includeDeprecated = true;
      continue;
    }

    if (arg === "--include-draft") {
      includeDraft = true;
      continue;
    }

    if (arg === "--include-experimental") {
      includeExperimental = true;
      continue;
    }

    if (arg === "--include-disabled-for-tests") {
      includeDisabledForTests = true;
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
    contextPath,
    format,
    includeDeprecated,
    includeDisabledForTests,
    includeDraft,
    includeExperimental,
    includeRestricted,
    requestPath,
    resultsPath,
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

async function readToolContext(filePath: string): Promise<
  | { ok: true; value: DecisionRequest["context"] }
  | { error: string; ok: false }
> {
  try {
    const content = await readFile(filePath, "utf8");
    return {
      ok: true,
      value: JSON.parse(content) as DecisionRequest["context"]
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to read tool context.",
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

  if (value.context.riskCeiling !== undefined && !["none", "low", "medium", "high", "critical"].includes(value.context.riskCeiling)) {
    return "Decision request context.riskCeiling must be none, low, medium, high, or critical when present.";
  }

  if (
    value.context.allowedRiskTiers !== undefined
    && (!Array.isArray(value.context.allowedRiskTiers)
      || value.context.allowedRiskTiers.some((riskTier) => !["none", "low", "medium", "high", "critical"].includes(riskTier)))
  ) {
    return "Decision request context.allowedRiskTiers must be an array of risk tiers when present.";
  }

  if (!["A0", "A1", "A2", "A3", "A4", "A5"].includes(value.context.autonomyTier)) {
    return "Decision request context.autonomyTier must be A0, A1, A2, A3, A4, or A5.";
  }

  return null;
}

function validateToolContextShape(value: DecisionRequest["context"], label: string): string | null {
  if (typeof value !== "object" || value === null) {
    return `${label} tool context must be a JSON object.`;
  }

  if (!Array.isArray(value.permissions) || value.permissions.some((permission) => typeof permission !== "string")) {
    return `${label} tool context.permissions must be an array of strings.`;
  }

  if (!["A0", "A1", "A2", "A3", "A4", "A5"].includes(value.autonomyTier)) {
    return `${label} tool context.autonomyTier must be A0, A1, A2, A3, A4, or A5.`;
  }

  if (value.userId !== undefined && typeof value.userId !== "string") {
    return `${label} tool context.userId must be a string when present.`;
  }

  if (value.tenantId !== undefined && typeof value.tenantId !== "string") {
    return `${label} tool context.tenantId must be a string when present.`;
  }

  if (value.riskCeiling !== undefined && !["none", "low", "medium", "high", "critical"].includes(value.riskCeiling)) {
    return `${label} tool context.riskCeiling must be none, low, medium, high, or critical when present.`;
  }

  if (
    value.allowedRiskTiers !== undefined
    && (!Array.isArray(value.allowedRiskTiers)
      || value.allowedRiskTiers.some((riskTier) => !["none", "low", "medium", "high", "critical"].includes(riskTier)))
  ) {
    return `${label} tool context.allowedRiskTiers must be an array of risk tiers when present.`;
  }

  return null;
}

function buildAdapterCliToolset(
  command: AdapterCliCommand,
  registry: ReturnType<typeof buildRegistry>,
  options: {
    context: DecisionRequest["context"];
    includeDeprecated?: boolean;
    includeDisabledForTests?: boolean;
    includeDraft?: boolean;
    includeExperimental?: boolean;
    includeRestricted?: boolean;
  }
): AdapterCliToolset {
  switch (command) {
    case "ai-sdk-tools":
      return buildAiSdkTools(registry, options);
    case "anthropic-tools":
      return buildAnthropicClaudeTools(registry, options);
    case "gemini-tools":
      return buildGeminiFunctionDeclarations(registry, options);
    case "langchain-tools":
      return buildLangChainToolDescriptors(registry, options);
    case "mcp-tools":
      return buildMcpToolDescriptors(registry, options);
    case "semantic-kernel-functions":
      return buildSemanticKernelFunctions(registry, options);
    case "openai-tools":
      return buildOpenAIResponsesTools(registry, options);
  }
}

function adapterExportedCount(toolset: AdapterCliToolset): number {
  if (Array.isArray(toolset.tools)) {
    return toolset.tools.length;
  }

  if (toolset.tools && typeof toolset.tools === "object") {
    return Object.keys(toolset.tools).length;
  }

  if (toolset.functionDeclarations) {
    return toolset.functionDeclarations.length;
  }

  if (toolset.functions) {
    return toolset.functions.length;
  }

  return 0;
}

function adapterLabel(command: AdapterCliCommand): string {
  switch (command) {
    case "ai-sdk-tools":
      return "AI SDK";
    case "anthropic-tools":
      return "Anthropic Claude";
    case "gemini-tools":
      return "Gemini";
    case "langchain-tools":
      return "LangChain";
    case "mcp-tools":
      return "MCP";
    case "openai-tools":
      return "OpenAI";
    case "semantic-kernel-functions":
      return "Semantic Kernel";
  }
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
