import type { CapabilityManifest } from "../../generated/manifest-types.js";
import type {
  AicfDiagnostic,
  JsonObject,
  LoadedCapabilityManifest,
  ManifestRegistry
} from "../../types.js";
import type {
  AicfBuiltContext,
  AicfRuntimeContext,
  AicfRuntimeToolResultEnvelope,
  AicfToolExecutionRequest,
  AicfToolExecutor,
  RuntimeCapabilitySlice
} from "../../runtime/index.js";

export type AicfProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "vercel-ai-sdk"
  | "mcp"
  | "langchain"
  | "semantic-kernel";

export interface AicfProviderMetadata {
  defaultNamePrefix: string;
  id: AicfProviderId;
  label: string;
  maxToolNameLength: number;
  toolNamePattern: RegExp;
  toolNamePatternDescription: string;
}

export interface AicfProviderToolNameBinding {
  capabilityId: string;
  capabilityVersion?: string;
  operation: "read" | "prepare" | "commit";
  originalInputSchema: JsonObject;
  provider: AicfProviderId;
  providerToolName: string;
  restricted: boolean;
}

export interface AicfProviderToolNameMap {
  bindingByCapabilityId: Map<string, AicfProviderToolNameBinding>;
  bindingByProviderToolName: Map<string, AicfProviderToolNameBinding>;
  bindings: AicfProviderToolNameBinding[];
  diagnostics: AicfDiagnostic[];
  provider: AicfProviderId;
  providerNameToCapabilityId(providerToolName: string): string | undefined;
  toProviderToolName(capabilityId: string): string | undefined;
}

export interface CreateProviderToolNameMapOptions {
  capabilities: LoadedCapabilityManifest[] | ManifestRegistry;
  maxToolNameLength?: number;
  namePrefix?: string;
  provider: AicfProviderId;
}

export interface AicfProviderToolDescriptor {
  capabilityId: string;
  description: string;
  inputSchema: JsonObject;
  metadata: {
    autonomyTier: CapabilityManifest["autonomy_tier"];
    capabilityType: CapabilityManifest["capability_type"];
    restricted: boolean;
    riskTier: CapabilityManifest["risk_tier"];
  };
  provider: AicfProviderId;
  providerToolName: string;
}

export interface BuildProviderToolDescriptorInput {
  binding: AicfProviderToolNameBinding;
  loadedCapability: LoadedCapabilityManifest;
  normalizedInputSchema: JsonObject;
}

export interface AicfProviderToolCall {
  args: Record<string, unknown>;
  callId?: string;
  capabilityId: string;
  provider: AicfProviderId;
  providerToolName: string;
  rawProviderRef?: {
    id?: string;
    type?: string;
  };
}

export interface ParseProviderToolCallInput {
  args?: unknown;
  callId?: string;
  provider: AicfProviderId;
  providerToolName: string;
  rawProviderRef?: {
    id?: string;
    type?: string;
  };
  requireCallId?: boolean;
  toolNameMap: AicfProviderToolNameMap;
}

export interface ParseProviderToolCallResult {
  diagnostics: AicfDiagnostic[];
  parsed?: AicfProviderToolCall;
  valid: boolean;
}

export interface NormalizeProviderToolSchemaOptions {
  path?: string;
  unsupportedKeywords?: string[];
}

export interface NormalizeProviderToolSchemaResult {
  diagnostics: AicfDiagnostic[];
  normalizedSchema?: JsonObject;
  originalSchema?: JsonObject;
  valid: boolean;
}

export interface AicfProviderToolResult {
  callId?: string;
  capabilityId: string;
  envelope: AicfRuntimeToolResultEnvelope;
  isError: boolean;
  output: string;
  provider: AicfProviderId;
  providerToolName: string;
}

export interface BuildProviderToolResultInput {
  envelope: AicfRuntimeToolResultEnvelope;
  providerCall: AicfProviderToolCall;
  runtimeContext?: AicfRuntimeContext;
}

export interface ExecuteProviderToolCallInput {
  builtContext: AicfBuiltContext;
  executor: AicfToolExecutor;
  providerCall: AicfProviderToolCall;
  registry: ManifestRegistry;
  runtimeContext: AicfRuntimeContext;
  runtimeSlice?: RuntimeCapabilitySlice;
  source?: AicfToolExecutionRequest["source"];
  toolNameMap: AicfProviderToolNameMap;
}

export interface LoadOptionalProviderDependencyOptions {
  dependencyName: string;
  provider?: AicfProviderId;
}
