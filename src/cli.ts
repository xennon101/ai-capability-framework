#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { buildAiSdkTools } from "./ai-sdk.js";
import { buildAnthropicClaudeTools } from "./anthropic-claude.js";
import {
  buildProviderTargetMatrix,
  exportProviderTools,
  formatProviderConformanceReport,
  formatProviderTargetMatrix,
  isProviderConformanceTarget,
  listProviderTargets,
  normalizeProviderConformanceTarget,
  parseProviderConformanceTargets,
  runProviderConformanceSuite
} from "./conformance/index.js";
import {
  createControlsEvaluatorSnapshot,
  DefaultControlsEvaluator,
  LocalJsonControlsStore,
  type AicfControlScope,
  type ControlDecision,
  type ControlsSnapshot,
  type KillSwitchMode
} from "./controls/index.js";
import { decideCapability } from "./decision.js";
import {
  exportEvidencePack,
  validateEvidencePack,
  type EvidenceExportFormat,
  type EvidenceIncidentSummaryInput,
  type ModelUpgradeRecord
} from "./evidence/index.js";
import { formatEvalSuiteResult, loadEvalResults, runEvalSuite } from "./eval-runner.js";
import { buildGeminiFunctionDeclarations } from "./gemini.js";
import {
  analyzeCapabilityImpact,
  compareCapabilityVersions,
  compileCapabilityRisk,
  evaluateLifecycleTransition,
  formatGovernanceGateReport,
  runGovernanceGate,
  type CapabilityLifecycleStatus,
  type GovernanceGateReport
} from "./governance/index.js";
import { buildLangChainToolDescriptors } from "./langchain.js";
import { loadManifests } from "./loader.js";
import { buildMcpToolDescriptors } from "./mcp.js";
import { createDefaultOpenAIResponsesClient } from "./openai/index.js";
import { buildOpenAIResponsesTools } from "./openai-responses.js";
import { exportPromptfooSuite } from "./promptfoo/index.js";
import { buildRegistry, formatInspection, inspectRegistry } from "./registry.js";
import {
  createGoldenFromTrace,
  runReplay,
  validateReplayTrace,
  type ReplayMode,
  type ReplayResult,
  type ReplayTrace
} from "./replay/index.js";
import {
  exportPromptfooSecurityPackSuite,
  generateSecurityCases,
  getSecurityPack,
  listSecurityPacks,
  type SecurityPackCoverageReport,
  type SecurityPackId
} from "./security-packs/index.js";
import {
  AicfActionLifecycleManager,
  AicfHandlerRegistry,
  AicfToolExecutor,
  DefaultCapabilityRouter,
  DefaultContextBuilder,
  DefaultPolicyBroker,
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemoryIdempotencyStore,
  InMemoryPreparedActionStore
} from "./runtime/index.js";
import { evaluateGate, runLiveEvalSuite, type AicfLiveEvalCaseInput } from "./evals-live/index.js";
import { buildSemanticKernelFunctions } from "./semantic-kernel.js";
import type { AicfDiagnostic, CapabilityManifest, DecisionRequest, EvalCase } from "./types.js";
import { validateManifests, validatePublicFixtures } from "./validator.js";
import type { ProviderConformanceReport } from "./conformance/index.js";

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

  if (command === "providers") {
    return runProvidersCli(argv.slice(1), { stderr, stdout });
  }

  if (command === "conformance") {
    return runConformanceCli(argv.slice(1), { stderr, stdout });
  }

  if (command === "governance") {
    return runGovernanceCli(argv.slice(1), { stderr, stdout });
  }

  if (command === "gate") {
    return runGateCli(argv.slice(1), { stderr, stdout });
  }

  if (command === "evidence") {
    return runEvidenceCli(argv.slice(1), { stderr, stdout });
  }

  if (command === "controls") {
    return runControlsCli(argv.slice(1), { stderr, stdout });
  }

  if (command === "replay") {
    return runReplayCli(argv.slice(1), { stderr, stdout });
  }

  if (command === "evals") {
    return runEvalsCli(argv.slice(1), { stderr, stdout });
  }

  if (command === "security") {
    return runSecurityCli(argv.slice(1), { stderr, stdout });
  }

  if (
    command !== "validate"
    && command !== "inspect"
    && command !== "decide"
    && command !== "eval"
    && command !== "eval-live"
    && command !== "export"
    && !adapterCommands.has(command)
  ) {
    stderr.write(`Unknown command "${command}".\n\n${helpText()}`);
    return 1;
  }

  const parsedArgs = parseCommandArgs(command === "export" && argv[1] === "promptfoo" ? argv.slice(2) : argv.slice(1));
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

  if (command === "export") {
    if (argv[1] !== "promptfoo") {
      stderr.write("Usage: aicf export promptfoo <path> --out <dir> [--provider <provider>] [--include-red-team-defaults]\n");
      return 1;
    }

    if (!parsedArgs.outPath) {
      stderr.write("Missing required --out <dir>.\n");
      return 1;
    }

    const suite = exportPromptfooSuite({
      evalCases: registry.evals.map((evalCase) => evalCase.manifest),
      includeRedTeamDefaults: parsedArgs.includeRedTeamDefaults,
      providerName: parsedArgs.providerName
    });
    for (const file of suite.files) {
      const destination = path.join(parsedArgs.outPath, file.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.content, "utf8");
    }
    stdout.write(`${JSON.stringify({
      files: suite.files.map((file) => path.join(parsedArgs.outPath ?? "", file.path).replaceAll("\\", "/"))
    }, null, 2)}\n`);
    return 0;
  }

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

  if (command === "eval-live") {
    if (!parsedArgs.casesPath) {
      stderr.write("Missing required --cases <cases.json>.\n");
      return 1;
    }

    if (!parsedArgs.model) {
      stderr.write("Missing required --model <model> for live evals.\n");
      return 1;
    }

    if (!process.env.OPENAI_API_KEY) {
      stderr.write("OPENAI_API_KEY is required for eval-live. Use the TypeScript API with a mock client for API-key-free tests.\n");
      return 1;
    }

    const cases = await readLiveEvalCases(parsedArgs.casesPath);
    if (!cases.ok) {
      stderr.write(`${cases.error}\n`);
      return 1;
    }

    const handlers = new AicfHandlerRegistry({ registry });
    const auditSink = new InMemoryAuditSink();
    const policyBroker = new DefaultPolicyBroker();
    const lifecycle = new AicfActionLifecycleManager({
      approvalStore: new InMemoryApprovalStore(),
      auditSink,
      handlers,
      idempotencyStore: new InMemoryIdempotencyStore(),
      policyBroker,
      preparedActionStore: new InMemoryPreparedActionStore(),
      registry
    });
    const executor = new AicfToolExecutor({
      actionLifecycle: lifecycle,
      auditSink,
      handlers,
      policyBroker,
      registry
    });
    const results = await runLiveEvalSuite({
      cases: cases.value,
      contextBuilderFactory: () => new DefaultContextBuilder(),
      executor,
      model: parsedArgs.model,
      openAIClient: await createDefaultOpenAIResponsesClient(),
      registry,
      router: new DefaultCapabilityRouter()
    });
    const gate = evaluateGate(results);
    const output = {
      gate,
      results
    };
    stdout.write(`${parsedArgs.format === "text" ? formatLiveEvalResults(results, gate) : JSON.stringify(output, null, 2)}\n`);
    return gate.passed ? 0 : 1;
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
    "  eval-live <path> --cases <file> --model <model> [--format text|json]  Run opt-in live evals.",
    "  export promptfoo <path> --out <dir> [--provider <provider>]  Generate Promptfoo suite files.",
    "  governance risk <path> [--capability <id>] [--format text|json]  Compile governance risk.",
    "  governance lifecycle <path> --capability <id> --to <status> --reason <text>  Evaluate lifecycle transition.",
    "  governance compatibility --before <file> --after <file> [--format text|json]  Compare capability versions.",
    "  governance impact <path> --capability <id> [--format text|json]  Analyze capability impact.",
    "  gate <path> --env <name> [--config <file>] [--format text|json]  Run the CI governance gate.",
    "  evidence export <path> --out <file> [--format json|markdown]  Export a public-safe evidence pack.",
    "  controls list [--store <file>] [--format text|json]  List local runtime controls.",
    "  controls check <path> --capability <id> [--provider <provider>] [--model <model>]  Evaluate runtime controls.",
    "  controls kill-switch create --mode <mode> --reason <text> --capability <id>|--provider <id>|--global  Add a local kill switch.",
    "  replay run <trace.json> --mode <mode> [--manifest-root <path>] [--format text|json]  Replay a sanitized runtime trace.",
    "  evals create-from-trace <trace.json> --suite <id> --out <file>  Draft an eval from a sanitized trace.",
    "  security list-packs [--format text|json]  List built-in security packs.",
    "  security generate <path> --pack <id> --out <file> [--format yaml|json]  Generate security cases.",
    "  security export-promptfoo <path> --out <file> [--provider <provider>] [--pack <id>]  Export Promptfoo red-team config.",
    "  conformance run <path> [--providers <csv>] [--format text|json] [--out <file>]  Run cross-provider conformance.",
    "  conformance matrix <path> [--providers <csv>] [--format markdown|json] [--out <file>]  Export provider conformance matrix.",
    "  providers list  List provider conformance targets.",
    "  providers conformance <path> [--format text|json]  Run provider conformance checks.",
    "  providers export-tools <path> --provider <provider> --context <file>  Export provider tools.",
    "  providers export-semantic-kernel-openapi <path> --context <file> --server-url <url>  Export Semantic Kernel OpenAPI.",
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
  afterPath?: string;
  beforePath?: string;
  capabilityId?: string;
  baselinePath?: string;
  configPath?: string;
  contextPath?: string;
  casesPath?: string;
  environment?: string;
  error?: string;
  failOnWarnings?: boolean;
  format?: "json" | "text" | string;
  conformanceReportPath?: string;
  evalResultsPath?: string;
  gateReportPath?: string;
  includeDeprecated?: boolean;
  includeDisabledForTests?: boolean;
  includeDraft?: boolean;
  includeExperimental?: boolean;
  includeRedTeamDefaults?: boolean;
  includeDiagnostics?: boolean;
  includeRawContent?: boolean;
  includeRestricted?: boolean;
  jsonOutput?: boolean;
  manifestRoot?: string;
  mode?: string;
  model?: string;
  outPath?: string;
  packId?: string;
  providerCsv?: string;
  providerName?: string;
  projectId?: string;
  projectName?: string;
  reason?: string;
  requireReview?: boolean;
  requestPath?: string;
  resultsPath?: string;
  securityReportPath?: string;
  incidentSummaryPath?: string;
  modelUpgradesPath?: string;
  serverUrl?: string;
  strict?: boolean;
  suiteId?: string;
  targetPath?: string;
  toStatus?: string;
  fromStatus?: string;
  autonomyTier?: string;
  domain?: string;
  expiresAt?: string;
  globalScope?: boolean;
  killSwitchMode?: string;
  riskTier?: string;
  storePath?: string;
  tenantId?: string;
  artifactHygiene?: boolean;
} {
  let afterPath: string | undefined;
  let beforePath: string | undefined;
  let capabilityId: string | undefined;
  let baselinePath: string | undefined;
  let configPath: string | undefined;
  let contextPath: string | undefined;
  let casesPath: string | undefined;
  let environment: string | undefined;
  let failOnWarnings = false;
  let format = "text";
  let conformanceReportPath: string | undefined;
  let evalResultsPath: string | undefined;
  let gateReportPath: string | undefined;
  let includeDeprecated = false;
  let includeDisabledForTests = false;
  let includeDraft = false;
  let includeExperimental = false;
  let includeRedTeamDefaults = false;
  let includeDiagnostics = false;
  let includeRawContent = false;
  let includeRestricted = false;
  let jsonOutput = false;
  let manifestRoot: string | undefined;
  let mode: string | undefined;
  let model: string | undefined;
  let outPath: string | undefined;
  let packId: string | undefined;
  let providerCsv: string | undefined;
  let providerName: string | undefined;
  let projectId: string | undefined;
  let projectName: string | undefined;
  let reason: string | undefined;
  let requireReview = true;
  let requestPath: string | undefined;
  let resultsPath: string | undefined;
  let securityReportPath: string | undefined;
  let incidentSummaryPath: string | undefined;
  let modelUpgradesPath: string | undefined;
  let serverUrl: string | undefined;
  let strict = false;
  let suiteId: string | undefined;
  let targetPath: string | undefined;
  let toStatus: string | undefined;
  let fromStatus: string | undefined;
  let autonomyTier: string | undefined;
  let domain: string | undefined;
  let expiresAt: string | undefined;
  let globalScope = false;
  let killSwitchMode: string | undefined;
  let riskTier: string | undefined;
  let storePath: string | undefined;
  let tenantId: string | undefined;
  let artifactHygiene = true;

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

    if (arg === "--eval-results") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --eval-results." };
      }

      evalResultsPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--gate-report") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --gate-report." };
      }

      gateReportPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--conformance-report") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --conformance-report." };
      }

      conformanceReportPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--security-report") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --security-report." };
      }

      securityReportPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--model-upgrades") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --model-upgrades." };
      }

      modelUpgradesPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--incident-summary") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --incident-summary." };
      }

      incidentSummaryPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--cases") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --cases." };
      }

      casesPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--model") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --model." };
      }

      model = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--store") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --store." };
      }

      storePath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--config") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --config." };
      }

      configPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--baseline") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --baseline." };
      }

      baselinePath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--env" || arg === "--environment") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: `Missing value for ${arg}.` };
      }

      environment = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--mode") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --mode." };
      }

      mode = nextArg;
      killSwitchMode = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--manifest-root") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --manifest-root." };
      }

      manifestRoot = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--suite") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --suite." };
      }

      suiteId = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--expires-at") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --expires-at." };
      }

      expiresAt = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--domain") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --domain." };
      }

      domain = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--risk") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --risk." };
      }

      riskTier = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--tenant") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --tenant." };
      }

      tenantId = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--autonomy") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --autonomy." };
      }

      autonomyTier = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--out") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --out." };
      }

      outPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--provider") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --provider." };
      }

      providerName = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--project-id") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --project-id." };
      }

      projectId = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--project-name") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --project-name." };
      }

      projectName = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--providers") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --providers." };
      }

      providerCsv = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--pack") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --pack." };
      }

      packId = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--server-url") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --server-url." };
      }

      serverUrl = nextArg;
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

    if (arg === "--capability") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --capability." };
      }

      capabilityId = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--to") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --to." };
      }

      toStatus = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--from") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --from." };
      }

      fromStatus = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--reason") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --reason." };
      }

      reason = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--before") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --before." };
      }

      beforePath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--after") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        return { error: "Missing value for --after." };
      }

      afterPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--strict") {
      strict = true;
      continue;
    }

    if (arg === "--json") {
      format = "json";
      jsonOutput = true;
      continue;
    }

    if (arg === "--fail-on-warnings") {
      failOnWarnings = true;
      continue;
    }

    if (arg === "--no-artifact-hygiene") {
      artifactHygiene = false;
      continue;
    }

    if (arg === "--global") {
      globalScope = true;
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

    if (arg === "--include-red-team-defaults") {
      includeRedTeamDefaults = true;
      continue;
    }

    if (arg === "--include-diagnostics") {
      includeDiagnostics = true;
      continue;
    }

    if (arg === "--include-raw-content") {
      includeRawContent = true;
      continue;
    }

    if (arg === "--no-require-review") {
      requireReview = false;
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
    afterPath,
    artifactHygiene,
    baselinePath,
    beforePath,
    capabilityId,
    casesPath,
    configPath,
    conformanceReportPath,
    contextPath,
    environment,
    evalResultsPath,
    failOnWarnings,
    format,
    gateReportPath,
    includeDeprecated,
    includeDisabledForTests,
    includeDraft,
    includeExperimental,
    includeDiagnostics,
    includeRawContent,
    includeRedTeamDefaults,
    includeRestricted,
    jsonOutput,
    manifestRoot,
    mode,
    model,
    outPath,
    packId,
    providerCsv,
    providerName,
    projectId,
    projectName,
    reason,
    requireReview,
    requestPath,
    resultsPath,
    securityReportPath,
    incidentSummaryPath,
    modelUpgradesPath,
    serverUrl,
    strict,
    suiteId,
    targetPath,
    toStatus,
    fromStatus,
    autonomyTier,
    domain,
    expiresAt,
    globalScope,
    killSwitchMode,
    riskTier,
    storePath,
    tenantId
  };
}

