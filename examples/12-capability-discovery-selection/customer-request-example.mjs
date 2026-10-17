import { toOpenAIResponsesToolName } from "ai-capability-framework";
import { DefaultContextBuilder } from "ai-capability-framework/runtime";
import {
  createCapabilityDiscovery,
  createInMemoryDiscoveryBudget,
  buildCapabilitySearchCorpus,
  buildCapabilityEmbeddingIndex,
  DISCOVERY_STANDARD_PROFILE,
  aggregateDiscoveryUsage
} from "ai-capability-framework/discovery";
import {
  MockOpenAIResponsesClient,
  mockFunctionCallResponse,
  mockTextResponse,
  runOpenAIResponses
} from "ai-capability-framework/openai";
import {
  customerRequest,
  plannedTasks,
  taskExpectations,
  validatePlannedTasks
} from "./customer-cases.mjs";
import { createCustomerHarness } from "./customer-harness.mjs";
import { DeterministicMockEmbeddingClient } from "./mock-embeddings.mjs";

function mockModel(responses) {
  const client = new MockOpenAIResponsesClient(
    responses.map((response) => ({
      ...response,
      usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 }
    }))
  );
  const usage = [];
  const create = client.responses.create;
  client.responses.create = async (input) => {
    const response = await create(input);
    usage.push(response.usage);
    return response;
  };
  return { client, usage };
}

function modelUsage(reports) {
  return {
    mock: true,
    inputTokens: reports.reduce((sum, report) => sum + report.input_tokens, 0),
    outputTokens: reports.reduce((sum, report) => sum + report.output_tokens, 0),
    totalTokens: reports.reduce((sum, report) => sum + report.total_tokens, 0),
    tokenTotalsComplete: true,
    estimatedCost: null,
    costComplete: false
  };
}

export async function runCustomerRequestExample() {
  const harness = await createCustomerHarness();
  const planning = mockModel([
    mockTextResponse(JSON.stringify(plannedTasks), "plan_example")
  ]);
  const planResponse = await planning.client.responses.create({
    model: "mock-model",
    input: customerRequest,
    instructions:
      "Return ordered task objects with id, text and dependsOn. Use prior tasks for dependencies."
  });
  if (
    typeof planResponse.output_text !== "string" ||
    planResponse.output_text.length > 32_000
  )
    throw new Error("Invalid application task plan.");
  const tasks = validatePlannedTasks(JSON.parse(planResponse.output_text));
  const discovery = createCapabilityDiscovery({ registry: harness.registry });
  const completed = new Map();
  const taskResults = [],
    ordinaryUsage = [];
  let ordinaryModelTurns = 0;

  // Application orchestration: discover one task when its dependencies are available.
  for (const task of tasks) {
    if (task.dependsOn.some((id) => !completed.has(id)))
      throw new Error("Task dependency is not complete.");
    const prior = completed.get("read-ticket");
    const runtimeContext = {
      ...harness.runtimeContext,
      requestId: "request_" + task.id
    };
    const contextBuilder = new DefaultContextBuilder({
      hostItems: prior
        ? [
            {
              id: "ticket-result",
              kind: "entity",
              title: "Authorized ticket result",
              data: prior.data,
              trusted: true,
              visibleToModel: true
            }
          ]
        : []
    });
    const [result] = await discovery.search({
      tasks: [{ id: task.id, text: task.text }],
      runtimeContext
    });
    if (result.status !== "matched")
      throw new Error("Expected a usable shortlist for the synthetic task.");
    const expected = taskExpectations[task.id];
    if (
      result.candidates.some((candidate) =>
        expected.forbiddenIds.includes(candidate.capabilityId)
      )
    )
      throw new Error("Forbidden capability in shortlist.");
    const isRead = task.id === "read-ticket";
    const capabilityId = isRead ? "support.ticket.get" : "support.refund.prepare_case";
    const model = mockModel([
      mockFunctionCallResponse({
        name: toOpenAIResponsesToolName(capabilityId),
        callId: "call_" + task.id,
        args: isRead
          ? { ticket_id: "TCK-100" }
          : {
              ticket_id: prior.data.ticket.ticket_id,
              order_id: prior.data.ticket.order_id,
              reason_code: "customer_request",
              requested_amount: null
            }
      }),
      mockTextResponse(
        isRead
          ? "Ticket TCK-100 is open for order ORD-100."
          : "The refund case is prepared and awaiting approval."
      )
    ]);
    const loop = await runOpenAIResponses({
      ...harness,
      runtimeContext,
      contextBuilder,
      userInput: { text: task.text },
      router: discovery.routerFor(result),
      client: model.client,
      model: "mock-model"
    });
    const outcome = loop.toolResults[0];
    if (
      loop.status !== "completed" ||
      !outcome ||
      !["success", "prepared", "approval_required"].includes(outcome.status) ||
      !loop.toolCalls.every((call) =>
        expected.compatibleIds.includes(call.capabilityId)
      )
    )
      throw new Error(
        "Unexpected tool outcome: " +
          JSON.stringify({
            taskId: task.id,
            status: loop.status,
            errors: loop.errors,
            toolStatus: outcome?.status,
            toolErrors: outcome?.errors
          })
      );
    const exportedToolNames = model.client.requests[0].tools.map((tool) => tool.name);
    if (
      exportedToolNames.includes(
        toOpenAIResponsesToolName("support.refund.commit_case")
      )
    )
      throw new Error("Commit must not be exported.");
    completed.set(task.id, outcome);
    ordinaryModelTurns += model.client.requests.length;
    ordinaryUsage.push(...model.usage);
    taskResults.push({
      taskId: task.id,
      candidateIds: result.candidates.map((candidate) => candidate.capabilityId),
      exportedToolNames,
      selectedCapabilityId: loop.toolCalls[0].capabilityId,
      toolStatus: outcome.status,
      approvalRequired:
        outcome.action?.approvalRequired ?? outcome.status === "approval_required",
      preview: outcome.data?.preview,
      discoveryUsage: result.usage
    });
  }
  if (
    harness.readCalls.length !== 1 ||
    harness.prepareCalls.length !== 1 ||
    harness.prepareCalls[0].order_id !==
      completed.get("read-ticket").data.ticket.order_id ||
    !completed.get("prepare-refund").action?.preparedActionId ||
    completed.get("prepare-refund").action?.approvalRequired !== true
  )
    throw new Error("The customer flow must read and prepare once for approval.");
  const [noMatch] = await discovery.search({
    tasks: [{ id: "clarify", text: "quasar" }],
    runtimeContext: harness.runtimeContext
  });
  const deniedContext = structuredClone(harness.runtimeContext);
  deniedContext.subject.permissions = [];
  const [denied] = await discovery.search({
    tasks: [{ id: "denied", text: "ticket" }],
    runtimeContext: deniedContext
  });
  return {
    mock: true,
    customerRequest,
    plannedTasks: tasks,
    taskResults,
    planning: {
      turns: planning.client.requests.length,
      usage: modelUsage(planning.usage)
    },
    ordinaryModel: { turns: ordinaryModelTurns, usage: modelUsage(ordinaryUsage) },
    discoveryUsage: aggregateDiscoveryUsage(
      taskResults.flatMap((result) => result.discoveryUsage.stages),
      taskResults.reduce(
        (sum, result) => sum + result.discoveryUsage.totals.elapsedMs,
        0
      )
    ),
    dedicatedSelectorCalls: 0,
    embeddingAttempts: 0,
    readCalls: harness.readCalls.length,
    prepareCalls: harness.prepareCalls.length,
    commitCalls: harness.executedOperations.filter(
      (operation) => operation === "commit"
    ).length,
    companionCases: {
      noMatch: {
        status: noMatch.status,
        response: "Please clarify what you would like to do."
      },
      denied: {
        status: denied.status,
        exportedCount: discovery.routerFor(denied).route({
          registry: harness.registry,
          builtContext: await new DefaultContextBuilder().build({
            baseContext: deniedContext,
            registry: harness.registry,
            userInput: { text: "ticket" }
          }),
          userInput: { text: "ticket" }
        }).items.length
      }
    },
    finalText:
      "Ticket TCK-100 is open for order ORD-100. Its refund case is prepared and awaiting approval. No refund has been issued."
  };
}

