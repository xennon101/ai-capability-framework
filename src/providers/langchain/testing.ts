import type {
  AicfLangChainSchemaFactory,
  AicfLangChainToolConfig,
  AicfLangChainToolFactory,
  AicfLangChainToolFunction
} from "./types.js";

export interface MockLangChainTool {
  config: AicfLangChainToolConfig;
  invoke: AicfLangChainToolFunction;
  kind: "mock-langchain-tool";
}

export function createMockLangChainToolFactory(): AicfLangChainToolFactory {
  return {
    tool: (fn, config): MockLangChainTool => ({
      config,
      invoke: fn,
      kind: "mock-langchain-tool"
    })
  };
}

export function createMockLangChainSchemaFactory(): AicfLangChainSchemaFactory {
  return {
    createSchema: (schema) => ({
      diagnostics: [],
      schema: {
        kind: "mock-langchain-schema",
        schema
      }
    })
  };
}

export function isMockLangChainTool(value: unknown): value is MockLangChainTool {
  return isRecord(value)
    && value.kind === "mock-langchain-tool"
    && isRecord(value.config)
    && typeof value.invoke === "function";
}

export class MockLangGraphToolNode {
  readonly options: Record<string, unknown> | undefined;
  readonly tools: unknown[];

  constructor(tools: unknown[], options?: Record<string, unknown>) {
    this.options = options;
    this.tools = tools;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