async function runControlsCli(argv: string[], options: CliRunOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const [subcommand] = argv;

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    stdout.write(controlsHelpText());
    return subcommand ? 0 : 1;
  }

  if (subcommand === "list") {
    const parsedArgs = parseCommandArgs(argv.slice(1));
    if (parsedArgs.error) {
      stderr.write(`${parsedArgs.error}\n\n${controlsHelpText()}`);
      return 1;
    }
    const store = new LocalJsonControlsStore(parsedArgs.storePath);
    const snapshot = createControlsEvaluatorSnapshot(store);
    stdout.write(parsedArgs.format === "json" ? `${JSON.stringify(snapshot, null, 2)}\n` : formatControlsSnapshot(snapshot));
    return 0;
  }

  if (subcommand === "check") {
    const parsedArgs = parseCommandArgs(argv.slice(1));
    if (parsedArgs.error) {
      stderr.write(`${parsedArgs.error}\n\n${controlsHelpText()}`);
      return 1;
    }
    if (!parsedArgs.capabilityId) {
      stderr.write("Missing required --capability <id>.\n");
      return 1;
    }
    const loaded = await loadValidatedRegistry(parsedArgs.targetPath ?? "examples");
    if (!loaded.ok) {
      stderr.write(formatDiagnostics(loaded.errors));
      return 1;
    }
    const capability = loaded.registry.capabilityById.get(parsedArgs.capabilityId);
    if (!capability) {
      stderr.write(`Unknown capability id "${parsedArgs.capabilityId}".\n`);
      return 1;
    }
    const store = new LocalJsonControlsStore(parsedArgs.storePath);
    const evaluator = new DefaultControlsEvaluator(createControlsEvaluatorSnapshot(store));
    const decision = evaluator.evaluate({
      autonomyTier: isAutonomyTier(parsedArgs.autonomyTier) ? parsedArgs.autonomyTier : undefined,
      capability,
      capabilityId: capability.manifest.id,
      domain: parsedArgs.domain ?? capability.manifest.domain,
      model: parsedArgs.model,
      operation: "export",
      providerId: parsedArgs.providerName,
      registry: loaded.registry,
      riskTier: isRiskTier(parsedArgs.riskTier) ? parsedArgs.riskTier : capability.manifest.risk_tier,
      tenantId: parsedArgs.tenantId
    });
    stdout.write(parsedArgs.format === "json" ? `${JSON.stringify(decision, null, 2)}\n` : formatControlDecision(decision));
    return decision.status === "denied" ? 1 : 0;
  }

  if (subcommand === "kill-switch" && argv[1] === "create") {
    const parsedArgs = parseCommandArgs(argv.slice(2));
    if (parsedArgs.error) {
      stderr.write(`${parsedArgs.error}\n\n${controlsHelpText()}`);
      return 1;
    }
    if (!isKillSwitchMode(parsedArgs.killSwitchMode) || !parsedArgs.reason) {
      stderr.write("Missing required --mode <deny|force_approval|read_only> and --reason <text>.\n");
      return 1;
    }
    const scope = scopeFromArgs(parsedArgs);
    if (!scope) {
      stderr.write("Provide exactly one kill-switch scope: --global, --provider, --capability, --domain, --risk, --tenant, --autonomy, or --provider with --model.\n");
      return 1;
    }
    const store = new LocalJsonControlsStore(parsedArgs.storePath);
    const killSwitch = {
      createdAt: new Date().toISOString(),
      expiresAt: parsedArgs.expiresAt,
      id: `ks_${Date.now().toString(36)}`,
      mode: parsedArgs.killSwitchMode,
      reason: parsedArgs.reason,
      scope
    };
    store.putKillSwitch(killSwitch);
    stdout.write(`${JSON.stringify(killSwitch, null, 2)}\n`);
    return 0;
  }

  stderr.write(`Unknown controls command "${argv.join(" ")}".\n\n${controlsHelpText()}`);
  return 1;
}

