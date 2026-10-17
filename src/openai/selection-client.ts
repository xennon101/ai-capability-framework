import type { SelectionModelClient } from "../discovery/types.js";
import type { ModelUsage, ProviderModelConfiguration } from "../runtime/provider-types.js";
import { freezeProviderValue, knownUsage, ownValue } from "../runtime/provider-usage.js";
import type { AicfOpenAIResponseLike, AicfOpenAIResponsesClient } from "./types.js";
import { extractOpenAIResponseText } from "./tool-loop.js";

export const OPENAI_SELECTION_TRANSPORT_VERSION = "responses-selection.v1";
export interface OpenAIInputPreflightInput {
  request: Readonly<Record<string, unknown>>;
  /** Prior requests/responses needed to account for continuation context, never logged. */
  history: readonly { request: Readonly<Record<string, unknown>>; response: AicfOpenAIResponseLike }[];
  configuration: Readonly<ProviderModelConfiguration>;
  maxInputTokens: number;
  signal?: AbortSignal;
  deadlineAt: number;
}
export type OpenAIInputTokenPreflight = (input: OpenAIInputPreflightInput) => number | Promise<number>;
export interface CreateOpenAISelectionClientOptions {
  client: AicfOpenAIResponsesClient;
  configuration: ProviderModelConfiguration;
  mock: boolean;
  inputTokenPreflight: OpenAIInputTokenPreflight;
}

/** Credentials and model-specific token counting remain with the caller's configured client. */
export function createOpenAISelectionClient(options: CreateOpenAISelectionClientOptions): SelectionModelClient {
  const configuration = freezeProviderValue({ ...options.configuration });
  if (!options.client?.responses || typeof options.client.responses.create !== "function" || typeof options.mock !== "boolean"
    || typeof options.inputTokenPreflight !== "function" || [configuration.provider, configuration.model, configuration.configurationId]
      .some(value => typeof value !== "string" || !value.trim())) throw new Error("A selection adapter requires an explicit client, model, provenance and token preflight.");
  return Object.freeze({ configuration, mock: options.mock, transportVersion: OPENAI_SELECTION_TRANSPORT_VERSION,
    async generateStructured(input: Parameters<SelectionModelClient["generateStructured"]>[0]) {
      const request = freezeProviderValue({ model: configuration.model, input: input.messages.map(message => ({ ...message })),
        text: { format: { type: "json_schema", name: "aicf_capability_selection_v1", strict: true, schema: projectSelectionSchema(input.outputSchema) } },
        max_output_tokens: input.maxOutputTokens, truncation: "disabled", stream: false, store: false, tools: [] });
      let attempted = false, completed = false, usage: ModelUsage = {};
      try {
        await enforceOpenAIInputTokens({ request, history: [], configuration, maxInputTokens: input.maxInputTokens,
          signal: input.signal, deadlineAt: input.deadlineAt }, options.inputTokenPreflight);
        input.beforeProviderCall?.();
        attempted = true;
        const response = await options.client.responses.create(request, { signal: input.signal,
          timeout: Math.max(1, input.deadlineAt - Date.now()), maxRetries: 0 });
        completed = true;
        usage = normalizeOpenAIUsage(response.usage);
        if (!boundedResponse(response)) throw new Error();
        const output = extractOpenAIResponseText(response);
        if (response.status !== "completed" || !output.trim() || hasRefusal(response)
          || usage.outputTokens !== undefined && usage.outputTokens > input.maxOutputTokens) throw new Error();
        return { output, usage, providerAttempts: 1, ...(typeof response.id === "string" ? { responseRef: response.id } : {}) };
      } catch (error) {
        if (!completed) usage = normalizeOpenAIUsage(ownValue(error, "usage"));
        throw providerFailure(attempted ? 1 : 0, completed ? 1 : 0, usage);
      }
    }
  });
}

export async function enforceOpenAIInputTokens(input: OpenAIInputPreflightInput, preflight: OpenAIInputTokenPreflight): Promise<void> {
  if (input.signal?.aborted || Date.now() >= input.deadlineAt) throw providerFailure(0, 0, {});
  const count = await preflight(input);
  if (!Number.isSafeInteger(count) || count < 0 || count > input.maxInputTokens
    || input.signal?.aborted || Date.now() >= input.deadlineAt) throw providerFailure(0, 0, {});
}

export function normalizeOpenAIUsage(raw: unknown): ModelUsage {
  if (!raw || typeof raw !== "object") return {};
  return { ...knownUsage(raw), ...knownUsage({ inputTokens: ownValue(raw, "input_tokens"), outputTokens: ownValue(raw, "output_tokens"),
    totalTokens: ownValue(raw, "total_tokens"), cachedInputTokens: ownValue(ownValue(raw, "input_tokens_details"), "cached_tokens"),
    reasoningTokens: ownValue(ownValue(raw, "output_tokens_details"), "reasoning_tokens") }) };
}

function providerFailure(providerAttempts: number, completedResponses: number, usage: ModelUsage): Error {
  return Object.assign(new Error("The configured Responses transport could not produce an acceptable response."), {
    providerAttempts, completedResponses, usage, diagnostic: { code: "provider_unavailable", message: "The configured Responses transport was unavailable." }
  });
}

function hasRefusal(response: AicfOpenAIResponseLike): boolean {
  return (response.output ?? []).some(item => !!item && typeof item === "object" && "content" in item
    && Array.isArray(item.content) && item.content.some(content => content && typeof content === "object" && content.type === "refusal"));
}

/** Transport-only conversion: mutually exclusive select/abstain branches retain their meaning. */
function projectSelectionSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectSelectionSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["$schema", "$id", "title"].includes(key))
    .map(([key, child]) => key === "oneOf" ? ["anyOf", projectSelectionSchema(child)]
      : key === "const" ? ["enum", [child]] : [key, projectSelectionSchema(child)]));
}

function boundedResponse(response: AicfOpenAIResponseLike): boolean {
  if (response.output_text !== undefined && (typeof response.output_text !== "string" || response.output_text.length > 128_000)) return false;
  if (response.output !== undefined && (!Array.isArray(response.output) || response.output.length > 64)) return false;
  let characters = 0;
  for (const item of response.output ?? []) {
    if (!item || typeof item !== "object" || !("content" in item)) continue;
    if (!Array.isArray(item.content) || item.content.length > 64) return false;
    for (const content of item.content) if (content && typeof content === "object" && typeof content.text === "string") {
      characters += content.text.length;
      if (characters > 128_000) return false;
    }
  }
  return true;
}
