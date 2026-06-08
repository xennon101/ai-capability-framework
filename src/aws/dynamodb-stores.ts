import type {
  AicfActionState,
  AicfApprovalDecision,
  AicfApprovalStore,
  AicfAuditEvent,
  AicfAuditSink,
  AicfIdempotencyStore,
  AicfPreparedAction,
  AicfPreparedActionStore
} from "../runtime/index.js";
import {
  asAwsClient,
  clone,
  isRecord,
  lookupKey,
  metadataContext,
  nowIso,
  parseScopeContext,
  partitionKey,
  sanitizeAuditEvent,
  ttlEpochSeconds
} from "./helpers.js";
import type { AwsClientLike, DynamoDbStoreOptions } from "./types.js";

const schemaVersion = "0.1";

interface StoredItem {
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  PK: string;
  SK: string;
  payload?: unknown;
  result?: Record<string, unknown>;
  [key: string]: unknown;
}

export class DynamoDbPreparedActionStore implements AicfPreparedActionStore {
  private client: AwsClientLike;
  private options: DynamoDbStoreOptions;

  constructor(options: DynamoDbStoreOptions) {
    this.options = options;
    this.client = asAwsClient(options.documentClient, "DynamoDB document client");
  }

  async create(action: AicfPreparedAction): Promise<void> {
    const item = preparedActionItem(this.options, action);
    await this.client.send(await dynamoDbCommand("PutCommand", {
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      Item: item,
      TableName: this.options.tableName
    }));
  }

  async get(preparedActionId: string): Promise<AicfPreparedAction | undefined> {
    const item = await querySingle(this.client, this.options, lookupKey(this.options, "PREPARED", preparedActionId), this.options.gsi1Name ?? "GSI1");
    return item?.payload ? clone(item.payload as AicfPreparedAction) : undefined;
  }

  async updateState(input: {
    expectedState?: AicfActionState;
    nextState: AicfActionState;
    preparedActionId: string;
    updatedAt: string;
  }): Promise<void> {
    const item = await querySingle(this.client, this.options, lookupKey(this.options, "PREPARED", input.preparedActionId), this.options.gsi1Name ?? "GSI1");
    if (!item) {
      throw new Error("Prepared action was not found.");
    }

    const expressionAttributeValues: Record<string, unknown> = {
      ":nextState": input.nextState,
      ":updatedAt": input.updatedAt
    };

    if (input.expectedState) {
      expressionAttributeValues[":expectedState"] = input.expectedState;
    }

    const commandInput: Record<string, unknown> = {
      ExpressionAttributeNames: {
        "#payload": "payload",
        "#state": "state"
      },
      ExpressionAttributeValues: expressionAttributeValues,
      Key: {
        PK: item.PK,
        SK: item.SK
      },
      TableName: this.options.tableName,
      UpdateExpression: "SET #state = :nextState, updatedAt = :updatedAt, #payload.#state = :nextState, #payload.updatedAt = :updatedAt"
    };

    if (input.expectedState) {
      commandInput.ConditionExpression = "#state = :expectedState";
    }

    await this.client.send(await dynamoDbCommand("UpdateCommand", commandInput));
  }
}

export class DynamoDbApprovalStore implements AicfApprovalStore {
  private client: AwsClientLike;
  private options: DynamoDbStoreOptions;

  constructor(options: DynamoDbStoreOptions) {
    this.options = options;
    this.client = asAwsClient(options.documentClient, "DynamoDB document client");
  }

  async create(decision: AicfApprovalDecision): Promise<void> {
    const item = approvalItem(this.options, decision);
    await this.client.send(await dynamoDbCommand("PutCommand", {
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      Item: item,
      TableName: this.options.tableName
    }));
  }

  async get(approvalId: string): Promise<AicfApprovalDecision | undefined> {
    const item = await querySingle(this.client, this.options, lookupKey(this.options, "APPROVAL", approvalId), this.options.gsi1Name ?? "GSI1");
    return item?.payload ? clone(item.payload as AicfApprovalDecision) : undefined;
  }

