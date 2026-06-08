import path from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildAiSdkTools,
  buildAnthropicClaudeTools,
  buildGeminiFunctionDeclarations,
  buildLangChainToolDescriptors,
  buildMcpToolDescriptors,
  buildOpenAIResponsesTools,
  buildRegistry,
  buildSemanticKernelFunctions,
  decideCapability,
  deniedToolResult,
  formatInspection,
  loadEvalResults,
  inspectRegistry,
  loadManifests,
  okToolResult,
  parseAiSdkToolCall,
  parseAnthropicClaudeToolUse,
  parseGeminiFunctionCall,
  parseLangChainToolCall,
  parseMcpToolCall,
  parseOpenAIResponsesToolCall,
  parseSemanticKernelFunctionCall,
  runEvalSuite,
  runCli,
  scoreEvalCase,
  selectCapabilitySlice,
  toModelFacingToolResult,
  toAiSdkToolName,
  toAnthropicClaudeToolName,
  toGeminiFunctionName,
  toLangChainToolName,
  toMcpToolName,
  toOpenAIResponsesToolName,
  toSemanticKernelFunctionName,
  validateManifests,
  validatePublicFixtures,
  type AicfToolResultEnvelope,
  type CapabilityManifest,
  type DecisionRequest,
  type EvalCandidateResult,
  type EvalCase,
  type LoadedCapabilityManifest,
  type LoadedEvalCase,
  type LoadedManifest
} from "../index.js";

describe("AICF core", () => {
  it("loads and validates the public examples", async () => {
    const loaded = await loadManifests({ path: "examples" });
    const validation = validateManifests(loaded.manifests);

    expect(loaded.errors).toEqual([]);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(loaded.manifests).toHaveLength(16);
  });

  it("builds a registry and inspect summary for the public examples", async () => {
    const loaded = await loadManifests({ path: "examples" });
    const registry = buildRegistry(loaded.manifests);
    const inspection = inspectRegistry(registry);
    const output = formatInspection(inspection);

    expect(registry.capabilityById.has("support.ticket.get")).toBe(true);
    expect(registry.capabilityById.has("scheduling.invite.prepare")).toBe(true);
    expect(registry.entityById.has("Ticket")).toBe(true);
    expect(registry.entityById.has("MeetingInvite")).toBe(true);
    expect(registry.evalById.has("support.refund.prepare_case.valid")).toBe(true);
    expect(registry.evalById.has("scheduling.invite.prepare.valid")).toBe(true);
    expect(inspection.counts).toEqual({
      capabilities: 6,
      entities: 4,
      evals: 6,
      manifests: 16
    });
    expect(output).toContain("support.refund.prepare_case");
    expect(output).toContain("scheduling.invite.prepare");
    expect(output).toContain("Warnings:\n- none");
  });

  it("reports schema validation failures with structured diagnostics", async () => {
    const invalidManifest = {
      absolutePath: path.resolve("test/invalid/capabilities/invalid.yaml"),
      kind: "capability",
      manifest: {
        id: "support.invalid.missing_required_fields"
      },
      path: "test/invalid/capabilities/invalid.yaml"
    } as LoadedManifest;

    const validation = validateManifests([invalidManifest]);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.code === "schema")).toBe(true);
    expect(validation.errors[0]).toMatchObject({
      kind: "capability",
      path: "test/invalid/capabilities/invalid.yaml"
    });
  });

  it("reports missing eval references", async () => {
    const loaded = await loadManifests({ path: "examples" });
    const capability = loaded.manifests.find(
      (manifest) => manifest.kind === "capability" && manifest.manifest.id === "support.refund.prepare_case"
    );
    if (!capability) {
      throw new Error("Expected support.refund.prepare_case example capability.");
    }

    const missingReference = {
      ...capability,
      manifest: {
        ...capability.manifest,
        evals: {
          golden: ["../evals/missing.yaml"]
        }
      }
    } as LoadedManifest;

    const validation = validateManifests([
      ...loaded.manifests.filter((manifest) => manifest !== capability),
      missingReference
    ]);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(expect.objectContaining({
      code: "missing_reference",
      id: "support.refund.prepare_case"
    }));
  });

  it("reports duplicate IDs within the same manifest kind", async () => {
    const loaded = await loadManifests({ path: "examples" });
    const capability = loaded.manifests.find(
      (manifest) => manifest.kind === "capability" && manifest.manifest.id === "support.ticket.get"
    );
    if (!capability) {
      throw new Error("Expected support.ticket.get example capability.");
    }

    const duplicate = {
      ...capability,
      absolutePath: path.resolve("test/duplicate/capabilities/support.ticket.get.yaml"),
      path: "test/duplicate/capabilities/support.ticket.get.yaml"
    } as LoadedManifest;

    const validation = validateManifests([...loaded.manifests, duplicate]);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(expect.objectContaining({
      code: "duplicate_id",
      id: "support.ticket.get"
    }));
  });
});

describe("AICF CLI", () => {
  it("validates examples with exit code 0", async () => {
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();

    const exitCode = await runCli(["validate", "examples"], { stderr, stdout });

    expect(exitCode).toBe(0);
    expect(stdout.value).toContain("Validated 16 manifest(s) and 18 fixture(s).");
    expect(stderr.value).toBe("");
  });

  it("inspects examples with readable counts and IDs", async () => {
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();

    const exitCode = await runCli(["inspect", "examples"], { stderr, stdout });

    expect(exitCode).toBe(0);
    expect(stdout.value).toContain("Manifests: 16 (6 capabilities, 4 entities, 6 evals)");
    expect(stdout.value).toContain("support.ticket.get");
    expect(stdout.value).toContain("scheduling.invite.prepare");
    expect(stdout.value).toContain("Warnings:\n- none");
    expect(stderr.value).toBe("");
  });

  it("exports OpenAI Responses tools with exit code 0", async () => {
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();

    const exitCode = await runCli([
      "openai-tools",
      "examples",
      "--context",
      "examples/support/openai/context.support_agent.json"
    ], { stderr, stdout });
    const parsed = JSON.parse(stdout.value) as {
      bindings: Array<{ capabilityId: string }>;
      excluded: Array<{ capabilityId: string; reason: string }>;
      tools: unknown[];
    };

    expect(exitCode).toBe(0);
    expect(stderr.value).toBe("");
    expect(parsed.tools).toHaveLength(2);
    expect(parsed.bindings.map((binding) => binding.capabilityId)).toEqual([
      "support.refund.prepare_case",
      "support.ticket.get"
    ]);
    expect(parsed.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "support.refund.commit_case",
      reason: "restricted"
    }));
  });

  it("returns nonzero when OpenAI tool export is missing context", async () => {
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();

    const exitCode = await runCli(["openai-tools", "examples"], { stderr, stdout });

    expect(exitCode).toBe(1);
    expect(stdout.value).toBe("");
    expect(stderr.value).toContain("Missing required --context");
  });

  it("exports each non-OpenAI adapter from the CLI", async () => {
    for (const command of [
      "anthropic-tools",
      "gemini-tools",
      "ai-sdk-tools",
      "mcp-tools",
      "langchain-tools",
      "semantic-kernel-functions"
    ]) {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await runCli([
        command,
        "examples",
        "--context",
        "examples/support/openai/context.support_agent.json"
      ], { stderr, stdout });
      const parsed = JSON.parse(stdout.value) as {
        bindings: Array<{ capabilityId: string }>;
        excluded: Array<{ capabilityId: string; reason: string }>;
        functionDeclarations?: unknown[];
        functions?: unknown[];
        tools?: Record<string, unknown> | unknown[];
      };

      expect(exitCode, command).toBe(0);
      expect(stderr.value, command).toBe("");
      expect(adapterExportedCount(parsed), command).toBe(2);
      expect(parsed.bindings.map((binding) => binding.capabilityId), command).toEqual([
        "support.refund.prepare_case",
        "support.ticket.get"
      ]);
      expect(parsed.excluded, command).toContainEqual(expect.objectContaining({
        capabilityId: "support.refund.commit_case",
        reason: "restricted"
      }));
    }
  });

  it("runs deterministic evals with text and JSON output", async () => {
    const textStdout = createWritableBuffer();
    const textStderr = createWritableBuffer();
    const jsonStdout = createWritableBuffer();
    const jsonStderr = createWritableBuffer();

    const textExitCode = await runCli([
      "eval",
      "examples",
      "--results",
      "examples/eval-results/public.results.passing.json"
    ], { stderr: textStderr, stdout: textStdout });
    const jsonExitCode = await runCli([
      "eval",
      "examples",
      "--results",
      "examples/eval-results/public.results.passing.json",
      "--format",
      "json"
    ], { stderr: jsonStderr, stdout: jsonStdout });
    const parsed = JSON.parse(jsonStdout.value) as { status: string; summary: { total: number } };

    expect(textExitCode).toBe(0);
    expect(textStdout.value).toContain("Eval suite passed: 6/6 passed.");
    expect(textStderr.value).toBe("");
    expect(jsonExitCode).toBe(0);
    expect(parsed.status).toBe("passed");
    expect(parsed.summary.total).toBe(6);
    expect(jsonStderr.value).toBe("");
  });

  it("returns nonzero when deterministic evals fail", async () => {
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();
    const fixturePath = await writeTemporaryEvalResults({
      schema_version: "1.0",
      results: [{
        eval_id: "support.refund.prepare_case.valid",
        selected_capabilities: ["support.refund.commit_case"],
        action_state: "committed",
        committed_capabilities: ["support.refund.commit_case"]
      }]
    });

    const exitCode = await runCli([
      "eval",
      "examples",
      "--results",
      fixturePath
    ], { stderr, stdout });

    expect(exitCode).toBe(1);
    expect(stdout.value).toContain("Eval suite failed:");
    expect(stderr.value).toBe("");
  });
});