async function runGovernanceCli(argv: string[], options: CliRunOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const [subcommand] = argv;

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    stdout.write(governanceHelpText());
    return subcommand ? 0 : 1;
  }

  if (!["risk", "lifecycle", "compatibility", "impact"].includes(subcommand)) {
    stderr.write(`Unknown governance command "${subcommand}".\n\n${governanceHelpText()}`);
    return 1;
  }

  const parsedArgs = parseCommandArgs(argv.slice(1));
  if (parsedArgs.error) {
    stderr.write(`${parsedArgs.error}\n\n${governanceHelpText()}`);
    return 1;
  }

  if (parsedArgs.format !== "text" && parsedArgs.format !== "json") {
    stderr.write("Governance format must be text or json.\n");
    return 1;
  }

  if (subcommand === "compatibility") {
    if (!parsedArgs.beforePath || !parsedArgs.afterPath) {
      stderr.write("Missing required --before <file> and --after <file>.\n");
      return 1;
    }

    const before = await readCapabilityManifest(parsedArgs.beforePath);
    const after = await readCapabilityManifest(parsedArgs.afterPath);
    if (!before.ok || !after.ok) {
      stderr.write(`${[before.ok ? null : before.error, after.ok ? null : after.error].filter(Boolean).join("\n")}\n`);
      return 1;
    }

    const beforeValidation = validateManifests([{
      absolutePath: path.resolve(parsedArgs.beforePath),
      kind: "capability",
      manifest: before.value,
      path: parsedArgs.beforePath
    }]);
    const afterValidation = validateManifests([{
      absolutePath: path.resolve(parsedArgs.afterPath),
      kind: "capability",
      manifest: after.value,
      path: parsedArgs.afterPath
    }]);
    const validationErrors = [...beforeValidation.errors, ...afterValidation.errors];
    if (validationErrors.length > 0) {
      stderr.write(formatDiagnostics(validationErrors));
      return 1;
    }

    const diff = compareCapabilityVersions(before.value, after.value);
    stdout.write(parsedArgs.format === "json" ? `${JSON.stringify(diff, null, 2)}\n` : formatCompatibilityDiff(diff));
    return diff.compatibility === "breaking" ? 1 : 0;
  }

  const loaded = await loadValidatedRegistry(parsedArgs.targetPath ?? "examples");
  if (!loaded.ok) {
    stderr.write(formatDiagnostics(loaded.errors));
    return 1;
  }

  if (subcommand === "risk") {
    const capabilities = parsedArgs.capabilityId
      ? [loaded.registry.capabilityById.get(parsedArgs.capabilityId)]
      : loaded.registry.capabilities;
    if (capabilities.some((entry) => !entry)) {
      stderr.write(`Unknown capability id "${parsedArgs.capabilityId}".\n`);
      return 1;
    }

    const results = capabilities.map((entry) => compileCapabilityRisk(entry!.manifest, {
      entities: loaded.registry.entities.map((entity) => entity.manifest)
    }));
    stdout.write(parsedArgs.format === "json" ? `${JSON.stringify(results, null, 2)}\n` : formatRiskResults(results));
    return governanceExitCode(results.every((result) => result.passed), parsedArgs.strict, results.flatMap((result) => result.warnings));
  }

  if (subcommand === "lifecycle") {
    if (!parsedArgs.capabilityId || !parsedArgs.toStatus || !parsedArgs.reason) {
      stderr.write("Missing required --capability <id>, --to <status>, and --reason <text>.\n");
      return 1;
    }
    if (!isLifecycleStatus(parsedArgs.toStatus) || (parsedArgs.fromStatus && !isLifecycleStatus(parsedArgs.fromStatus))) {
      stderr.write("Lifecycle status must be draft, review, approved, canary, production, deprecated, disabled, or removed.\n");
      return 1;
    }

    const decision = evaluateLifecycleTransition(loaded.registry, {
      capabilityId: parsedArgs.capabilityId,
      from: parsedArgs.fromStatus as CapabilityLifecycleStatus | undefined,
      reason: parsedArgs.reason,
      to: parsedArgs.toStatus
    });
    stdout.write(parsedArgs.format === "json" ? `${JSON.stringify(decision, null, 2)}\n` : formatLifecycleDecision(decision));
    return governanceExitCode(decision.allowed, parsedArgs.strict, decision.warnings);
  }

  if (!parsedArgs.capabilityId) {
    stderr.write("Missing required --capability <id>.\n");
    return 1;
  }

  const report = analyzeCapabilityImpact(loaded.registry, parsedArgs.capabilityId);
  stdout.write(parsedArgs.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : formatImpactReport(report));
  return governanceExitCode(
    report.missingCoverage.every((gap) => gap.severity !== "blocking"),
    parsedArgs.strict,
    report.missingCoverage.filter((gap) => gap.severity === "warning")
  );
}

