import {
  createCapabilityDiscovery,
  createInMemoryDiscoveryBudget,
  aggregateDiscoveryUsage
} from "ai-capability-framework/discovery";
import { createDiscoveryExample } from "./discovery-example.mjs";
import {
  MockSelectionClient,
  selectorCases,
  selectionResponse,
  selectedDecision,
  abstainedDecision
} from "./mock-selection.mjs";

export async function runSelectionExample() {
  const harness = await createDiscoveryExample();
  const discovery = createCapabilityDiscovery({ registry: harness.registry });
  const results = await discovery.search({
    tasks: selectorCases.map(({ id, text }) => ({ id, text })),
    runtimeContext: harness.runtimeContext
  });
  const budget = createInMemoryDiscoveryBudget({
    runId: harness.runtimeContext.runId,
    maxProviderCalls: 3,
    maxInputTokens: 12_000
  });
  const client = new MockSelectionClient([
    selectionResponse(
      selectedDecision("competition", "support.ticket.get"),
      abstainedDecision("single")
    )
  ]);
  const initial = await discovery.select({
    results,
    client,
    budget,
    maxInputTokens: 4000,
    maxOutputTokens: 1000
  });
  const repairClient = new MockSelectionClient([
    selectionResponse(selectedDecision("competition", "support.foreign")),
    selectionResponse(selectedDecision("competition", "support.ticket.get"))
  ]);
  const repaired = await discovery.select({
    results: [results[0]],
    client: repairClient,
    budget,
    maxInputTokens: 4000,
    maxOutputTokens: 1000,
    limits: { maxAttempts: 2 }
  });
  if (
    initial.outcomes[0]?.status !== "selected" ||
    initial.outcomes[1]?.status !== "abstained" ||
    initial.outcomes.length !== 2 ||
    initial.discovery[2].status !== "no_match" ||
    repaired.outcomes[0]?.status !== "selected"
  ) {
    throw new Error(
      "The mock selector must choose, abstain, skip and repair as specified."
    );
  }
  for (const batch of [initial, repaired])
    for (const outcome of batch.outcomes) {
      const fixture = selectorCases.find((entry) => entry.id === outcome.queryId);
      if (
        outcome.status === "selected" &&
        (!fixture.compatibleIds.includes(outcome.capabilityId) ||
          fixture.forbiddenIds.includes(outcome.capabilityId))
      ) {
        throw new Error(
          "The selected capability must be compatible and not forbidden."
        );
      }
    }
  return {
    mock: true,
    initial,
    repaired,
    mockSelectionAttempts: client.calls.length + repairClient.calls.length,
    toolCalls: harness.readCalls.length,
    embeddingAttempts: 0,
    usage: aggregateDiscoveryUsage(
      [...initial.usage.stages, ...repaired.usage.stages],
      initial.usage.totals.elapsedMs + repaired.usage.totals.elapsedMs
    )
  };
}