describe("AICF release readiness", () => {
  it("built package exports include the expected public API surface", async () => {
    const builtPackage = await import("../../dist/index.js") as Record<string, unknown>;
    const expectedExports = [
      "buildAiSdkTools",
      "buildAnthropicClaudeTools",
      "buildGeminiFunctionDeclarations",
      "buildLangChainToolDescriptors",
      "buildMcpToolDescriptors",
      "buildOpenAIResponsesTools",
      "buildRegistry",
      "buildSemanticKernelFunctions",
      "decideCapability",
      "deniedToolResult",
      "approvalRequiredToolResult",
      "evaluateLifecycle",
      "evaluatePolicy",
      "errorToolResult",
      "formatEvalSuiteResult",
      "formatInspection",
      "inspectRegistry",
      "kindFromPath",
      "loadEvalResults",
      "loadManifests",
      "okToolResult",
      "parseAiSdkToolCall",
      "parseAnthropicClaudeToolUse",
      "parseGeminiFunctionCall",
      "parseLangChainToolCall",
      "parseMcpToolCall",
      "parseOpenAIResponsesToolCall",
      "parseSemanticKernelFunctionCall",
      "runCli",
      "runEvalSuite",
      "scoreEvalCase",
      "selectCapabilitySlice",
      "toModelFacingToolResult",
      "toAiSdkToolName",
      "toAnthropicClaudeToolName",
      "toGeminiFunctionName",
      "toLangChainToolName",
      "toMcpToolName",
      "toOpenAIResponsesToolName",
      "toSemanticKernelFunctionName",
      "unavailableToolResult",
      "validateCapabilityInvariants",
      "validateManifests",
      "validatePublicFixtures"
    ];

    for (const exportName of expectedExports) {
      expect(builtPackage[exportName], exportName).toEqual(expect.any(Function));
    }
  });

  it("built CLI binary exists and help lists all public commands", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      bin: { aicf: string };
    };
    const cliPath = packageJson.bin.aicf.replace(/^\.\//, "");
    const cliContent = await readFile(cliPath, "utf8");
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();

    const exitCode = await runCli(["help"], { stderr, stdout });

    expect(cliContent).toContain("#!/usr/bin/env node");
    expect(exitCode).toBe(0);
    expect(stderr.value).toBe("");
    for (const command of [
      "validate",
      "inspect",
      "decide",
      "openai-tools",
      "anthropic-tools",
      "gemini-tools",
      "ai-sdk-tools",
      "mcp-tools",
      "langchain-tools",
      "semantic-kernel-functions",
      "conformance run",
      "conformance matrix",
      "providers list",
      "providers conformance",
      "providers export-tools",
      "providers export-semantic-kernel-openapi",
      "gate",
      "evidence export",
      "governance risk",
      "governance lifecycle",
      "governance compatibility",
      "governance impact",
      "controls list",
      "controls check",
      "controls kill-switch create",
      "replay run",
      "evals create-from-trace",
      "security list-packs",
      "security generate",
      "security export-promptfoo",
      "eval",
      "eval-live",
      "export promptfoo"
    ]) {
      expect(stdout.value).toContain(command);
    }
  });

  it("package dry-run contains public assets and excludes private or source-only material", () => {
    const files = packageDryRunFiles();
    const requiredFiles = [
      "CHANGELOG.md",
      "CODE_OF_CONDUCT.md",
      "CONTRIBUTING.md",
      "GOVERNANCE.md",
      "LICENSE",
      "ROADMAP.md",
      "README.md",
      "SECURITY.md",
      "conformance/valid/capabilities/conformance.note.get.yaml",
      "conformance/invalid/schema/capabilities/conformance.invalid.missing_required.yaml",
      "dist/index.js",
      "dist/cli.js",
      "dist/audit/index.js",
      "dist/aws/index.js",
      "dist/conformance/index.js",
      "dist/control-plane/index.js",
      "dist/controls/index.js",
      "dist/evidence/index.js",
      "dist/evalops/index.js",
      "dist/evals-live/index.js",
      "dist/governance/index.js",
      "dist/langfuse/index.js",
      "dist/memory/index.js",
      "dist/mcp-server/index.js",
      "dist/observability/index.js",
      "dist/openai/index.js",
      "dist/provenance/index.js",
      "dist/promptfoo/index.js",
      "dist/replay/index.js",
      "dist/providers/ai-sdk/index.js",
      "dist/providers/index.js",
      "dist/providers/anthropic/index.js",
      "dist/providers/conformance/index.js",
      "dist/providers/gemini/index.js",
      "dist/providers/langchain/index.js",
      "dist/providers/mcp/index.js",
      "dist/providers/semantic-kernel/index.js",
      "dist/runtime/index.js",
      "dist/security/index.js",
      "dist/security-packs/index.js",
      "docs/action-lifecycle.md",
      "docs/adapters.md",
      "docs/ai-sdk-runtime.md",
      "docs/api.md",
      "docs/architecture/current-state.md",
      "docs/assets/aicf-logo.svg",
      "docs/assets/aicf-mark.svg",
      "docs/audit/index.md",
      "docs/anthropic-runtime.md",
      "docs/aws/cloudwatch-telemetry.md",
      "docs/aws/dynamodb-single-table.md",
      "docs/aws/kms-redaction.md",
      "docs/aws/production-reference.md",
      "docs/aws/step-functions-approval.md",
      "docs/aws-runtime.md",
      "docs/controls/index.md",
      "docs/control-plane.md",
      "docs/eval-runner.md",
      "docs/evidence.md",
      "docs/glossary.md",
      "docs/index.md",
      "docs/core/capability-manifests.md",
      "docs/core/entity-manifests.md",
      "docs/control-plane/overview.md",
      "docs/evals/golden-tests.md",
      "docs/evals/overview.md",
      "docs/getting-started/concepts.md",
      "docs/getting-started/installation.md",
      "docs/getting-started/quickstart.md",
      "docs/governance/gate.md",
      "docs/governance/impact-and-compatibility.md",
      "docs/governance/index.md",
      "docs/governance/lifecycle.md",
      "docs/governance/overview.md",
      "docs/governance/risk-compiler.md",
      "docs/gemini-runtime.md",
      "docs/getting-started.md",
      "docs/implementation-notes/baseline-gaps.md",
      "docs/langchain-runtime.md",
      "docs/semantic-kernel-runtime.md",
      "docs/host-responsibilities.md",
      "docs/interoperability.md",
      "docs/migration-0.1-to-1.0.md",
      "docs/live-evals.md",
      "docs/memory.md",
      "docs/mcp-server-runtime.md",
      "docs/observability-runtime.md",
      "docs/openai-walkthrough.md",
      "docs/openai-responses.md",
      "docs/openai-runtime.md",
      "docs/policy-broker.md",
      "docs/provenance.md",
      "docs/provider-conformance.md",
      "docs/observability/overview.md",
      "docs/public-framework/compatibility-policy.md",
      "docs/public-framework/deprecation-policy.md",
      "docs/public-framework/release-process.md",
      "docs/public-framework/security-disclosure.md",
      "docs/public-framework/v1-certification.md",
      "docs/providers/anthropic.md",
      "docs/providers/conformance.md",
      "docs/providers/gemini.md",
      "docs/providers/langchain-langgraph.md",
      "docs/providers/mcp.md",
      "docs/providers/openai.md",
      "docs/providers/semantic-kernel.md",
      "docs/providers/vercel-ai-sdk.md",
      "docs/providers.md",
      "docs/runtime/action-lifecycle.md",
      "docs/runtime/policy-broker.md",
      "docs/runtime/runtime-overview.md",
      "docs/runtime/tool-result-envelope.md",
      "docs/evals/replay-and-trace-to-golden.md",
      "docs/evalops.md",
      "docs/runtime.md",
      "docs/security/trust-taint-redaction.md",
      "docs/security/overview.md",
      "docs/security/security-packs.md",
      "docs/start-here.md",
      "examples/eval-results/public.results.passing.json",
      "examples/aws/README.md",
      "examples/control-plane/README.md",
      "examples/control-plane/fixtures/control-plane.seed.json",
      "examples/control-plane/public/index.html",
      "examples/control-plane/server.mjs",
      "examples/providers/ai-sdk-next/README.md",
      "examples/providers/anthropic-claude/README.md",
      "examples/providers/gemini/README.md",
      "examples/providers/langchain-agent/README.md",
      "examples/providers/langgraph-tool-node/README.md",
      "examples/providers/mcp/README.md",
      "examples/providers/provider-conformance/README.md",
      "examples/providers/semantic-kernel-mcp/README.md",
      "examples/providers/semantic-kernel-openapi/README.md",
      "examples/01-basic-read-capability/README.md",
      "examples/02-prepare-approve-commit/README.md",
      "examples/03-multi-provider-tools/README.md",
      "examples/04-mcp-server/README.md",
      "examples/05-langchain-langgraph-bridge/README.md",
      "examples/06-vercel-ai-sdk-bridge/README.md",
      "examples/07-policy-broker-custom-auth/README.md",
      "examples/08-aws-step-functions-approval/README.md",
      "examples/09-security-packs-promptfoo/README.md",
      "examples/10-trace-to-golden/README.md",
      "examples/11-control-plane/README.md",
      "examples/aicf.config.yaml",
      "examples/runtime-support-billing/README.md",
      "examples/runtime-support-billing/run-mock.mjs",
      "examples/runtime-support-billing/support-billing-runtime.mjs",
      "examples/semantic-kernel-mcp/README.md",
      "examples/semantic-kernel-openapi/README.md",
      "examples/scheduling/capabilities/scheduling.invite.prepare.yaml",
      "examples/support/capabilities/support.ticket.get.yaml",
      "examples/support/eval-results/support.results.passing.json",
      "examples/support/memory/support.agent.preferences.json",
      "examples/support/provenance/support.refund.summary.provenance.json",
      "examples/support/replay/support.refund.approval_required.trace.json",
      "schemas/adapter-context.schema.json",
      "schemas/audit/action-record.schema.json",
      "schemas/audit/approval-record.schema.json",
      "schemas/audit/idempotency-record.schema.json",
      "schemas/audit/policy-decision-record.schema.json",
      "schemas/aws/approval-task.schema.json",
      "schemas/aws/budget-usage.schema.json",
      "schemas/aws/dynamodb-item.schema.json",
      "schemas/aws/telemetry-event.schema.json",
      "schemas/capability-manifest.schema.json",
      "schemas/conformance/conformance-case.schema.json",
      "schemas/conformance/conformance-report.schema.json",
      "schemas/conformance/provider-target-matrix.schema.json",
      "schemas/control-plane/state.schema.json",
      "schemas/controls/budget-policy.schema.json",
      "schemas/controls/circuit-breaker-policy.schema.json",
      "schemas/controls/control-decision.schema.json",
      "schemas/controls/kill-switch.schema.json",
      "schemas/decision-request.schema.json",
      "schemas/entity-manifest.schema.json",
      "schemas/eval-case.schema.json",
      "schemas/evalops/braintrust-dataset.schema.json",
      "schemas/evalops/openai-eval-dataset.schema.json",
      "schemas/evidence/evidence-export-input.schema.json",
      "schemas/evidence/evidence-pack.schema.json",
      "schemas/eval-result.schema.json",
      "schemas/governance/compatibility-diff.schema.json",
      "schemas/governance/gate-config.schema.json",
      "schemas/governance/gate-report.schema.json",
      "schemas/governance/impact-report.schema.json",
      "schemas/governance/lifecycle-transition.schema.json",
      "schemas/governance/risk-compilation-result.schema.json",
      "schemas/memory/governed-memory-fixture.schema.json",
      "schemas/memory/governed-memory-record.schema.json",
      "schemas/provenance/generated-content-provenance.schema.json",
      "schemas/provenance/provenance-adapter-hook-result.schema.json",
      "schemas/replay/replay-result.schema.json",
      "schemas/replay/replay-trace.schema.json",
      "schemas/replay/trace-to-golden-options.schema.json",
      "schemas/security/context-segment.schema.json",
      "schemas/security/redaction-policy.schema.json",
      "schemas/security/retention-policy.schema.json",
      "schemas/security/source-ref.schema.json",
      "schemas/security-packs/coverage-report.schema.json",
      "schemas/security-packs/promptfoo-red-team-config.schema.json",
      "schemas/security-packs/security-case-suite.schema.json",
      "schemas/security-packs/security-pack.schema.json",
      "security-packs/approval_bypass.yaml",
      "security-packs/prompt_injection_direct.yaml",
      "security-packs/unsafe_commit_attempt.yaml",
      "schemas/tool-result-envelope.schema.json"
    ];

    for (const file of requiredFiles) {
      expect(files).toContain(file);
    }

    expect(files.some((file) => file.startsWith("_private/"))).toBe(false);
    expect(files.some((file) => file.startsWith("node_modules/"))).toBe(false);
    expect(files.some((file) => file.startsWith("src/"))).toBe(false);
    expect(files.some((file) => file.startsWith("scripts/"))).toBe(false);
    expect(files.some((file) => file.startsWith("traces/"))).toBe(false);
    expect(files.some((file) => file.startsWith("prompts/"))).toBe(false);
    expect(files.some((file) => file.endsWith(".tgz"))).toBe(false);
    expect(files.some((file) => file.toLowerCase().includes("provider-payload"))).toBe(false);
    expect(files.some((file) => file.toLowerCase().includes("credential"))).toBe(false);
  });

  it("package scripts include runtime, optional, and release gates", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["check:runtime"]).toContain("src/__tests__/runtime");
    expect(packageJson.scripts["check:runtime"]).toContain("src/__tests__/examples");
    expect(packageJson.scripts["typecheck"]).toBe("tsc -p tsconfig.json --noEmit");
    expect(packageJson.scripts["archive:source"]).toBe("node scripts/create-source-archive.mjs");
    expect(packageJson.scripts["docs:api"]).toBe("typedoc --options typedoc.json");
    expect(packageJson.scripts["docs:build"]).toContain("npm run docs:api");
    expect(packageJson.scripts["docs:build"]).toContain("npm run check:docs");
    expect(packageJson.scripts["check:docs"]).toBe("node scripts/check-docs.mjs");
    expect(packageJson.scripts["check:public"]).toContain("npm run check:package-public");
    expect(packageJson.scripts["check:public"]).toContain("npm run check:workspace-public");
    expect(packageJson.scripts["check:public"]).toContain("npm run check:secrets");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:generated");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:public");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:runtime");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:optional");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:providers:mock");
    expect(packageJson.scripts["check:certification"]).toContain("node scripts/check-certification.mjs");
    expect(packageJson.scripts["check:git-clean"]).toBe("node scripts/check-git-clean.mjs");
    expect(packageJson.scripts["check:source-archive"]).toBe("node scripts/check-source-archive.mjs");
    expect(packageJson.scripts["check:release-source"]).toContain("npm run check:workspace-public");
    expect(packageJson.scripts["check:release-source"]).toContain("npm run check:git-clean");
    expect(packageJson.scripts["check:release-source"]).toContain("npm run check:source-archive");
    expect(packageJson.scripts["check:optional"]).toContain("src/__tests__/aws");
    expect(packageJson.scripts["check:optional"]).toContain("src/__tests__/evalops");
    expect(packageJson.scripts["check:optional"]).toContain("src/__tests__/langfuse");
    expect(packageJson.scripts["check:optional"]).toContain("src/__tests__/openai-agents");
    expect(packageJson.scripts["check:optional"]).toContain("src/__tests__/promptfoo");
    expect(packageJson.scripts["check:optional"]).toContain("src/__tests__/providers/anthropic");
    expect(packageJson.scripts["check:optional"]).toContain("src/__tests__/providers/gemini");
    expect(packageJson.scripts["check:optional"]).toContain("src/__tests__/providers/ai-sdk");
    expect(packageJson.scripts["check:optional"]).toContain("src/__tests__/providers/langchain");
    expect(packageJson.scripts["check:optional"]).toContain("src/__tests__/providers/mcp");
    expect(packageJson.scripts["check:optional"]).toContain("src/__tests__/providers/semantic-kernel");
    expect(packageJson.scripts["check:optional"]).toContain("src/__tests__/providers/conformance");
    expect(packageJson.scripts["check:providers"]).toBe("vitest run src/__tests__/providers");
    expect(packageJson.scripts["check:providers:mock"]).toContain("npm run test:anthropic:mock");
    expect(packageJson.scripts["check:providers:mock"]).toContain("npm run test:gemini:mock");
    expect(packageJson.scripts["check:providers:mock"]).toContain("npm run test:ai-sdk:mock");
    expect(packageJson.scripts["check:providers:mock"]).toContain("npm run test:langchain:mock");
    expect(packageJson.scripts["check:providers:mock"]).toContain("npm run test:semantic-kernel");
    expect(packageJson.scripts["check:providers:mock"]).toContain("npm run test:mcp-provider");
    expect(packageJson.scripts["check:providers:mock"]).toContain("npm run test:providers:conformance");
    expect(packageJson.scripts["check:providers:mock"]).toContain("npm run test:conformance");
    expect(packageJson.scripts["check:providers:live"]).toContain("npm run test:anthropic:live");
    expect(packageJson.scripts["check:providers:live"]).toContain("npm run test:gemini:live");
    expect(packageJson.scripts["check:providers:live"]).toContain("npm run test:ai-sdk:live");
    expect(packageJson.scripts["check:providers:live"]).toContain("npm run test:langchain:live");
    expect(packageJson.scripts["check:release:providers"]).toContain("npm run check:providers:mock");
    expect(packageJson.scripts["check:release:providers"]).toContain("npm run check:release-install");
    expect(packageJson.scripts["test:anthropic:mock"]).toContain("src/__tests__/providers/anthropic");
    expect(packageJson.scripts["test:aws"]).toContain("src/__tests__/aws");
    expect(packageJson.scripts["test:aws:live"]).toContain("src/__tests__/aws-live");
    expect(packageJson.scripts["test:audit"]).toContain("src/__tests__/audit");
    expect(packageJson.scripts["test:controls"]).toContain("src/__tests__/controls");
    expect(packageJson.scripts["test:control-plane"]).toContain("src/__tests__/control-plane");
    expect(packageJson.scripts["test:conformance"]).toContain("src/__tests__/conformance");
    expect(packageJson.scripts["test:evalops"]).toContain("src/__tests__/evalops");
    expect(packageJson.scripts["test:evidence"]).toContain("src/__tests__/evidence");
    expect(packageJson.scripts["test:memory"]).toContain("src/__tests__/memory");
    expect(packageJson.scripts["test:provenance"]).toContain("src/__tests__/provenance");
    expect(packageJson.scripts["test:gemini:mock"]).toContain("src/__tests__/providers/gemini");
    expect(packageJson.scripts["test:governance"]).toContain("src/__tests__/governance");
    expect(packageJson.scripts["test:ai-sdk:mock"]).toContain("src/__tests__/providers/ai-sdk");
    expect(packageJson.scripts["test:replay"]).toContain("src/__tests__/replay");
    expect(packageJson.scripts["test:security"]).toContain("src/__tests__/security");
    expect(packageJson.scripts["test:security-packs"]).toContain("src/__tests__/security-packs");
    expect(packageJson.scripts["test:langchain:mock"]).toContain("src/__tests__/providers/langchain");
    expect(packageJson.scripts["test:mcp-provider"]).toContain("src/__tests__/providers/mcp");
    expect(packageJson.scripts["test:mcp-server"]).toContain("src/__tests__/mcp-server");
    expect(packageJson.scripts["test:providers:conformance"]).toContain("src/__tests__/providers/conformance");
    expect(packageJson.scripts["test:semantic-kernel"]).toContain("src/__tests__/providers/semantic-kernel");
    expect(packageJson.scripts["check:release"]).toBe("npm run check && npm run check:optional && npm pack --dry-run --json");
  });

  it("documents the F0 baseline reconciliation state", async () => {
    const currentState = await readFile("docs/architecture/current-state.md", "utf8");
    const baselineGaps = await readFile("docs/implementation-notes/baseline-gaps.md", "utf8");
    const normalizedCurrentState = currentState.replace(/\s+/g, " ");
    const normalizedBaselineGaps = baselineGaps.replace(/\s+/g, " ");

    expect(normalizedCurrentState).toContain("package root is the provider-neutral Core API");
    expect(normalizedCurrentState).toContain("runtime subpath");
    expect(normalizedCurrentState).toContain("provider-specific APIs live behind optional subpaths");
    expect(normalizedCurrentState).toContain("public hygiene");
    expect(normalizedBaselineGaps).toContain("No unresolved F0 baseline gaps remain");
    expect(normalizedBaselineGaps).toContain("npm run typecheck");
    expect(normalizedBaselineGaps).toContain("docs/architecture/current-state.md");
  });

  it("source archive export-ignore rules cover private, generated, and local artifacts", async () => {
    const attributes = await readFile(".gitattributes", "utf8");
    for (const rule of [
      "_private/ export-ignore",
      ".aicf/ export-ignore",
      "node_modules/ export-ignore",
      "dist/ export-ignore",
      "dist-source/ export-ignore",
      "traces/ export-ignore",
      "*.tgz export-ignore",
      "*.zip export-ignore",
      "*.docx export-ignore",
      "*.pdf export-ignore",
      ".env export-ignore",
      ".env.* export-ignore"
    ]) {
      expect(attributes).toContain(rule);
    }
  });

  it("git cleanliness release check skips safely when .git is absent", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aicf-no-git-"));
    let output = "";
    try {
      output = execFileSync(process.execPath, [path.resolve("scripts/check-git-clean.mjs")], {
        cwd: directory,
        encoding: "utf8"
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }

    expect(output).toContain("Git clean check skipped");
  });

  it("public docs describe the provider-neutral release boundary", async () => {
    const readme = await readFile("README.md", "utf8");
    const startHere = await readFile("docs/start-here.md", "utf8");
    const openaiWalkthrough = await readFile("docs/openai-walkthrough.md", "utf8");
    const evalRunner = await readFile("docs/eval-runner.md", "utf8");
    const governanceGate = await readFile("docs/governance/gate.md", "utf8");
    const providers = await readFile("docs/providers.md", "utf8");
    const release = await readFile("docs/release.md", "utf8");

    const normalizedReadme = readme.replace(/\s+/g, " ");
    const normalizedStartHere = startHere.replace(/\s+/g, " ");
    const normalizedOpenaiWalkthrough = openaiWalkthrough.replace(/\s+/g, " ");
    const normalizedEvalRunner = evalRunner.replace(/\s+/g, " ");
    const normalizedRelease = release.replace(/\s+/g, " ");
    expect(normalizedReadme).toContain("provider-agnostic AI capability framework");
    expect(normalizedReadme).toContain("OpenAI, Anthropic Claude, Google Gemini, Vercel AI SDK, Model Context Protocol, LangChain/LangGraph, and Semantic Kernel");
    expect(readme).toContain("docs/start-here.md");
    expect(readme).toContain("docs/openai-walkthrough.md");
    expect(readme).toContain("docs/glossary.md");
    expect(providers).toContain("OpenAI is one adapter, not the architecture");
    expect(providers).toContain("Live tests are opt-in");
    expect(normalizedStartHere).toContain("The model can see read and prepare tools, but the commit capability is not exposed");
    expect(normalizedOpenaiWalkthrough).toContain("The model does not call `support.refund.commit_case`");
    expect(normalizedOpenaiWalkthrough).toContain("host applications remain responsible for provider credentials, model selection, auth, side effects, approvals, storage, and audit");
    expect(normalizedEvalRunner).toContain("without calling models");
    expect(governanceGate).toContain("does not call models");
    expect(governanceGate).toContain("does not call live integrations");
    expect(providers).toContain("Provider SDK validation does not replace AICF validation");
    expect(normalizedRelease).toContain("root and runtime imports remain provider-SDK-free");
    expect(normalizedRelease).toContain("commit capabilities are not exported by default");
  });

  it("public docs and examples do not include private or local-only path markers", () => {
    const publicFiles = listPublicDocsAndExamples();

    const forbiddenPathPatterns = [
      /(^|\/)_private(\/|$)/,
      /provider-payload/i,
      /raw-payload/i,
      /raw_provider/i,
      /raw-trace/i,
      /raw_prompt/i,
      /credential/i,
      /api-key/i,
      /apikey/i,
      /access-token/i,
      /access_token/i,
      /\.tgz$/i,
      /\.zip$/i,
      /\.pdf$/i,
      /\.docx$/i
    ];

    for (const file of publicFiles) {
      expect(forbiddenPathPatterns.some((pattern) => pattern.test(file))).toBe(false);
    }
  });
});

