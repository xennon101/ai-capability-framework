import { AicfProviderError } from "../shared/errors.js";
import { loadOptionalProviderDependency } from "../shared/optional-dependency.js";
import type {
  AicfAiSdkToolConfig,
  AicfAiSdkToolFactories
} from "./types.js";

export function createAiSdkToolFactoriesFromSdk(sdk: unknown): AicfAiSdkToolFactories {
  if (!isRecord(sdk) || typeof sdk.tool !== "function" || typeof sdk.jsonSchema !== "function") {
    throw new AicfProviderError({
      code: "provider_sdk_error",
      provider: "vercel-ai-sdk",
      safeMessage: "The AI SDK module did not expose tool and jsonSchema factories."
    });
  }

  const typedSdk = sdk as {
    jsonSchema: AicfAiSdkToolFactories["jsonSchema"];
    stepCountIs?: AicfAiSdkToolFactories["stepCountIs"];
    tool: AicfAiSdkToolFactories["tool"];
  };

  return {
    jsonSchema: (schema, options) => typedSdk.jsonSchema(schema, options),
    stepCountIs: typeof typedSdk.stepCountIs === "function" ? (count) => typedSdk.stepCountIs?.(count) : undefined,
    tool: (config: AicfAiSdkToolConfig) => typedSdk.tool(config)
  };
}

export async function createDefaultAiSdkToolFactories(): Promise<AicfAiSdkToolFactories> {
  const sdk = await loadOptionalProviderDependency({
    dependencyName: "ai",
    provider: "vercel-ai-sdk"
  });
  return createAiSdkToolFactoriesFromSdk(sdk);
}

export function createPlainAiSdkToolFactories(): AicfAiSdkToolFactories {
  return {
    jsonSchema: (schema, options) => ({
      schema,
      validate: options?.validate
    }),
    stepCountIs: (count) => ({
      count,
      type: "aicf_step_count_is"
    }),
    tool: (config) => config
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