async function runGateCli(argv: string[], options: CliRunOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  if (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    stdout.write(gateHelpText());
    return 0;
  }

  const parsedArgs = parseCommandArgs(argv);
  if (parsedArgs.error) {
    stderr.write(`${parsedArgs.error}\n\n${gateHelpText()}`);
    return 2;
  }

  if (!parsedArgs.targetPath) {
    stderr.write(`Missing required <manifest-root>.\n\n${gateHelpText()}`);
    return 2;
  }

  if (parsedArgs.format !== "text" && parsedArgs.format !== "json") {
    stderr.write("Gate format must be text or json.\n");
    return 2;
  }

  try {
    const report = await runGovernanceGate({
      baselineRoot: parsedArgs.baselinePath,
      configPath: parsedArgs.configPath,
      environment: parsedArgs.environment,
      failOnWarnings: parsedArgs.failOnWarnings,
      includeArtifactHygiene: parsedArgs.artifactHygiene,
      manifestRoot: parsedArgs.targetPath
    });
    stdout.write(formatGovernanceGateReport(report, parsedArgs.format));
    return report.exitCode;
  } catch (error) {
    stderr.write(`Unexpected governance gate error: ${error instanceof Error ? error.message : "unknown error"}\n`);
    return 5;
  }
}

async function runEvidenceCli(argv: string[], options: CliRunOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const [subcommand] = argv;

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    stdout.write(evidenceHelpText());
    return subcommand ? 0 : 1;
  }

  if (subcommand !== "export") {
    stderr.write(`Unknown evidence command "${subcommand}".\n\n${evidenceHelpText()}`);
    return 1;
  }

  const parsedArgs = parseCommandArgs(argv.slice(1));
  if (parsedArgs.error) {
    stderr.write(`${parsedArgs.error}\n\n${evidenceHelpText()}`);
    return 1;
  }

  const format = parsedArgs.format === "text" ? "json" : parsedArgs.format;
  if (format !== "json" && format !== "markdown") {
    stderr.write("Evidence export format must be json or markdown.\n");
    return 1;
  }

  if (!parsedArgs.outPath) {
    stderr.write("Missing required --out <file>.\n");
    return 1;
  }

  if (isUnsafeEvidenceOutputPath(parsedArgs.outPath)) {
    stderr.write("Evidence output path must not target private, trace, prompt, provider-payload, credential, archive, or local-only paths.\n");
    return 1;
  }

  const loaded = await loadValidatedRegistry(parsedArgs.targetPath ?? "examples");
  if (!loaded.ok) {
    stderr.write(formatDiagnostics(loaded.errors));
    return 1;
  }

  const gateReport = parsedArgs.gateReportPath
    ? await readStructuredFile<GovernanceGateReport>(parsedArgs.gateReportPath, "governance gate report")
    : undefined;
  const conformanceReport = parsedArgs.conformanceReportPath
    ? await readStructuredFile<ProviderConformanceReport>(parsedArgs.conformanceReportPath, "provider conformance report")
    : undefined;
  const securityReport = parsedArgs.securityReportPath
    ? await readStructuredFile<SecurityPackCoverageReport>(parsedArgs.securityReportPath, "security-pack coverage report")
    : undefined;
  const incidentSummary = parsedArgs.incidentSummaryPath
    ? await readStructuredFile<EvidenceIncidentSummaryInput>(parsedArgs.incidentSummaryPath, "incident summary")
    : undefined;
  const modelUpgradeHistory = parsedArgs.modelUpgradesPath
    ? await readStructuredFile<ModelUpgradeRecord[] | { records?: ModelUpgradeRecord[] }>(parsedArgs.modelUpgradesPath, "model upgrade history")
    : undefined;
  const structuredInputs = [gateReport, conformanceReport, securityReport, incidentSummary, modelUpgradeHistory].filter((value) => value !== undefined);
  for (const input of structuredInputs) {
    if (input && !input.ok) {
      stderr.write(`${input.error}\n`);
      return 1;
    }
  }

  let evalSuiteResult: ReturnType<typeof runEvalSuite> | undefined;
  if (parsedArgs.evalResultsPath) {
    const loadedResults = await loadEvalResults(parsedArgs.evalResultsPath);
    if (loadedResults.errors.length > 0) {
      stderr.write(formatDiagnostics(loadedResults.errors));
      return 1;
    }
    evalSuiteResult = runEvalSuite(loaded.registry, loadedResults.results);
  }

  const upgradesValue = modelUpgradeHistory?.ok ? modelUpgradeHistory.value : undefined;
  const exportResult = exportEvidencePack({
    aicfVersion: await readPackageVersion(),
    conformanceReport: conformanceReport?.ok ? conformanceReport.value : undefined,
    environment: parsedArgs.environment,
    evalSuiteResult,
    gateReport: gateReport?.ok ? gateReport.value : undefined,
    incidentSummary: incidentSummary?.ok ? incidentSummary.value : undefined,
    modelUpgradeHistory: Array.isArray(upgradesValue) ? upgradesValue : upgradesValue?.records,
    project: {
      environment: parsedArgs.environment,
      id: parsedArgs.projectId,
      name: parsedArgs.projectName
    },
    registry: loaded.registry,
    securityReport: securityReport?.ok ? securityReport.value : undefined
  }, format as EvidenceExportFormat);

  const validation = validateEvidencePack(exportResult.pack);
  if (!validation.valid) {
    stderr.write(`Evidence pack failed schema validation:\n${validation.errors.join("\n")}\n`);
    return 1;
  }

  await mkdir(path.dirname(parsedArgs.outPath), { recursive: true });
  await writeFile(parsedArgs.outPath, exportResult.content, "utf8");
  stdout.write(`${JSON.stringify({
    capabilities: exportResult.pack.capabilityInventory.length,
    format,
    gaps: exportResult.pack.gaps.length,
    out: parsedArgs.outPath
  }, null, 2)}\n`);
  return 0;
}