describe("AICF decision control plane", () => {
  it("allows a read capability select decision", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.ticket.get",
      operation: "select",
      args: {
        ticket_id: "TCK-1001"
      },
      context: {
        autonomyTier: "A1",
        permissions: ["ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      }
    });

    expect(result.status).toBe("allowed");
    expect(result.reasons).toEqual([]);
    expect(result.audit).toMatchObject({
      capabilityId: "support.ticket.get",
      operation: "select",
      status: "allowed"
    });
  });

  it("allows select eligibility without fact-dependent policy evidence", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.refund.prepare_case",
      operation: "select",
      context: {
        autonomyTier: "A2",
        permissions: ["refund.case.create", "ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      }
    });

    expect(result.status).toBe("allowed");
    expect(result.reasons).toEqual([]);
  });

  it("denies when permissions are missing", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.ticket.get",
      operation: "select",
      context: {
        autonomyTier: "A1",
        permissions: [],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      }
    });

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "missing_permission"
    }));
  });

  it("denies when requested autonomy exceeds the capability tier", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.ticket.get",
      operation: "select",
      context: {
        autonomyTier: "A2",
        permissions: ["ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      }
    });

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "autonomy_exceeded"
    }));
  });

  it("requires approval for a refund prepare request over the threshold", async () => {
    const registry = await loadValidRegistry();
    const request = await readDecisionExample("support.refund.prepare_case.approval_required.json");

    const result = decideCapability(registry, request);

    expect(result.status).toBe("approval_required");
    expect(result.requiredApprovals).toContainEqual(expect.objectContaining({
      code: "approval_required",
      rule: "refund.amount_over_threshold"
    }));
  });

  it("denies when a deny fact is true", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      args: {
        order_id: "ORD-2003",
        reason_code: "damaged_item",
        ticket_id: "TCK-1002"
      },
      context: {
        autonomyTier: "A2",
        permissions: ["refund.case.create", "ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      },
      facts: {
        "refund.order_not_refundable": {
          value: true,
          reason: "Synthetic order is outside the refundable window."
        }
      }
    });

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "deny_rule_matched",
      rule: "refund.order_not_refundable"
    }));
  });

  it("fails closed when a deny fact is missing", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      args: {
        order_id: "ORD-2003",
        reason_code: "damaged_item",
        ticket_id: "TCK-1002"
      },
      context: {
        autonomyTier: "A2",
        permissions: ["refund.case.create", "ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      }
    });

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "missing_fact",
      rule: "refund.order_not_refundable"
    }));
  });

  it("denies commit without approval", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.refund.commit_case",
      operation: "commit",
      args: {
        approval_id: "approval_example_1",
        prepared_action_id: "prepared_example_refund_1"
      },
      context: {
        autonomyTier: "A0",
        permissions: ["refund.case.commit"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_lead"
      },
      facts: {
        "refund.approval_missing_or_invalid": false
      },
      idempotencyKey: "idem_example_refund_commit_1"
    });

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "approval_required"
    }));
  });

  it("denies commit without a required idempotency key", async () => {
    const registry = await loadValidRegistry();
    const result = decideCapability(registry, {
      capabilityId: "support.refund.commit_case",
      operation: "commit",
      args: {
        approval_id: "approval_example_1",
        prepared_action_id: "prepared_example_refund_1"
      },
      approval: {
        approvalId: "approval_example_1",
        approved: true
      },
      context: {
        autonomyTier: "A0",
        permissions: ["refund.case.commit"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_lead"
      },
      facts: {
        "refund.approval_missing_or_invalid": false
      }
    });

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "idempotency_required"
    }));
  });

  it("allows commit with approval and idempotency key", async () => {
    const registry = await loadValidRegistry();
    const request = await readDecisionExample("support.refund.commit_case.allowed.json");

    const result = decideCapability(registry, request);

    expect(result.status).toBe("allowed");
    expect(result.audit).toMatchObject({
      capabilityId: "support.refund.commit_case",
      idempotencyKey: "idem_example_refund_commit_1",
      operation: "commit",
      status: "allowed"
    });
  });

  it("allows scheduling invite send with approval and idempotency key", async () => {
    const registry = await loadValidRegistry();
    const request = await readDecisionExample(
      "scheduling.invite.send.allowed.json",
      "examples/scheduling/decisions"
    );

    const result = decideCapability(registry, request);

    expect(result.status).toBe("allowed");
    expect(result.audit).toMatchObject({
      capabilityId: "scheduling.invite.send",
      idempotencyKey: "idem_example_invite_send_1",
      operation: "commit",
      status: "allowed"
    });
  });

  it("prints JSON from the decide CLI and exits zero for denied decisions", async () => {
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();

    const exitCode = await runCli([
      "decide",
      "examples",
      "--request",
      "examples/support/decisions/support.refund.commit_case.denied_missing_approval.json"
    ], { stderr, stdout });
    const parsed = JSON.parse(stdout.value) as { status: string };

    expect(exitCode).toBe(0);
    expect(stderr.value).toBe("");
    expect(parsed.status).toBe("denied");
  });

  it("keeps idempotency in the generated CapabilityManifest type", async () => {
    const generatedTypes = await readFile("src/generated/manifest-types.ts", "utf8");
    const registry = await loadValidRegistry();
    const commitCapability = registry.capabilityById.get("support.refund.commit_case");

    expect(generatedTypes).toContain("schema_version: \"1.0\";");
    expect(generatedTypes).toContain("idempotency?:");
    expect(commitCapability?.manifest.idempotency).toEqual({
      required: true,
      key_fields: ["prepared_action_id", "approval_id"]
    });
  });
});

