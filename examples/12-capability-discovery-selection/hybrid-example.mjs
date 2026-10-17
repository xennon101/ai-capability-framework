import {
  buildCapabilitySearchCorpus,
  buildCapabilityEmbeddingIndex,
  CapabilityDiscoverer,
  RetrievalCapabilityRouter,
  aggregateDiscoveryUsage,
  publishCapabilityEmbeddingIndex,
  loadCapabilityEmbeddingIndex
} from "ai-capability-framework/discovery";
import { toOpenAIResponsesToolName } from "ai-capability-framework";
import {
  MockOpenAIResponsesClient,
  mockFunctionCallResponse,
  mockTextResponse,
  runOpenAIResponses
} from "ai-capability-framework/openai";
import { createDiscoveryExample } from "./discovery-example.mjs";
import {
  DeterministicMockEmbeddingClient,
  MockDiscoveryBudget,
  embeddingIndexLimits,
  embeddingExecution
} from "./mock-embeddings.mjs";

export async function runHybridExample() {
  const harness = await createDiscoveryExample();
  const corpus = buildCapabilitySearchCorpus(harness.registry);
  const client = new DeterministicMockEmbeddingClient();
  const budget = new MockDiscoveryBudget();
  const deadlineAt = Date.now() + 30_000;
  const built = await buildCapabilityEmbeddingIndex({
    corpus,
    client,
    budget,
    execution: embeddingExecution,
    limits: embeddingIndexLimits,
    batchSize: 3,
    maxProviderCalls: 1,
    runId: harness.runtimeContext.runId,
    requestId: harness.runtimeContext.requestId,
    deadlineAt
  });
  if (built.status !== "built") throw new Error("The mock index build must succeed.");

  // The host chooses storage. This example never writes vectors to disk.
  const artifacts = new Map();
  const store = {
    read: async (key) => artifacts.get(key) ?? null,
    replace: async (key, value) => {
      artifacts.set(key, value);
    }
  };
  const expected = {
    corpus,
    configuration: client.configuration,
    mock: true,
    limits: embeddingIndexLimits
  };
  const published = await publishCapabilityEmbeddingIndex(
    store,
    "example-index",
    built.index,
    expected
  );
  const loaded = await loadCapabilityEmbeddingIndex(store, "example-index", expected);
  if (!published.published || !loaded.valid) {
    throw new Error("Host storage must round-trip a complete validated index.");
  }
  const configuration = {
    mode: "hybrid",
    policyVersion: "example.hybrid.v1",
    weights: { semantic: 0.75, lexical: 0.25 },
    failurePolicy: "unavailable",
    limits: { maxCandidates: 2 }
  };
  const embedding = {
    client,
    index: loaded.index,
    indexLimits: embeddingIndexLimits,
    execution: embeddingExecution
  };
  const request = {
    registry: harness.registry,
    builtContext: harness.builtContext,
    userInput: { text: "case details" },
    budget,
    deadlineAt
  };
  const router = new RetrievalCapabilityRouter({
    mode: "native_tool_selection",
    discovery: configuration,
    embedding
  });
  const routed = await router.routeWithDiagnostics(request);
  const ordinaryClient = new MockOpenAIResponsesClient([
    mockFunctionCallResponse({
      name: toOpenAIResponsesToolName("support.ticket.get"),
      args: { ticket_id: "TCK-100" },
      callId: "call_hybrid_example"
    }),
    mockTextResponse("Ticket TCK-100 is open.", "response_hybrid_example")
  ]);
  const ordinaryLoopDiscovery = [];
  const loop = await runOpenAIResponses({
    ...harness,
    userInput: request.userInput,
    router: {
      route: async (routeRequest) => {
        const result = await router.routeWithDiagnostics({
          ...routeRequest,
          budget,
          deadlineAt
        });
        ordinaryLoopDiscovery.push(...result.discovery);
        return result.slice;
      }
    },
    client: ordinaryClient,
    model: "mock-model"
  });
  if (loop.status !== "completed" || loop.toolResults[0]?.status !== "success") {
    throw new Error("The ordinary mocked runtime must complete an authorized read.");
  }
  const invalid = structuredClone(loaded.index);
  invalid.entries[0].capabilityId = "support.ticket.substituted";
  const discoveryRequest = {
    routeRequest: { ...request, userInput: { text: "ticket" } },
    runId: harness.runtimeContext.runId,
    requestId: harness.runtimeContext.requestId,
    queries: [{ id: "invalid-index", fragments: [{ key: "request", text: "ticket" }] }],
    budget,
    deadlineAt
  };
  const before = client.calls.length;
  const rejected = await new CapabilityDiscoverer(configuration, {
    embedding: { ...embedding, index: invalid }
  }).discover(discoveryRequest);
  const fallback = await new CapabilityDiscoverer(
    { ...configuration, failurePolicy: "lexical_fallback" },
    { embedding: { ...embedding, index: invalid } }
  ).discover(discoveryRequest);
  if (
    rejected[0].status !== "unavailable" ||
    fallback[0].actualMode !== "lexical" ||
    client.calls.length !== before
  ) {
    throw new Error(
      "Invalid indexes must reject or explicitly fall back before a query call."
    );
  }
  const embeddingStages = [
    ...built.usage.stages,
    ...routed.discovery.flatMap((result) => result.usage.stages),
    ...ordinaryLoopDiscovery.flatMap((result) => result.usage.stages)
  ];
  return {
    mock: true,
    slice: routed.slice,
    discovery: routed.discovery,
    indexFingerprint: loaded.index.indexFingerprint,
    buildUsage: built.usage,
    embeddingUsage: aggregateDiscoveryUsage(
      embeddingStages,
      embeddingStages.reduce((total, stage) => total + stage.elapsedMs, 0)
    ),
    logicalEmbeddingAttempts: client.calls.length,
    invalidIndexStatus: rejected[0].status,
    invalidIndexQueryCalls: client.calls.length - before,
    fallbackMode: fallback[0].actualMode,
    fallbackReason: fallback[0].degradedReason,
    ordinaryMockModelTurns: ordinaryClient.requests.length,
    toolStatus: loop.toolResults[0].status
  };
}
