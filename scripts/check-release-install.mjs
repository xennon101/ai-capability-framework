import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const keepTmp = process.env.AICF_KEEP_TMP === "1";
const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const npmArgs = (...args) => npmExecPath ? [npmExecPath, ...args] : args;
const repoRoot = process.cwd();
let tarballPath;
let tempDirectory;

try {
  const packOutput = execFileSync(npmCommand, npmArgs("pack", "--json"), {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const packResult = JSON.parse(packOutput)[0];
  tarballPath = path.resolve(repoRoot, packResult.filename);
  tempDirectory = await mkdtemp(path.join(tmpdir(), "aicf-release-install-"));

  execFileSync(npmCommand, npmArgs("init", "-y"), {
    cwd: tempDirectory,
    stdio: "ignore"
  });
  execFileSync(npmCommand, npmArgs("install", "--omit=dev", tarballPath), {
    cwd: tempDirectory,
    stdio: "pipe"
  });
  execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    `
      const root = await import("ai-capability-framework");
      if (!root.loadManifests || !root.decideCapability) throw new Error("Missing expected root exports.");

      const subpaths = [
        ["runtime", "ai-capability-framework/runtime", "DefaultCapabilityRouter"],
        ["openai", "ai-capability-framework/openai", "runOpenAIResponses"],
        ["observability", "ai-capability-framework/observability", "CollectingTraceSink"],
        ["governance", "ai-capability-framework/governance", "compileCapabilityRisk"],
        ["governance-gate", "ai-capability-framework/governance", "runGovernanceGate"],
        ["audit", "ai-capability-framework/audit", "DefaultAuditLedger"],
        ["security", "ai-capability-framework/security", "redactForTrace"],
        ["controls", "ai-capability-framework/controls", "DefaultControlsEvaluator"],
        ["control-plane", "ai-capability-framework/control-plane", "createControlPlaneService"],
        ["replay", "ai-capability-framework/replay", "runReplay"],
        ["security-packs", "ai-capability-framework/security-packs", "listSecurityPacks"],
        ["conformance", "ai-capability-framework/conformance", "runConformanceSuite"],
        ["langfuse", "ai-capability-framework/langfuse", "LangfuseTraceSink"],
        ["evals-live", "ai-capability-framework/evals-live", "runLiveEvalSuite"],
        ["evalops", "ai-capability-framework/evalops", "exportBraintrustDataset"],
        ["evidence", "ai-capability-framework/evidence", "createEvidencePack"],
        ["memory", "ai-capability-framework/memory", "selectGovernedMemory"],
        ["provenance", "ai-capability-framework/provenance", "createGeneratedContentProvenance"],
        ["promptfoo", "ai-capability-framework/promptfoo", "exportPromptfooSuite"],
        ["aws", "ai-capability-framework/aws", "DynamoDbControlPlaneStore"],
        ["mcp-server", "ai-capability-framework/mcp-server", "AicfMcpServer"],
        ["providers", "ai-capability-framework/providers", "createProviderToolNameMap"],
        ["providers/ai-sdk", "ai-capability-framework/providers/ai-sdk", "buildAiSdkTools"],
        ["providers/anthropic", "ai-capability-framework/providers/anthropic", "runAnthropicMessages"],
        ["providers/conformance", "ai-capability-framework/providers/conformance", "runProviderConformanceSuite"],
        ["providers/gemini", "ai-capability-framework/providers/gemini", "runGeminiGenerateContent"],
        ["providers/langchain", "ai-capability-framework/providers/langchain", "buildLangChainTools"],
        ["providers/mcp", "ai-capability-framework/providers/mcp", "buildMcpProviderToolDescriptors"],
        ["providers/semantic-kernel", "ai-capability-framework/providers/semantic-kernel", "exportSemanticKernelOpenApiPlugin"]
      ];

      for (const [label, specifier, exportName] of subpaths) {
        const imported = await import(specifier);
        if (!imported[exportName]) {
          throw new Error(\`Missing expected \${label} export: \${exportName}\`);
        }
      }

      const governance = await import("ai-capability-framework/governance");
      const gateConfig = await governance.loadGovernanceGateConfig(process.cwd());
      if (gateConfig.config.schema_version !== "1.0") {
        throw new Error("Governance gate config fallback did not load.");
      }
      const gateText = governance.formatGovernanceGateReport({
        checks: [],
        environment: "production",
        exitCode: 0,
        failures: [],
        generatedAt: "1970-01-01T00:00:00.000Z",
        manifestRoot: ".",
        passed: true,
        schema_version: "1.0",
        summary: { failed: 0, passed: 0, skipped: 0, warnings: 0 },
        warnings: []
      }, "text");
      if (!gateText.includes("AICF governance gate passed")) {
        throw new Error("Governance gate formatter did not return expected text.");
      }

      const evidence = await import("ai-capability-framework/evidence");
      const evidenceValidation = evidence.validateEvidencePack({
        aicfVersion: "1.0.0-rc.1",
        approvalSummary: { approved: 0, pending: 0, rejected: 0, status: "not_supplied", total: 0 },
        capabilityInventory: [],
        conformanceSummary: { failed: 0, gaps: 1, passed: 0, providers: 0, status: "not_supplied", total: 0, warnings: 0 },
        disclaimers: evidence.evidenceDisclaimers(),
        evalSummary: { failed: 0, gaps: 0, passed: 0, status: "not_supplied", total: 0, warnings: 0 },
        gaps: [],
        generatedAt: "1970-01-01T00:00:00.000Z",
        humanReviewPolicySummary: { approvalRequiredCapabilities: 0, humanReviewRequiredCapabilities: 0, status: "available" },
        mappings: [],
        policyInventory: [],
        project: { id: "release-install", name: "Release Install" },
        providerInventory: [],
        redaction: { content: "redacted_refs_and_hashes_only", omitted: ["raw prompts"] },
        retentionSummary: { rawPromptRetention: "none", rawProviderPayloadRetention: "none", status: "available" },
        riskInventory: [],
        schemaVersion: "1.0",
        securitySummary: { failed: 0, gaps: 0, missingRequired: 0, passed: 0, status: "not_supplied", total: 0, warnings: 0 }
      });
      if (!evidenceValidation.valid) {
        throw new Error("Evidence pack schema validation failed in release install smoke test.");
      }

      const provenance = await import("ai-capability-framework/provenance");
      const provenanceRecord = provenance.createGeneratedContentProvenance({
        capabilityRefs: [{ capabilityId: "release.install.example", operation: "read", version: "1.0.0" }],
        contentId: "release-install-provenance",
        contentType: "text",
        createdAt: "1970-01-01T00:00:00.000Z",
        generatedBy: "model_assisted_human",
        modelRefs: ["release-install-model"],
        providerRefs: [{ providerId: "mock", runId: "release-install-run" }],
        sourceRefs: [{
          contentHash: provenance.hashProvenanceValue("release install source"),
          sourceId: "release-install-source",
          sourceType: "tool_result",
          trust: "tool_result"
        }]
      });
      if (!provenance.validateGeneratedContentProvenance(provenanceRecord).valid) {
        throw new Error("Generated content provenance schema validation failed in release install smoke test.");
      }

      const openai = await import("ai-capability-framework/openai");
      try {
        await openai.createDefaultOpenAIResponsesClient();
        throw new Error("Expected missing OpenAI SDK error.");
      } catch (error) {
        if (error?.code !== "missing_openai_sdk") throw error;
      }
      try {
        await openai.createDefaultAgentsSdkBridgeFactory();
        throw new Error("Expected missing Agents SDK error.");
      } catch (error) {
        if (error?.code !== "missing_agents_sdk") throw error;
      }

      const anthropic = await import("ai-capability-framework/providers/anthropic");
      try {
        await anthropic.createDefaultAnthropicMessagesClient();
        throw new Error("Expected missing Anthropic SDK error.");
      } catch (error) {
        if (error?.code !== "provider_dependency_missing") throw error;
      }

      const gemini = await import("ai-capability-framework/providers/gemini");
      try {
        await gemini.createDefaultGeminiClient();
        throw new Error("Expected missing Google GenAI SDK error.");
      } catch (error) {
        if (error?.code !== "provider_dependency_missing") throw error;
      }

      const aiSdk = await import("ai-capability-framework/providers/ai-sdk");
      try {
        await aiSdk.createDefaultAiSdkToolFactories();
        throw new Error("Expected missing AI SDK error.");
      } catch (error) {
        if (error?.code !== "provider_dependency_missing") throw error;
      }

      const langchain = await import("ai-capability-framework/providers/langchain");
      try {
        await langchain.createDefaultLangChainToolFactory();
        throw new Error("Expected missing LangChain SDK error.");
      } catch (error) {
        if (error?.code !== "provider_dependency_missing") throw error;
      }
    `
  ], {
    cwd: tempDirectory,
    stdio: "pipe"
  });
  execFileSync(npmCommand, npmArgs("exec", "--", "aicf", "--help"), {
    cwd: tempDirectory,
    stdio: "pipe"
  });

  console.log(`Release install smoke test passed in ${tempDirectory}.`);
} finally {
  if (!keepTmp && tempDirectory) {
    await rm(tempDirectory, { force: true, recursive: true });
  }

  if (!keepTmp && tarballPath) {
    await rm(tarballPath, { force: true });
  }
}
