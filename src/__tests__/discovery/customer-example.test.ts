import { describe, expect, it, vi } from "vitest";
import { runCustomerRequestExample, runSimpleHybridExample } from "../../../examples/12-capability-discovery-selection/customer-request-example.mjs";
import { validatePlannedTasks } from "../../../examples/12-capability-discovery-selection/customer-cases.mjs";

describe("customer request to ordinary model tool selection", () => {
  it("decomposes, retrieves, reads and prepares for approval with no network or dedicated selector", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    try {
      const result = await runCustomerRequestExample();
      expect(result.plannedTasks[1].dependsOn).toEqual(["read-ticket"]);
      expect(result.taskResults.map((task: any) => [task.taskId, task.selectedCapabilityId, task.toolStatus])).toEqual([
        ["read-ticket", "support.ticket.get", "success"], ["prepare-refund", "support.refund.prepare_case", "approval_required"]
      ]);
      for (const task of result.taskResults) {
        expect(task.candidateIds).toHaveLength(2);
        expect(task.exportedToolNames).toHaveLength(2);
        expect(task.candidateIds).not.toContain("support.refund.commit_case");
      }
      expect(result.taskResults[1]).toMatchObject({ approvalRequired: true, preview: { order_id: "ORD-100", ticket_id: "TCK-100" } });
      expect(result).toMatchObject({ readCalls: 1, prepareCalls: 1, commitCalls: 0, embeddingAttempts: 0, dedicatedSelectorCalls: 0,
        planning: { turns: 1, usage: { totalTokens: 25, tokenTotalsComplete: true, estimatedCost: null, costComplete: false } },
        ordinaryModel: { turns: 4, usage: { totalTokens: 100, tokenTotalsComplete: true } },
        discoveryUsage: { totals: { providerAttempts: 0, totalTokens: { total: 0, complete: true } } },
        companionCases: { noMatch: { status: "no_match" }, denied: { status: "no_match", exportedCount: 0 } } });
      expect(result.finalText).toContain("awaiting approval");
      const hybrid = await runSimpleHybridExample();
      expect(hybrid).toMatchObject({ embeddingAttempts: 2, invalidIndexStatus: "unavailable", invalidIndexQueryCalls: 0,
        result: { actualMode: "hybrid" }, usage: { totals: { providerAttempts: 2, totalTokens: { total: 80, complete: true } } } });
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it.each([[], [{ id: "one", text: "ticket", dependsOn: ["missing"] }],
    [{ id: "one", text: "ticket", dependsOn: [] }, { id: "one", text: "refund", dependsOn: [] }],
    [{ id: "one", text: "ticket", dependsOn: [], capabilityId: "injected" }],
    [{ id: "one", text: "ticket", dependsOn: ["one"] }]])("validates application task plans before discovery: %j", plan => {
    expect(() => validatePlannedTasks(plan)).toThrow("Invalid application task plan");
  });
});
