import type { CapabilityManifest } from "../../generated/manifest-types.js";
import type { AicfDiagnostic, JsonObject, ManifestRegistry } from "../../types.js";
import type { RuntimeCapabilitySlice } from "../../runtime/index.js";
import type {
  AicfProviderToolCall,
  AicfProviderToolNameMap
} from "../shared/types.js";

export interface BuildMcpProviderToolDescriptorsRequest {
  includeRestricted?: boolean;
  maxToolNameLength?: number;
  namePrefix?: string;
  registry: ManifestRegistry;
  slice: RuntimeCapabilitySlice;
}

export interface McpProviderToolDescriptorSet {
  bindings: AicfProviderToolNameMap["bindings"];
  descriptors: McpProviderToolDescriptor[];
  diagnostics: AicfDiagnostic[];
  excluded: McpProviderExcludedCapability[];
  toolNameMap: AicfProviderToolNameMap;
  tools: McpProviderToolDescriptor[];
}

export interface McpProviderExcludedCapability {
  capabilityId: string;
  diagnostics: AicfDiagnostic[];
  path?: string;
  reason: "commit" | "restricted" | "missing_capability" | "unsupported_schema" | "tool_name_collision";
}

export interface McpProviderToolDescriptor {
  _meta: {
    aicf: McpProviderAicfMetadata;
  };
  annotations?: McpProviderToolAnnotations;
  description: string;
  inputSchema: JsonObject;
  name: string;
  outputSchema?: JsonObject;
  title: string;
}

export interface McpProviderToolAnnotations {
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  readOnlyHint?: boolean;
}

export interface McpProviderAicfMetadata {
  approvalRequired: boolean;
  capabilityId: string;
  capabilityType: CapabilityManifest["capability_type"];
  capabilityVersion?: string;
  lifecycleOperation: "read" | "prepare";
  riskTier: CapabilityManifest["risk_tier"];
  security: McpProviderSecuritySummary;
  sideEffects: McpProviderSideEffectSummary;
}

export interface McpProviderSecuritySummary {
  approvalMayBeRequired: boolean;
  commitNotPerformed: true;
  dataScope?: string[];
  requiresHostAuthorization: true;
  requiresUserContext: boolean;
  tenantScoped: boolean;
}

export interface McpProviderSideEffectSummary {
  chargesMoney: boolean;
  changesPermissions: boolean;
  createsRecords: boolean;
  deletesRecords: boolean;
  irreversible: boolean;
  readsData: boolean;
  refundsMoney: boolean;
  sendsExternalMessages: boolean;
  triggersExternalWorkflow: boolean;
  updatesRecords: boolean;
  writesData: boolean;
}

export interface McpProviderToolCallRequest {
  method?: "tools/call";
  params: {
    arguments?: Record<string, unknown>;
    name: string;
  };
}

export interface ParseMcpProviderToolCallResult {
  diagnostics: AicfDiagnostic[];
  parsed?: AicfProviderToolCall;
  valid: boolean;
}

export interface McpProviderToolNameOptions {
  maxLength?: number;
  namePrefix?: string;
}

export interface LoadMcpSdkModuleOptions {
  dependencyName?: string;
}
