import { semanticKernelMcpWarnings } from "./plugin-metadata.js";

export function getSemanticKernelMcpIntegrationGuide(): string {
  return [
    "Semantic Kernel compatibility is best handled through the AICF MCP server runtime when MCP plugin import is available.",
    "Build a selected capability slice for the current user, account, tenant, workflow, permissions, autonomy tier, and risk ceiling before exposing tools.",
    "AICF MCP tools should expose read and prepare operations only. Commit capabilities must not be listed for model invocation.",
    "The host application remains responsible for auth, account and tenant authority, approval collection, idempotency, side effects, and audit.",
    "Approval-required AICF envelopes are pauses, not completed actions.",
    "When Semantic Kernel automatic function invocation is enabled, keep AICF as the policy and lifecycle authority and never bypass AICF executor envelopes.",
    ...semanticKernelMcpWarnings()
  ].join("\n");
}