export async function runSimpleHybridExample() {
  const { registry, runtimeContext } = await createCustomerHarness();
  const client = new DeterministicMockEmbeddingClient();
  const budget = createInMemoryDiscoveryBudget({
    runId: runtimeContext.runId,
    maxProviderCalls: 2,
    maxInputTokens: 8000
  });
  // Administrative build is explicit and separate from serving.
  const built = await buildCapabilityEmbeddingIndex({
    corpus: buildCapabilitySearchCorpus(registry),
    client,
    budget: budget.ledger,
    execution: {
      budgetPolicy: budget.policy,
      limits: {
        maxInputTokens: 4000,
        maxCharactersPerText: DISCOVERY_STANDARD_PROFILE.maxCharactersPerText,
        maxCharactersPerCall: DISCOVERY_STANDARD_PROFILE.maxCharactersPerCall
      }
    },
    limits: DISCOVERY_STANDARD_PROFILE.indexLimits,
    batchSize: 3,
    maxProviderCalls: 1,
    deadlineAt: Date.now() + 30_000,
    runId: runtimeContext.runId,
    requestId: runtimeContext.requestId
  });
  if (built.status !== "built")
    throw new Error("The explicit mock build must succeed.");
  const options = {
    registry,
    mode: "hybrid",
    embedding: { client, index: built.index, maxInputTokens: 4000 }
  };
  const [result] = await createCapabilityDiscovery(options).search({
    tasks: [{ id: "case", text: "case details" }],
    runtimeContext,
    budget
  });
  const before = client.calls.length;
  const [invalid] = await createCapabilityDiscovery({
    ...options,
    embedding: { ...options.embedding, index: {} }
  }).search({
    tasks: [{ id: "invalid-index", text: "ticket" }],
    runtimeContext,
    budget
  });
  if (
    result.status !== "matched" ||
    invalid.status !== "unavailable" ||
    client.calls.length !== before
  )
    throw new Error("Hybrid contract example failed.");
  return {
    mock: true,
    result,
    invalidIndexStatus: invalid.status,
    invalidIndexQueryCalls: client.calls.length - before,
    embeddingAttempts: client.calls.length,
    indexFingerprint: built.index.indexFingerprint,
    usage: aggregateDiscoveryUsage(
      [...built.usage.stages, ...result.usage.stages, ...invalid.usage.stages],
      built.usage.totals.elapsedMs +
        result.usage.totals.elapsedMs +
        invalid.usage.totals.elapsedMs
    )
  };
}