describe("AICF deterministic eval runner", () => {
  it("loads a valid public fixture and passes all current evals", async () => {
    const registry = await loadValidRegistry();
    const loadedResults = await loadEvalResults("examples/eval-results/public.results.passing.json");

    const suite = runEvalSuite(registry, loadedResults.results);

    expect(loadedResults.errors).toEqual([]);
    expect(loadedResults.results).toHaveLength(6);
    expect(suite.status).toBe("passed");
    expect(suite.summary).toEqual({
      failed: 0,
      passed: 6,
      total: 6
    });
  });

  it("fails selected capability include and exclude checks", async () => {
    const registry = await loadValidRegistry();
    const evalCase = loadedEval(registry, "support.refund.prepare_case.valid");
    const candidate = candidateForEval("support.refund.prepare_case.valid", {
      selected_capabilities: ["support.refund.commit_case"]
    });

    const result = scoreEvalCase(evalCase, candidate, registry);

    expect(result.status).toBe("failed");
    expect(result.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "tool_selection_includes"
    }));
    expect(result.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "tool_selection_excludes"
    }));
  });

  it("fails deep subset argument checks", async () => {
    const registry = await loadValidRegistry();
    const evalCase = loadedEval(registry, "support.refund.prepare_case.valid");
    const candidate = candidateForEval("support.refund.prepare_case.valid", {
      selected_capabilities: ["support.refund.prepare_case"],
      tool_calls: [{
        capability_id: "support.refund.prepare_case",
        args: {
          order_id: "ORD-WRONG",
          reason_code: "damaged_item",
          ticket_id: "TCK-1001"
        }
      }]
    });

    const result = scoreEvalCase(evalCase, candidate, registry);

    expect(result.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "tool_input_json_subset"
    }));
  });

  it("fails policy decision mismatches", async () => {
    const registry = await loadValidRegistry();
    const evalCase = loadedEval(registry, "support.refund.prepare_case.approval_required");
    const candidate = candidateForEval("support.refund.prepare_case.approval_required", {
      policy_decision: "allowed",
      selected_capabilities: ["support.refund.prepare_case"],
      tool_calls: [{
        capability_id: "support.refund.prepare_case",
        args: {
          order_id: "ORD-2003",
          reason_code: "damaged_item",
          requested_amount: 750,
          ticket_id: "TCK-1002"
        }
      }]
    });

    const result = scoreEvalCase(evalCase, candidate, registry);

    expect(result.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "policy_decision_matches"
    }));
  });

  it("fails no-commit checks when commit behavior appears", async () => {
    const registry = await loadValidRegistry();
    const evalCase = loadedEval(registry, "support.refund.prepare_case.valid");
    const candidate = candidateForEval("support.refund.prepare_case.valid", {
      action_state: "committed",
      committed_capabilities: ["support.refund.commit_case"],
      selected_capabilities: ["support.refund.prepare_case"],
      tool_calls: [{
        capability_id: "support.refund.commit_case",
        args: {
          approval_id: "approval_example_1",
          prepared_action_id: "prepared_example_refund_1"
        }
      }]
    });

    const result = scoreEvalCase(evalCase, candidate, registry);

    expect(result.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "no_unapproved_commit"
    }));
  });

  it("fails refusal checks when required refusal text is missing", async () => {
    const registry = await loadValidRegistry();
    const evalCase = loadedEval(registry, "support.refund.commit_case.requires_approval");
    const candidate = candidateForEval("support.refund.commit_case.requires_approval", {
      action_state: "refused",
      refusal: {
        present: true,
        reason: "Approval is required."
      },
      selected_capabilities: ["support.refund.prepare_case"]
    });

    const result = scoreEvalCase(evalCase, candidate, registry);

    expect(result.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "refusal_present"
    }));
  });

  it("enforces response must_include and must_not_include expectations", async () => {
    const registry = await loadValidRegistry();
    const baseEval = loadedEval(registry, "support.refund.commit_case.requires_approval");
    const evalCase = {
      ...baseEval.manifest,
      expected: {
        ...baseEval.manifest.expected,
        response: {
          must_include: ["approval"],
          must_not_include: ["refund_id"]
        }
      },
      scorers: [{
        type: "response_excludes_private_detail"
      }]
    } satisfies EvalCase;
    const candidate = candidateForEval("support.refund.commit_case.requires_approval", {
      response: {
        text: "The refund_id is hidden."
      }
    });

    const result = scoreEvalCase(evalCase, candidate, registry);

    expect(result.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "response_must_include"
    }));
    expect(result.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "response_excludes_private_detail"
    }));
    expect(result.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "response_must_not_include"
    }));
  });

  it("fails when a candidate result is missing for a loaded eval", async () => {
    const registry = await loadValidRegistry();
    const loadedResults = await loadEvalResults("examples/eval-results/public.results.passing.json");
    const suite = runEvalSuite(
      registry,
      loadedResults.results.filter((candidate) => candidate.eval_id !== "support.refund.prepare_case.valid")
    );

    expect(suite.status).toBe("failed");
    expect(suite.diagnostics).toContainEqual(expect.objectContaining({
      code: "missing_candidate",
      id: "support.refund.prepare_case.valid"
    }));
  });

  it("fails closed for unknown scorer types", async () => {
    const registry = await loadValidRegistry();
    const baseEval = loadedEval(registry, "support.refund.prepare_case.valid");
    const evalCase = {
      ...baseEval.manifest,
      scorers: [{
        type: "unknown_public_scorer"
      }]
    } satisfies EvalCase;
    const candidate = candidateForEval("support.refund.prepare_case.valid", {});

    const result = scoreEvalCase(evalCase, candidate, registry);

    expect(result.status).toBe("failed");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "unknown_scorer"
    }));
  });
});

