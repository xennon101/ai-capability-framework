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
        ["langfuse", "ai-capability-framework/langfuse", "LangfuseTraceSink"],
        ["evals-live", "ai-capability-framework/evals-live", "runLiveEvalSuite"],
        ["promptfoo", "ai-capability-framework/promptfoo", "exportPromptfooSuite"],
        ["aws", "ai-capability-framework/aws", "DynamoDbPreparedActionStore"],
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
