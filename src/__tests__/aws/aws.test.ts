import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DynamoDbApprovalStore,
  DynamoDbAuditSink,
  DynamoDbIdempotencyStore,
  DynamoDbPreparedActionStore,
  EventBridgeRuntimeEventPublisher,
  FakeDynamoDbDocumentClient,
  FakeEventBridgeClient,
  FakeStepFunctionsClient,
  StepFunctionsApprovalAdapter,
  type AicfRuntimeEventPublisher
} from "../../aws/index.js";
import type {
  AicfApprovalDecision,
  AicfAuditEvent,
  AicfPreparedAction
} from "../../runtime/index.js";

const tableName = "AicfRuntime";
const fixedNow = () => new Date("2026-06-04T12:00:00.000Z");

describe("AWS DynamoDB runtime stores", () => {
  it("writes, reads, and updates prepared actions with single-table keys", async () => {
    const client = new FakeDynamoDbDocumentClient();
    const store = new DynamoDbPreparedActionStore({
      documentClient: client,
      now: fixedNow,
      tableName
    });
    const action = preparedAction();

    await store.create(action);
    const loaded = await store.get(action.preparedActionId);
    await store.updateState({
      expectedState: "approval_pending",
      nextState: "approved",
      preparedActionId: action.preparedActionId,
      updatedAt: "2026-06-04T12:01:00.000Z"
    });
    const updated = await store.get(action.preparedActionId);

    expect(client.commands[0]).toMatchObject({
      name: "PutCommand",
      input: {
        Item: {
          entityType: "prepared_action",
          GSI1PK: "PREPARED#prepared_1",
          PK: "AICF#tenant_example#acct_example",
          SK: "PREPARED#prepared_1",
          ttlEpochSeconds: 1780578000
        },
        TableName: tableName
      }
    });
    expect(client.commands.map((command) => command.name)).toContain("QueryCommand");
    expect(client.commands.map((command) => command.name)).toContain("UpdateCommand");
    expect(loaded).toMatchObject({ preparedActionId: "prepared_1", tenantId: "tenant_example" });
    expect(updated).toMatchObject({ preparedActionId: "prepared_1", state: "approved" });
  });

  it("stores approval decisions and supports approval/prepared-action lookups", async () => {
    const client = new FakeDynamoDbDocumentClient();
    const store = new DynamoDbApprovalStore({
      documentClient: client,
      tableName
    });
    const decision = approvalDecision();

    await store.create(decision);
    const byId = await store.get(decision.approvalId);
    const forPreparedAction = await store.getForPreparedAction("prepared_1");

    expect(client.commands[0]).toMatchObject({
      name: "PutCommand",
      input: {
        Item: {
          entityType: "approval",
          GSI1PK: "APPROVAL#approval_1",
          GSI2PK: "PREPARED_APPROVALS#prepared_1",
          PK: "AICF#tenant_example#acct_example",
          SK: "APPROVAL#prepared_1#approval_1"
        }
      }
    });
    expect(byId).toMatchObject({ approvalId: "approval_1", approved: true });
    expect(forPreparedAction).toHaveLength(1);
    expect(forPreparedAction[0]).toMatchObject({ preparedActionId: "prepared_1" });
  });

  it("reserves and completes idempotency keys without duplicate commits", async () => {
    const client = new FakeDynamoDbDocumentClient();
    const store = new DynamoDbIdempotencyStore({
      documentClient: client,
      tableName
    });
    const scope = "tenant:tenant_example|account:acct_example|capability:support.refund.commit_case|prepared:prepared_1";

    const first = await store.reserve({
      expiresAt: "2026-06-04T13:00:00.000Z",
      key: "refund:TCK-100:1",
      metadata: {
        aicf: {
          accountId: "acct_example",
          preparedActionId: "prepared_1",
          tenantId: "tenant_example"
        }
      },
      scope
    });
    await store.complete({
      key: "refund:TCK-100:1",
      result: {
        committedActionId: "commit_1",
        status: "committed"
      },
      scope
    });
    const duplicate = await store.reserve({
      expiresAt: "2026-06-04T13:00:00.000Z",
      key: "refund:TCK-100:1",
      scope
    });

    expect(first).toEqual({ reserved: true });
    expect(duplicate).toEqual({
      existing: {
        committedActionId: "commit_1",
        status: "committed"
      },
      reserved: false
    });
    expect(client.commands.find((command) => command.name === "PutCommand")?.input.Item).toMatchObject({
      entityType: "idempotency",
      PK: "AICF#tenant_example#acct_example",
      SK: `IDEMPOTENCY#${scope}#refund:TCK-100:1`
    });
  });

  it("writes sanitized audit event payloads", async () => {
    const client = new FakeDynamoDbDocumentClient();
    const sink = new DynamoDbAuditSink({
      defaultAccountId: "acct_example",
      defaultTenantId: "tenant_example",
      documentClient: client,
      now: fixedNow,
      tableName,
      ttlSeconds: 3600
    });

    await sink.write(auditEvent());

    const item = client.commands[0]?.input.Item as Record<string, unknown>;
    const payload = item.payload as AicfAuditEvent;
    expect(client.commands[0]).toMatchObject({
      name: "PutCommand",
      input: {
        Item: {
          entityType: "audit_event",
          PK: "AICF#tenant_example#acct_example",
          SK: "AUDIT#2026-06-04T12:00:00.000Z#audit_1",
          ttlEpochSeconds: 1780578000
        }
      }
    });
    expect(payload.details?.token).toBe("[REDACTED]");
    expect(payload.details?.rawPrompt).toBe("[REDACTED]");
  });
});

