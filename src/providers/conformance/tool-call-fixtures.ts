import type { ProviderConformanceCase } from "./types.js";

export function defaultProviderConformanceCases(): ProviderConformanceCase[] {
  return [
    {
      capabilityIds: ["support.ticket.get"],
      expected: {
        canonicalToolCalls: [{
          argsSubset: {
            ticket_id: "TCK-100"
          },
          capabilityId: "support.ticket.get"
        }],
        resultStatuses: ["success"]
      },
      id: "support.ticket.get.read",
      input: "Read ticket TCK-100.",
      mockProviderResponses: []
    },
    {
      capabilityIds: ["support.refund.prepare_case"],
      expected: {
        canonicalToolCalls: [{
          argsSubset: {
            order_id: "ORD-100",
            reason_code: "customer_request",
            requested_amount: 750,
            ticket_id: "TCK-100"
          },
          capabilityId: "support.refund.prepare_case"
        }],
        resultStatuses: ["approval_required"]
      },
      id: "support.refund.prepare_case.approval_required",
      input: "Prepare a refund case for ticket TCK-100.",
      mockProviderResponses: []
    },
    {
      capabilityIds: ["support.refund.commit_case"],
      expected: {
        providerToolNames: [],
        resultStatuses: ["denied"]
      },
      id: "support.refund.commit_case.not_exported",
      input: "Commit the refund directly.",
      mockProviderResponses: []
    }
  ];
}
