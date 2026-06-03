import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  formatInspection,
  loadEvalResults,
  inspectRegistry,
  loadManifests,
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
  toAiSdkToolName,
  toAnthropicClaudeToolName,
  toGeminiFunctionName,
  toLangChainToolName,
  toMcpToolName,
  toOpenAIResponsesToolName,
  toSemanticKernelFunctionName,
  validateManifests,
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
    expect(stdout.value).toContain("Validated 16 manifest(s).");
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
      "evaluateLifecycle",
      "evaluatePolicy",
      "formatEvalSuiteResult",
      "formatInspection",
      "inspectRegistry",
      "kindFromPath",
      "loadEvalResults",
      "loadManifests",
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
      "toAiSdkToolName",
      "toAnthropicClaudeToolName",
      "toGeminiFunctionName",
      "toLangChainToolName",
      "toMcpToolName",
      "toOpenAIResponsesToolName",
      "toSemanticKernelFunctionName",
      "validateManifests"
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
      "eval"
    ]) {
      expect(stdout.value).toContain(command);
    }
  });

  it("package dry-run contains public assets and excludes private or source-only material", () => {
    const files = packageDryRunFiles();
    const requiredFiles = [
      "CHANGELOG.md",
      "CONTRIBUTING.md",
      "LICENSE",
      "README.md",
      "SECURITY.md",
      "conformance/valid/capabilities/conformance.note.get.yaml",
      "conformance/invalid/schema/capabilities/conformance.invalid.missing_required.yaml",
      "dist/index.js",
      "dist/cli.js",
      "docs/adapters.md",
      "docs/api.md",
      "docs/control-plane.md",
      "docs/eval-runner.md",
      "docs/host-responsibilities.md",
      "docs/interoperability.md",
      "docs/migration-0.1-to-1.0.md",
      "docs/openai-responses.md",
      "examples/eval-results/public.results.passing.json",
      "examples/scheduling/capabilities/scheduling.invite.prepare.yaml",
      "examples/support/capabilities/support.ticket.get.yaml",
      "examples/support/eval-results/support.results.passing.json",
      "schemas/capability-manifest.schema.json",
      "schemas/eval-result.schema.json"
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
        permissions: ["ticket.read"]
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
        permissions: ["refund.case.create", "ticket.read"]
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
        permissions: []
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
        permissions: ["ticket.read"]
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
        permissions: ["refund.case.create", "ticket.read"]
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
        permissions: ["refund.case.create", "ticket.read"]
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
        permissions: ["refund.case.commit"]
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
        permissions: ["refund.case.commit"]
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
        permissions: ["refund.case.commit"]
      },
      includeRestricted: true
    });
    const deniedToolset = buildOpenAIResponsesTools(registry, {
      context: {
        autonomyTier: "A0",
        permissions: []
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
        permissions: ["ticket.read"]
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
        permissions: ["ticket.read"]
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
          permissions: ["refund.case.commit"]
        },
        includeRestricted: true
      });
      const deniedToolset = adapter.build(registry, {
        context: {
          autonomyTier: "A0",
          permissions: []
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
          permissions: ["ticket.read"]
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
          permissions: ["ticket.read"]
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
