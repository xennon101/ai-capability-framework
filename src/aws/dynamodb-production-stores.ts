import type {
  ActionFilter,
  ActionRecord,
  ActionStore,
  ApprovalFilter,
  ApprovalLedgerStore,
  ApprovalRecord,
  IdempotencyFilter,
  IdempotencyLedgerStore,
  IdempotencyMetadata,
  IdempotencyRecord,
  IdempotencyReservation,
  PolicyDecisionFilter,
  PolicyDecisionRecord,
  PolicyDecisionStore,
  ResultRef
} from "../audit/index.js";
import { createIdempotencyRecord, hashAuditValue } from "../audit/index.js";
import type { AicfControlPlaneStore, AicfControlPlaneStoreState } from "../control-plane/index.js";
import type {
  BudgetPolicy,
  BudgetUsage,
  CircuitBreakerEvent,
  CircuitBreakerPolicy,
  CircuitBreakerState,
  ControlsSnapshot,
  KillSwitch
} from "../controls/index.js";
import type { ReplayTrace } from "../replay/index.js";
import {
  asAwsClient,
  clone,
  isRecord,
  lookupKey,
  nowIso,
  partitionKey,
  ttlEpochSeconds
} from "./helpers.js";
import type {
  AwsBudgetUsageRecord,
  AwsClientLike,
  DynamoDbBudgetUsageStoreOptions,
  DynamoDbStoreOptions,
  StepFunctionsApprovalTaskRecord,
  StepFunctionsApprovalTaskStore
} from "./types.js";

const schemaVersion = "1.0";

interface StoredItem {
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  PK: string;
  SK: string;
  entityType: string;
  payload?: unknown;
  [key: string]: unknown;
}

export class DynamoDbPolicyDecisionStore implements PolicyDecisionStore {
  private client: AwsClientLike;
  private options: DynamoDbStoreOptions;

  constructor(options: DynamoDbStoreOptions) {
    this.options = options;
    this.client = asAwsClient(options.documentClient, "DynamoDB document client");
  }

  async getDecision(decisionId: string): Promise<PolicyDecisionRecord | null> {
    return payloadOrNull(await queryByLookup(this.client, this.options, "POLICY_DECISION", decisionId));
  }

  async listDecisions(filter: PolicyDecisionFilter = {}): Promise<PolicyDecisionRecord[]> {
    return (await queryByEntity(this.client, this.options, "policy_decision"))
      .map((item) => item.payload)
      .filter((payload): payload is PolicyDecisionRecord => isRecord(payload))
      .filter((record) => matchesPolicyDecision(record, filter))
      .map(clone);
  }

  async putDecision(record: PolicyDecisionRecord): Promise<void> {
    await putItem(this.client, this.options, policyDecisionItem(this.options, record), true);
  }
}

export class DynamoDbActionStore implements ActionStore {
  private client: AwsClientLike;
  private options: DynamoDbStoreOptions;

  constructor(options: DynamoDbStoreOptions) {
    this.options = options;
    this.client = asAwsClient(options.documentClient, "DynamoDB document client");
  }

  async getAction(actionId: string): Promise<ActionRecord | null> {
    return payloadOrNull(await queryByLookup(this.client, this.options, "ACTION_RECORD", actionId));
  }

  async listActions(filter: ActionFilter = {}): Promise<ActionRecord[]> {
    return (await queryByEntity(this.client, this.options, "action_record"))
      .map((item) => item.payload)
      .filter((payload): payload is ActionRecord => isRecord(payload))
      .filter((record) => matchesAction(record, filter))
      .map(clone);
  }

  async putAction(record: ActionRecord): Promise<void> {
    await putItem(this.client, this.options, actionItem(this.options, record), true);
  }