async function runConformanceCli(argv: string[], options: CliRunOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const [subcommand] = argv;

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    stdout.write(conformanceHelpText());
    return subcommand ? 0 : 1;
  }

  if (subcommand !== "run" && subcommand !== "matrix") {
    stderr.write(`Unknown conformance command "${subcommand}".\n\n${conformanceHelpText()}`);
    return 1;
  }

  const parsedArgs = parseCommandArgs(argv.slice(1));
  if (parsedArgs.error) {
    stderr.write(`${parsedArgs.error}\n\n${conformanceHelpText()}`);
    return 1;
  }

  const parsedProviders = parseProviderConformanceTargets(parsedArgs.providerCsv);
  if (parsedProviders.errors.length > 0) {
    stderr.write(`${parsedProviders.errors.join("\n")}\n`);
    return 1;
  }

  const loaded = await loadValidatedRegistry(parsedArgs.targetPath ?? "examples");
  if (!loaded.ok) {
    stderr.write(formatDiagnostics(loaded.errors));
    return 1;
  }

  if (subcommand === "run") {
    if (parsedArgs.format !== "text" && parsedArgs.format !== "json") {
      stderr.write("Conformance run format must be text or json.\n");
      return 1;
    }

    const report = runProviderConformanceSuite({
      providers: parsedProviders.providers,
      registry: loaded.registry,
      serverUrl: parsedArgs.serverUrl
    });
    const output = formatProviderConformanceReport(report, parsedArgs.format);
    await writeCliOutput(output, parsedArgs.outPath, stdout);
    return report.passed ? 0 : 1;
  }

  const matrixFormat = parsedArgs.format === "text" ? "markdown" : parsedArgs.format;
  if (matrixFormat !== "markdown" && matrixFormat !== "json") {
    stderr.write("Conformance matrix format must be markdown or json.\n");
    return 1;
  }

  const matrix = buildProviderTargetMatrix({
    providers: parsedProviders.providers
  });
  await writeCliOutput(formatProviderTargetMatrix(matrix, matrixFormat), parsedArgs.outPath, stdout);
  return 0;
}

async function runProvidersCli(argv: string[], options: CliRunOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const [subcommand] = argv;

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    stdout.write(providerHelpText());
    return subcommand ? 0 : 1;
  }

  if (subcommand === "list") {
    stdout.write(`${JSON.stringify(listProviderTargets(), null, 2)}\n`);
    return 0;
  }

  if (subcommand === "conformance") {
    return runConformanceCli(["run", ...argv.slice(1)], { stderr, stdout });
  }

  if (!["conformance", "export-tools", "export-semantic-kernel-openapi"].includes(subcommand)) {
    stderr.write(`Unknown providers command "${subcommand}".\n\n${providerHelpText()}`);
    return 1;
  }

  const parsedArgs = parseCommandArgs(argv.slice(1));
  if (parsedArgs.error) {
    stderr.write(`${parsedArgs.error}\n\n${providerHelpText()}`);
    return 1;
  }

  const loaded = await loadValidatedRegistry(parsedArgs.targetPath ?? "examples");
  if (!loaded.ok) {
    stderr.write(formatDiagnostics(loaded.errors));
    return 1;
  }

  if (subcommand === "export-tools") {
    const normalizedProvider = parsedArgs.providerName ? normalizeProviderConformanceTarget(parsedArgs.providerName) : undefined;
    if (!parsedArgs.providerName || !isProviderConformanceTarget(parsedArgs.providerName) || !normalizedProvider) {
      stderr.write("Missing or invalid --provider. Use one of: openai, anthropic, gemini, ai-sdk, langchain, mcp, semantic-kernel-mcp.\n");
      return 1;
    }

    if (normalizedProvider === "semantic-kernel-openapi") {
      stderr.write("Use providers export-semantic-kernel-openapi for Semantic Kernel exports.\n");
      return 1;
    }

    if (!parsedArgs.contextPath) {
      stderr.write("Missing required --context <context.json>.\n");
      return 1;
    }

    const context = await readToolContext(parsedArgs.contextPath);
    if (!context.ok) {
      stderr.write(`${context.error}\n`);
      return 1;
    }

    const contextError = validateToolContextShape(context.value, "Provider");
    if (contextError) {
      stderr.write(`${contextError}\n`);
      return 1;
    }

    const exportResult = exportProviderTools({
      context: context.value,
      includeDiagnostics: parsedArgs.includeDiagnostics,
      includeRestricted: parsedArgs.includeRestricted,
      provider: normalizedProvider,
      registry: loaded.registry
    });
    return writeProviderExportResult(exportResult, parsedArgs.includeDiagnostics, stdout, stderr);
  }

  if (!parsedArgs.contextPath) {
    stderr.write("Missing required --context <context.json>.\n");
    return 1;
  }

  if (!parsedArgs.serverUrl) {
    stderr.write("Missing required --server-url <url>.\n");
    return 1;
  }

  const context = await readToolContext(parsedArgs.contextPath);
  if (!context.ok) {
    stderr.write(`${context.error}\n`);
    return 1;
  }

  const contextError = validateToolContextShape(context.value, "Semantic Kernel");
  if (contextError) {
    stderr.write(`${contextError}\n`);
    return 1;
  }

  const exportResult = exportProviderTools({
    context: context.value,
    includeDiagnostics: parsedArgs.includeDiagnostics,
    provider: "semantic-kernel-openapi",
    registry: loaded.registry,
    serverUrl: parsedArgs.serverUrl
  });
  return writeProviderExportResult(exportResult, parsedArgs.includeDiagnostics, stdout, stderr);
}

async function runReplayCli(argv: string[], options: CliRunOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const [subcommand] = argv;

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    stdout.write(replayHelpText());
    return subcommand ? 0 : 1;
  }

  if (subcommand !== "run") {
    stderr.write(`Unknown replay command "${subcommand}".\n\n${replayHelpText()}`);
    return 1;
  }

  const parsedArgs = parseCommandArgs(argv.slice(1));
  if (parsedArgs.error) {
    stderr.write(`${parsedArgs.error}\n\n${replayHelpText()}`);
    return 1;
  }

  if (!parsedArgs.targetPath) {
    stderr.write("Missing required <trace.json>.\n");
    return 1;
  }

  if (parsedArgs.format !== "text" && parsedArgs.format !== "json") {
    stderr.write("Replay format must be text or json.\n");
    return 1;
  }

  if (!isReplayMode(parsedArgs.mode)) {
    stderr.write("Replay mode must be deterministic_mock, policy_only, router_only, tool_validation_only, or provider_live.\n");
    return 1;
  }

  const trace = await readReplayTrace(parsedArgs.targetPath);
  if (!trace.ok) {
    stderr.write(`${trace.error}\n`);
    return 1;
  }

  let registry: ReturnType<typeof buildRegistry> | undefined;
  if (parsedArgs.manifestRoot) {
    const loaded = await loadValidatedRegistry(parsedArgs.manifestRoot);
    if (!loaded.ok) {
      stderr.write(formatDiagnostics(loaded.errors));
      return 1;
    }
    registry = loaded.registry;
  }

  const replayResult = await runReplay(trace.value, {
    mode: parsedArgs.mode,
    registry
  });
  stdout.write(parsedArgs.format === "json" ? `${JSON.stringify(replayResult, null, 2)}\n` : formatReplayResult(replayResult));
  return replayResult.status === "passed" ? 0 : 1;
}