describe("OpenAI Responses adapter", () => {
  it("exports allowed read and prepare capabilities for the support context", async () => {
    const registry = await loadValidRegistry();
    const context = await readOpenAIContextExample();
    const toolset = buildOpenAIResponsesTools(registry, { context });

    expect(toolset.tools).toHaveLength(2);
    expect(toolset.tools.every((tool) => tool.type === "function" && tool.strict === true)).toBe(true);
    expect(toolset.bindings.map((binding) => binding.capabilityId)).toEqual([
      "support.refund.prepare_case",
      "support.ticket.get"
    ]);
    expect(toolset.bindings.map((binding) => binding.toolName)).toEqual([
      "aicf_support_refund_prepare_case",
      "aicf_support_ticket_get"
    ]);
  });

  it("exports allowed read and prepare capabilities for the scheduling context", async () => {
    const registry = await loadValidRegistry();
    const content = await readFile("examples/scheduling/openai/context.scheduler.json", "utf8");
    const context = JSON.parse(content) as DecisionRequest["context"];
    const toolset = buildOpenAIResponsesTools(registry, { context });

    expect(toolset.bindings.map((binding) => binding.capabilityId)).toEqual([
      "scheduling.availability.get",
      "scheduling.invite.prepare"
    ]);
    expect(toolset.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "scheduling.invite.send",
      reason: "restricted"
    }));
  });

  it("excludes the refund commit capability by default with diagnostics", async () => {
    const registry = await loadValidRegistry();
    const context = await readOpenAIContextExample();
    const toolset = buildOpenAIResponsesTools(registry, { context });

    expect(toolset.bindings.some((binding) => binding.capabilityId === "support.refund.commit_case")).toBe(false);
    expect(toolset.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "support.refund.commit_case",
      reason: "restricted"
    }));
    expect(toolset.diagnostics).toContainEqual(expect.objectContaining({
      code: "capability_excluded",
      id: "support.refund.commit_case"
    }));
  });

  it("exports restricted capabilities only when explicitly included and still selectable", async () => {
    const registry = await loadValidRegistry();
    const allowedToolset = buildOpenAIResponsesTools(registry, {
      context: {
        autonomyTier: "A0",
        permissions: ["refund.case.commit"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_lead"
      },
      includeRestricted: true
    });
    const deniedToolset = buildOpenAIResponsesTools(registry, {
      context: {
        autonomyTier: "A0",
        permissions: [],
        tenantId: "tenant_example_support",
        userId: "user_example_support_lead"
      },
      includeRestricted: true
    });

    expect(allowedToolset.bindings).toContainEqual(expect.objectContaining({
      capabilityId: "support.refund.commit_case",
      restricted: true
    }));
    expect(deniedToolset.bindings.some((binding) => binding.capabilityId === "support.refund.commit_case")).toBe(false);
    expect(deniedToolset.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "support.refund.commit_case",
      reason: "decision_denied"
    }));
  });

  it("generates OpenAI-safe names, truncates long names, and reports collisions", async () => {
    const registry = await loadValidRegistry();
    const longName = toOpenAIResponsesToolName(
      "support.very_long_capability_name_segment_for_openai_tool_export.with_many_more_segments.and_hashing"
    );
    const baseCapability = registry.capabilityById.get("support.ticket.get");
    if (!baseCapability) {
      throw new Error("Expected support.ticket.get example capability.");
    }

    const collisionRegistry = buildRegistry([
      loadedCapability("examples/collision/capabilities/one.yaml", {
        ...cloneManifest(baseCapability.manifest),
        id: "support.alpha_case.get"
      }),
      loadedCapability("examples/collision/capabilities/two.yaml", {
        ...cloneManifest(baseCapability.manifest),
        id: "support.alpha.case_get"
      })
    ]);
    const collisionToolset = buildOpenAIResponsesTools(collisionRegistry, {
      context: {
        autonomyTier: "A1",
        permissions: ["ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      }
    });

    expect(longName.length).toBeLessThanOrEqual(64);
    expect(longName).toMatch(/^aicf_support_very_long_capability_name_segment_for_open_[a-f0-9]{8}$/);
    expect(collisionToolset.diagnostics).toContainEqual(expect.objectContaining({
      code: "tool_name_collision",
      id: "support.alpha.case_get"
    }));
    expect(collisionToolset.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "support.alpha.case_get",
      reason: "tool_name_collision"
    }));
  });

  it("normalizes optional input fields as nullable for OpenAI strict mode", async () => {
    const registry = await loadValidRegistry();
    const context = await readOpenAIContextExample();
    const toolset = buildOpenAIResponsesTools(registry, { context });
    const prepareTool = toolset.tools.find((tool) => tool.name === "aicf_support_refund_prepare_case");
    if (!prepareTool) {
      throw new Error("Expected prepare refund OpenAI tool.");
    }
    const properties = prepareTool.parameters.properties as Record<string, { type?: unknown }>;

    expect(prepareTool.parameters.required).toEqual([
      "ticket_id",
      "order_id",
      "reason_code",
      "requested_amount"
    ]);
    expect(properties.requested_amount?.type).toEqual(["number", "null"]);
    expect(prepareTool.parameters.additionalProperties).toBe(false);
  });

  it("excludes unsupported schemas instead of weakening strict export", async () => {
    const registry = await loadValidRegistry();
    const baseCapability = registry.capabilityById.get("support.ticket.get");
    if (!baseCapability) {
      throw new Error("Expected support.ticket.get example capability.");
    }
    const unsupportedRegistry = buildRegistry([
      loadedCapability("examples/unsupported/capabilities/support.ticket.get.yaml", {
        ...cloneManifest(baseCapability.manifest),
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["ticket_id"],
          properties: {
            ticket_id: {
              anyOf: [
                { type: "string" },
                { type: "number" }
              ]
            }
          }
        }
      })
    ]);

    const toolset = buildOpenAIResponsesTools(unsupportedRegistry, {
      context: {
        autonomyTier: "A1",
        permissions: ["ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      }
    });

    expect(toolset.tools).toHaveLength(0);
    expect(toolset.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "support.ticket.get",
      reason: "unsupported_schema"
    }));
    expect(toolset.diagnostics).toContainEqual(expect.objectContaining({
      code: "unsupported",
      id: "support.ticket.get"
    }));
  });

  it("parses valid OpenAI tool calls and validates failure cases", async () => {
    const registry = await loadValidRegistry();
    const context = await readOpenAIContextExample();
    const toolset = buildOpenAIResponsesTools(registry, { context });
    const valid = parseOpenAIResponsesToolCall(toolset, {
      arguments: "{\"ticket_id\":\"TCK-1001\"}",
      call_id: "call_example_1",
      id: "fc_example_1",
      name: "aicf_support_ticket_get",
      type: "function_call"
    });
    const invalidJson = parseOpenAIResponsesToolCall(toolset, {
      arguments: "{",
      name: "aicf_support_ticket_get",
      type: "function_call"
    });
    const unknownTool = parseOpenAIResponsesToolCall(toolset, {
      arguments: "{}",
      name: "aicf_missing_tool",
      type: "function_call"
    });
    const schemaFailure = parseOpenAIResponsesToolCall(toolset, {
      arguments: "{\"ticket_id\":\"bad\"}",
      name: "aicf_support_ticket_get",
      type: "function_call"
    });

    expect(valid.valid).toBe(true);
    expect(valid.parsed).toMatchObject({
      args: { ticket_id: "TCK-1001" },
      callId: "call_example_1",
      capabilityId: "support.ticket.get"
    });
    expect(invalidJson.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid_tool_call",
      id: "support.ticket.get"
    }));
    expect(unknownTool.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid_tool_call"
    }));
    expect(schemaFailure.diagnostics).toContainEqual(expect.objectContaining({
      code: "schema",
      id: "support.ticket.get"
    }));
  });
});