  async updateAction(actionId: string, patch: Partial<ActionRecord>): Promise<ActionRecord> {
    const existing = await this.getAction(actionId);
    if (!existing) {
      throw new Error("Action record was not found.");
    }
    const updated: ActionRecord = {
      ...existing,
      ...clone(patch),
      actionId,
      schemaVersion,
      updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : nowIso(this.options)
    };
    await putItem(this.client, this.options, actionItem(this.options, updated), false);
    return clone(updated);
  }
}

export class DynamoDbApprovalLedgerStore implements ApprovalLedgerStore {
  private client: AwsClientLike;
  private options: DynamoDbStoreOptions;

  constructor(options: DynamoDbStoreOptions) {
    this.options = options;
    this.client = asAwsClient(options.documentClient, "DynamoDB document client");
  }

  async getApproval(approvalRecordId: string): Promise<ApprovalRecord | null> {
    return payloadOrNull(await queryByLookup(this.client, this.options, "APPROVAL_RECORD", approvalRecordId));
  }

  async listApprovals(filter: ApprovalFilter = {}): Promise<ApprovalRecord[]> {
    return (await queryByEntity(this.client, this.options, "approval_record"))
      .map((item) => item.payload)
      .filter((payload): payload is ApprovalRecord => isRecord(payload))
      .filter((record) => matchesApproval(record, filter))
      .map(clone);
  }

  async putApproval(record: ApprovalRecord): Promise<void> {
    await putItem(this.client, this.options, approvalLedgerItem(this.options, record), true);
  }

  async updateApproval(approvalRecordId: string, patch: Partial<ApprovalRecord>): Promise<ApprovalRecord> {
    const existing = await this.getApproval(approvalRecordId);
    if (!existing) {
      throw new Error("Approval record was not found.");
    }
    const updated: ApprovalRecord = {
      ...existing,
      ...clone(patch),
      approvalRecordId,
      schemaVersion
    };
    await putItem(this.client, this.options, approvalLedgerItem(this.options, updated), false);
    return clone(updated);
  }
}

export class DynamoDbIdempotencyLedgerStore implements IdempotencyLedgerStore {
  private client: AwsClientLike;
  private options: DynamoDbStoreOptions;

  constructor(options: DynamoDbStoreOptions) {
    this.options = options;
    this.client = asAwsClient(options.documentClient, "DynamoDB document client");
  }

  async complete(key: string, scope: string, resultRef: ResultRef): Promise<void> {
    const existing = await this.get(key, scope);
    if (!existing) {
      throw new Error("Idempotency record was not found.");
    }
    const completed: IdempotencyRecord = {
      ...existing,
      completedAt: nowIso(this.options),
      resultRef: clone(resultRef),
      status: "completed"
    };
    await putItem(this.client, this.options, idempotencyLedgerItem(this.options, completed), false);
  }

  async get(key: string, scope: string): Promise<IdempotencyRecord | null> {
    return payloadOrNull(await queryByLookup(this.client, this.options, "IDEMPOTENCY_RECORD", scopedHash(hashAuditValue({ key }), hashAuditValue({ scope }))));
  }

  async listIdempotencyRecords(filter: IdempotencyFilter = {}): Promise<IdempotencyRecord[]> {
    return (await queryByEntity(this.client, this.options, "idempotency_record"))
      .map((item) => item.payload)
      .filter((payload): payload is IdempotencyRecord => isRecord(payload))
      .filter((record) => matchesIdempotency(record, filter))
      .map(clone);
  }

  async reserve(key: string, metadata: IdempotencyMetadata): Promise<IdempotencyReservation> {
    const existing = await this.get(key, metadata.scope);
    if (existing) {
      return {
        record: existing,
        reserved: false
      };
    }
    const record = createIdempotencyRecord({
      expiresAt: metadata.expiresAt,
      key,
      metadata: metadata.metadata,
      scope: metadata.scope,
      status: "reserved"
    });
    await putItem(this.client, this.options, idempotencyLedgerItem(this.options, record), true);
    return {
      record: clone(record),
      reserved: true
    };
  }
}