describe("AWS approval and event adapters", () => {
  it("starts and resumes Step Functions approval workflows", async () => {
    const client = new FakeStepFunctionsClient();
    const adapter = new StepFunctionsApprovalAdapter({
      now: fixedNow,
      sfnClient: client,
      stateMachineArn: "arn:aws:states:us-east-1:123456789012:stateMachine:aicf-approval"
    });

    const started = await adapter.startApproval({
      approvalRequirement: {
        approvalType: "operator_review",
        reason: "Refund requires operator review."
      },
      callbackUrl: "https://example.com/aicf/approvals/prepared_1",
      preparedAction: preparedAction()
    });
    await adapter.sendApprovalResult({
      decision: approvalDecision(),
      taskToken: "task-token-approved"
    });
    await adapter.sendApprovalResult({
      decision: {
        ...approvalDecision(),
        approvalId: "approval_2",
        approved: false,
        reason: "Reviewer rejected the action."
      },
      taskToken: "task-token-rejected"
    });

    expect(started.executionArn).toContain("arn:aws:states");
    expect(client.commands.map((command) => command.name)).toEqual([
      "StartExecutionCommand",
      "SendTaskSuccessCommand",
      "SendTaskFailureCommand"
    ]);
    const startInput = JSON.parse(String(client.commands[0]?.input.input)) as Record<string, unknown>;
    expect(startInput).toMatchObject({
      schemaVersion: "0.1",
      preparedAction: {
        accountId: "acct_example",
        preparedActionId: "prepared_1",
        tenantId: "tenant_example"
      }
    });
    expect(JSON.stringify(startInput)).not.toContain("argsRedacted");
    expect(client.commands[2]?.input).toMatchObject({
      error: "AICFApprovalRejected",
      taskToken: "task-token-rejected"
    });
  });

  it("publishes sanitized trace and audit events to EventBridge", async () => {
    const client = new FakeEventBridgeClient();
    const publisher: AicfRuntimeEventPublisher = new EventBridgeRuntimeEventPublisher({
      eventBridgeClient: client,
      eventBusName: "aicf-events",
      source: "example.aicf"
    });

    await publisher.publish({
      attributes: {
        capabilityId: "support.ticket.get",
        rawPrompt: "secret raw prompt"
      },
      requestId: "req_1",
      runId: "run_1",
      timestamp: "2026-06-04T12:00:00.000Z",
      type: "model.call.start"
    });
    await publisher.publish(auditEvent());

    expect(client.commands).toHaveLength(2);
    expect(client.commands[0]).toMatchObject({
      name: "PutEventsCommand",
      input: {
        Entries: [expect.objectContaining({
          DetailType: "AICF Trace model.call.start",
          EventBusName: "aicf-events",
          Source: "example.aicf"
        })]
      }
    });
    const traceDetail = JSON.parse(String((client.commands[0]?.input.Entries as Array<{ Detail: string }>)[0]?.Detail)) as Record<string, unknown>;
    expect(JSON.stringify(traceDetail)).not.toContain("secret raw prompt");
    expect(client.commands[1]?.input).toMatchObject({
      Entries: [expect.objectContaining({
        DetailType: "AICF Audit action_commit"
      })]
    });
  });
});

