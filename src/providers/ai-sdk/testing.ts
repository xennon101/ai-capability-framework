import type {
  AicfAiSdkToolConfig,
  AicfAiSdkToolFactories
} from "./types.js";

export interface MockAiSdkTool {
  config: AicfAiSdkToolConfig;
  kind: "mock-ai-sdk-tool";
}

export interface MockAiSdkSchema {
  kind: "mock-ai-sdk-json-schema";
  schema: unknown;
  validate?: unknown;
}

export function createMockAiSdkToolFactories(): AicfAiSdkToolFactories {
  return {
    jsonSchema: (schema, options): MockAiSdkSchema => ({
      kind: "mock-ai-sdk-json-schema",
      schema,
      validate: options?.validate
    }),
    stepCountIs: (count) => ({
      count,
      kind: "mock-ai-sdk-step-count"
    }),
    tool: (config): MockAiSdkTool => ({
      config,
      kind: "mock-ai-sdk-tool"
    })
  };
}

export function isMockAiSdkTool(value: unknown): value is MockAiSdkTool {
  return isRecord(value)
    && value.kind === "mock-ai-sdk-tool"
    && isRecord(value.config);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