async function runEvalsCli(argv: string[], options: CliRunOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const [subcommand] = argv;

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    stdout.write(evalsHelpText());
    return subcommand ? 0 : 1;
  }

  if (subcommand !== "create-from-trace") {
    stderr.write(`Unknown evals command "${subcommand}".\n\n${evalsHelpText()}`);
    return 1;
  }

  const parsedArgs = parseCommandArgs(argv.slice(1));
  if (parsedArgs.error) {
    stderr.write(`${parsedArgs.error}\n\n${evalsHelpText()}`);
    return 1;
  }

  if (!parsedArgs.targetPath || !parsedArgs.suiteId || !parsedArgs.outPath) {
    stderr.write("Missing required <trace.json>, --suite <id>, or --out <file>.\n");
    return 1;
  }

  const trace = await readReplayTrace(parsedArgs.targetPath);
  if (!trace.ok) {
    stderr.write(`${trace.error}\n`);
    return 1;
  }

  const evalDraft = createGoldenFromTrace(trace.value, {
    includeRawContent: parsedArgs.includeRawContent,
    requireReview: parsedArgs.requireReview,
    suiteId: parsedArgs.suiteId
  });
  await mkdir(path.dirname(parsedArgs.outPath), { recursive: true });
  await writeFile(parsedArgs.outPath, YAML.stringify(evalDraft), "utf8");
  stdout.write(`${JSON.stringify({
    eval_id: evalDraft.id,
    out: parsedArgs.outPath,
    review_required: parsedArgs.requireReview
  }, null, 2)}\n`);
  return 0;
}

async function runSecurityCli(argv: string[], options: CliRunOptions): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const [subcommand] = argv;

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    stdout.write(securityHelpText());
    return subcommand ? 0 : 1;
  }

  if (subcommand === "list-packs") {
    const parsedArgs = parseCommandArgs(argv.slice(1));
    if (parsedArgs.error) {
      stderr.write(`${parsedArgs.error}\n\n${securityHelpText()}`);
      return 1;
    }

    const packs = listSecurityPacks();
    stdout.write(parsedArgs.format === "json" ? `${JSON.stringify(packs, null, 2)}\n` : formatSecurityPacks(packs));
    return 0;
  }

  if (subcommand !== "generate" && subcommand !== "export-promptfoo") {
    stderr.write(`Unknown security command "${subcommand}".\n\n${securityHelpText()}`);
    return 1;
  }

  const parsedArgs = parseCommandArgs(argv.slice(1));
  if (parsedArgs.error) {
    stderr.write(`${parsedArgs.error}\n\n${securityHelpText()}`);
    return 1;
  }

  if (!parsedArgs.outPath) {
    stderr.write("Missing required --out <file>.\n");
    return 1;
  }
  const outputPath = parsedArgs.outPath;

  if (parsedArgs.packId && !getSecurityPack(parsedArgs.packId)) {
    stderr.write(`Unknown security pack id "${parsedArgs.packId}".\n`);
    return 1;
  }

  if (subcommand === "generate" && !parsedArgs.packId) {
    stderr.write("Missing required --pack <id>.\n");
    return 1;
  }

  const generationFormat = parsedArgs.format === "text" ? "yaml" : parsedArgs.format;
  if (subcommand === "generate" && generationFormat !== "yaml" && generationFormat !== "json") {
    stderr.write("Security generate format must be yaml or json.\n");
    return 1;
  }

  const loaded = await loadValidatedRegistry(parsedArgs.targetPath ?? "examples");
  if (!loaded.ok) {
    stderr.write(formatDiagnostics(loaded.errors));
    return 1;
  }

  const packIds = parsedArgs.packId ? [parsedArgs.packId as SecurityPackId] : undefined;
  if (subcommand === "generate") {
    const suite = generateSecurityCases(loaded.registry, { packIds });
    if (suite.cases.length === 0) {
      stderr.write(`No security cases were generated for pack "${parsedArgs.packId}".\n`);
      return 1;
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    const content = generationFormat === "json"
      ? `${JSON.stringify(suite, null, 2)}\n`
      : YAML.stringify(suite);
    await writeFile(outputPath, content, "utf8");
    stdout.write(`${JSON.stringify({
      cases: suite.cases.length,
      out: outputPath,
      pack_id: parsedArgs.packId
    }, null, 2)}\n`);
    return 0;
  }

  const exportResult = exportPromptfooSecurityPackSuite(loaded.registry, {
    outputPath: path.basename(outputPath),
    packIds,
    providerName: parsedArgs.providerName
  });
  if (exportResult.cases.length === 0) {
    stderr.write(parsedArgs.packId
      ? `No security cases were generated for pack "${parsedArgs.packId}".\n`
      : "No security cases were generated.\n");
    return 1;
  }

  const configFile = exportResult.files.find((file) => file.path === path.basename(outputPath))
    ?? exportResult.files[0];
  if (!configFile) {
    stderr.write("Security Promptfoo export did not produce a config file.\n");
    return 1;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, configFile.content, "utf8");
  stdout.write(`${JSON.stringify({
    cases: exportResult.cases.length,
    out: outputPath,
    provider: parsedArgs.providerName ?? "echo"
  }, null, 2)}\n`);
  return 0;
}

async function loadValidatedRegistry(targetPath: string): Promise<
  | { ok: true; registry: ReturnType<typeof buildRegistry> }
  | { errors: AicfDiagnostic[]; ok: false }
> {
  const loadResult = await loadManifests({ path: targetPath });
  const validation = validateManifests(loadResult.manifests);
  const fixtureValidation = validatePublicFixtures(loadResult.fixtures);
  const errors = [...loadResult.errors, ...validation.errors, ...fixtureValidation.errors];
  if (errors.length > 0) {
    return {
      errors,
      ok: false
    };
  }

  return {
    ok: true,
    registry: buildRegistry(loadResult.manifests)
  };
}

function writeProviderExportResult(
  exportResult: ReturnType<typeof exportProviderTools>,
  includeDiagnostics: boolean | undefined,
  stdout: WritableLike,
  stderr: WritableLike
): number {
  const fatalDiagnostics = exportResult.diagnostics.filter(isFatalProviderExportDiagnostic);
  const warnings = exportResult.diagnostics.filter((diagnostic) => !isFatalProviderExportDiagnostic(diagnostic));
  if (!includeDiagnostics && warnings.length > 0) {
    stderr.write(formatDiagnostics(warnings));
  }

  if (fatalDiagnostics.length > 0) {
    stderr.write(formatDiagnostics(fatalDiagnostics));
    return 1;
  }

  if (exportResult.exportedCount === 0) {
    stderr.write(`No ${exportResult.provider} provider tools were exportable.\n`);
    return 1;
  }

  const output = includeDiagnostics
    ? exportResult
    : {
      artifact: exportResult.artifact,
      bindings: exportResult.bindings,
      exportedCount: exportResult.exportedCount,
      provider: exportResult.provider,
      providerToolNames: exportResult.providerToolNames
    };
  stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return 0;
}

