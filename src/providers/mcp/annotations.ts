import type { LoadedCapabilityManifest } from "../../types.js";
import type {
  McpProviderSideEffectSummary,
  McpProviderToolAnnotations
} from "./types.js";

export function mcpAnnotationsForCapability(
  loadedCapability: LoadedCapabilityManifest
): McpProviderToolAnnotations {
  const capability = loadedCapability.manifest;
  const sideEffects = capability.side_effects;
  const writes = sideEffects.writes_data
    || sideEffects.creates_records
    || sideEffects.updates_records
    || sideEffects.deletes_records;
  const openWorld = sideEffects.sends_external_messages || sideEffects.triggers_external_workflow;
  const destructive = sideEffects.deletes_records
    || sideEffects.changes_permissions
    || sideEffects.irreversible
    || sideEffects.charges_money
    || sideEffects.refunds_money;

  return {
    destructiveHint: destructive,
    idempotentHint: !destructive && (!writes || capability.idempotency?.required === true),
    openWorldHint: openWorld,
    readOnlyHint: sideEffects.reads_data && !writes && !openWorld && !destructive
  };
}

export function mcpSideEffectSummaryForCapability(
  loadedCapability: LoadedCapabilityManifest
): McpProviderSideEffectSummary {
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

export function mcpApprovalRequiredForCapability(
  loadedCapability: LoadedCapabilityManifest
): boolean {
  return Boolean(
    loadedCapability.manifest.policy.approval_required
    || loadedCapability.manifest.policy.approval_required_if?.length
  );
}
