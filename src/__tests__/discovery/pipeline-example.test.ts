import { describe, expect, it } from "vitest";
import { runPipelineExample } from "../../../examples/12-capability-discovery-selection/pipeline-example.mjs";

describe("complete mocked provider/runtime integration", () => {
  it("runs all four optional paths with exact stage counts, complete mock receipts and approval-required preparation", async () => {
    const report = await runPipelineExample();
    expect(report.realProviderCalls).toBe(0);
    expect(report.qualityQualified).toBe(false);
    expect(report.cases).toHaveLength(4);
    expect(report.cases.map((item: any) => item.usage.totals.providerAttempts)).toEqual([5, 7, 7, 9]);
    for (const item of report.cases) {
      expect(item.planningTurns).toBe(1); expect(item.ordinaryTurns).toBe(4);
      expect(item.tasks.map((task: any) => task.chosenId)).toEqual(["support.ticket.get", "support.refund.prepare_case"]);
      expect(item.tasks[1].approvalRequired).toBe(true);
      expect(item.usage.stages.every((stage: any) => stage.mock)).toBe(true);
      expect(item.usage.totals.totalTokens.complete).toBe(true);
      expect(item.usage.totals.estimatedCost).toEqual({ total: 0, knownSubtotal: 0, complete: true });
      expect(item.snapshotFingerprints.every((value: string) => /^sha256:[0-9a-f]{64}$/.test(value))).toBe(true);
    }
    expect(report.failures).toMatchObject({ noMatch: "no_match", abstention: "abstained", permissionRevocation: "no_tools",
      sourceMutation: "no_tools", invalidIndexQueryCalls: 0, budgetDeniedAfterAttempts: 1 });
  });
});
