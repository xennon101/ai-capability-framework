import assert from "node:assert/strict";
import { toOpenAIResponsesToolName } from "ai-capability-framework";
import {
  createAicfProviderRun,
  DefaultContextBuilder
} from "ai-capability-framework/runtime";
import {
  createCapabilityDiscovery,
  createInMemoryDiscoveryBudget,
  buildCapabilityEmbeddingIndex,
  buildCapabilitySearchCorpus,
  createDiscoverySnapshot,
  replayDiscoverySnapshot
} from "ai-capability-framework/discovery";
import {
  createOpenAISelectionClient,
  MockOpenAIResponsesClient,
  mockTextResponse,
  mockFunctionCallResponse,
  runOpenAIResponses
} from "ai-capability-framework/openai";
import { createCustomerHarness } from "./customer-harness.mjs";
import {
  plannedTasks,
  taskExpectations,
  validatePlannedTasks
} from "./customer-cases.mjs";
import {
  DeterministicMockEmbeddingClient,
  embeddingIndexLimits
} from "./mock-embeddings.mjs";

const configuration = {
  provider: "openai",
  model: "mock-model",
  configurationId: "example.pipeline.responses.v1"
};
const normalizedUsage = {
  inputTokens: 20,
  outputTokens: 5,
  totalTokens: 25,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  estimatedCost: 0
};
function reported(response) {
  return {
    ...response,
    status: "completed",
    usage: {
      input_tokens: 20,
      output_tokens: 5,
      total_tokens: 25,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 }
    }
  };
}
function runFor(harness, maxProviderCalls = 20) {
  const budget = createInMemoryDiscoveryBudget({
    runId: harness.runtimeContext.runId,
    maxProviderCalls,
    maxInputTokens: 80_000,
    maxOutputTokens: 20_000
  });
  return createAicfProviderRun({
    runId: harness.runtimeContext.runId,
    budget,
    deadlineAt: Date.now() + 30_000
  });
}
// An application explicitly invokes this administrative operation, separately from serving.
async function buildMockIndex(harness) {
  const client = new DeterministicMockEmbeddingClient();
  const budget = createInMemoryDiscoveryBudget({
    runId: "run_index_example",
    maxProviderCalls: 1,
    maxInputTokens: 8000
  });
  const execution = {
    budgetPolicy: budget.policy,
    limits: {
      maxInputTokens: 8000,
      maxCharactersPerText: 16_384,
      maxCharactersPerCall: 65_536
    }
  };
  const built = await buildCapabilityEmbeddingIndex({
    corpus: buildCapabilitySearchCorpus(harness.registry),
    client,
    execution,
    limits: embeddingIndexLimits,
    batchSize: 10,
    maxProviderCalls: 1,
    budget: budget.ledger,
    runId: "run_index_example",
    requestId: "index_build_example",
    deadlineAt: Date.now() + 30_000
  });
  assert.equal(built.status, "built");
  return { client, index: built.index, usage: built.usage };
}

