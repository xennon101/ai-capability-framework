import { createOpenAISelectionClient } from "ai-capability-framework/openai";
import { hashDiscoveryContent } from "ai-capability-framework/discovery";
import { EXECUTION } from "./campaign.mjs";

const inputItems = (value) =>
  typeof value === "string"
    ? [{ role: "user", content: value }]
    : structuredClone(value ?? []);

function usableOutput(response) {
  if (!Array.isArray(response?.output) || response.output.length > 64) return false;
  let actionable = false;
  for (const item of response.output) {
    if (item?.type === "function_call") {
      if (
        typeof item.name !== "string" ||
        typeof item.call_id !== "string" ||
        typeof item.arguments !== "string" ||
        item.arguments.length > 128_000
      )
        return false;
      actionable = true;
    } else if (item?.type === "message") {
      if (!Array.isArray(item.content) || item.content.length > 64) return false;
      for (const content of item.content) {
        if (
          content?.type !== "output_text" ||
          typeof content.text !== "string" ||
          content.text.length > 128_000
        )
          return false;
        actionable ||= !!content.text.trim();
      }
    } else if (item?.type !== "reasoning") return false;
  }
  return actionable;
}

export function decorateRequest(request, history = []) {
  const decorated = {
    ...structuredClone(request),
    reasoning: { effort: EXECUTION.reasoning },
    service_tier: "default",
    parallel_tool_calls: false,
    truncation: "disabled",
    stream: false,
    store: false
  };
  // Replay complete prior inputs/outputs explicitly; no server-side stored conversation is required.
  if (request.previous_response_id) {
    if (!history.length || history.at(-1).response.id !== request.previous_response_id)
      throw new Error("Missing continuation fixtures.");
    decorated.input = [
      ...history.flatMap((turn) => [
        ...inputItems(turn.request.input),
        ...structuredClone(turn.response.output ?? [])
      ]),
      ...inputItems(request.input)
    ];
    delete decorated.previous_response_id;
  }
  delete decorated.temperature;
  return decorated;
}