export class DynamoDbControlsStore {
  private client: AwsClientLike;
  private options: DynamoDbStoreOptions;

  constructor(options: DynamoDbStoreOptions) {
    this.options = options;
    this.client = asAwsClient(options.documentClient, "DynamoDB document client");
  }

  async deleteKillSwitch(id: string): Promise<boolean> {
    const existing = await queryByLookup(this.client, this.options, "KILL_SWITCH", id);
    if (!existing) {
      return false;
    }
    await this.client.send(await dynamoDbCommand("DeleteCommand", {
      Key: { PK: existing.PK, SK: existing.SK },
      TableName: this.options.tableName
    }));
    return true;
  }

  async listBudgetPolicies(): Promise<BudgetPolicy[]> {
    return listPayloads<BudgetPolicy>(await queryByEntity(this.client, this.options, "budget_policy"));
  }

  async listCircuitBreakerEvents(): Promise<CircuitBreakerEvent[]> {
    return listPayloads<CircuitBreakerEvent>(await queryByEntity(this.client, this.options, "circuit_breaker_event"));
  }

  async listCircuitBreakerPolicies(): Promise<CircuitBreakerPolicy[]> {
    return listPayloads<CircuitBreakerPolicy>(await queryByEntity(this.client, this.options, "circuit_breaker_policy"));
  }

  async listCircuitBreakerStates(): Promise<CircuitBreakerState[]> {
    return listPayloads<CircuitBreakerState>(await queryByEntity(this.client, this.options, "circuit_breaker_state"));
  }

  async listKillSwitches(): Promise<KillSwitch[]> {
    return listPayloads<KillSwitch>(await queryByEntity(this.client, this.options, "kill_switch"));
  }

  async putBudgetPolicy(policy: BudgetPolicy): Promise<void> {
    await putItem(this.client, this.options, controlItem(this.options, "budget_policy", policy.id, policy), false);
  }

  async putCircuitBreakerPolicy(policy: CircuitBreakerPolicy): Promise<void> {
    await putItem(this.client, this.options, controlItem(this.options, "circuit_breaker_policy", policy.id, policy), false);
  }

  async putCircuitBreakerState(state: CircuitBreakerState): Promise<void> {
    await putItem(this.client, this.options, controlItem(this.options, "circuit_breaker_state", state.policyId, state), false);
  }

  async putKillSwitch(killSwitch: KillSwitch): Promise<KillSwitch> {
    await putItem(this.client, this.options, controlItem(this.options, "kill_switch", killSwitch.id, killSwitch), false);
    return clone(killSwitch);
  }

  async recordCircuitBreakerEvent(event: CircuitBreakerEvent): Promise<void> {
    const eventId = hashAuditValue(event);
    await putItem(this.client, this.options, controlItem(this.options, "circuit_breaker_event", eventId, event), true);
  }

  async snapshotControls(): Promise<ControlsSnapshot> {
    const [
      budgetPolicies,
      circuitBreakerEvents,
      circuitBreakerPolicies,
      circuitBreakerStates,
      killSwitches
    ] = await Promise.all([
      this.listBudgetPolicies(),
      this.listCircuitBreakerEvents(),
      this.listCircuitBreakerPolicies(),
      this.listCircuitBreakerStates(),
      this.listKillSwitches()
    ]);
    return {
      budgetPolicies,
      circuitBreakerEvents,
      circuitBreakerPolicies,
      circuitBreakerStates,
      killSwitches
    };
  }
}

export class DynamoDbBudgetUsageStore {
  private client: AwsClientLike;
  private options: DynamoDbBudgetUsageStoreOptions;

  constructor(options: DynamoDbBudgetUsageStoreOptions) {
    this.options = options;
    this.client = asAwsClient(options.documentClient, "DynamoDB document client");
  }