describe("AWS import and package boundaries", () => {
  it("exports AWS APIs from the built package subpath", async () => {
    const aws = await import("../../../dist/aws/index.js") as Record<string, unknown>;

    for (const exportName of [
      "DynamoDbPreparedActionStore",
      "DynamoDbApprovalStore",
      "DynamoDbIdempotencyStore",
      "DynamoDbAuditSink",
      "StepFunctionsApprovalAdapter",
      "EventBridgeRuntimeEventPublisher",
      "FakeDynamoDbDocumentClient",
      "FakeStepFunctionsClient",
      "FakeEventBridgeClient"
    ]) {
      expect(aws[exportName], exportName).toEqual(expect.any(Function));
    }
  });

  it("keeps AWS SDK imports out of root, runtime, and OpenAI built subpaths", async () => {
    for (const file of [
      "dist/index.js",
      "dist/runtime/index.js",
      "dist/openai/index.js"
    ]) {
      const content = await readFile(file, "utf8");
      expect(content).not.toContain("@aws-sdk/");
      expect(content).not.toContain("dist/aws/");
    }
  });
});

function preparedAction(): AicfPreparedAction {
  return {
    accountId: "acct_example",
    argsHash: "hash_1",
    argsRedacted: {
      order_id: "ORD-100",
      requested_amount: 25
    },
    capabilityId: "support.refund.commit_case",
    capabilityVersion: "1.0.0",
    createdAt: "2026-06-04T12:00:00.000Z",
    expiresAt: "2026-06-04T13:00:00.000Z",
    metadata: {
      aicf: {
        accountId: "acct_example",
        capabilityId: "support.refund.commit_case",
        preparedActionId: "prepared_1",
        tenantId: "tenant_example"
      }
    },
    policyDecision: {
      reasons: [],
      requiredApprovals: [{
        approvalType: "operator_review",
        reason: "Refund requires operator review."
      }],
      status: "approval_required"
    },
    preparedActionId: "prepared_1",
    preview: {
      data: {
        ticket_id: "TCK-100"
      },
      riskTier: "medium",
      summary: "Refund case prepared."
    },
    requestId: "req_1",
    runId: "run_1",
    state: "approval_pending",
    subjectId: "user_example",
    tenantId: "tenant_example",
    updatedAt: "2026-06-04T12:00:00.000Z"
  };
}

function approvalDecision(): AicfApprovalDecision {
  return {
    approvalId: "approval_1",
    approved: true,
    decidedAt: "2026-06-04T12:02:00.000Z",
    decidedBy: {
      actorId: "operator_example",
      actorType: "operator"
    },
    metadata: {
      aicf: {
        accountId: "acct_example",
        capabilityId: "support.refund.commit_case",
        preparedActionId: "prepared_1",
        tenantId: "tenant_example"
      }
    },
    preparedActionId: "prepared_1",
    reason: "Approved for synthetic test."
  };
}

function auditEvent(): AicfAuditEvent {
  return {
    actionState: "committed",
    capabilityId: "support.refund.commit_case",
    createdAt: "2026-06-04T12:00:00.000Z",
    details: {
      accountId: "acct_example",
      rawPrompt: "refund customer 25",
      tenantId: "tenant_example",
      token: "Bearer sk-secret"
    },
    eventId: "audit_1",
    operation: "commit",
    preparedActionId: "prepared_1",
    requestId: "req_1",
    runId: "run_1",
    status: "succeeded",
    type: "action_commit"
  };
}
