import { isRestrictedCapability } from "../../adapter-common.js";
import type { LoadedCapabilityManifest } from "../../types.js";
import { AicfProviderError } from "../shared/errors.js";
import { createProviderToolNameMap } from "../shared/name-mapper.js";
import type { AicfProviderToolNameMap } from "../shared/types.js";
import type {
  SemanticKernelOpenApiExportRequest,
  SemanticKernelSideEffectSummary
} from "./types.js";

export const semanticKernelProvider = "semantic-kernel" as const;
export const defaultSemanticKernelTitle = "AICF Semantic Kernel Plugin";
export const defaultSemanticKernelPluginName = "aicf";
export const defaultSemanticKernelVersion = "1.0.0";

export function exportableSemanticKernelCapabilities(
  request: Pick<SemanticKernelOpenApiExportRequest, "registry" | "slice">
): LoadedCapabilityManifest[] {
  const ids = request.slice.items.map((item) => item.capabilityId);
  return ids
    .map((id) => request.registry.capabilityById.get(id))
    .filter((item): item is LoadedCapabilityManifest => Boolean(item))
    .filter((loadedCapability) => !isCommitCapability(loadedCapability))
    .filter((loadedCapability) => !isRestrictedCapability(loadedCapability.manifest));
}

export function createSemanticKernelToolNameMap(
  request: Pick<SemanticKernelOpenApiExportRequest, "maxToolNameLength" | "namePrefix">,
  capabilities: LoadedCapabilityManifest[]
): AicfProviderToolNameMap {
  return createProviderToolNameMap({
    capabilities,
    maxToolNameLength: request.maxToolNameLength,
    namePrefix: request.namePrefix,
    provider: semanticKernelProvider
  });
}

export function validateSemanticKernelServerUrl(serverUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new AicfProviderError({
      code: "provider_sdk_error",
      details: {
        field: "serverUrl"
      },
      provider: semanticKernelProvider,
      safeMessage: "Semantic Kernel OpenAPI export requires a valid HTTP or HTTPS server URL."
    });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AicfProviderError({
      code: "provider_sdk_error",
      details: {
        field: "serverUrl",
        protocol: parsed.protocol
      },
      provider: semanticKernelProvider,
      safeMessage: "Semantic Kernel OpenAPI export requires an HTTP or HTTPS server URL."
    });
  }

  parsed.username = "";
  parsed.password = "";
  return parsed.toString().replace(/\/$/u, "");
}

export function semanticKernelPluginName(request: Pick<SemanticKernelOpenApiExportRequest, "pluginName">): string {
  const value = request.pluginName?.trim() || defaultSemanticKernelPluginName;
  return value.replace(/[^a-zA-Z0-9_]+/gu, "_").replace(/^_+|_+$/gu, "") || defaultSemanticKernelPluginName;
}

export function lifecycleOperationForSemanticKernelCapability(
  loadedCapability: LoadedCapabilityManifest
): "read" | "prepare" {
  return loadedCapability.manifest.lifecycle.prepare ? "prepare" : "read";
}

export function semanticKernelSideEffectSummary(
  loadedCapability: LoadedCapabilityManifest
): SemanticKernelSideEffectSummary {
  const sideEffects = loadedCapability.manifest.side_effects;
  return {
    chargesMoney: sideEffects.charges_money,
    changesPermissions: sideEffects.changes_permissions,
    createsRecords: sideEffects.creates_records,
    deletesRecords: sideEffects.deletes_records,
    irreversible: sideEffects.irreversible,
    readsData: sideEffects.reads_data,
    refundsMoney: sideEffects.refunds_money,
    sendsExternalMessages: sideEffects.sends_external_messages,
    triggersExternalWorkflow: sideEffects.triggers_external_workflow,
    updatesRecords: sideEffects.updates_records,
    writesData: sideEffects.writes_data
  };
}

export function semanticKernelApprovalRequired(loadedCapability: LoadedCapabilityManifest): boolean {
  return Boolean(
    loadedCapability.manifest.policy.approval_required
    || loadedCapability.manifest.policy.approval_required_if?.length
  );
}

function isCommitCapability(loadedCapability: LoadedCapabilityManifest): boolean {
  return loadedCapability.manifest.lifecycle.commit
    || loadedCapability.manifest.capability_type === "write_commit";
}