function isFatalProviderExportDiagnostic(diagnostic: AicfDiagnostic): boolean {
  return [
    "invalid_context",
    "provider_schema_unsupported",
    "provider_tool_name_collision",
    "schema",
    "tool_name_collision",
    "unsupported"
  ].includes(diagnostic.code);
}

function providerHelpText(): string {
  return [
    "Usage: aicf providers <command> [path]",
    "",
    "Commands:",
    "  providers list",
    "  providers conformance <path> [--format text|json]",
    "  providers export-tools <path> --provider <provider> --context <context.json> [--include-diagnostics]",
    "  providers export-semantic-kernel-openapi <path> --context <context.json> --server-url <url> [--include-diagnostics]",
    ""
  ].join("\n");
}

function conformanceHelpText(): string {
  return [
    "Usage: aicf conformance <command> [path]",
    "",
    "Commands:",
    "  conformance run <path> [--providers <csv>] [--format text|json] [--out <file>]",
    "  conformance matrix <path> [--providers <csv>] [--format markdown|json] [--out <file>]",
    ""
  ].join("\n");
}

function governanceHelpText(): string {
  return [
    "Usage: aicf governance <command> [path]",
    "",
    "Commands:",
    "  governance risk <path> [--capability <id>] [--format text|json] [--strict]",
    "  governance lifecycle <path> --capability <id> --to <status> --reason <text> [--from <status>] [--format text|json] [--strict]",
    "  governance compatibility --before <capability.yaml|json> --after <capability.yaml|json> [--format text|json]",
    "  governance impact <path> --capability <id> [--format text|json] [--strict]",
    ""
  ].join("\n");
}

function gateHelpText(): string {
  return [
    "Usage: aicf gate <manifest-root> --env <name> [--config <file>] [--baseline <path>] [--format text|json]",
    "",
    "Options:",
    "  --json                  Alias for --format json.",
    "  --fail-on-warnings      Treat warnings as gate failures.",
    "  --no-artifact-hygiene   Skip local public-artifact hygiene scanning.",
    ""
  ].join("\n");
}

function evidenceHelpText(): string {
  return [
    "Usage: aicf evidence <command> [path]",
    "",
    "Commands:",
    "  evidence export <manifest-root> --out <file> [--format json|markdown] [--project-id <id>] [--project-name <name>] [--environment <name>]",
    "",
    "Optional inputs:",
    "  --gate-report <json|yaml> --conformance-report <json|yaml> --eval-results <json> --security-report <json|yaml>",
    "  --model-upgrades <json|yaml> --incident-summary <json|yaml>",
    ""
  ].join("\n");
}

async function writeCliOutput(content: string, outPath: string | undefined, stdout: WritableLike): Promise<void> {
  if (!outPath) {
    stdout.write(content);
    return;
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, content, "utf8");
}

function controlsHelpText(): string {
  return [
    "Usage: aicf controls <command>",
    "",
    "Commands:",
    "  controls list [--store <file>] [--format text|json]",
    "  controls check <path> --capability <id> [--provider <provider>] [--model <model>] [--tenant <id>] [--risk <tier>] [--autonomy <tier>] [--format text|json]",
    "  controls kill-switch create --mode <deny|force_approval|read_only> --reason <text> --global|--provider <id>|--capability <id>|--domain <name>|--risk <tier>|--tenant <id>|--autonomy <tier> [--expires-at <iso>] [--store <file>]",
    ""
  ].join("\n");
}

function replayHelpText(): string {
  return [
    "Usage: aicf replay <command>",
    "",
    "Commands:",
    "  replay run <trace.json> --mode <deterministic_mock|policy_only|router_only|tool_validation_only|provider_live> [--manifest-root <path>] [--format text|json]",
    ""
  ].join("\n");
}

function evalsHelpText(): string {
  return [
    "Usage: aicf evals <command>",
    "",
    "Commands:",
    "  evals create-from-trace <trace.json> --suite <suite-id> --out <file> [--include-raw-content] [--no-require-review]",
    ""
  ].join("\n");
}

function securityHelpText(): string {
  return [
    "Usage: aicf security <command>",
    "",
    "Commands:",
    "  security list-packs [--format text|json]",
    "  security generate <manifest-root> --pack <pack-id> --out <file> [--format yaml|json]",
    "  security export-promptfoo <manifest-root> --out <file> [--provider <provider>] [--pack <pack-id>]",
    ""
  ].join("\n");
}