  async listUsage(filter: { capabilityId?: string; runId?: string; tenantId?: string } = {}): Promise<AwsBudgetUsageRecord[]> {
    return listPayloads<AwsBudgetUsageRecord>(await queryByEntity(this.client, this.options, "budget_usage"))
      .filter((record) => (!filter.capabilityId || record.capabilityId === filter.capabilityId)
        && (!filter.runId || record.runId === filter.runId)
        && (!filter.tenantId || record.tenantId === filter.tenantId));
  }

  async putUsage(record: AwsBudgetUsageRecord): Promise<void> {
    await putItem(this.client, this.options, budgetUsageItem(this.options, record), false);
  }
}

export class DynamoDbStepFunctionsApprovalTaskStore implements StepFunctionsApprovalTaskStore {
  private client: AwsClientLike;
  private options: DynamoDbStoreOptions;

  constructor(options: DynamoDbStoreOptions) {
    this.options = options;
    this.client = asAwsClient(options.documentClient, "DynamoDB document client");
  }

  async getTask(taskId: string): Promise<StepFunctionsApprovalTaskRecord | null> {
    return payloadOrNull(await queryByLookup(this.client, this.options, "APPROVAL_TASK", taskId));
  }

  async getTaskForPreparedAction(preparedActionId: string): Promise<StepFunctionsApprovalTaskRecord | null> {
    const output = await this.client.send(await dynamoDbCommand("QueryCommand", {
      ExpressionAttributeValues: {
        ":pk": lookupKey(this.options, "PREPARED_APPROVAL_TASK", preparedActionId)
      },
      IndexName: this.options.gsi2Name ?? "GSI2",
      KeyConditionExpression: "GSI2PK = :pk",
      Limit: 1,
      TableName: this.options.tableName
    })) as { Items?: StoredItem[] };
    return payloadOrNull(output.Items?.[0]);
  }

  async putTask(record: StepFunctionsApprovalTaskRecord): Promise<void> {
    await putItem(this.client, this.options, approvalTaskItem(this.options, record), true);
  }

  async updateTask(taskId: string, patch: Partial<StepFunctionsApprovalTaskRecord>): Promise<StepFunctionsApprovalTaskRecord> {
    const existing = await this.getTask(taskId);
    if (!existing) {
      throw new Error("Step Functions approval task was not found.");
    }
    const updated: StepFunctionsApprovalTaskRecord = {
      ...existing,
      ...clone(patch),
      schemaVersion,
      taskId,
      updatedAt: patch.updatedAt ?? nowIso(this.options)
    };
    await putItem(this.client, this.options, approvalTaskItem(this.options, updated), false);
    return clone(updated);
  }
}

export class DynamoDbReplayTraceMetadataStore {
  private client: AwsClientLike;
  private options: DynamoDbStoreOptions;

  constructor(options: DynamoDbStoreOptions) {
    this.options = options;
    this.client = asAwsClient(options.documentClient, "DynamoDB document client");
  }

  async getReplayTrace(traceId: string): Promise<ReplayTrace | undefined> {
    return payloadOrUndefined(await queryByLookup(this.client, this.options, "REPLAY_TRACE", traceId));
  }

  async listReplayTraces(): Promise<ReplayTrace[]> {
    return listPayloads<ReplayTrace>(await queryByEntity(this.client, this.options, "replay_trace"));
  }

  async putReplayTrace(trace: ReplayTrace): Promise<void> {
    const sanitized = sanitizeStoredPayload(trace) as ReplayTrace;
    await putItem(this.client, this.options, replayTraceItem(this.options, sanitized), false);
  }
}

export interface DynamoDbControlPlaneStoreOptions extends DynamoDbStoreOptions {
  actionStore?: ActionStore;
  approvalStore?: ApprovalLedgerStore;
  controlsStore?: DynamoDbControlsStore;
  decisionStore?: PolicyDecisionStore;
  replayStore?: DynamoDbReplayTraceMetadataStore;
}

