import { describe, expect, it } from "vitest";
import { verifyAgentsSdkConsumer } from "../../../scripts/fixtures/agents-sdk-consumer.mjs";
import { verifyOpenAiSdkConsumer } from "../../../scripts/fixtures/openai-sdk-consumer.mjs";
import { verifyAwsSdkConsumer } from "../../../scripts/fixtures/aws-sdk-consumer.mjs";

describe("actual optional SDK contracts with local transports", () => {
  it("invokes SDK function tools through runtime approval and authorization boundaries", async () => {
    expect(await verifyAgentsSdkConsumer()).toMatchObject({ reads: 1, preparations: 1, approvalRequired: true, revokedCallBlocked: true, commits: 0, networkAttempts: 0 });
  });

  it("preserves Responses requests, cancellation, continuations and incomplete usage", async () => {
    expect(await verifyOpenAiSdkConsumer()).toMatchObject({ requests: 10, unexpectedNetwork: 0,
      ordinary: [{ status: "completed", reads: 1, attempts: 2 }, { status: "provider_error", reads: 1, attempts: 2 }] });
  });

  it("serializes commands using all seven actual AWS packages without network access", async () => {
    expect(await verifyAwsSdkConsumer()).toEqual({ packages: 7, serializedRequests: 6, transport: "injected", networkAttempts: 0 });
  });
});
