import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkGettingStarted } from "./check-getting-started.mjs";

/** Runs against a tarball-installed consumer, using only documented package imports. */
export async function checkDiscoveryInstall({ directory, repoRoot, npmCommand, npmArgs }) {
  const packageDirectory = path.join(directory, "node_modules/ai-capability-framework");
  await writeFile(path.join(directory, "no-network.mjs"), "globalThis.fetch = async () => { throw new Error('Network forbidden in mock examples.'); };\n");
  // Prove the user's first app before installing the qualification-only compiler.
  await checkGettingStarted({ directory, packageDirectory, npmCommand, npmArgs });
  const dependencies = {};
  for (const name of ["typescript", "@types/node"]) {
    const metadata = JSON.parse(await readFile(path.join(repoRoot, "node_modules", name, "package.json"), "utf8"));
    dependencies[name] = metadata.version;
  }
  execFileSync(npmCommand, npmArgs("install", "--save-dev", "--ignore-scripts", "--no-audit", "--no-fund",
    ...Object.entries(dependencies).map(([name, version]) => `${name}@${version}`)), { cwd: directory, stdio: "pipe" });

  const typeFixture = `
    import { buildRegistry } from "ai-capability-framework";
    import { DefaultContextBuilder, createAicfProviderRun, type AicfRuntimeContext, type ProviderBudgetLedger } from "ai-capability-framework/runtime";
    import { createOpenAISelectionClient, type CreateOpenAISelectionClientOptions } from "ai-capability-framework/openai";
    import { createCapabilityDiscovery, createInMemoryDiscoveryBudget, evaluateCapabilityDiscovery,
      type CapabilityDiscoveryResult, type EmbeddingClient, type SelectionModelClient,
      type DiscoveryEvaluationSuite, type DiscoveryEvaluationObservations } from "ai-capability-framework/discovery";
    const configuration = { provider: "mock", model: "mock-model", configurationId: "mock.v1" };
    const selection: SelectionModelClient = { mock: true, configuration,
      generateStructured: async input => ({ output: { schema_version: "1.0", decisions: [] }, providerAttempts: 1 }) };
    const embedding: EmbeddingClient = { mock: true, configuration,
      embed: async input => ({ vectors: input.texts.map(() => [1]), configuration, vectorDimension: 1, providerAttempts: 1 }) };
    const ledger: ProviderBudgetLedger = {
      reserve: async input => ({ status: "reserved", reservationId: input.requestId }), settle: async () => {}
    };
    const budget = createInMemoryDiscoveryBudget({ runId: "run_example", maxProviderCalls: 2, maxInputTokens: 100, maxOutputTokens: 100 });
    const discovery = createCapabilityDiscovery({ registry: buildRegistry([]), contextBuilder: new DefaultContextBuilder() });
    async function application(runtimeContext: AicfRuntimeContext) {
      const results: readonly CapabilityDiscoveryResult[] = await discovery.search({ tasks: [{ id: "read-ticket", text: "Read ticket TCK-100." }], runtimeContext });
      const router = discovery.routerFor(results[0]!);
      const batch = await discovery.select({ results, client: selection, budget, maxInputTokens: 50, maxOutputTokens: 20 });
      return discovery.routerFor(batch, "read-ticket");
    }
    const scopedEvaluation: Parameters<typeof evaluateCapabilityDiscovery>[0]["caseIds"] = ["synthetic.task"];
    export { application, selection, embedding, ledger, createAicfProviderRun, createOpenAISelectionClient, evaluateCapabilityDiscovery, scopedEvaluation };
    export type { CreateOpenAISelectionClientOptions, DiscoveryEvaluationSuite, DiscoveryEvaluationObservations };
  `;
  await writeFile(path.join(directory, "discovery-consumer.mts"), typeFixture);
  await writeFile(path.join(directory, "stable-consumer.mts"), `
    import type { ManifestRegistry } from "ai-capability-framework";
    import { createCapabilityDiscovery, type CapabilitySearchRequest, type CapabilityResultRouter } from "ai-capability-framework/discovery";
    import { DefaultContextBuilder, type AicfRuntimeContext, type AicfToolExecutor, type AicfCapabilityRouter } from "ai-capability-framework/runtime";
    import { runOpenAIResponses, type AicfOpenAIResponsesClient } from "ai-capability-framework/openai";
    export async function application(registry: ManifestRegistry, runtimeContext: AicfRuntimeContext,
      client: AicfOpenAIResponsesClient, executor: AicfToolExecutor, signal?: AbortSignal) {
      const discovery = createCapabilityDiscovery({ registry, mode: "lexical" });
      const request: CapabilitySearchRequest = { tasks: [{ id: "read-ticket", text: "Read ticket TCK-100." }],
        runtimeContext, signal, deadlineAt: Date.now() + 10000, eligibility: { allowedCapabilityTypes: ["read_data"] } };
      const [result] = await discovery.search(request);
      if (result?.status !== "matched") return { outcome: result?.status };
      const resultRouter: CapabilityResultRouter = discovery.routerFor(result);
      const router: AicfCapabilityRouter = resultRouter;
      return runOpenAIResponses({ registry, runtimeContext, client, executor, model: "host-model",
        contextBuilder: new DefaultContextBuilder(), router, userInput: { text: request.tasks[0]!.text } });
    }
  `);
  execFileSync(process.execPath, [path.join(directory, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict",
    "--skipLibCheck", "false", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "node",
    "discovery-consumer.mts", "stable-consumer.mts"], { cwd: directory, stdio: "pipe" });

  await writeFile(path.join(directory, "discovery-imports.mjs"), `
    import { createRequire } from "node:module";
    import { readFile } from "node:fs/promises";
    import { createCapabilityDiscovery, evaluateCapabilityDiscovery } from "ai-capability-framework/discovery";
    import { buildRegistry } from "ai-capability-framework";
    import { createOpenAISelectionClient } from "ai-capability-framework/openai";
    const require = createRequire(import.meta.url);
    for (const name of ["openai", "@openai/agents", "@anthropic-ai/sdk", "@google/genai"]) {
      try { require.resolve(name); throw new Error("Unexpected optional SDK: " + name); }
      catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
    }
    for (const name of ["metadata", "embedding-index", "selection-response", "eval-suite", "eval-observations"]) {
      const schema = await import("ai-capability-framework/schemas/discovery/" + name + ".schema.json", { with: { type: "json" } });
      if (!schema.default.$schema) throw new Error("Invalid schema import.");
    }
    const replaySchema = await import("ai-capability-framework/schemas/replay/discovery-snapshot.schema.json", { with: { type: "json" } });
    if (!replaySchema.default.$schema) throw new Error("Missing replay schema.");
    if (typeof createCapabilityDiscovery !== "function" || typeof evaluateCapabilityDiscovery !== "function" || typeof createOpenAISelectionClient !== "function") throw new Error("Missing discovery exports.");
    const packageData = JSON.parse(await readFile(new URL(import.meta.resolve("ai-capability-framework/package.json")), "utf8"));
    if (packageData.version !== "${JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")).version}") throw new Error("Wrong packed version.");
    if (buildRegistry([]).capabilities.length !== 0) throw new Error("Core import failed.");
  `);
  execFileSync(process.execPath, ["discovery-imports.mjs"], { cwd: directory, stdio: "pipe" });
  for (const file of ["run-mock.mjs", "run-hybrid-mock.mjs", "run-customer-mock.mjs", "run-selector-mock.mjs", "run-pipeline-mock.mjs", "run-evaluation-mock.mjs", "run-evaluation-live.mjs"]) {
    const output = execFileSync(process.execPath, ["--import", pathToFileURL(path.join(directory, "no-network.mjs")).href,
      path.join(packageDirectory, "examples/12-capability-discovery-selection", file)], { cwd: directory, encoding: "utf8", stdio: "pipe" });
    JSON.parse(output);
  }
  console.log("Discovery consumer: strict types, six schema imports, optional-SDK isolation, six mock commands and offline campaign preflight passed.");
}