describe("Non-OpenAI adapter exports", () => {
  for (const adapter of nonOpenAiAdapterConfigs()) {
    it(`${adapter.label} exports support read/prepare capabilities and excludes restricted commit by default`, async () => {
      const registry = await loadValidRegistry();
      const context = await readOpenAIContextExample();
      const toolset = adapter.build(registry, { context });

      expect(adapterExportedCount(toolset), adapter.label).toBe(2);
      expect(toolset.bindings.map((binding) => binding.capabilityId), adapter.label).toEqual([
        "support.refund.prepare_case",
        "support.ticket.get"
      ]);
      expect(toolset.excluded, adapter.label).toContainEqual(expect.objectContaining({
        capabilityId: "support.refund.commit_case",
        reason: "restricted"
      }));
    });

    it(`${adapter.label} exports scheduling read/prepare capabilities for the scheduling context`, async () => {
      const registry = await loadValidRegistry();
      const content = await readFile("examples/scheduling/openai/context.scheduler.json", "utf8");
      const context = JSON.parse(content) as DecisionRequest["context"];
      const toolset = adapter.build(registry, { context });

      expect(toolset.bindings.map((binding) => binding.capabilityId), adapter.label).toEqual([
        "scheduling.availability.get",
        "scheduling.invite.prepare"
      ]);
      expect(toolset.excluded, adapter.label).toContainEqual(expect.objectContaining({
        capabilityId: "scheduling.invite.send",
        reason: "restricted"
      }));
    });

    it(`${adapter.label} exports restricted capabilities only when explicitly included and selectable`, async () => {
      const registry = await loadValidRegistry();
      const allowedToolset = adapter.build(registry, {
        context: {
          autonomyTier: "A0",
          permissions: ["refund.case.commit"],
          tenantId: "tenant_example_support",
          userId: "user_example_support_lead"
        },
        includeRestricted: true
      });
      const deniedToolset = adapter.build(registry, {
        context: {
          autonomyTier: "A0",
          permissions: [],
          tenantId: "tenant_example_support",
          userId: "user_example_support_lead"
        },
        includeRestricted: true
      });

      expect(allowedToolset.bindings).toContainEqual(expect.objectContaining({
        capabilityId: "support.refund.commit_case",
        restricted: true
      }));
      expect(deniedToolset.bindings.some((binding) => binding.capabilityId === "support.refund.commit_case")).toBe(false);
      expect(deniedToolset.excluded).toContainEqual(expect.objectContaining({
        capabilityId: "support.refund.commit_case",
        reason: "decision_denied"
      }));
    });

    it(`${adapter.label} generates safe names, truncates long names, and reports collisions`, async () => {
      const registry = await loadValidRegistry();
      const longName = adapter.toName(
        "support.very_long_capability_name_segment_for_tool_export.with_many_more_segments.and_hashing"
      );
      const baseCapability = registry.capabilityById.get("support.ticket.get");
      if (!baseCapability) {
        throw new Error("Expected support.ticket.get example capability.");
      }

      const collisionRegistry = buildRegistry([
        loadedCapability("examples/collision/capabilities/one.yaml", {
          ...cloneManifest(baseCapability.manifest),
          id: "support.alpha_case.get"
        }),
        loadedCapability("examples/collision/capabilities/two.yaml", {
          ...cloneManifest(baseCapability.manifest),
          id: "support.alpha.case_get"
        })
      ]);
      const collisionToolset = adapter.build(collisionRegistry, {
        context: {
          autonomyTier: "A1",
          permissions: ["ticket.read"],
          tenantId: "tenant_example_support",
          userId: "user_example_support_agent"
        }
      });

      expect(longName.length, adapter.label).toBeLessThanOrEqual(64);
      expect(longName, adapter.label).toMatch(/^aicf_support_very_long_capability_name_segment_for_tool_[a-f0-9]{8}$/);
      expect(collisionToolset.diagnostics, adapter.label).toContainEqual(expect.objectContaining({
        code: "tool_name_collision",
        id: "support.alpha.case_get"
      }));
      expect(collisionToolset.excluded, adapter.label).toContainEqual(expect.objectContaining({
        capabilityId: "support.alpha.case_get",
        reason: "tool_name_collision"
      }));
    });

    it(`${adapter.label} normalizes schemas and excludes unsupported schemas`, async () => {
      const registry = await loadValidRegistry();
      const context = await readOpenAIContextExample();
      const toolset = adapter.build(registry, { context });
      const prepareBinding = toolset.bindings.find((binding) => binding.capabilityId === "support.refund.prepare_case");
      if (!prepareBinding) {
        throw new Error(`Expected support.refund.prepare_case binding for ${adapter.label}.`);
      }
      const properties = prepareBinding.normalizedInputSchema.properties as Record<string, { type?: unknown }>;
      const baseCapability = registry.capabilityById.get("support.ticket.get");
      if (!baseCapability) {
        throw new Error("Expected support.ticket.get example capability.");
      }
      const unsupportedRegistry = buildRegistry([
        loadedCapability("examples/unsupported/capabilities/support.ticket.get.yaml", {
          ...cloneManifest(baseCapability.manifest),
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["ticket_id"],
            properties: {
              ticket_id: {
                anyOf: [
                  { type: "string" },
                  { type: "number" }
                ]
              }
            }
          }
        })
      ]);
      const unsupportedToolset = adapter.build(unsupportedRegistry, {
        context: {
          autonomyTier: "A1",
          permissions: ["ticket.read"],
          tenantId: "tenant_example_support",
          userId: "user_example_support_agent"
        }
      });

      expect(prepareBinding.normalizedInputSchema.required, adapter.label).toEqual([
        "ticket_id",
        "order_id",
        "reason_code",
        "requested_amount"
      ]);
      expect(properties.requested_amount?.type, adapter.label).toEqual(["number", "null"]);
      expect(adapterExportedCount(unsupportedToolset), adapter.label).toBe(0);
      expect(unsupportedToolset.excluded, adapter.label).toContainEqual(expect.objectContaining({
        capabilityId: "support.ticket.get",
        reason: "unsupported_schema"
      }));
      expect(unsupportedToolset.diagnostics, adapter.label).toContainEqual(expect.objectContaining({
        code: "unsupported",
        id: "support.ticket.get"
      }));
    });

    it(`${adapter.label} parses valid tool calls and validates failure cases`, async () => {
      const registry = await loadValidRegistry();
      const context = await readOpenAIContextExample();
      const toolset = adapter.build(registry, { context });
      const ticketBinding = toolset.bindings.find((binding) => binding.capabilityId === "support.ticket.get");
      if (!ticketBinding) {
        throw new Error(`Expected support.ticket.get binding for ${adapter.label}.`);
      }

      const valid = adapter.parse(toolset, adapter.validCall(ticketBinding.toolName));
      const malformed = adapter.parse(toolset, adapter.malformedCall());
      const unknownTool = adapter.parse(toolset, adapter.unknownCall());
      const schemaFailure = adapter.parse(toolset, adapter.schemaFailureCall(ticketBinding.toolName));

      expect(valid.valid, adapter.label).toBe(true);
      expect(valid.parsed, adapter.label).toMatchObject({
        args: { ticket_id: "TCK-1001" },
        capabilityId: "support.ticket.get"
      });
      expect(malformed.diagnostics, adapter.label).toContainEqual(expect.objectContaining({
        code: "invalid_tool_call"
      }));
      expect(unknownTool.diagnostics, adapter.label).toContainEqual(expect.objectContaining({
        code: "invalid_tool_call"
      }));
      expect(schemaFailure.diagnostics, adapter.label).toContainEqual(expect.objectContaining({
        code: "schema",
        id: "support.ticket.get"
      }));
    });
  }
});

