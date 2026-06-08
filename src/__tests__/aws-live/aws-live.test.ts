import { describe, expect, it } from "vitest";

const runLive = process.env.RUN_AWS_INTEGRATION === "1"
  && typeof process.env.AICF_AWS_TEST_TABLE === "string"
  && process.env.AICF_AWS_TEST_TABLE.length > 0;

describe.skipIf(!runLive)("AWS live integration scaffold", () => {
  it("is intentionally opt-in and requires host-provided AWS resources", () => {
    expect(process.env.RUN_AWS_INTEGRATION).toBe("1");
    expect(process.env.AICF_AWS_TEST_TABLE).toBeTruthy();
  });
});