  async getForPreparedAction(preparedActionId: string): Promise<AicfApprovalDecision[]> {
    const output = await this.client.send(await dynamoDbCommand("QueryCommand", {
      ExpressionAttributeValues: {
        ":pk": lookupKey(this.options, "PREPARED_APPROVALS", preparedActionId)
      },
      IndexName: this.options.gsi2Name ?? "GSI2",
      KeyConditionExpression: "GSI2PK = :pk",
      TableName: this.options.tableName
    })) as { Items?: StoredItem[] };

    return (output.Items ?? [])
      .map((item) => item.payload)
      .filter((payload): payload is AicfApprovalDecision => isRecord(payload))
      .map(clone);
  }
}

export class DynamoDbIdempotencyStore implements AicfIdempotencyStore {
  private client: AwsClientLike;
  private options: DynamoDbStoreOptions;

  constructor(options: DynamoDbStoreOptions) {
    this.options = options;
    this.client = asAwsClient(options.documentClient, "DynamoDB document client");
  }

  async reserve(input: {
    expiresAt: string;
    key: string;
    metadata?: Record<string, unknown>;
    scope: string;
  }): Promise<{ reserved: true } | { existing?: Record<string, unknown>; reserved: false }> {
    const lookup = lookupKey(this.options, "IDEMPOTENCY", `${input.scope}#${input.key}`);
    const existing = await querySingle(this.client, this.options, lookup, this.options.gsi1Name ?? "GSI1");
    if (existing) {
      return {
        existing: isRecord(existing.result) ? clone(existing.result) : undefined,
        reserved: false
      };
    }

    await this.client.send(await dynamoDbCommand("PutCommand", {
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      Item: idempotencyItem(this.options, input),
      TableName: this.options.tableName
    }));
    return { reserved: true };
  }

  async complete(input: {
    key: string;
    result: Record<string, unknown>;
    scope: string;
  }): Promise<void> {
    const lookup = lookupKey(this.options, "IDEMPOTENCY", `${input.scope}#${input.key}`);
    const item = await querySingle(this.client, this.options, lookup, this.options.gsi1Name ?? "GSI1");
    if (!item) {
      await this.client.send(await dynamoDbCommand("PutCommand", {
        Item: idempotencyItem(this.options, {
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          key: input.key,
          scope: input.scope
        }, input.result),
        TableName: this.options.tableName
      }));
      return;
    }

    await this.client.send(await dynamoDbCommand("UpdateCommand", {
      ExpressionAttributeNames: {
        "#result": "result"
      },
      ExpressionAttributeValues: {
        ":completedAt": nowIso(this.options),
        ":result": clone(input.result)
      },
      Key: {
        PK: item.PK,
        SK: item.SK
      },
      TableName: this.options.tableName,
      UpdateExpression: "SET #result = :result, completedAt = :completedAt"
    }));
  }
}

export class DynamoDbAuditSink implements AicfAuditSink {
  private client: AwsClientLike;
  private options: DynamoDbStoreOptions;

  constructor(options: DynamoDbStoreOptions) {
    this.options = options;
    this.client = asAwsClient(options.documentClient, "DynamoDB document client");
  }

  async write(event: AicfAuditEvent): Promise<void> {
    await this.client.send(await dynamoDbCommand("PutCommand", {
      Item: auditItem(this.options, event),
      TableName: this.options.tableName
    }));
  }
}

function preparedActionItem(options: DynamoDbStoreOptions, action: AicfPreparedAction): StoredItem {
  return stripUndefined({
    accountId: action.accountId,
    capabilityId: action.capabilityId,
    createdAt: action.createdAt,
    entityType: "prepared_action",
    expiresAt: action.expiresAt,
    GSI1PK: lookupKey(options, "PREPARED", action.preparedActionId),
    GSI1SK: action.createdAt,
    payload: clone(action),
    PK: partitionKey(options, action.tenantId, action.accountId),
    preparedActionId: action.preparedActionId,
    schemaVersion,
    SK: `PREPARED#${action.preparedActionId}`,
    state: action.state,
    subjectId: action.subjectId,
    tenantId: action.tenantId,
    ttlEpochSeconds: ttlEpochSeconds(options, action.expiresAt),
    updatedAt: action.updatedAt
  });
}

