import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("runtime support billing example", () => {
  it("runs the mock runtime flow end to end with model-safe boundaries", () => {
    const output = execFileSync(process.execPath, [
      "examples/runtime-support-billing/run-mock.mjs"
    ], {
      encoding: "utf8"
    });
    const summary = JSON.parse(output) as {
      approvalId: string;
      auditEventCount: number;
      commitStatus: string;
      duplicateCommitStatus: string;
      modelFacingSlice: string;
      modelSafePrepareEnvelope: Record<string, unknown>;
      prepareStatus: string;
      preparedActionId: string;
      readStatus: string;
      refundId: string;
      routedCapabilityIds: string[];
      ticketOrderId: string;
    };

    expect(summary.routedCapabilityIds).toContain("support.ticket.get");
    expect(summary.routedCapabilityIds).toContain("support.refund.prepare_case");
    expect(summary.routedCapabilityIds).not.toContain("support.refund.commit_case");
    expect(summary.modelFacingSlice).not.toContain("support.refund.commit_case");
    expect(summary.readStatus).toBe("success");
    expect(summary.ticketOrderId).toBe("ORD-100");
    expect(summary.prepareStatus).toBe("approval_required");
    expect(summary.preparedActionId).toEqual(expect.stringContaining("prepared_support_refund_prepare_case"));
    expect(summary.approvalId).toEqual(expect.stringContaining("approval_prepared_support_refund_prepare_case"));
    expect(summary.commitStatus).toBe("committed");
    expect(summary.duplicateCommitStatus).toBe("committed");
    expect(summary.refundId).toBe("RF-runtime-support-billing-1");
    expect(summary.auditEventCount).toBeGreaterThanOrEqual(7);
    expect(JSON.stringify(summary.modelSafePrepareEnvelope)).not.toContain("diagnostics");
    expect(JSON.stringify(summary.modelSafePrepareEnvelope)).not.toContain("token");
  });
});
