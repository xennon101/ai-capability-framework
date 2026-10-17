// Deterministic contract fixture, never a live model or a retrieval-quality evaluation.
export class MockSelectionClient {
  mock = true;
  configuration = {
    provider: "mock",
    model: "synthetic-selector",
    configurationId: "example.selection.v1",
    revision: "1"
  };
  calls = [];
  constructor(outputs) {
    this.outputs = [...outputs];
  }
  async generateStructured(input) {
    this.calls.push(input);
    if (input.maxInputTokens < 120 || input.maxOutputTokens < 20) {
      throw Object.assign(new Error("Mock token ceiling exceeded."), {
        providerAttempts: 0
      });
    }
    if (!this.outputs.length) throw new Error("No mock selection output queued.");
    const next = this.outputs.shift();
    if (next instanceof Error) throw next;
    return {
      output: typeof next === "function" ? next(input) : next,
      providerAttempts: 1,
      usage: {
        inputTokens: 120,
        outputTokens: 20,
        totalTokens: 140,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        estimatedCost: 0
      }
    };
  }
}

export function selectedDecision(queryId, capabilityId) {
  return {
    query_id: queryId,
    decision: "select",
    capability_id: capabilityId,
    reason_code: "supported_candidate"
  };
}
export function abstainedDecision(queryId, reason = "ambiguous_request") {
  return {
    query_id: queryId,
    decision: "abstain",
    capability_id: null,
    reason_code: reason
  };
}
export function selectionResponse(...decisions) {
  return { schema_version: "1.0", decisions };
}

export const selectorCases = [
  {
    id: "competition",
    text: "ticket refund",
    compatibleIds: ["support.ticket.get"],
    forbiddenIds: ["support.refund.commit_case"]
  },
  {
    id: "single",
    text: "ticket",
    compatibleIds: [],
    forbiddenIds: ["support.refund.commit_case"]
  },
  {
    id: "no-match",
    text: "quasar",
    compatibleIds: [],
    forbiddenIds: ["support.refund.commit_case"]
  }
];