function formatSecurityPacks(packs: ReturnType<typeof listSecurityPacks>): string {
  const lines = [
    `AICF Security Packs (${packs.length})`
  ];
  for (const pack of packs) {
    lines.push(`- ${pack.id}: ${pack.name}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatControlsSnapshot(snapshot: ControlsSnapshot): string {
  return [
    "AICF Runtime Controls",
    `Kill switches: ${snapshot.killSwitches.length}`,
    `Circuit breaker policies: ${snapshot.circuitBreakerPolicies.length}`,
    `Circuit breaker states: ${snapshot.circuitBreakerStates.length}`,
    `Budget policies: ${snapshot.budgetPolicies.length}`,
    `Circuit breaker events: ${snapshot.circuitBreakerEvents.length}`,
    ""
  ].join("\n");
}

function formatControlDecision(decision: ControlDecision): string {
  const lines = [
    "AICF Runtime Control Check",
    `Decision: ${decision.status}`
  ];
  for (const reason of decision.reasons) {
    lines.push(`- ${reason.severity}: ${reason.code}: ${reason.message}`);
  }
  if (decision.reasons.length === 0) {
    lines.push("- allowed: no matching blocking controls");
  }
  return `${lines.join("\n")}\n`;
}

function formatReplayResult(result: ReplayResult): string {
  const lines = [
    `Replay ${result.mode} ${result.status}: ${result.summary.passed}/${result.summary.total} steps passed.`
  ];

  for (const diagnostic of result.diagnostics) {
    lines.push(`- ${diagnostic.code}: ${diagnostic.message}`);
  }

  for (const step of result.steps) {
    lines.push(`- ${step.status}: ${step.name}: ${step.message}`);
  }

  return `${lines.join("\n")}\n`;
}

function isKillSwitchMode(value: string | undefined): value is KillSwitchMode {
  return value === "deny" || value === "force_approval" || value === "read_only";
}

function isRiskTier(value: string | undefined): value is "none" | "low" | "medium" | "high" | "critical" {
  return value === "none" || value === "low" || value === "medium" || value === "high" || value === "critical";
}

function isAutonomyTier(value: string | undefined): value is "A0" | "A1" | "A2" | "A3" | "A4" | "A5" {
  return value === "A0" || value === "A1" || value === "A2" || value === "A3" || value === "A4" || value === "A5";
}

function isReplayMode(value: string | undefined): value is ReplayMode {
  return value === "deterministic_mock"
    || value === "policy_only"
    || value === "router_only"
    || value === "tool_validation_only"
    || value === "provider_live";
}

function scopeFromArgs(input: {
  autonomyTier?: string;
  capabilityId?: string;
  domain?: string;
  globalScope?: boolean;
  model?: string;
  providerName?: string;
  riskTier?: string;
  tenantId?: string;
}): AicfControlScope | null {
  const candidates: AicfControlScope[] = [];
  if (input.globalScope) {
    candidates.push({ type: "global" });
  }
  if (input.providerName && input.model) {
    candidates.push({ model: input.model, providerId: input.providerName, type: "model" });
  } else if (input.providerName) {
    candidates.push({ providerId: input.providerName, type: "provider" });
  }
  if (input.capabilityId) {
    candidates.push({ capabilityId: input.capabilityId, type: "capability" });
  }
  if (input.domain) {
    candidates.push({ domain: input.domain, type: "domain" });
  }
  if (isRiskTier(input.riskTier)) {
    candidates.push({ riskTier: input.riskTier, type: "risk_tier" });
  }
  if (input.tenantId) {
    candidates.push({ tenantId: input.tenantId, type: "tenant" });
  }
  if (isAutonomyTier(input.autonomyTier)) {
    candidates.push({ autonomyTier: input.autonomyTier, type: "autonomy_tier" });
  }

  return candidates.length === 1 ? candidates[0] ?? null : null;
}

function governanceExitCode(
  passed: boolean,
  strict: boolean | undefined,
  warnings: Array<{ severity?: string }>
): number {
  if (!passed) {
    return 1;
  }
  if (strict && warnings.length > 0) {
    return 1;
  }
  return 0;
}

function isLifecycleStatus(value: string): value is CapabilityLifecycleStatus {
  return ["draft", "review", "approved", "canary", "production", "deprecated", "disabled", "removed"].includes(value);
}

function formatRiskResults(results: Array<ReturnType<typeof compileCapabilityRisk>>): string {
  const lines = ["AICF Governance Risk"];
  for (const result of results) {
    lines.push(
      "",
      `- ${result.capabilityId}: ${result.passed ? "passed" : "failed"} declared=${result.declaredRiskTier} inferred=${result.inferredMinimumRiskTier}`
    );
    for (const reason of result.reasons) {
      lines.push(`  - ${reason.severity}: ${reason.code}: ${reason.message}`);
    }
    for (const warning of result.warnings) {
      lines.push(`  - warning: ${warning.code}: ${warning.message}`);
    }
    const missingControls = result.requiredControls.filter((control) => control.required && !control.present);
    for (const control of missingControls) {
      lines.push(`  - missing control: ${control.code}: ${control.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatLifecycleDecision(decision: ReturnType<typeof evaluateLifecycleTransition>): string {
  const lines = [
    "AICF Governance Lifecycle",
    `Transition: ${decision.from} -> ${decision.to}`,
    `Decision: ${decision.allowed ? "allowed" : "blocked"}`
  ];
  for (const reason of decision.reasons) {
    lines.push(`- ${reason.severity}: ${reason.code}: ${reason.message}`);
  }
  for (const requiredAction of decision.requiredActions) {
    lines.push(`- required: ${requiredAction.code}: ${requiredAction.message}`);
  }
  for (const warning of decision.warnings) {
    lines.push(`- warning: ${warning.code}: ${warning.message}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatCompatibilityDiff(diff: ReturnType<typeof compareCapabilityVersions>): string {
  const lines = [
    "AICF Governance Compatibility",
    `Capability: ${diff.capabilityId}`,
    `Versions: ${diff.fromVersion} -> ${diff.toVersion}`,
    `Compatibility: ${diff.compatibility}`
  ];
  for (const change of diff.changes) {
    lines.push(`- ${change.compatibility}: ${change.code}: ${change.message}`);
  }
  for (const action of diff.requiredActions) {
    lines.push(`- required: ${action.code}: ${action.message}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatImpactReport(report: ReturnType<typeof analyzeCapabilityImpact>): string {
  const lines = [
    "AICF Governance Impact",
    `Capability: ${report.capabilityId}`,
    `Affected capabilities: ${formatInlineList(report.affectedCapabilities)}`,
    `Affected entities: ${formatInlineList(report.affectedEntities)}`,
    `Affected evals: ${formatInlineList(report.affectedEvalSuites)}`,
    `Affected providers: ${formatInlineList(report.affectedProviders)}`,
    `Affected policies: ${formatInlineList(report.affectedPolicies)}`
  ];
  for (const gap of report.missingCoverage) {
    lines.push(`- ${gap.severity}: ${gap.code}: ${gap.message}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatInlineList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

async function readStructuredFile<TValue>(filePath: string, label: string): Promise<
  | { ok: true; value: TValue }
  | { error: string; ok: false }
> {
  try {
    const content = await readFile(filePath, "utf8");
    const value = path.extname(filePath).toLowerCase() === ".json"
      ? JSON.parse(content)
      : YAML.parse(content);
    return {
      ok: true,
      value: value as TValue
    };
  } catch (error) {
    return {
      error: `Unable to read ${label}: ${error instanceof Error ? error.message : "unknown error"}`,
      ok: false
    };
  }
}

async function readPackageVersion(): Promise<string> {
  try {
    const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version.length > 0 ? packageJson.version : "unknown";
  } catch {
    return "unknown";
  }
}

function isUnsafeEvidenceOutputPath(outputPath: string): boolean {
  const normalized = outputPath.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/");
  const forbiddenSegments = new Set([
    ".aicf",
    "_private",
    "dist-source",
    "generated-docs",
    "logs",
    "private",
    "prompts",
    "traces"
  ]);
  const forbiddenExtensions = new Set([".docx", ".pdf", ".pptx", ".tgz", ".xlsx", ".zip"]);
  if (segments.some((segment) => forbiddenSegments.has(segment))) {
    return true;
  }
  if (normalized.includes("provider-payload") || normalized.includes("raw-payload")) {
    return true;
  }
  if (normalized.includes("credential") || normalized.includes("api-key") || normalized.includes("apikey") || normalized.includes("access-token")) {
    return true;
  }
  return forbiddenExtensions.has(path.extname(normalized));
}

async function readCapabilityManifest(filePath: string): Promise<
  | { ok: true; value: CapabilityManifest }
  | { error: string; ok: false }
> {
  try {
    const content = await readFile(filePath, "utf8");
    const value = path.extname(filePath).toLowerCase() === ".json"
      ? JSON.parse(content)
      : YAML.parse(content);
    return {
      ok: true,
      value: value as CapabilityManifest
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to read capability manifest.",
      ok: false
    };
  }
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

async function readLiveEvalCases(filePath: string): Promise<
  | { ok: true; value: AicfLiveEvalCaseInput[] }
  | { error: string; ok: false }
> {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    const cases = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { cases?: unknown }).cases)
        ? (parsed as { cases: unknown[] }).cases
        : null;

    if (!cases) {
      return {
        error: "Live eval cases file must be a JSON array or an object with cases[].",
        ok: false
      };
    }

    return {
      ok: true,
      value: cases as AicfLiveEvalCaseInput[]
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to read live eval cases.",
      ok: false
    };
  }
}

async function readReplayTrace(filePath: string): Promise<
  | { ok: true; value: ReplayTrace }
  | { error: string; ok: false }
> {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    const validation = validateReplayTrace(parsed, filePath);
    if (!validation.valid) {
      return {
        error: formatDiagnostics(validation.diagnostics).trimEnd(),
        ok: false
      };
    }

    return {
      ok: true,
      value: parsed as ReplayTrace
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to read replay trace.",
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

function formatLiveEvalResults(
  results: Array<{ evalId: string; status: string }>,
  gate: { averageScore: number; status: string }
): string {
  const lines = [
    `Live eval gate ${gate.status}: average score ${gate.averageScore.toFixed(3)}.`
  ];
  for (const result of results) {
    lines.push(`- ${result.status}: ${result.evalId}`);
  }

  return `${lines.join("\n")}\n`;
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
