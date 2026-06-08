import type { JsonObject } from "ai-capability-framework";

export type ExamplePolicyDecision = {
  allowed: boolean;
  approvalRequired: boolean;
  reasons: string[];
};

export function decideExamplePolicy(input: {
  capabilityId: string;
  operation: string;
  args?: JsonObject;
  permissions: string[];
  tenantPresent: boolean;
}): ExamplePolicyDecision {
  if (!input.tenantPresent) {
    return { allowed: false, approvalRequired: false, reasons: ["missing_tenant_context"] };
  }
  if (!input.permissions.includes(`capability:${input.capabilityId}:${input.operation}`)) {
    return { allowed: false, approvalRequired: false, reasons: ["missing_permission"] };
  }
  return { allowed: true, approvalRequired: false, reasons: ["policy_allowed"] };
}
