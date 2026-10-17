// Executable retrieval fixtures reuse the support manifests without adding manifest files.
export const retrievalCases = [
  {
    id: "ticket_lookup",
    fragments: [{ key: "request", text: "Read ticket" }],
    compatibleIds: ["support.ticket.get"],
    forbiddenIds: ["support.refund.commit_case", "support.refund.prepare_case"]
  },
  {
    id: "refund_review",
    fragments: [{ key: "request", text: "Prepare refund" }],
    compatibleIds: ["support.refund.prepare_case"],
    forbiddenIds: ["support.refund.commit_case", "support.ticket.get"]
  },
  {
    id: "ticket_lookup_again",
    fragments: [{ key: "request", text: "ticket" }],
    compatibleIds: ["support.ticket.get"],
    forbiddenIds: ["support.refund.commit_case"]
  },
  {
    id: "no_matching_terms",
    fragments: [{ key: "request", text: "quasar" }],
    compatibleIds: [],
    forbiddenIds: [
      "support.refund.commit_case",
      "support.refund.prepare_case",
      "support.ticket.get"
    ]
  }
];