function approvalItem(options: DynamoDbStoreOptions, decision: AicfApprovalDecision): StoredItem {
  const context = metadataContext(decision.metadata);
  const decidedAt = decision.decidedAt ?? nowIso(options);
  return stripUndefined({
    accountId: context.accountId,
    approvalId: decision.approvalId,
    approved: decision.approved,
    decidedAt,
    entityType: "approval",
    expiresAt: decision.expiresAt,
    GSI1PK: lookupKey(options, "APPROVAL", decision.approvalId),
    GSI1SK: decidedAt,
    GSI2PK: decision.preparedActionId ? lookupKey(options, "PREPARED_APPROVALS", decision.preparedActionId) : undefined,
    GSI2SK: decidedAt,
    payload: clone(decision),
    PK: partitionKey(options, context.tenantId, context.accountId),
    preparedActionId: decision.preparedActionId,
    schemaVersion,
    SK: `APPROVAL#${decision.preparedActionId ?? "unknown"}#${decision.approvalId}`,
    tenantId: context.tenantId,
    ttlEpochSeconds: ttlEpochSeconds(options, decision.expiresAt)
  });
}

function idempotencyItem(
  options: DynamoDbStoreOptions,
  input: {
    expiresAt: string;
    key: string;
    metadata?: Record<string, unknown>;
    scope: string;
  },
  result?: Record<string, unknown>
): StoredItem {
  const metadata = metadataContext(input.metadata);
  const scope = parseScopeContext(input.scope);
  const tenantId = metadata.tenantId ?? scope.tenantId;
  const accountId = metadata.accountId ?? scope.accountId;
  const createdAt = nowIso(options);
  return stripUndefined({
    accountId,
    createdAt,
    entityType: "idempotency",
    expiresAt: input.expiresAt,
    GSI1PK: lookupKey(options, "IDEMPOTENCY", `${input.scope}#${input.key}`),
    GSI1SK: createdAt,
    idempotencyKey: input.key,
    metadata: input.metadata,
    PK: partitionKey(options, tenantId, accountId),
    result: result ? clone(result) : undefined,
    schemaVersion,
    scope: input.scope,
    SK: `IDEMPOTENCY#${input.scope}#${input.key}`,
    tenantId,
    ttlEpochSeconds: ttlEpochSeconds(options, input.expiresAt)
  });
}

function auditItem(options: DynamoDbStoreOptions, event: AicfAuditEvent): StoredItem {
  const tenantId = stringFromDetails(event.details, "tenantId") ?? options.defaultTenantId;
  const accountId = stringFromDetails(event.details, "accountId") ?? options.defaultAccountId;
  const sanitized = sanitizeAuditEvent(event);
  return stripUndefined({
    accountId,
    capabilityId: event.capabilityId,
    createdAt: event.createdAt,
    entityType: "audit_event",
    eventId: event.eventId,
    eventType: event.type,
    operation: event.operation,
    payload: sanitized,
    PK: partitionKey(options, tenantId, accountId),
    requestId: event.requestId,
    runId: event.runId,
    schemaVersion,
    SK: `AUDIT#${event.createdAt}#${event.eventId}`,
    status: event.status,
    tenantId,
    ttlEpochSeconds: ttlEpochSeconds(options)
  });
}

async function querySingle(
  client: AwsClientLike,
  options: DynamoDbStoreOptions,
  lookupPk: string,
  indexName: string
): Promise<StoredItem | undefined> {
  const output = await client.send(await dynamoDbCommand("QueryCommand", {
    ExpressionAttributeValues: {
      ":pk": lookupPk
    },
    IndexName: indexName,
    KeyConditionExpression: `${indexName === (options.gsi2Name ?? "GSI2") ? "GSI2PK" : "GSI1PK"} = :pk`,
    Limit: 1,
    TableName: options.tableName
  })) as { Items?: StoredItem[] };

  return output.Items?.[0];
}

type DynamoDbCommandName = "PutCommand" | "QueryCommand" | "UpdateCommand";

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

function stringFromDetails(details: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = details?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
