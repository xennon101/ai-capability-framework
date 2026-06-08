export type ExampleApprovalPayload = {
  approvalId: string;
  preparedActionId: string;
  capabilityId: string;
  safeSummary: string;
};

export function createExampleApprovalPayload(input: ExampleApprovalPayload) {
  return {
    approval_id: input.approvalId,
    prepared_action_id: input.preparedActionId,
    capability_id: input.capabilityId,
    summary: input.safeSummary
  };
}
