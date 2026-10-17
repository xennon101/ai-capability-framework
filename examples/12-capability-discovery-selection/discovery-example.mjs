import { fileURLToPath } from "node:url";
import {
  buildRegistry,
  loadManifests,
  toOpenAIResponsesToolName,
  validateManifests
} from "ai-capability-framework";
import {
  AicfActionLifecycleManager,
  AicfHandlerRegistry,
  AicfToolExecutor,
  buildRuntimeContext,
  DefaultContextBuilder,
  DefaultPolicyBroker,
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemoryIdempotencyStore,
  InMemoryPreparedActionStore,
  StaticAuthPlatformAdapter
} from "ai-capability-framework/runtime";
import {
  CapabilityDiscoverer,
  RetrievalCapabilityRouter
} from "ai-capability-framework/discovery";
import {
  MockOpenAIResponsesClient,
  mockFunctionCallResponse,
  mockTextResponse,
  runOpenAIResponses
} from "ai-capability-framework/openai";
import { retrievalCases } from "./retrieval-cases.mjs";

export const discoveryConfiguration = {
  mode: "lexical",
  policyVersion: "example.lexical.v1",
  limits: { maxCandidates: 2 }
};

export async function createDiscoveryExample() {
  const loaded = await loadManifests({
    path: fileURLToPath(new URL("../support/", import.meta.url))
  });
  if (loaded.errors.length || !validateManifests(loaded.manifests).valid) {
    throw new Error("The synthetic support manifests must validate.");
  }
  const registry = buildRegistry(loaded.manifests);
  const runtimeContext = await buildRuntimeContext({
    adapter: new StaticAuthPlatformAdapter({
      account: { accountId: "account_example", tenantId: "tenant_example" },
      subject: {
        userId: "user_example",
        roles: ["support_agent"],
        permissions: ["ticket.read", "refund.case.create"]
      }
    }),
    autonomy: {
      autonomyTier: "A2",
      maxRiskTier: "medium",
      allowSideEffects: true,
      allowExternalMessages: false,
      allowMoneyMovement: false,
      allowPermissionChanges: false
    },
    environment: "test",
    runId: "run_example",
    requestId: "request_example"
  });
  const userInput = { text: "Read ticket TCK-100." };
  const contextBuilder = new DefaultContextBuilder();
  const builtContext = await contextBuilder.build({
    baseContext: runtimeContext,
    registry,
    userInput
  });
  const handlers = new AicfHandlerRegistry({ registry });
  const readCalls = [];
  handlers.register({
    capabilityId: "support.ticket.get",
    read: ({ args }) => {
      readCalls.push(args.ticket_id);
      return {
        ticket: { ticket_id: args.ticket_id, status: "open", order_id: "ORD-100" }
      };
    }
  });
  const policyBroker = new DefaultPolicyBroker();
  const auditSink = new InMemoryAuditSink();
  const lifecycle = new AicfActionLifecycleManager({
    registry,
    handlers,
    policyBroker,
    auditSink,
    approvalStore: new InMemoryApprovalStore(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    preparedActionStore: new InMemoryPreparedActionStore()
  });
  const executor = new AicfToolExecutor({
    registry,
    handlers,
    policyBroker,
    auditSink,
    actionLifecycle: lifecycle
  });
  const router = new RetrievalCapabilityRouter({
    mode: "native_tool_selection",
    discovery: discoveryConfiguration
  });
  return {
    registry,
    runtimeContext,
    builtContext,
    contextBuilder,
    userInput,
    executor,
    router,
    readCalls
  };
}

export async function runDiscoveryExample() {
  const harness = await createDiscoveryExample();
  const routeRequest = {
    registry: harness.registry,
    builtContext: harness.builtContext,
    userInput: harness.userInput
  };
  const batch = await new CapabilityDiscoverer(discoveryConfiguration).discover({
    routeRequest,
    runId: harness.runtimeContext.runId,
    requestId: harness.runtimeContext.requestId,
    queries: retrievalCases.map(({ id, fragments }) => ({ id, fragments }))
  });
  for (const [index, result] of batch.entries()) {
    const fixture = retrievalCases[index];
    const ids = result.candidates.map((candidate) => candidate.capabilityId);
    if (
      ids.some(
        (id) => !fixture.compatibleIds.includes(id) || fixture.forbiddenIds.includes(id)
      ) ||
      fixture.compatibleIds.some((id) => !ids.includes(id))
    ) {
      throw new Error("Retrieval fixture failed: " + fixture.id);
    }
  }
  const routed = await harness.router.routeWithDiagnostics(routeRequest);
  const client = new MockOpenAIResponsesClient([
    mockFunctionCallResponse({
      name: toOpenAIResponsesToolName("support.ticket.get"),
      args: { ticket_id: "TCK-100" },
      callId: "call_example"
    }),
    mockTextResponse("Ticket TCK-100 is open.", "response_example")
  ]);
  const loop = await runOpenAIResponses({
    ...harness,
    client,
    model: "mock-model"
  });
  if (loop.status !== "completed" || loop.toolResults[0]?.status !== "success") {
    throw new Error("The mocked ordinary model/tool loop must complete.");
  }
  return {
    fixtureResults: batch.map(({ queryId, status, candidates }) => ({
      queryId,
      status,
      capabilityIds: candidates.map((candidate) => candidate.capabilityId)
    })),
    slice: routed.slice,
    exportedToolNames: client.requests[0].tools.map((tool) => tool.name),
    discoveryUsage: routed.discovery[0].usage,
    ordinaryMockModelTurns: client.requests.length,
    toolStatus: loop.toolResults[0].status,
    finalText: loop.finalText
  };
}