export class DynamoDbControlPlaneStore implements AicfControlPlaneStore {
  private actionStore: ActionStore;
  private approvalStore: ApprovalLedgerStore;
  private controlsStore: DynamoDbControlsStore;
  private decisionStore: PolicyDecisionStore;
  private replayStore: DynamoDbReplayTraceMetadataStore;

  constructor(options: DynamoDbControlPlaneStoreOptions) {
    this.actionStore = options.actionStore ?? new DynamoDbActionStore(options);
    this.approvalStore = options.approvalStore ?? new DynamoDbApprovalLedgerStore(options);
    this.controlsStore = options.controlsStore ?? new DynamoDbControlsStore(options);
    this.decisionStore = options.decisionStore ?? new DynamoDbPolicyDecisionStore(options);
    this.replayStore = options.replayStore ?? new DynamoDbReplayTraceMetadataStore(options);
  }

  async deleteKillSwitch(id: string): Promise<boolean> {
    return this.controlsStore.deleteKillSwitch(id);
  }

  async getReplayTrace(traceId: string): Promise<ReplayTrace | undefined> {
    return this.replayStore.getReplayTrace(traceId);
  }

  async listActions(): Promise<ActionRecord[]> {
    return this.actionStore.listActions();
  }

  async listApprovals(): Promise<ApprovalRecord[]> {
    return this.approvalStore.listApprovals();
  }

  async listDecisions(): Promise<PolicyDecisionRecord[]> {
    return this.decisionStore.listDecisions();
  }

  async listReplayTraces(): Promise<ReplayTrace[]> {
    return this.replayStore.listReplayTraces();
  }

  async putKillSwitch(killSwitch: KillSwitch): Promise<KillSwitch> {
    return this.controlsStore.putKillSwitch(killSwitch);
  }

  async snapshotControls(): Promise<ControlsSnapshot> {
    return this.controlsStore.snapshotControls();
  }

  async snapshotState(): Promise<AicfControlPlaneStoreState> {
    return {
      actions: await this.listActions(),
      approvals: await this.listApprovals(),
      controls: await this.snapshotControls(),
      decisions: await this.listDecisions(),
      replayTraces: await this.listReplayTraces(),
      schemaVersion
    };
  }

  async updateApproval(approvalRecordId: string, patch: Partial<ApprovalRecord>): Promise<ApprovalRecord | undefined> {
    const existing = await this.approvalStore.getApproval(approvalRecordId);
    if (!existing) {
      return undefined;
    }
    const updated = await this.approvalStore.updateApproval(approvalRecordId, patch);
    if (updated.preparedActionId && (updated.status === "approved" || updated.status === "rejected")) {
      const nextState = updated.status;
      const related = await this.actionStore.listActions({ preparedActionId: updated.preparedActionId });
      await Promise.all(related.map((action) => this.actionStore.updateAction(action.actionId, {
        actionState: nextState,
        approvalRecordId,
        updatedAt: updated.decidedAt ?? nowIso({ now: undefined })
      })));
    }
    return updated;
  }
}

function policyDecisionItem(options: DynamoDbStoreOptions, record: PolicyDecisionRecord): StoredItem {
  return recordItem(options, "policy_decision", record.decisionId, record.createdAt, record, {
    accountRefHash: record.accountRef?.refHash,
    capabilityId: record.capabilityId,
    decision: record.decision,
    operation: record.operation,
    runId: record.runId,
    tenantRefHash: record.tenantRef?.refHash
  });
}

function actionItem(options: DynamoDbStoreOptions, record: ActionRecord): StoredItem {
  return recordItem(options, "action_record", record.actionId, record.createdAt, record, {
    actionState: record.actionState,
    capabilityId: record.capabilityId,
    preparedActionId: record.preparedActionId,
    runId: record.runId
  });
}

function approvalLedgerItem(options: DynamoDbStoreOptions, record: ApprovalRecord): StoredItem {
  return recordItem(options, "approval_record", record.approvalRecordId, record.createdAt, record, {
    capabilityId: record.capabilityId,
    preparedActionId: record.preparedActionId,
    status: record.status
  });
}