describe("AICF core repair hardening", () => {
  it("loads and validates all public non-manifest fixtures", async () => {
    const loaded = await loadManifests({ path: "examples" });
    const fixtureValidation = validatePublicFixtures(loaded.fixtures);

    expect(loaded.errors).toEqual([]);
    expect(loaded.fixtures).toHaveLength(18);
    expect(fixtureValidation.errors).toEqual([]);
    expect(fixtureValidation.valid).toBe(true);
  });

  it("fails malformed and unknown public structured fixtures", async () => {
    const malformedDirectory = await mkdtemp(path.join(tmpdir(), "aicf-fixture-malformed-"));
    const unknownDirectory = await mkdtemp(path.join(tmpdir(), "aicf-fixture-unknown-"));
    await writeFile(path.join(malformedDirectory, "bad.json"), "{", "utf8");
    await writeFile(path.join(unknownDirectory, "notes.json"), "{\"ok\":true}", "utf8");

    const malformed = await loadManifests({ path: malformedDirectory });
    const unknown = await loadManifests({ path: unknownDirectory });
    const unknownValidation = validatePublicFixtures(unknown.fixtures);

    expect(malformed.errors).toContainEqual(expect.objectContaining({ code: "parse" }));
    expect(unknownValidation.errors).toContainEqual(expect.objectContaining({ code: "invalid_fixture" }));
  });

  it("denies prepare and commit requests with missing or invalid args", async () => {
    const registry = await loadValidRegistry();
    const baseRequest = {
      capabilityId: "support.refund.prepare_case",
      context: {
        autonomyTier: "A2" as const,
        permissions: ["refund.case.create", "ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      },
      facts: {
        "refund.order_not_refundable": false
      },
      operation: "prepare" as const
    };
    const missingArgs = decideCapability(registry, baseRequest);
    const invalidArgs = decideCapability(registry, {
      ...baseRequest,
      args: {
        ticket_id: "TCK-1002"
      }
    });
    const invalidCommitArgs = decideCapability(registry, {
      capabilityId: "support.refund.commit_case",
      operation: "commit",
      args: {
        prepared_action_id: ""
      },
      approval: {
        approvalId: "approval_example_1",
        approved: true
      },
      context: {
        autonomyTier: "A0",
        permissions: ["refund.case.commit"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_lead"
      },
      facts: {
        "refund.approval_missing_or_invalid": false
      },
      idempotencyKey: "idem_example_refund_commit_1"
    });

    expect(missingArgs.reasons).toContainEqual(expect.objectContaining({ code: "missing_args" }));
    expect(invalidArgs.reasons).toContainEqual(expect.objectContaining({ code: "schema_validation_failed" }));
    expect(invalidArgs.diagnostics).toContainEqual(expect.objectContaining({ code: "schema_validation_failed" }));
    expect(invalidCommitArgs.reasons).toContainEqual(expect.objectContaining({ code: "schema_validation_failed" }));
  });

  it("denies missing required tenant/user context and risk ceiling violations", async () => {
    const registry = await loadValidRegistry();
    const missingContext = decideCapability(registry, {
      capabilityId: "support.ticket.get",
      operation: "select",
      args: {
        ticket_id: "TCK-1001"
      },
      context: {
        autonomyTier: "A1",
        permissions: ["ticket.read"]
      }
    });
    const riskExceeded = decideCapability(registry, {
      capabilityId: "support.refund.prepare_case",
      operation: "select",
      context: {
        autonomyTier: "A2",
        permissions: ["refund.case.create", "ticket.read"],
        riskCeiling: "low",
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      }
    });

    expect(missingContext.reasons).toContainEqual(expect.objectContaining({ code: "missing_user_context" }));
    expect(missingContext.reasons).toContainEqual(expect.objectContaining({ code: "missing_tenant_context" }));
    expect(riskExceeded.reasons).toContainEqual(expect.objectContaining({ code: "risk_tier_exceeded" }));
  });

  it("enforces capability status for decisions and adapter exports", async () => {
    const registry = await loadValidRegistry();
    const baseCapability = registry.capabilityById.get("support.ticket.get");
    if (!baseCapability) throw new Error("Expected support.ticket.get.");

    const disabledRegistry = buildRegistry([
      loadedCapability("examples/status/capabilities/support.ticket.get.yaml", {
        ...cloneManifest(baseCapability.manifest),
        status: "disabled"
      })
    ]);
    const decision = decideCapability(disabledRegistry, {
      capabilityId: "support.ticket.get",
      operation: "select",
      args: {
        ticket_id: "TCK-1001"
      },
      context: {
        autonomyTier: "A1",
        permissions: ["ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      }
    });
    const toolset = buildOpenAIResponsesTools(disabledRegistry, {
      context: {
        autonomyTier: "A1",
        permissions: ["ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      }
    });

    expect(decision.reasons).toContainEqual(expect.objectContaining({ code: "status_disabled" }));
    expect(toolset.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "support.ticket.get",
      reason: "status_disabled"
    }));
  });

  it("treats delete capabilities as restricted by default", async () => {
    const registry = await loadValidRegistry();
    const baseCapability = registry.capabilityById.get("support.ticket.get");
    if (!baseCapability) throw new Error("Expected support.ticket.get.");

    const deleteRegistry = buildRegistry([
      loadedCapability("examples/delete/capabilities/support.ticket.get.yaml", {
        ...cloneManifest(baseCapability.manifest),
        side_effects: {
          ...cloneManifest(baseCapability.manifest.side_effects),
          deletes_records: true
        }
      })
    ]);
    const context = {
      autonomyTier: "A1" as const,
      permissions: ["ticket.read"],
      tenantId: "tenant_example_support",
      userId: "user_example_support_agent"
    };
    const defaultToolset = buildOpenAIResponsesTools(deleteRegistry, { context });
    const includedToolset = buildOpenAIResponsesTools(deleteRegistry, {
      context,
      includeRestricted: true
    });

    expect(defaultToolset.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "support.ticket.get",
      reason: "restricted"
    }));
    expect(includedToolset.bindings).toContainEqual(expect.objectContaining({
      capabilityId: "support.ticket.get",
      restricted: true
    }));
  });

  it("parses normalized optional nulls and denormalizes to original args", async () => {
    const registry = await loadValidRegistry();
    const baseCapability = registry.capabilityById.get("support.ticket.get");
    if (!baseCapability) throw new Error("Expected support.ticket.get.");

    const optionalRegistry = buildRegistry([
      loadedCapability("examples/optional/capabilities/support.ticket.get.yaml", {
        ...cloneManifest(baseCapability.manifest),
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["ticket_id"],
          properties: {
            ticket_id: {
              type: "string",
              pattern: "^TCK-[0-9]+$"
            },
            note: {
              type: "string"
            },
            nullable_note: {
              type: ["string", "null"]
            }
          }
        }
      })
    ]);
    const toolset = buildOpenAIResponsesTools(optionalRegistry, {
      context: {
        autonomyTier: "A1",
        permissions: ["ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      }
    });
    const parsed = parseOpenAIResponsesToolCall(toolset, {
      arguments: "{\"ticket_id\":\"TCK-1001\",\"note\":null,\"nullable_note\":null}",
      name: "aicf_support_ticket_get",
      type: "function_call"
    });

    expect(parsed.valid).toBe(true);
    expect(parsed.parsed?.args).toEqual({
      nullable_note: null,
      ticket_id: "TCK-1001"
    });
  });

  it("validates embedded JSON Schemas and semantic capability invariants", async () => {
    const registry = await loadValidRegistry();
    const baseCapability = registry.capabilityById.get("support.ticket.get");
    if (!baseCapability) throw new Error("Expected support.ticket.get.");
    const prepareCapability = registry.capabilityById.get("support.refund.prepare_case");
    if (!prepareCapability) throw new Error("Expected support.refund.prepare_case.");

    const invalidSchema = loadedCapability("examples/invalid/capabilities/schema.yaml", {
      ...cloneManifest(baseCapability.manifest),
      input_schema: {
        type: "not_a_json_schema_type"
      }
    });
    const invalidInvariant = loadedCapability("examples/invalid/capabilities/invariant.yaml", {
      ...cloneManifest(baseCapability.manifest),
      id: "support.ticket.bad_read",
      side_effects: {
        ...cloneManifest(baseCapability.manifest.side_effects),
        writes_data: true
      }
    });
    const missingCommitReference = loadedCapability("examples/invalid/capabilities/missing-commit-link.yaml", {
      ...cloneManifest(prepareCapability.manifest),
      id: "support.refund.prepare_missing_commit_link",
      lifecycle: {
        ...cloneManifest(prepareCapability.manifest.lifecycle),
        commit_capability_id: "support.refund.missing_commit"
      }
    });
    const nonCommitReference = loadedCapability("examples/invalid/capabilities/non-commit-link.yaml", {
      ...cloneManifest(prepareCapability.manifest),
      id: "support.refund.prepare_non_commit_link",
      lifecycle: {
        ...cloneManifest(prepareCapability.manifest.lifecycle),
        commit_capability_id: "support.ticket.get"
      }
    });
    const validation = validateManifests([invalidSchema, invalidInvariant, missingCommitReference, nonCommitReference, loadedCapability(baseCapability.path, cloneManifest(baseCapability.manifest))]);

    expect(validation.errors).toContainEqual(expect.objectContaining({ code: "invalid_input_schema" }));
    expect(validation.errors).toContainEqual(expect.objectContaining({ code: "invalid_read_side_effects" }));
    expect(validation.errors.filter((error) => error.code === "invalid_commit_capability_reference")).toHaveLength(2);
  });

  it("scores action state, duplicate candidates, unknown evals, exact args, and forbidden calls", async () => {
    const registry = await loadValidRegistry();
    const evalCase = loadedEval(registry, "support.refund.prepare_case.valid");
    const wrongState = scoreEvalCase(evalCase, candidateForEval("support.refund.prepare_case.valid", {
      action_state: "denied",
      selected_capabilities: ["support.refund.prepare_case"],
      tool_calls: [{
        capability_id: "support.refund.prepare_case",
        args: {
          order_id: "ORD-2003",
          reason_code: "damaged_item",
          ticket_id: "TCK-1002"
        }
      }]
    }), registry);
    const exactEval = {
      ...evalCase,
      manifest: {
        ...cloneManifest(evalCase.manifest),
        expected: {
          ...cloneManifest(evalCase.manifest.expected),
          forbidden_tool_calls: [{ capability_id: "support.refund.commit_case" }],
          tool_calls: [{
            capability_id: "support.refund.prepare_case",
            args_exact: {
              order_id: "ORD-2003",
              reason_code: "damaged_item",
              ticket_id: "TCK-1002"
            }
          }]
        },
        scorers: [
          { type: "tool_input_exact_json" },
          { type: "no_forbidden_tool_call" }
        ]
      }
    } satisfies LoadedEvalCase;
    const strictResult = scoreEvalCase(exactEval, candidateForEval("support.refund.prepare_case.valid", {
      selected_capabilities: ["support.refund.prepare_case"],
      tool_calls: [
        {
          capability_id: "support.refund.prepare_case",
          args: {
            extra: true,
            order_id: "ORD-2003",
            reason_code: "damaged_item",
            ticket_id: "TCK-1002"
          }
        },
        {
          capability_id: "support.refund.commit_case",
          args: {}
        }
      ]
    }), registry);
    const unknownCapabilityResult = scoreEvalCase(evalCase, candidateForEval("support.refund.prepare_case.valid", {
      selected_capabilities: ["support.refund.prepare_case"],
      tool_calls: [{
        capability_id: "support.unknown.capability",
        args: {}
      }]
    }), registry);
    const unknownCommittedResult = scoreEvalCase(evalCase, candidateForEval("support.refund.prepare_case.valid", {
      committed_capabilities: ["support.unknown.commit"],
      selected_capabilities: ["support.refund.prepare_case"]
    }), registry);
    const suite = runEvalSuite(registry, [
      candidateForEval("support.refund.prepare_case.valid", {}),
      candidateForEval("support.refund.prepare_case.valid", {}),
      candidateForEval("support.unknown.eval", {})
    ], {
      evalIds: ["support.refund.prepare_case.valid"]
    });

    expect(wrongState.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "action_state_matches"
    }));
    expect(strictResult.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "tool_input_exact_json"
    }));
    expect(strictResult.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "no_forbidden_tool_call"
    }));
    expect(unknownCapabilityResult.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "known_tool_call_capabilities"
    }));
    expect(unknownCommittedResult.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "known_committed_capabilities"
    }));
    expect(suite.diagnostics).toContainEqual(expect.objectContaining({ code: "invalid_eval_result" }));
    expect(suite.diagnostics).toContainEqual(expect.objectContaining({ code: "unknown_eval_result" }));
  });

  it("selects deterministic capability slices and builds adapters from a slice", async () => {
    const registry = await loadValidRegistry();
    const slice = selectCapabilitySlice({
      domains: ["support"],
      context: {
        autonomyTier: "A2",
        permissions: ["ticket.read", "refund.case.create"],
        riskCeiling: "medium",
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      },
      registry
    });
    const ticketOnly = selectCapabilitySlice({
      capabilityIds: ["support.ticket.get"],
      context: {
        autonomyTier: "A1",
        permissions: ["ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      },
      registry
    });
    const toolset = buildOpenAIResponsesTools(ticketOnly, {
      context: {
        autonomyTier: "A1",
        permissions: ["ticket.read"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      }
    });

    expect(slice.capabilities.map((capability) => capability.manifest.id)).toEqual([
      "support.refund.prepare_case",
      "support.ticket.get"
    ]);
    expect(slice.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "support.refund.commit_case",
      reason: "restricted"
    }));
    expect(toolset.bindings.map((binding) => binding.capabilityId)).toEqual(["support.ticket.get"]);
  });

  it("builds model-facing tool result envelopes without private diagnostics", () => {
    const ok = okToolResult({
      capability_id: "support.ticket.get",
      capability_version: "1.0.0",
      data: {
        ticket_id: "TCK-1001"
      },
      private_diagnostics: {
        internal: true
      }
    });
    const denied = deniedToolResult({
      capability_id: "support.ticket.get",
      capability_version: "1.0.0",
      policy: {
        reasons: [{ code: "missing_permission", message: "Missing permission." }],
        status: "denied"
      }
    });
    const publicOk = toModelFacingToolResult(ok) as AicfToolResultEnvelope;

    expect(ok.status).toBe("ok");
    expect(denied.status).toBe("denied");
    expect(publicOk.private_diagnostics).toBeUndefined();
  });
});

describe("AICF public conformance fixtures", () => {
  it("valid conformance manifests load, validate, and pass eval scoring", async () => {
    const registry = await loadValidRegistry("conformance/valid");
    const loadedResults = await loadEvalResults("conformance/valid/eval-results/conformance.results.passing.json");
    const suite = runEvalSuite(registry, loadedResults.results);

    expect(registry.capabilityById.has("conformance.note.get")).toBe(true);
    expect(loadedResults.errors).toEqual([]);
    expect(suite.status).toBe("passed");
    expect(suite.summary).toEqual({
      failed: 0,
      passed: 1,
      total: 1
    });
  });

  it("invalid conformance schema fixtures fail validation", async () => {
    const loaded = await loadManifests({ path: "conformance/invalid/schema" });
    const validation = validateManifests(loaded.manifests);

    expect(loaded.errors).toEqual([]);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(expect.objectContaining({
      code: "schema",
      id: "conformance.invalid.missing_required"
    }));
  });

  it("invalid conformance duplicate fixtures fail validation", async () => {
    const loaded = await loadManifests({ path: "conformance/invalid/duplicate" });
    const validation = validateManifests(loaded.manifests);

    expect(loaded.errors).toEqual([]);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(expect.objectContaining({
      code: "duplicate_id",
      id: "conformance.duplicate.get"
    }));
  });

  it("invalid conformance missing-reference fixtures fail validation", async () => {
    const loaded = await loadManifests({ path: "conformance/invalid/missing-reference" });
    const validation = validateManifests(loaded.manifests);

    expect(loaded.errors).toEqual([]);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(expect.objectContaining({
      code: "missing_reference",
      id: "conformance.missing_reference.prepare"
    }));
  });

  it("conformance decision fixtures produce deterministic denial", async () => {
    const registry = await loadValidRegistry("conformance/valid");
    const content = await readFile(
      "conformance/valid/decisions/conformance.note.get.denied_missing_permission.json",
      "utf8"
    );
    const request = JSON.parse(content) as DecisionRequest;
    const result = decideCapability(registry, request);

    expect(result.status).toBe("denied");
    expect(result.reasons).toContainEqual(expect.objectContaining({
      code: "missing_permission"
    }));
  });

  it("conformance OpenAI fixture excludes denied capabilities", async () => {
    const registry = await loadValidRegistry("conformance/valid");
    const content = await readFile("conformance/valid/openai/context.no_permissions.json", "utf8");
    const context = JSON.parse(content) as DecisionRequest["context"];
    const toolset = buildOpenAIResponsesTools(registry, { context });

    expect(toolset.tools).toHaveLength(0);
    expect(toolset.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "conformance.note.get",
      reason: "decision_denied"
    }));
  });

  it("conformance failing eval-result fixture fails scorer checks", async () => {
    const registry = await loadValidRegistry("conformance/valid");
    const loadedResults = await loadEvalResults("conformance/invalid/eval-results/conformance.results.failing.json");
    const suite = runEvalSuite(registry, loadedResults.results);

    expect(loadedResults.errors).toEqual([]);
    expect(suite.status).toBe("failed");
    expect(suite.evals[0]?.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "tool_selection_includes"
    }));
    expect(suite.evals[0]?.scorers).toContainEqual(expect.objectContaining({
      passed: false,
      scorer: "no_unapproved_commit"
    }));
  });
});

