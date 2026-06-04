import type {
  AicfBuiltContext,
  AicfRuntimeContext,
  AicfToolExecutor,
  RuntimeCapabilitySlice
} from "../../runtime/index.js";
import type { AicfTraceContentCapture, AicfTraceSink } from "../../observability/index.js";
import type { AicfDiagnostic, JsonObject, ManifestRegistry } from "../../types.js";
import type { AicfProviderToolNameMap } from "../shared/types.js";

export interface AicfLangChainToolFactory {
  tool(fn: AicfLangChainToolFunction, config: AicfLangChainToolConfig): unknown;
}

export interface AicfLangChainToolFunction {
  (args: unknown, config?: Record<string, unknown>): Promise<string>;
}

export interface AicfLangChainToolConfig {
  description: string;
  metadata?: Record<string, unknown>;
  name: string;
  schema: unknown;
}

export interface AicfLangChainSchemaFactory {
  createSchema(schema: JsonObject, options?: {
    path?: string;
  }): {
    diagnostics: AicfDiagnostic[];
    schema?: unknown;
  };
}

export interface BuildLangChainToolsRequest {
  builtContext: AicfBuiltContext;
  contentCapture?: AicfTraceContentCapture;
  executor: AicfToolExecutor;
  maxToolNameLength?: number;
  namePrefix?: string;
  registry: ManifestRegistry;
  runtimeContext: AicfRuntimeContext;
  schemaFactory?: AicfLangChainSchemaFactory;
  slice: RuntimeCapabilitySlice;
  toolFactory?: AicfLangChainToolFactory;
  traceSink?: AicfTraceSink;
}

export interface AicfLangChainToolSet {
  diagnostics: AicfDiagnostic[];
  toolNameMap: AicfProviderToolNameMap;
  tools: unknown[];
}

export type AicfLangChainToolset = AicfLangChainToolSet;

export interface BuildLangGraphToolNodeRequest extends BuildLangChainToolsRequest {
  ToolNode?: new (tools: unknown[], options?: Record<string, unknown>) => unknown;
  toolNodeOptions?: Record<string, unknown>;
}