/** Four explicit integrations; all responses and vectors are deterministic contract fixtures. */
export async function runPipelineCase({ hybrid = false, dedicated = false } = {}) {
  const harness = await createCustomerHarness(),
    providerRun = runFor(harness);
  const administrative = hybrid ? await buildMockIndex(harness) : undefined;
  const retrieval = {
    policyVersion: "example.pipeline.v1",
    ...(hybrid
      ? {
          mode: "hybrid",
          weights: { semantic: 0.75, lexical: 0.25 },
          failurePolicy: "unavailable"
        }
      : { mode: "lexical" })
  };
  const discoveryOptions = {
    registry: harness.registry,
    ...retrieval,
    ...(hybrid
      ? {
          embedding: {
            client: administrative.client,
            index: administrative.index,
            maxInputTokens: 4000
          }
        }
      : {})
  };
  const planning = await providerRun.attempt({
    requestId: "request_plan",
    stage: "planning",
    configuration,
    mock: true,
    maxInputTokens: 4000,
    maxOutputTokens: 1000,
    invoke: async () => ({
      output: plannedTasks,
      providerAttempts: 1,
      usage: normalizedUsage
    }),
    validate: (response) => ({ value: validatePlannedTasks(response.output) })
  });
  assert.equal(planning.code, undefined);
  const completed = new Map(),
    taskResults = [],
    snapshots = [];
  let ordinaryTurns = 0,
    selectorAttempts = 0;
  for (const task of planning.value) {
    assert.ok(task.dependsOn.every((id) => completed.has(id)));
    const prior = completed.get("read-ticket");
    const runtimeContext = {
      ...harness.runtimeContext,
      requestId: "request_" + task.id
    };
    const contextBuilder = new DefaultContextBuilder({
      hostItems: prior
        ? [
            {
              id: "authorized-ticket",
              kind: "entity",
              title: "Authorized ticket result",
              data: prior.data,
              trusted: true,
              visibleToModel: true
            }
          ]
        : []
    });
    const discovery = createCapabilityDiscovery({
      ...discoveryOptions,
      contextBuilder
    });
    const [result] = await discovery.search({
      tasks: [{ id: task.id, text: task.text }],
      runtimeContext,
      providerRun
    });
    assert.equal(result.status, "matched");
    const expectations = taskExpectations[task.id],
      isRead = task.id === "read-ticket";
    const capabilityId = isRead ? "support.ticket.get" : "support.refund.prepare_case";
    assert.ok(
      result.candidates.some((candidate) =>
        expectations.compatibleIds.includes(candidate.capabilityId)
      )
    );
    assert.ok(
      result.candidates.every(
        (candidate) => !expectations.forbiddenIds.includes(candidate.capabilityId)
      )
    );
    let batch;
    if (dedicated) {
      const transport = new MockOpenAIResponsesClient([
        reported(
          mockTextResponse(
            JSON.stringify({
              schema_version: "1.0",
              decisions: [
                {
                  query_id: task.id,
                  decision: "select",
                  capability_id: capabilityId,
                  reason_code: "supported_candidate"
                }
              ]
            })
          )
        )
      ]);
      const client = createOpenAISelectionClient({
        client: transport,
        configuration,
        mock: true,
        inputTokenPreflight: () => 120
      });
      batch = await discovery.select({
        results: [result],
        client,
        maxInputTokens: 4000,
        maxOutputTokens: 1000,
        estimateCost: () => 0
      });
      assert.equal(batch.outcomes[0].status, "selected");
      selectorAttempts += transport.requests.length;
    }
    const router = batch
      ? discovery.routerFor(batch, task.id)
      : discovery.routerFor(result);
    const client = new MockOpenAIResponsesClient([
      reported(
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
        })
      ),
      reported(
        mockTextResponse(
          isRead ? "Ticket read." : "Refund preparation requires approval."
        )
      )
    ]);
    const loop = await runOpenAIResponses({
      ...harness,
      runtimeContext,
      contextBuilder,
      userInput: { text: task.text },
      router,
      client,
      model: "mock-model",
      providerExecution: {
        configuration,
        mock: true,
        maxInputTokens: 4000,
        maxOutputTokens: 1000,
        inputTokenPreflight: () => 120,
        estimateCost: () => 0
      }
    });
    assert.equal(loop.status, "completed");
    assert.ok(
      loop.toolCalls.every((call) =>
        expectations.compatibleIds.includes(call.capabilityId)
      )
    );
    assert.ok(
      client.requests.every((request) =>
        request.tools.every(
          (tool) =>
            tool.name !== toOpenAIResponsesToolName("support.refund.commit_case")
        )
      )
    );
    completed.set(task.id, loop.toolResults[0]);
    ordinaryTurns += client.requests.length;
    taskResults.push({
      taskId: task.id,
      candidateIds: result.candidates.map((candidate) => candidate.capabilityId),
      chosenId: loop.toolCalls[0].capabilityId,
      toolStatus: loop.toolResults[0].status,
      approvalRequired:
        loop.toolResults[0].action?.approvalRequired ??
        loop.toolResults[0].status === "approval_required"
    });
    const builtContext = await contextBuilder.build({
      baseContext: runtimeContext,
      registry: harness.registry,
      userInput: { text: task.text }
    });
    const routeRequest = {
      registry: harness.registry,
      builtContext,
      userInput: { text: task.text }
    };
    const snapshot = createDiscoverySnapshot({
      routeRequest,
      configuration: retrieval,
      queries: [{ id: task.id, fragments: [{ key: "task", text: task.text }] }],
      discovery: [result],
      selection: batch
    });
    assert.equal(
      replayDiscoverySnapshot(snapshot, { mode: "snapshot_validation", routeRequest })
        .status,
      "passed"
    );
    assert.equal(
      replayDiscoverySnapshot(snapshot, { mode: "ranking", routeRequest }).status,
      "refused"
    );
    snapshots.push(snapshot.snapshotFingerprint);
  }
  assert.deepEqual(harness.executedOperations, ["read", "prepare"]);
  assert.equal(harness.readCalls.length, 1);
  assert.equal(harness.prepareCalls.length, 1);
  assert.equal(
    harness.prepareCalls[0].order_id,
    completed.get("read-ticket").data.ticket.order_id
  );
  assert.ok(completed.get("prepare-refund").action?.preparedActionId);
  const receipt = providerRun.snapshot();
  const queryEmbeddings = hybrid
    ? administrative.client.calls.length - administrative.usage.totals.providerAttempts
    : 0;
  assert.equal(
    receipt.usage.totals.providerAttempts,
    1 + ordinaryTurns + selectorAttempts + queryEmbeddings
  );
  assert.equal(ordinaryTurns, 4);
  assert.equal(selectorAttempts, dedicated ? 2 : 0);
  assert.equal(queryEmbeddings, hybrid ? 2 : 0);
  return {
    retrieval: hybrid ? "hybrid" : "lexical",
    selection: dedicated ? "dedicated" : "native",
    mock: true,
    planningTurns: 1,
    ordinaryTurns,
    selectorAttempts,
    queryEmbeddings,
    administrativeIndexUsage: administrative?.usage ?? null,
    tasks: taskResults,
    snapshotFingerprints: snapshots,
    usage: receipt.usage,
    traceEvents: receipt.events.length,
    customerResponse:
      "Ticket TCK-100 was read. A refund case for order ORD-100 is prepared and requires approval; no refund was committed."
  };
}