interface AdapterToolsetLike {
  bindings: Array<{
    capabilityId: string;
    normalizedInputSchema: Record<string, unknown>;
    restricted: boolean;
    toolName: string;
  }>;
  diagnostics: Array<{ code: string; id?: string }>;
  excluded: Array<{ capabilityId: string; reason: string }>;
  functionDeclarations?: unknown[];
  functions?: unknown[];
  tools?: Record<string, unknown> | unknown[];
}

interface AdapterParseResultLike {
  diagnostics: Array<{ code: string; id?: string }>;
  parsed?: {
    args: Record<string, unknown>;
    capabilityId: string;
  };
  valid: boolean;
}

interface AdapterTestConfig {
  build(
    registry: Awaited<ReturnType<typeof loadValidRegistry>>,
    options: {
      context: DecisionRequest["context"];
      includeRestricted?: boolean;
    }
  ): AdapterToolsetLike;
  label: string;
  malformedCall(): unknown;
  parse(toolset: AdapterToolsetLike, call: unknown): AdapterParseResultLike;
  schemaFailureCall(toolName: string): unknown;
  toName(capabilityId: string): string;
  unknownCall(): unknown;
  validCall(toolName: string): unknown;
}

function nonOpenAiAdapterConfigs(): AdapterTestConfig[] {
  return [
    {
      build: (registry, options) => buildAnthropicClaudeTools(registry, options),
      label: "Anthropic Claude",
      malformedCall: () => ({ name: "aicf_support_ticket_get", type: "tool_use" }),
      parse: (toolset, call) => parseAnthropicClaudeToolUse(
        toolset as Parameters<typeof parseAnthropicClaudeToolUse>[0],
        call as Parameters<typeof parseAnthropicClaudeToolUse>[1]
      ),
      schemaFailureCall: (toolName) => ({
        input: { ticket_id: "bad" },
        name: toolName,
        type: "tool_use"
      }),
      toName: toAnthropicClaudeToolName,
      unknownCall: () => ({
        input: {},
        name: "aicf_missing_tool",
        type: "tool_use"
      }),
      validCall: (toolName) => ({
        id: "toolu_example_1",
        input: { ticket_id: "TCK-1001" },
        name: toolName,
        type: "tool_use"
      })
    },
    {
      build: (registry, options) => buildGeminiFunctionDeclarations(registry, options) as unknown as AdapterToolsetLike,
      label: "Google Gemini",
      malformedCall: () => ({ name: "aicf_support_ticket_get" }),
      parse: (toolset, call) => parseGeminiFunctionCall(
        toolset as Parameters<typeof parseGeminiFunctionCall>[0],
        call as Parameters<typeof parseGeminiFunctionCall>[1]
      ),
      schemaFailureCall: (toolName) => ({
        args: { ticket_id: "bad" },
        name: toolName
      }),
      toName: toGeminiFunctionName,
      unknownCall: () => ({
        args: {},
        name: "aicf_missing_tool"
      }),
      validCall: (toolName) => ({
        args: { ticket_id: "TCK-1001" },
        id: "gemini_call_example_1",
        name: toolName
      })
    },
    {
      build: (registry, options) => buildAiSdkTools(registry, options),
      label: "Vercel AI SDK",
      malformedCall: () => ({ toolName: "aicf_support_ticket_get" }),
      parse: (toolset, call) => parseAiSdkToolCall(
        toolset as Parameters<typeof parseAiSdkToolCall>[0],
        call as Parameters<typeof parseAiSdkToolCall>[1]
      ),
      schemaFailureCall: (toolName) => ({
        input: { ticket_id: "bad" },
        toolName
      }),
      toName: toAiSdkToolName,
      unknownCall: () => ({
        input: {},
        toolName: "aicf_missing_tool"
      }),
      validCall: (toolName) => ({
        input: { ticket_id: "TCK-1001" },
        toolCallId: "call_example_1",
        toolName
      })
    },
    {
      build: (registry, options) => buildMcpToolDescriptors(registry, options),
      label: "Model Context Protocol",
      malformedCall: () => ({ params: { name: "aicf_support_ticket_get" } }),
      parse: (toolset, call) => parseMcpToolCall(
        toolset as Parameters<typeof parseMcpToolCall>[0],
        call as Parameters<typeof parseMcpToolCall>[1]
      ),
      schemaFailureCall: (toolName) => ({
        method: "tools/call",
        params: {
          arguments: { ticket_id: "bad" },
          name: toolName
        }
      }),
      toName: toMcpToolName,
      unknownCall: () => ({
        method: "tools/call",
        params: {
          arguments: {},
          name: "aicf_missing_tool"
        }
      }),
      validCall: (toolName) => ({
        method: "tools/call",
        params: {
          arguments: { ticket_id: "TCK-1001" },
          name: toolName
        }
      })
    },
    {
      build: (registry, options) => buildLangChainToolDescriptors(registry, options),
      label: "LangChain/LangGraph",
      malformedCall: () => ({ name: "aicf_support_ticket_get" }),
      parse: (toolset, call) => parseLangChainToolCall(
        toolset as Parameters<typeof parseLangChainToolCall>[0],
        call as Parameters<typeof parseLangChainToolCall>[1]
      ),
      schemaFailureCall: (toolName) => ({
        args: { ticket_id: "bad" },
        name: toolName
      }),
      toName: toLangChainToolName,
      unknownCall: () => ({
        args: {},
        name: "aicf_missing_tool"
      }),
      validCall: (toolName) => ({
        args: { ticket_id: "TCK-1001" },
        id: "lc_call_example_1",
        name: toolName
      })
    },
    {
      build: (registry, options) => buildSemanticKernelFunctions(registry, options) as unknown as AdapterToolsetLike,
      label: "Semantic Kernel",
      malformedCall: () => ({ functionName: "aicf_support_ticket_get" }),
      parse: (toolset, call) => parseSemanticKernelFunctionCall(
        toolset as Parameters<typeof parseSemanticKernelFunctionCall>[0],
        call as Parameters<typeof parseSemanticKernelFunctionCall>[1]
      ),
      schemaFailureCall: (toolName) => ({
        arguments: { ticket_id: "bad" },
        functionName: `aicf.${toolName}`
      }),
      toName: toSemanticKernelFunctionName,
      unknownCall: () => ({
        arguments: {},
        functionName: "aicf.aicf_missing_tool"
      }),
      validCall: (toolName) => ({
        arguments: { ticket_id: "TCK-1001" },
        functionName: `aicf.${toolName}`,
        id: "sk_call_example_1"
      })
    }
  ];
}

async function loadValidRegistry(manifestPath = "examples") {
  const loaded = await loadManifests({ path: manifestPath });
  const validation = validateManifests(loaded.manifests);
  if (loaded.errors.length > 0 || !validation.valid) {
    throw new Error(`Expected ${manifestPath} to load and validate.`);
  }

  return buildRegistry(loaded.manifests);
}

async function readOpenAIContextExample(): Promise<DecisionRequest["context"]> {
  const content = await readFile("examples/support/openai/context.support_agent.json", "utf8");
  return JSON.parse(content) as DecisionRequest["context"];
}

async function readDecisionExample(
  fileName: string,
  directory = "examples/support/decisions"
): Promise<DecisionRequest> {
  const content = await readFile(path.join(directory, fileName), "utf8");
  return JSON.parse(content) as DecisionRequest;
}

function loadedEval(registry: Awaited<ReturnType<typeof loadValidRegistry>>, evalId: string): LoadedEvalCase {
  const evalCase = registry.evals.find((candidate) => candidate.manifest.id === evalId);
  if (!evalCase) {
    throw new Error(`Expected eval ${evalId}.`);
  }

  return evalCase;
}

function candidateForEval(
  evalId: string,
  overrides: Partial<EvalCandidateResult>
): EvalCandidateResult {
  return {
    eval_id: evalId,
    action_state: "prepared",
    committed_capabilities: [],
    selected_capabilities: [],
    tool_calls: [],
    ...overrides
  };
}

async function writeTemporaryEvalResults(fixture: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "aicf-eval-"));
  const filePath = path.join(directory, "results.json");
  await writeFile(filePath, JSON.stringify(fixture, null, 2), "utf8");
  return filePath;
}

function packageDryRunFiles(): string[] {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = npmExecPath ? [npmExecPath, "pack", "--dry-run", "--json"] : ["pack", "--dry-run", "--json"];
  const output = execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const packResult = JSON.parse(output) as Array<{
    files: Array<{ path: string }>;
  }>;
  return packResult[0].files.map((file) => file.path.replaceAll("\\", "/")).sort();
}

function listPublicDocsAndExamples(): string[] {
  if (existsSync(".git")) {
    try {
      return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "README.md", "docs", "examples"], {
        encoding: "utf8"
      })
        .split(/\r?\n/)
        .filter(Boolean)
        .map((file) => file.replaceAll("\\", "/"))
        .sort();
    } catch {
      // Fall through to filesystem traversal for source archives without usable Git.
    }
  }

  const files: string[] = [];
  for (const root of ["README.md", "docs", "examples"]) {
    collectPublicFiles(root, files);
  }
  return files.sort();
}

function collectPublicFiles(filePath: string, files: string[]): void {
  if (!existsSync(filePath) || shouldSkipPublicWalkPath(filePath)) {
    return;
  }

  const stat = statSync(filePath);
  if (stat.isFile()) {
    files.push(filePath.replaceAll("\\", "/"));
    return;
  }

  if (stat.isDirectory()) {
    for (const child of readdirSync(filePath)) {
      collectPublicFiles(path.join(filePath, child), files);
    }
  }
}

function shouldSkipPublicWalkPath(filePath: string): boolean {
  const segments = filePath.replaceAll("\\", "/").split("/");
  const skipped = new Set([
    ".cache",
    "_private",
    "coverage",
    "dist",
    "local",
    "logs",
    "node_modules",
    "private",
    "traces"
  ]);
  return segments.some((segment) => skipped.has(segment));
}

function loadedCapability(filePath: string, manifest: CapabilityManifest): LoadedCapabilityManifest {
  return {
    absolutePath: path.resolve(filePath),
    kind: "capability",
    manifest,
    path: filePath
  };
}

function cloneManifest<T>(manifest: T): T {
  return JSON.parse(JSON.stringify(manifest)) as T;
}

function createWritableBuffer(): { value: string; write(chunk: string): void } {
  return {
    value: "",
    write(chunk: string) {
      this.value += chunk;
    }
  };
}

function adapterExportedCount(output: {
  functionDeclarations?: unknown[];
  functions?: unknown[];
  tools?: Record<string, unknown> | unknown[];
}): number {
  if (Array.isArray(output.tools)) {
    return output.tools.length;
  }

  if (output.tools && typeof output.tools === "object") {
    return Object.keys(output.tools).length;
  }

  if (output.functionDeclarations) {
    return output.functionDeclarations.length;
  }

  if (output.functions) {
    return output.functions.length;
  }

  return 0;
}
