// Synthetic vectors exercise contracts; they are not evidence of embedding quality.
export class DeterministicMockEmbeddingClient {
  mock = true;
  calls = [];

  constructor(vectorForText = fixtureVector) {
    this.configuration = {
      provider: "mock",
      model: "synthetic-vectors",
      configurationId: "example.embedding.v1",
      revision: "1",
      dimensions: 2
    };
    this.vectorForText = vectorForText;
  }

  async embed(input) {
    this.calls.push(input);
    const inputTokens = input.texts.reduce(
      (total, text) => total + Math.ceil(text.length / 4),
      0
    );
    if (inputTokens > input.maxInputTokens) {
      throw Object.assign(new Error("Mock input exceeds its token ceiling."), {
        providerAttempts: 0
      });
    }
    return {
      configuration: { ...this.configuration },
      vectorDimension: 2,
      vectors: input.texts.map(this.vectorForText),
      providerAttempts: 1,
      usage: {
        inputTokens,
        outputTokens: 0,
        totalTokens: inputTokens,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        estimatedCost: 0
      }
    };
  }
}

function fixtureVector(text) {
  if (/refund|reimbursement/i.test(text)) return [0, 1];
  if (/ticket|case details/i.test(text)) return [1, 0];
  return [-1, -1];
}

// Demonstration only. Production hosts own durable, concurrent reservation enforcement.
export class MockDiscoveryBudget {
  reservations = [];
  settlements = [];
  outstanding = new Map();

  async reserve(input) {
    const calls = this.settlements.reduce(
      (total, settlement) => total + settlement.result.providerAttempts,
      this.outstanding.size
    );
    if (calls + 1 > input.policy.maxProviderCallsPerRun) {
      return {
        status: "denied",
        diagnostic: { code: "budget_denied", message: "Mock call budget exhausted." }
      };
    }
    const reservationId = "reservation_" + (this.reservations.length + 1);
    this.reservations.push(input);
    this.outstanding.set(reservationId, input);
    return { status: "reserved", reservationId };
  }

  async settle(reservationId, result) {
    if (!this.outstanding.delete(reservationId)) {
      throw new Error("A reservation must settle exactly once.");
    }
    this.settlements.push({ reservationId, result });
  }
}

export const embeddingIndexLimits = {
  maxArtifactBytes: 1_000_000,
  maxEntries: 128,
  maxVectorDimension: 16
};

export const embeddingExecution = {
  limits: {
    maxInputTokens: 4_000,
    maxCharactersPerText: 16_000,
    maxCharactersPerCall: 32_000,
    maxEstimatedCostPerCall: 1
  },
  budgetPolicy: {
    id: "example.embedding-budget.v1",
    scope: { type: "global" },
    maxProviderCallsPerRun: 64,
    maxEstimatedCostPerRun: 64
  }
};