/** No credentials or SDK are discovered here. The host supplies both client and embedding tokenizer. */
export function createEvaluationClients({
  sdk,
  ledger,
  mock,
  tokenizer,
  tokenizerIdentity,
  pricing,
  scope = {}
}) {
  if (
    typeof mock !== "boolean" ||
    typeof tokenizer !== "function" ||
    typeof tokenizerIdentity !== "string" ||
    !tokenizerIdentity.trim() ||
    typeof sdk?.responses?.create !== "function" ||
    typeof sdk?.responses?.inputTokens?.count !== "function" ||
    typeof sdk?.embeddings?.create !== "function"
  )
    throw new Error("Explicit clients and token preflights are required.");
  if (
    !pricing ||
    Object.keys(pricing).some(
      (key) =>
        ![
          "inputPerMillion",
          "outputPerMillion",
          "embeddingPerMillion",
          "tokenCountPerRequest",
          "premiumMultiplier",
          "checkedAt"
        ].includes(key)
    )
  ) {
    throw new Error(
      "Pricing accepts only explicit numeric rates and its verification timestamp."
    );
  }
  for (const key of [
    "inputPerMillion",
    "outputPerMillion",
    "embeddingPerMillion",
    "tokenCountPerRequest",
    "premiumMultiplier"
  ]) {
    if (
      typeof pricing?.[key] !== "number" ||
      !Number.isFinite(pricing[key]) ||
      pricing[key] < 0
    )
      throw new Error("Explicit finite pricing is required.");
  }
  if (
    pricing.premiumMultiplier < 1 ||
    (!mock &&
      (!pricing.checkedAt ||
        Date.now() - Date.parse(pricing.checkedAt) > 24 * 60 * 60_000 ||
        !Number.isFinite(Date.parse(pricing.checkedAt)) ||
        Date.parse(pricing.checkedAt) > Date.now() + 300_000))
  )
    throw new Error("Live pricing must have been checked in the last 24 hours.");
  // Campaign-specific conservative floors, verified against official Standard pricing on 2026-10-16.
  // They are not framework pricing defaults. Hosts must raise them for higher current rates/premiums.
  if (
    !mock &&
    (pricing.inputPerMillion < 0.125 ||
      pricing.outputPerMillion < 0.5 ||
      pricing.embeddingPerMillion < 0.02)
  ) {
    throw new Error(
      "Live pricing is below the campaign's verified conservative floor."
    );
  }
  const pricingRates = Object.fromEntries(
    Object.entries(pricing).filter(([key]) => key !== "checkedAt")
  );
  const identity = hashDiscoveryContent({
    execution: EXECUTION,
    tokenizerIdentity,
    pricing: pricingRates,
    mock
  });
  const configuration = Object.freeze({
    provider: "openai",
    model: EXECUTION.model,
    configurationId: `evaluation.responses.${identity.slice(7, 23)}`
  });
  const embeddingConfiguration = Object.freeze({
    provider: "openai",
    model: EXECUTION.embeddingModel,
    configurationId: `evaluation.embedding.${identity.slice(7, 23)}`,
    dimensions: EXECUTION.dimensions
  });
  const prepared = new WeakMap();
  const check = () => {
    if (
      scope.signal?.aborted ||
      Date.now() >= (scope.deadlineAt ?? Infinity) ||
      scope.guard?.()
    )
      throw Object.assign(new Error("Evaluation binding is stale or cancelled."), {
        providerAttempts: 0
      });
    const control = scope.controls?.evaluate({
      operation: "provider_call",
      providerId: "openai",
      model: EXECUTION.model,
      registry: scope.registry,
      runtimeContext: scope.runtimeContext,
      usage: {
        providerCalls: ledger.snapshot().httpRequests,
        retries: 0,
        runtimeMs: 0,
        toolCalls: 0
      }
    });
    if (control?.status === "denied")
      throw Object.assign(new Error("Evaluation provider control denied dispatch."), {
        providerAttempts: 0
      });
  };
  const estimateCost = (usage, config) => {
    if (
      usage.inputTokens === undefined ||
      (config.model !== EXECUTION.embeddingModel && usage.outputTokens === undefined)
    )
      return undefined;
    const inputRate =
      config.model === EXECUTION.embeddingModel
        ? pricing.embeddingPerMillion
        : pricing.inputPerMillion;
    return (
      ((usage.inputTokens * inputRate +
        (config.model === EXECUTION.embeddingModel
          ? 0
          : usage.outputTokens * pricing.outputPerMillion)) /
        1_000_000) *
      pricing.premiumMultiplier
    );
  };
  const maxCost = (input = 8000, output = 1000, embedding = false) =>
    estimateCost(
      { inputTokens: input, outputTokens: output },
      embedding ? embeddingConfiguration : configuration
    );
  const inputTokenPreflight = async ({
    request,
    history,
    maxInputTokens,
    signal,
    deadlineAt
  }) => {
    check();
    const value = decorateRequest(request, history);
    const allowed = [
      "model",
      "input",
      "instructions",
      "parallel_tool_calls",
      "reasoning",
      "text",
      "tool_choice",
      "tools",
      "truncation"
    ];
    const payload = Object.fromEntries(
      allowed.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])
    );
    const response = await ledger
      .transport(
        "token_count",
        () =>
          sdk.responses.inputTokens.count(payload, {
            signal,
            timeout: Math.max(1, deadlineAt - Date.now()),
            maxRetries: 0
          }),
        { signal, deadlineAt, fee: pricing.tokenCountPerRequest }
      )
      .catch(() => {
        throw Object.assign(new Error("Input token preflight unavailable."), {
          providerAttempts: 0,
          completedResponses: 0,
          usage: {}
        });
      });
    if (
      !Number.isSafeInteger(response?.input_tokens) ||
      response.input_tokens < 0 ||
      response.input_tokens > maxInputTokens
    )
      throw Object.assign(new Error("Complete input exceeds its token ceiling."), {
        providerAttempts: 0
      });
    check();
    prepared.set(request, value);
    return response.input_tokens;
  };
  const client = {
    responses: {
      async create(request, options = {}) {
        const value = prepared.get(request);
        if (!value)
          throw Object.assign(
            new Error("A complete input preflight must precede generation."),
            { providerAttempts: 0 }
          );
        prepared.delete(request);
        check();
        const response = await ledger.transport(
          "generation",
          () =>
            sdk.responses.create(value, {
              ...options,
              maxRetries: 0,
              timeout: Math.max(
                1,
                Math.min(
                  options.timeout ?? 30_000,
                  (scope.deadlineAt ?? Date.now() + 30_000) - Date.now()
                )
              )
            }),
          {
            signal: options.signal,
            deadlineAt: Math.min(
              scope.deadlineAt ?? Infinity,
              Date.now() + (options.timeout ?? 30_000)
            )
          }
        );
        if (
          response?.status !== "completed" ||
          typeof response.model !== "string" ||
          (response.model !== EXECUTION.model &&
            !response.model.startsWith(EXECUTION.model + "-")) ||
          !usableOutput(response) ||
          response.output.some((item) =>
            item?.content?.some?.((content) => content?.type === "refusal")
          )
        ) {
          throw Object.assign(
            new Error("Evaluation generation response is incompatible or refused."),
            {
              usage: Object.fromEntries(
                Object.entries({
                  inputTokens: response?.usage?.input_tokens,
                  outputTokens: response?.usage?.output_tokens,
                  totalTokens: response?.usage?.total_tokens,
                  cachedInputTokens:
                    response?.usage?.input_tokens_details?.cached_tokens,
                  reasoningTokens:
                    response?.usage?.output_tokens_details?.reasoning_tokens
                }).filter(([, number]) => Number.isSafeInteger(number) && number >= 0)
              ),
              providerAttempts: 1,
              completedResponses: 1
            }
          );
        }
        return response;
      }
    }
  };
  const embeddingClient = Object.freeze({
    mock,
    configuration: embeddingConfiguration,
    async embed(input) {
      check();
      const counts = input.texts.map((text) => tokenizer(text));
      if (
        counts.some((count) => !Number.isSafeInteger(count) || count < 1) ||
        counts.reduce((a, b) => a + b, 0) > input.maxInputTokens
      )
        throw Object.assign(new Error("Embedding input exceeds its token ceiling."), {
          providerAttempts: 0
        });
      input.beforeProviderCall?.();
      const response = await ledger.transport(
        "embedding",
        () =>
          sdk.embeddings.create(
            {
              model: embeddingConfiguration.model,
              input: input.texts,
              dimensions: EXECUTION.dimensions,
              encoding_format: "float"
            },
            {
              signal: input.signal,
              timeout: Math.max(1, input.deadlineAt - Date.now()),
              maxRetries: 0
            }
          ),
        { signal: input.signal, deadlineAt: input.deadlineAt }
      );
      const usage = {};
      if (
        Number.isSafeInteger(response?.usage?.prompt_tokens) &&
        response.usage.prompt_tokens >= 0
      )
        usage.inputTokens = response.usage.prompt_tokens;
      if (
        Number.isSafeInteger(response?.usage?.total_tokens) &&
        response.usage.total_tokens >= 0
      )
        usage.totalTokens = response.usage.total_tokens;
      // These text-generation categories are inapplicable to this embedding operation.
      Object.assign(usage, {
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0
      });
      const cost = estimateCost(usage, embeddingConfiguration);
      if (cost !== undefined) usage.estimatedCost = cost;
      if (
        response?.model !== EXECUTION.embeddingModel ||
        !Array.isArray(response.data) ||
        response.data.length !== input.texts.length ||
        response.data.some(
          (entry, index) => entry.index !== index || !Array.isArray(entry.embedding)
        )
      ) {
        throw Object.assign(new Error("Embedding response is incompatible."), {
          usage,
          providerAttempts: 1,
          completedResponses: 1
        });
      }
      return {
        vectors: response.data.map((entry) => entry.embedding),
        configuration: embeddingConfiguration,
        vectorDimension: EXECUTION.dimensions,
        providerAttempts: 1,
        usage
      };
    }
  });
  return Object.freeze({
    mock,
    configuration,
    embeddingConfiguration,
    client,
    embeddingClient,
    inputTokenPreflight,
    selectionClient: createOpenAISelectionClient({
      client,
      configuration,
      mock,
      inputTokenPreflight
    }),
    estimateCost,
    maxCost,
    tokenizerIdentity,
    identity,
    forScope(next) {
      return createEvaluationClients({
        sdk,
        ledger,
        mock,
        tokenizer,
        tokenizerIdentity,
        pricing,
        scope: next
      });
    }
  });
}
