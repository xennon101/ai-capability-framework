import { AicfProviderError } from "../shared/errors.js";
import { loadOptionalProviderDependency } from "../shared/optional-dependency.js";
import type {
  AicfGeminiClient,
  CreateDefaultGeminiClientOptions
} from "./types.js";

export function createGeminiClientFromSdk(client: unknown): AicfGeminiClient {
  if (isGeminiClient(client)) {
    return client;
  }

  throw new AicfProviderError({
    code: "provider_sdk_error",
    provider: "gemini",
    safeMessage: "The Gemini SDK client did not expose models.generateContent."
  });
}

export async function createDefaultGeminiClient(
  options: CreateDefaultGeminiClientOptions = {}
): Promise<AicfGeminiClient> {
  const sdk = await loadOptionalProviderDependency<{
    GoogleGenAI?: new (options: CreateDefaultGeminiClientOptions) => unknown;
    default?: new (options: CreateDefaultGeminiClientOptions) => unknown;
  }>({
    dependencyName: "@google/genai",
    provider: "gemini"
  });
  const GoogleGenAI = sdk.GoogleGenAI ?? sdk.default;
  if (!GoogleGenAI) {
    throw new AicfProviderError({
      code: "provider_sdk_error",
      provider: "gemini",
      safeMessage: "The Google GenAI SDK module did not expose a client constructor."
    });
  }

  return createGeminiClientFromSdk(new GoogleGenAI(options));
}

function isGeminiClient(value: unknown): value is AicfGeminiClient {
  return typeof value === "object"
    && value !== null
    && "models" in value
    && typeof (value as { models?: { generateContent?: unknown } }).models?.generateContent === "function";
}