function idempotencyLedgerItem(options: DynamoDbStoreOptions, record: IdempotencyRecord): StoredItem {
  return recordItem(options, "idempotency_record", scopedHash(record.keyHash, record.scopeHash), record.createdAt, record, {
    keyHash: record.keyHash,
    scopeHash: record.scopeHash,
    status: record.status
  });
}

function controlItem(options: DynamoDbStoreOptions, entityType: string, id: string, payload: unknown): StoredItem {
  return recordItem(options, entityType, id, nowIso(options), payload, {});
}

function budgetUsageItem(options: DynamoDbStoreOptions, record: AwsBudgetUsageRecord): StoredItem {
  return recordItem(options, "budget_usage", record.usageId, record.createdAt, record, {
    capabilityId: record.capabilityId,
    providerId: record.providerId,
    runId: record.runId,
    tenantId: record.tenantId
  }, record.expiresAt);
}

function approvalTaskItem(options: DynamoDbStoreOptions, record: StepFunctionsApprovalTaskRecord): StoredItem {
  return recordItem(options, "approval_task", record.taskId, record.createdAt, record, {
    approvalRecordId: record.approvalRecordId,
    executionArn: record.executionArn,
    preparedActionId: record.preparedActionId,
    status: record.status,
    taskTokenHash: record.taskTokenHash
  }, record.expiresAt, {
    GSI2PK: lookupKey(options, "PREPARED_APPROVAL_TASK", record.preparedActionId),
    GSI2SK: record.createdAt
  });
}

function replayTraceItem(options: DynamoDbStoreOptions, trace: ReplayTrace): StoredItem {
  return recordItem(options, "replay_trace", trace.traceId, trace.createdAt, trace, {
    provider: trace.provider,
    runId: trace.runId
  });
}

function recordItem(
  options: DynamoDbStoreOptions,
  entityType: string,
  id: string,
  createdAt: string,
  payload: unknown,
  attributes: Record<string, unknown>,
  expiresAt?: string,
  overrideKeys: Partial<StoredItem> = {}
): StoredItem {
  return stripUndefined({
    ...attributes,
    ...overrideKeys,
    createdAt,
    entityType,
    expiresAt,
    GSI1PK: lookupKey(options, entityType.toUpperCase(), id),
    GSI1SK: createdAt,
    GSI2PK: overrideKeys.GSI2PK ?? lookupKey(options, "ENTITY", entityType),
    GSI2SK: overrideKeys.GSI2SK ?? createdAt,
    payload: sanitizeStoredPayload(payload),
    PK: partitionKey(options),
    schemaVersion,
    SK: `${entityType.toUpperCase()}#${id}`,
    ttlEpochSeconds: ttlEpochSeconds(options, expiresAt)
  });
}

async function putItem(client: AwsClientLike, options: DynamoDbStoreOptions, item: StoredItem, failOnDuplicate: boolean): Promise<void> {
  await client.send(await dynamoDbCommand("PutCommand", stripUndefined({
    ConditionExpression: failOnDuplicate ? "attribute_not_exists(PK) AND attribute_not_exists(SK)" : undefined,
    Item: item,
    TableName: options.tableName
  })));
}

async function queryByLookup(client: AwsClientLike, options: DynamoDbStoreOptions, entity: string, id: string): Promise<StoredItem | undefined> {
  const output = await client.send(await dynamoDbCommand("QueryCommand", {
    ExpressionAttributeValues: {
      ":pk": lookupKey(options, entity, id)
    },
    IndexName: options.gsi1Name ?? "GSI1",
    KeyConditionExpression: "GSI1PK = :pk",
    Limit: 1,
    TableName: options.tableName
  })) as { Items?: StoredItem[] };
  return output.Items?.[0];
}

