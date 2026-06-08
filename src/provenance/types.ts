import type { TraceRef } from "../audit/index.js";
import type { SourceRef } from "../security/index.js";
import type { JsonObject } from "../types.js";

export type GeneratedContentType = "text" | "document" | "image" | "audio" | "video" | "other";

export type GeneratedContentActor = "model" | "model_assisted_human" | "human_approved_model";

export interface ProviderRef {
  providerId: string;
  requestId?: string;
  responseId?: string;
  runId?: string;
  traceId?: string;
}

export type ProvenanceCapabilityOperation = "select" | "read" | "prepare" | "commit" | "verify";

export interface CapabilityRef {
  capabilityId: string;
  operation?: ProvenanceCapabilityOperation;
  version?: string;
}

export interface GeneratedContentProvenance {
  approvalRefs?: string[];
  capabilityRefs: CapabilityRef[];
  contentId: string;
  contentType: GeneratedContentType;
  createdAt: string;
  generatedBy: GeneratedContentActor;
  modelRefs: string[];
  providerRefs: ProviderRef[];
  schemaVersion: "1.0";
  sourceRefs: SourceRef[];
  traceRef?: TraceRef;
}

export interface ProvenanceReason {
  code: string;
  message: string;
  path?: string;
  severity: "info" | "warning" | "error";
}

export interface ProvenanceValidationResult {
  errors: ProvenanceReason[];
  valid: boolean;
  warnings: ProvenanceReason[];
}

export type ProvenanceFormat = "json" | "markdown";

export interface ProvenanceRedactionOptions {
  omitTraceRef?: boolean;
  omitProviderRequestRefs?: boolean;
}

export interface ProvenanceAdapterHookResult {
  adapterId: string;
  diagnostics?: ProvenanceReason[];
  labels?: Record<string, string>;
  schemaVersion: "1.0";
  sidecar?: JsonObject;
  status: "attached" | "skipped" | "failed";
}

export interface ProvenanceAdapterHookContext {
  adapterId?: string;
  now?: string;
}

export type ProvenanceAdapterHook = (
  record: GeneratedContentProvenance,
  context?: ProvenanceAdapterHookContext
) => Promise<ProvenanceAdapterHookResult> | ProvenanceAdapterHookResult;
