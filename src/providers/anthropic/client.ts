import { AicfProviderError } from "../shared/errors.js";
import { loadOptionalProviderDependency } from "../shared/optional-dependency.js";
import type {
  AicfAnthropicMessagesClient,
  CreateDefaultAnthropicMessagesClientOptions
} from "./types.js";

export function createAnthropicClientFromSdk(client: unknown): AicfAnthropicMessagesClient {
  if (isAnthropicMessagesClient(client)) {
    return client;
  }

  throw new AicfProviderError({
    code: "provider_sdk_error",
    provider: "anthropic",
    safeMessage: "The Anthropic SDK client did not expose messages.create."
  });
}

export async function createDefaultAnthropicMessagesClient(
  options: CreateDefaultAnthropicMessagesClientOptions = {}
): Promise<AicfAnthropicMessagesClient> {
  const sdk = await loadOptionalProviderDependency<{
    Anthropic?: new (options: CreateDefaultAnthropicMessagesClientOptions) => unknown;
    default?: new (options: CreateDefaultAnthropicMessagesClientOptions) => unknown;
  }>({
    dependencyName: "@anthropic-ai/sdk",
    provider: "anthropic"
  });
  const Anthropic = sdk.default ?? sdk.Anthropic;
  if (!Anthropic) {
    throw new AicfProviderError({
      code: "provider_sdk_error",
      provider: "anthropic",
      safeMessage: "The Anthropic SDK module did not expose a client constructor."
    });
  }

  return createAnthropicClientFromSdk(new Anthropic(options));
}

function isAnthropicMessagesClient(value: unknown): value is AicfAnthropicMessagesClient {
  return typeof value === "object"
    && value !== null
    && "messages" in value
    && typeof (value as { messages?: { create?: unknown } }).messages?.create === "function";
}
