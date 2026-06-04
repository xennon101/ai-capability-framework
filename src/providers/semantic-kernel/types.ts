import type { CapabilityManifest } from "../../generated/manifest-types.js";
import type { AicfDiagnostic, JsonObject, ManifestRegistry } from "../../types.js";
import type { RuntimeCapabilitySlice } from "../../runtime/index.js";
import type { AicfProviderToolNameMap } from "../shared/types.js";

export interface SemanticKernelOpenApiExportRequest {
  includeRiskMetadata?: boolean;
  maxToolNameLength?: number;
  namePrefix?: string;
  pluginName?: string;
  registry: ManifestRegistry;
  serverUrl: string;
  slice: RuntimeCapabilitySlice;
  title?: string;
  version?: string;
}

export interface SemanticKernelOpenApiExport {
  diagnostics: AicfDiagnostic[];
  document: SemanticKernelOpenApiDocument;
  toolNameMap: AicfProviderToolNameMap;
}

export interface SemanticKernelOpenApiDocument {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
  };
  servers: Array<{
    url: string;
  }>;
  paths: Record<string, SemanticKernelOpenApiPathItem>;
  components: {
    schemas: {
      AicfToolResultEnvelope: JsonObject;
    };
  };
  "x-aicf": {
    diagnostics?: AicfDiagnostic[];
    pluginName: string;
    provider: "semantic-kernel";
    schemaVersion: "1.0";
  };
}

export interface SemanticKernelOpenApiPathItem {
  post: SemanticKernelOpenApiOperation;
}

export interface SemanticKernelOpenApiOperation {
  description: string;
  operationId: string;
  requestBody: {
    required: true;
    content: {
      "application/json": {
        schema: JsonObject;
      };
    };
  };
  responses: {
    "200": {
      description: string;
      content: {
        "application/json": {
          schema: JsonObject;
        };
      };
    };
  };
  summary: string;
  "x-aicf": SemanticKernelAicfOperationMetadata;
}

export interface SemanticKernelAicfOperationMetadata {
  approvalRequired: boolean;
  capabilityId: string;
  capabilityType: CapabilityManifest["capability_type"];
  capabilityVersion?: string;
  lifecycleOperation: "read" | "prepare";
  riskTier?: CapabilityManifest["risk_tier"];
  sideEffects: SemanticKernelSideEffectSummary;
}

export interface SemanticKernelSideEffectSummary {
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

export interface SemanticKernelPluginMetadataRequest extends SemanticKernelOpenApiExportRequest {
  openApiDocumentUrl?: string;
}

export interface SemanticKernelPluginMetadata {
  description: string;
  functions: SemanticKernelPluginFunctionSummary[];
  mcp: {
    recommended: true;
    summary: string;
    warnings: string[];
  };
  openapi: {
    documentUrl?: string;
    importHint: string;
    serverUrl: string;
  };
  pluginName: string;
  provider: "semantic-kernel";
  schemaVersion: "1.0";
  title: string;
  version: string;
}

export interface SemanticKernelPluginFunctionSummary {
  approvalRequired: boolean;
  capabilityId: string;
  capabilityType: CapabilityManifest["capability_type"];
  description: string;
  lifecycleOperation: "read" | "prepare";
  name: string;
  riskTier: CapabilityManifest["risk_tier"];
}
