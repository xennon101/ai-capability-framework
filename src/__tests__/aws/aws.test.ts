import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  CloudWatchTelemetryPublisher,
  DynamoDbActionStore,
  DynamoDbApprovalStore,
  DynamoDbApprovalLedgerStore,
  DynamoDbAuditSink,
  DynamoDbBudgetUsageStore,
  DynamoDbControlPlaneStore,
  DynamoDbControlsStore,
  DynamoDbIdempotencyStore,
  DynamoDbIdempotencyLedgerStore,
  DynamoDbPolicyDecisionStore,
  DynamoDbPreparedActionStore,
  DynamoDbReplayTraceMetadataStore,
  DynamoDbStepFunctionsApprovalTaskStore,
  EventBridgeRuntimeEventPublisher,
  FakeCloudWatchClient,
  FakeCloudWatchLogsClient,
  FakeDynamoDbDocumentClient,
  FakeEventBridgeClient,
  FakeKmsClient,
  FakeStepFunctionsClient,
  KmsRedactionProvider,
  StepFunctionsApprovalAdapter,
  type AicfRuntimeEventPublisher
} from "../../aws/index.js";
import type {
  ActionRecord,
  ApprovalRecord,
  PolicyDecisionRecord
} from "../../audit/index.js";
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

  it("omits undefined expected-state values from prepared action updates", async () => {
    const client = new FakeDynamoDbDocumentClient();
    const store = new DynamoDbPreparedActionStore({
      documentClient: client,
      now: fixedNow,
      tableName
    });
    const action = preparedAction();

    await store.create(action);
    await store.updateState({
      nextState: "approved",
      preparedActionId: action.preparedActionId,
      updatedAt: "2026-06-04T12:01:00.000Z"
    });
    const updateCommand = client.commands.find((command) => command.name === "UpdateCommand");

    expect(updateCommand?.input.ConditionExpression).toBeUndefined();
    expect(updateCommand?.input.ExpressionAttributeValues).toEqual({
      ":nextState": "approved",
      ":updatedAt": "2026-06-04T12:01:00.000Z"
    });
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

describe("AWS DynamoDB production reference stores", () => {
  it("persists canonical audit ledger records with filters, cloning, and duplicate protection", async () => {
    const client = new FakeDynamoDbDocumentClient();
    const options = { documentClient: client, now: fixedNow, tableName };
    const decisions = new DynamoDbPolicyDecisionStore(options);
    const actions = new DynamoDbActionStore(options);
    const approvals = new DynamoDbApprovalLedgerStore(options);
    const idempotency = new DynamoDbIdempotencyLedgerStore(options);

    await decisions.putDecision(policyDecisionRecord());
    await actions.putAction(actionRecord());
    await approvals.putApproval(approvalRecord());
    const firstReservation = await idempotency.reserve("refund:TCK-100:1", {
      metadata: { reason: "synthetic idempotency test" },
      scope: "tenant:tenant_example|capability:support.refund.commit_case"
    });
    await idempotency.complete("refund:TCK-100:1", "tenant:tenant_example|capability:support.refund.commit_case", {
      resultHash: "hash_result",
      resultType: "commit"
    });
    const secondReservation = await idempotency.reserve("refund:TCK-100:1", {
      scope: "tenant:tenant_example|capability:support.refund.commit_case"
    });

    await expect(decisions.putDecision(policyDecisionRecord())).rejects.toThrow(/ConditionalCheckFailed/);
    const listedDecisions = await decisions.listDecisions({ capabilityId: "support.refund.prepare_case" });
    const listedActions = await actions.listActions({ preparedActionId: "prepared_1" });
    const updatedAction = await actions.updateAction("action_1", { actionState: "committing" });
    const listedApprovals = await approvals.listApprovals({ status: "pending" });
    const updatedApproval = await approvals.updateApproval("approval_record_1", { status: "approved" });
    const listedIdempotency = await idempotency.listIdempotencyRecords({ status: "completed" });

    listedDecisions[0]!.reasons.push({ code: "mutated", message: "Mutation should not persist." });
    expect((await decisions.getDecision("decision_1"))?.reasons).toHaveLength(1);
    expect(listedActions).toHaveLength(1);
    expect(updatedAction.actionState).toBe("committing");
    expect(listedApprovals).toHaveLength(1);
    expect(updatedApproval.status).toBe("approved");
    expect(firstReservation.reserved).toBe(true);
    expect(secondReservation.reserved).toBe(false);
    expect(listedIdempotency[0]).toMatchObject({ status: "completed" });
    expect(client.commands.find((command) => command.name === "PutCommand")?.input.Item).toMatchObject({
      entityType: "policy_decision",
      GSI1PK: "POLICY_DECISION#decision_1",
      GSI2PK: "ENTITY#policy_decision"
    });
  });

  it("persists controls, budget usage, approval tasks, and replay metadata", async () => {
    const client = new FakeDynamoDbDocumentClient();
    const options = { documentClient: client, now: fixedNow, tableName };
    const controls = new DynamoDbControlsStore(options);
    const budgetUsage = new DynamoDbBudgetUsageStore(options);
    const taskStore = new DynamoDbStepFunctionsApprovalTaskStore(options);
    const replayStore = new DynamoDbReplayTraceMetadataStore(options);

    await controls.putKillSwitch({
      createdAt: "2026-06-04T12:00:00.000Z",
      id: "ks_1",
      mode: "read_only",
      reason: "Synthetic production drill.",
      scope: { type: "capability", capabilityId: "support.refund.prepare_case" }
    });
    await controls.putBudgetPolicy({
      id: "budget_1",
      maxToolCallsPerRun: 4,
      scope: { type: "global" }
    });
    await controls.putCircuitBreakerPolicy({
      action: "open_deny",
      id: "breaker_1",
      metric: "provider_error_rate",
      scope: { type: "provider", providerId: "openai" },
      threshold: 0.5,
      windowSeconds: 60
    });
    await controls.putCircuitBreakerState({
      policyId: "breaker_1",
      status: "open"
    });
    await controls.recordCircuitBreakerEvent({
      metric: "provider_error_rate",
      occurredAt: "2026-06-04T12:00:00.000Z",
      scope: { type: "provider", providerId: "openai" },
      triggered: true
    });
    await budgetUsage.putUsage({
      createdAt: "2026-06-04T12:00:00.000Z",
      providerId: "openai",
      runId: "run_1",
      schemaVersion: "1.0",
      scope: { type: "provider", providerId: "openai" },
      usage: { providerCalls: 1, toolCalls: 2 },
      usageId: "usage_1"
    });
    await taskStore.putTask({
      createdAt: "2026-06-04T12:00:00.000Z",
      preparedActionId: "prepared_1",
      schemaVersion: "1.0",
      status: "started",
      taskId: "prepared_1",
      updatedAt: "2026-06-04T12:00:00.000Z"
    });
    await replayStore.putReplayTrace(replayTrace());

    const snapshot = await controls.snapshotControls();
    const usage = await budgetUsage.listUsage({ runId: "run_1" });
    const task = await taskStore.getTaskForPreparedAction("prepared_1");
    const replay = await replayStore.getReplayTrace("trace_1");
    const deleted = await controls.deleteKillSwitch("ks_1");

    expect(snapshot.killSwitches).toHaveLength(1);
    expect(snapshot.budgetPolicies).toHaveLength(1);
    expect(snapshot.circuitBreakerEvents).toHaveLength(1);
    expect(usage[0]).toMatchObject({ usageId: "usage_1", providerId: "openai" });
    expect(task).toMatchObject({ taskId: "prepared_1", status: "started" });
    expect(replay).toMatchObject({ traceId: "trace_1", runId: "run_1" });
    expect(deleted).toBe(true);
    expect(await controls.listKillSwitches()).toHaveLength(0);
    expect(client.commands.map((command) => command.name)).toContain("DeleteCommand");
  });

  it("composes a DynamoDB-backed control-plane store without raw details", async () => {
    const client = new FakeDynamoDbDocumentClient();
    const options = { documentClient: client, now: fixedNow, tableName };
    const decisions = new DynamoDbPolicyDecisionStore(options);
    const actions = new DynamoDbActionStore(options);
    const approvals = new DynamoDbApprovalLedgerStore(options);
    const replayStore = new DynamoDbReplayTraceMetadataStore(options);
    const store = new DynamoDbControlPlaneStore(options);

    await decisions.putDecision(policyDecisionRecord());
    await actions.putAction(actionRecord());
    await approvals.putApproval(approvalRecord());
    await store.putKillSwitch({
      createdAt: "2026-06-04T12:00:00.000Z",
      id: "ks_2",
      mode: "deny",
      reason: "Synthetic production drill.",
      scope: { type: "global" }
    });
    await replayStore.putReplayTrace({
      ...replayTrace(),
      extensions: {
        rawProviderPayload: "provider secret",
        summary: "safe"
      }
    });

    const updated = await store.updateApproval("approval_record_1", {
      decidedAt: "2026-06-04T12:03:00.000Z",
      status: "approved"
    });
    const snapshot = await store.snapshotState();

    expect(updated).toMatchObject({ status: "approved" });
    expect(snapshot.actions[0]).toMatchObject({ actionState: "approved", approvalRecordId: "approval_record_1" });
    expect(snapshot.controls.killSwitches).toHaveLength(1);
    expect(snapshot.decisions).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain("provider secret");
    expect(JSON.stringify(snapshot)).not.toContain("rawProviderPayload");
  });
});

describe("AWS approval and event adapters", () => {
  it("starts and resumes Step Functions approval workflows", async () => {
    const dynamoClient = new FakeDynamoDbDocumentClient();
    const taskStore = new DynamoDbStepFunctionsApprovalTaskStore({
      documentClient: dynamoClient,
      now: fixedNow,
      tableName
    });
    const client = new FakeStepFunctionsClient();
    const adapter = new StepFunctionsApprovalAdapter({
      heartbeatSeconds: 30,
      now: fixedNow,
      sfnClient: client,
      stateMachineArn: "arn:aws:states:us-east-1:123456789012:stateMachine:aicf-approval",
      taskStore,
      taskTokenTtlSeconds: 600
    });

    const started = await adapter.startApproval({
      approvalRequirement: {
        approvalType: "operator_review",
        reason: "Refund requires operator review."
      },
      callbackUrl: "https://example.com/aicf/approvals/prepared_1",
      preparedAction: preparedAction()
    });
    await adapter.heartbeatApprovalTask({ taskToken: "task-token-approved" });
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
    await adapter.expireApprovalTask({
      reason: "Synthetic expiry.",
      taskId: "prepared_1",
      taskToken: "task-token-expired"
    });
    await adapter.cancelApprovalTask({
      reason: "Synthetic cancellation.",
      taskId: "prepared_1",
      taskToken: "task-token-cancelled"
    });

    expect(started.executionArn).toContain("arn:aws:states");
    expect(client.commands.map((command) => command.name)).toEqual([
      "StartExecutionCommand",
      "SendTaskHeartbeatCommand",
      "SendTaskSuccessCommand",
      "SendTaskFailureCommand",
      "SendTaskFailureCommand",
      "SendTaskFailureCommand"
    ]);
    const startInput = JSON.parse(String(client.commands[0]?.input.input)) as Record<string, unknown>;
    expect(startInput).toMatchObject({
      schemaVersion: "0.1",
      heartbeatSeconds: 30,
      taskTokenTtlSeconds: 600,
      preparedAction: {
        accountId: "acct_example",
        preparedActionId: "prepared_1",
        tenantId: "tenant_example"
      }
    });
    expect(JSON.stringify(startInput)).not.toContain("argsRedacted");
    expect(client.commands[3]?.input).toMatchObject({
      error: "AICFApprovalRejected",
      taskToken: "task-token-rejected"
    });
    const task = await taskStore.getTask("prepared_1");
    expect(task).toMatchObject({
      preparedActionId: "prepared_1",
      status: "cancelled"
    });
    expect(JSON.stringify(task)).not.toContain("task-token");
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

  it("publishes sanitized telemetry to CloudWatch and creates KMS redaction refs", async () => {
    const cloudWatch = new FakeCloudWatchClient();
    const logs = new FakeCloudWatchLogsClient();
    const telemetry = new CloudWatchTelemetryPublisher({
      cloudWatchClient: cloudWatch,
      cloudWatchLogsClient: logs,
      logGroupName: "/aws/aicf/example",
      logStreamName: "synthetic",
      namespace: "AICF/Synthetic"
    });

    await telemetry.publish({
      attributes: {
        provider: "openai",
        rawProviderPayload: "secret payload"
      },
      requestId: "req_1",
      runId: "run_1",
      timestamp: "2026-06-04T12:00:00.000Z",
      type: "model.call.start"
    });

    expect(cloudWatch.commands[0]).toMatchObject({
      name: "PutMetricDataCommand",
      input: {
        Namespace: "AICF/Synthetic"
      }
    });
    expect(logs.commands[0]).toMatchObject({
      name: "PutLogEventsCommand",
      input: {
        logGroupName: "/aws/aicf/example",
        logStreamName: "synthetic"
      }
    });
    expect(JSON.stringify(logs.commands[0]?.input)).not.toContain("secret payload");

    const kms = new FakeKmsClient();
    const redaction = new KmsRedactionProvider({
      encryptionContext: {
        purpose: "aicf-redaction"
      },
      keyId: "alias/aicf-redaction",
      kmsClient: kms,
      now: fixedNow
    });
    const ref = await redaction.redact({
      tenantId: "tenant_example",
      token: "Bearer sk-secret"
    });

    expect(ref).toMatchObject({
      algorithm: "aws-kms-hmac-sha256",
      createdAt: "2026-06-04T12:00:00.000Z",
      keyId: "alias/aicf-redaction"
    });
    expect(ref.ref).not.toContain("tenant_example");
    expect(kms.commands[0]).toMatchObject({
      name: "GenerateMacCommand",
      input: {
        EncryptionContext: {
          purpose: "aicf-redaction"
        },
        KeyId: "alias/aicf-redaction",
        MacAlgorithm: "HMAC_SHA_256"
      }
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
      "DynamoDbPolicyDecisionStore",
      "DynamoDbActionStore",
      "DynamoDbApprovalLedgerStore",
      "DynamoDbIdempotencyLedgerStore",
      "DynamoDbControlsStore",
      "DynamoDbControlPlaneStore",
      "DynamoDbReplayTraceMetadataStore",
      "DynamoDbBudgetUsageStore",
      "DynamoDbStepFunctionsApprovalTaskStore",
      "StepFunctionsApprovalAdapter",
      "CloudWatchTelemetryPublisher",
      "KmsRedactionProvider",
      "EventBridgeRuntimeEventPublisher",
      "FakeDynamoDbDocumentClient",
      "FakeStepFunctionsClient",
      "FakeEventBridgeClient",
      "FakeCloudWatchClient",
      "FakeCloudWatchLogsClient",
      "FakeKmsClient"
    ]) {
      expect(aws[exportName], exportName).toEqual(expect.any(Function));
    }
  });

  it("keeps AWS SDK imports out of root, runtime, and OpenAI built subpaths", async () => {
    for (const file of [
      "dist/index.js",
      "dist/runtime/index.js",
      "dist/openai/index.js",
      "dist/providers/index.js",
      "dist/governance/index.js",
      "dist/controls/index.js",
      "dist/audit/index.js",
      "dist/control-plane/index.js"
    ]) {
      const content = await readFile(file, "utf8");
      expect(content).not.toContain("@aws-sdk/");
      expect(content).not.toContain("dist/aws/");
    }
  });
});

function policyDecisionRecord(): PolicyDecisionRecord {
  return {
    autonomyTier: "A2",
    capabilityId: "support.refund.prepare_case",
    capabilityVersion: "1.0.0",
    createdAt: "2026-06-04T12:00:00.000Z",
    decision: "approval_required",
    decisionId: "decision_1",
    inputHash: "hash_input",
    operation: "prepare",
    policySource: {
      source: "aicf",
      version: "1.0"
    },
    reasons: [{
      code: "approval_required",
      message: "Synthetic approval threshold requires review."
    }],
    redaction: {
      fieldsRedacted: ["tenantId", "subjectId"],
      hashAlgorithm: "sha256",
      mode: "redacted"
    },
    riskTier: "medium",
    runId: "run_1",
    schemaVersion: "1.0",
    subjectRef: {
      actorType: "user",
      refHash: "hash_subject"
    },
    tenantRef: {
      refHash: "hash_tenant"
    }
  };
}

function actionRecord(): ActionRecord {
  return {
    actionId: "action_1",
    actionState: "approval_required",
    auditRefs: ["audit_1"],
    capabilityId: "support.refund.prepare_case",
    capabilityVersion: "1.0.0",
    createdAt: "2026-06-04T12:00:00.000Z",
    inputHash: "hash_input",
    policyDecisionId: "decision_1",
    preparedActionId: "prepared_1",
    previewHash: "hash_preview",
    runId: "run_1",
    schemaVersion: "1.0",
    updatedAt: "2026-06-04T12:00:00.000Z"
  };
}

function approvalRecord(): ApprovalRecord {
  return {
    approvalRecordId: "approval_record_1",
    capabilityId: "support.refund.prepare_case",
    createdAt: "2026-06-04T12:00:00.000Z",
    preparedActionId: "prepared_1",
    requestedBy: {
      actorType: "user",
      refHash: "hash_subject"
    },
    requiredReasonCodes: ["approval_required"],
    schemaVersion: "1.0",
    status: "pending"
  };
}

function replayTrace() {
  return {
    actions: [{
      actionId: "action_1",
      actionState: "approval_required",
      capabilityId: "support.refund.prepare_case",
      preparedActionId: "prepared_1",
      resultHash: "hash_result"
    }],
    approvals: [{
      approvalRecordId: "approval_record_1",
      capabilityId: "support.refund.prepare_case",
      preparedActionId: "prepared_1",
      requiredReasonCodes: ["approval_required"],
      status: "pending"
    }],
    capabilitySlice: {
      capabilityIds: ["support.ticket.get", "support.refund.prepare_case"]
    },
    capabilityVersions: {
      "support.refund.prepare_case": "1.0.0"
    },
    context: {
      contextHash: "hash_context",
      decisionContext: {
        autonomyTier: "A2",
        permissions: ["support.ticket.read", "support.refund.prepare"]
      }
    },
    createdAt: "2026-06-04T12:00:00.000Z",
    policyDecisions: [{
      capabilityId: "support.refund.prepare_case",
      decision: "approval_required",
      decisionId: "decision_1",
      operation: "prepare",
      reasons: [{
        code: "approval_required",
        message: "Synthetic approval threshold requires review."
      }]
    }],
    redaction: {
      fieldsRedacted: ["tenantId", "subjectId"],
      hashAlgorithm: "sha256",
      mode: "redacted"
    },
    runId: "run_1",
    schemaVersion: "1.0" as const,
    toolCalls: [{
      args: {
        requested_amount: 25,
        ticket_id: "TCK-100"
      },
      argsHash: "hash_args",
      capabilityId: "support.refund.prepare_case",
      operation: "prepare"
    }],
    toolResults: [{
      actionState: "approval_required",
      capabilityId: "support.refund.prepare_case",
      resultHash: "hash_result",
      status: "approval_required"
    }],
    traceId: "trace_1"
  };
}

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
