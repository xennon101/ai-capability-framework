import { loadOptionalProviderDependency } from "../shared/optional-dependency.js";
import type { LoadedCapabilityManifest } from "../../types.js";
import {
  mcpApprovalRequiredForCapability
} from "./annotations.js";
import type {
  LoadMcpSdkModuleOptions,
  McpProviderSecuritySummary
} from "./types.js";

export function mcpSecuritySummaryForCapability(
  loadedCapability: LoadedCapabilityManifest
): McpProviderSecuritySummary {
  const authorization = loadedCapability.manifest.authorization;
  return {
    approvalMayBeRequired: mcpApprovalRequiredForCapability(loadedCapability),
    commitNotPerformed: true,
    ...(authorization.data_scope ? { dataScope: [...authorization.data_scope] } : {}),
    requiresHostAuthorization: true,
    requiresUserContext: authorization.requires_user_context,
    tenantScoped: authorization.tenant_scoped
  };
}

export async function loadMcpSdkModule<T = unknown>(
  options: LoadMcpSdkModuleOptions = {}
): Promise<T> {
  return loadOptionalProviderDependency<T>({
    dependencyName: options.dependencyName ?? "@modelcontextprotocol/sdk",
    provider: "mcp"
  });
}