async function queryByEntity(client: AwsClientLike, options: DynamoDbStoreOptions, entityType: string): Promise<StoredItem[]> {
  const output = await client.send(await dynamoDbCommand("QueryCommand", {
    ExpressionAttributeValues: {
      ":pk": lookupKey(options, "ENTITY", entityType)
    },
    IndexName: options.gsi2Name ?? "GSI2",
    KeyConditionExpression: "GSI2PK = :pk",
    TableName: options.tableName
  })) as { Items?: StoredItem[] };
  return output.Items ?? [];
}

function listPayloads<T>(items: StoredItem[]): T[] {
  return items
    .map((item) => item.payload)
    .filter((payload): payload is T => isRecord(payload))
    .map(clone);
}

function payloadOrNull<T>(item: StoredItem | undefined): T | null {
  return item?.payload && isRecord(item.payload) ? clone(item.payload as T) : null;
}

function payloadOrUndefined<T>(item: StoredItem | undefined): T | undefined {
  return item?.payload && isRecord(item.payload) ? clone(item.payload as T) : undefined;
}

function scopedHash(key: string, scope: string): string {
  return `${hashAuditValue({ scope })}#${hashAuditValue({ key })}`;
}

function matchesPolicyDecision(record: PolicyDecisionRecord, filter: PolicyDecisionFilter): boolean {
  return (!filter.capabilityId || record.capabilityId === filter.capabilityId)
    && (!filter.decision || record.decision === filter.decision)
    && (!filter.runId || record.runId === filter.runId);
}

function matchesAction(record: ActionRecord, filter: ActionFilter): boolean {
  return (!filter.actionState || record.actionState === filter.actionState)
    && (!filter.capabilityId || record.capabilityId === filter.capabilityId)
    && (!filter.preparedActionId || record.preparedActionId === filter.preparedActionId)
    && (!filter.runId || record.runId === filter.runId);
}

function matchesApproval(record: ApprovalRecord, filter: ApprovalFilter): boolean {
  return (!filter.capabilityId || record.capabilityId === filter.capabilityId)
    && (!filter.preparedActionId || record.preparedActionId === filter.preparedActionId)
    && (!filter.status || record.status === filter.status);
}

function matchesIdempotency(record: IdempotencyRecord, filter: IdempotencyFilter): boolean {
  return (!filter.keyHash || record.keyHash === filter.keyHash)
    && (!filter.scopeHash || record.scopeHash === filter.scopeHash)
    && (!filter.status || record.status === filter.status);
}

type DynamoDbCommandName = "DeleteCommand" | "PutCommand" | "QueryCommand" | "UpdateCommand";

async function dynamoDbCommand(commandName: DynamoDbCommandName, input: Record<string, unknown>): Promise<unknown> {
  let module: Record<DynamoDbCommandName, new (input: Record<string, unknown>) => unknown>;
  try {
    module = await import("@aws-sdk/lib-dynamodb") as unknown as Record<DynamoDbCommandName, new (input: Record<string, unknown>) => unknown>;
  } catch {
    throw new Error(`Optional AWS SDK dependency "@aws-sdk/lib-dynamodb" is required to use ${commandName}.`);
  }
  const Command = module[commandName];
  if (typeof Command !== "function") {
    throw new Error(`Optional AWS SDK dependency "@aws-sdk/lib-dynamodb" did not export ${commandName}.`);
  }
  return new Command(input);
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) {
      output[key] = child;
    }
  }
  return output as T;
}

const unsafeStoredKeyPattern = /^(rawPrompt|rawProviderPayload|rawTranscript|rawTrace|rawToolOutput|privateDiagnostics|stack|secret|token|password|credential)$/i;

function sanitizeStoredPayload(value: unknown): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeStoredPayload).filter((item) => item !== undefined);
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (unsafeStoredKeyPattern.test(key)) {
        continue;
      }
      const sanitized = sanitizeStoredPayload(child);
      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    }
    return output;
  }
  return String(value);
}