export async function runPipelineFailureCases() {
  const harness = await createCustomerHarness(),
    providerRun = runFor(harness);
  const discovery = createCapabilityDiscovery({ registry: harness.registry });
  const [none] = await discovery.search({
    tasks: [{ id: "none", text: "quasar" }],
    runtimeContext: harness.runtimeContext,
    providerRun
  });
  assert.equal(none.status, "no_match");
  const [matched] = await discovery.search({
    tasks: [{ id: "one", text: "ticket" }],
    runtimeContext: harness.runtimeContext,
    providerRun
  });
  const transport = new MockOpenAIResponsesClient([
    reported(
      mockTextResponse(
        JSON.stringify({
          schema_version: "1.0",
          decisions: [
            {
              query_id: "one",
              decision: "abstain",
              capability_id: null,
              reason_code: "insufficient_context"
            }
          ]
        })
      )
    )
  ]);
  const batch = await discovery.select({
    results: [matched],
    client: createOpenAISelectionClient({
      client: transport,
      configuration,
      mock: true,
      inputTokenPreflight: () => 120
    }),
    maxInputTokens: 4000,
    maxOutputTokens: 1000
  });
  assert.equal(batch.outcomes[0].status, "abstained");
  const bound = discovery.routerFor(matched);
  harness.runtimeContext.subject.permissions = [];
  const builtContext = await new DefaultContextBuilder().build({
    baseContext: harness.runtimeContext,
    registry: harness.registry,
    userInput: { text: "ticket" }
  });
  assert.equal(
    bound.route({
      registry: harness.registry,
      builtContext,
      userInput: { text: "ticket" }
    }).items.length,
    0
  );
  const fresh = await createCustomerHarness(),
    administrative = await buildMockIndex(fresh),
    invalidRun = runFor(fresh);
  const before = administrative.client.calls.length;
  const invalid = createCapabilityDiscovery({
    registry: fresh.registry,
    mode: "hybrid",
    embedding: {
      client: administrative.client,
      index: { ...administrative.index, indexFingerprint: "sha256:" + "0".repeat(64) },
      maxInputTokens: 4000
    }
  });
  const [rejected] = await invalid.search({
    tasks: [{ id: "bad", text: "ticket" }],
    runtimeContext: fresh.runtimeContext,
    providerRun: invalidRun
  });
  assert.equal(rejected.status, "unavailable");
  assert.equal(administrative.client.calls.length, before);
  const sourceApi = createCapabilityDiscovery({ registry: fresh.registry });
  const [sourceResult] = await sourceApi.search({
    tasks: [{ id: "source", text: "ticket" }],
    runtimeContext: fresh.runtimeContext
  });
  fresh.registry.capabilities[0].manifest.summary += " Updated guidance.";
  const sourceContext = await new DefaultContextBuilder().build({
    baseContext: fresh.runtimeContext,
    registry: fresh.registry,
    userInput: { text: "ticket" }
  });
  assert.equal(
    sourceApi.routerFor(sourceResult).route({
      registry: fresh.registry,
      builtContext: sourceContext,
      userInput: { text: "ticket" }
    }).items.length,
    0
  );
  const exhausted = runFor(fresh, 1);
  const attempt = {
    requestId: "budget",
    stage: "planning",
    configuration,
    mock: true,
    maxInputTokens: 100,
    maxOutputTokens: 20,
    invoke: async () => ({ providerAttempts: 1, usage: normalizedUsage }),
    validate: () => ({ value: true })
  };
  await exhausted.attempt(attempt);
  assert.equal((await exhausted.attempt(attempt)).code, "budget_denied");
  return {
    clarification: "Please clarify the task you want to perform.",
    noMatch: none.status,
    abstention: batch.outcomes[0].status,
    permissionRevocation: "no_tools",
    sourceMutation: "no_tools",
    invalidIndex: rejected.status,
    invalidIndexQueryCalls: administrative.client.calls.length - before,
    budgetDeniedAfterAttempts: exhausted.snapshot().usage.totals.providerAttempts,
    realProviderCalls: 0
  };
}
export async function runPipelineExample() {
  const cases = [];
  for (const hybrid of [false, true])
    for (const dedicated of [false, true])
      cases.push(await runPipelineCase({ hybrid, dedicated }));
  return {
    cases,
    failures: await runPipelineFailureCases(),
    realProviderCalls: 0,
    qualityQualified: false
  };
}
