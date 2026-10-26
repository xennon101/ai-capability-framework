import { describe, expect, it } from "vitest";
import { verifyMcpSdkConsumer } from "../../../scripts/fixtures/mcp-sdk-consumer.mjs";

describe("actual MCP SDK compatibility", () => {
  it("registers validated tools and preserves execution, approval and revocation boundaries", async () => {
    const result = await verifyMcpSdkConsumer();
    expect(result).toMatchObject({ reads: 1, preparations: 1, approvalRequired: true, revokedCallBlocked: true, commits: 0 });
  });
});
