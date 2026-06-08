import type {
  AicfApprovalDecision,
  AicfAuditEvent,
  AicfPreparedAction,
  AicfApprovalRequirement
} from "../runtime/index.js";
import type {
  BudgetUsage,
  AicfControlScope
} from "../controls/index.js";
import type { AicfRuntimeTraceEvent } from "../observability/index.js";

export interface AwsClientLike {
  send(command: unknown): Promise<unknown>;
}

export interface DynamoDbStoreOptions {
  defaultAccountId?: string;
  defaultTenantId?: string;
  documentClient: unknown;
  gsi1Name?: string;
  gsi2Name?: string;
  keyPrefix?: string;
  now?: () => Date;
  tableName: string;
  ttlSeconds?: number;
}

export interface StepFunctionsApprovalAdapterOptions {
  heartbeatSeconds?: number;
  now?: () => Date;
  sfnClient: unknown;
  stateMachineArn: string;
  taskStore?: StepFunctionsApprovalTaskStore;
  taskTokenTtlSeconds?: number;
}

export interface StepFunctionsStartApprovalInput {
  approvalRequirement: AicfApprovalRequirement;
  callbackUrl?: string;
  preparedAction: AicfPreparedAction;
}

export interface StepFunctionsSendApprovalResultInput {
  approvalRecordId?: string;
  decision: AicfApprovalDecision;
  executionArn?: string;
  taskToken: string;
}

export type StepFunctionsApprovalTaskStatus =
  | "started"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export interface StepFunctionsApprovalTaskRecord {
  approvalRecordId?: string;
  createdAt: string;
  executionArn?: string;
  expiresAt?: string;
  heartbeatSeconds?: number;
  payloadHash?: string;
  preparedActionId: string;
  schemaVersion: "1.0";
  status: StepFunctionsApprovalTaskStatus;
  taskId: string;
  taskTokenHash?: string;
  updatedAt: string;
}

export interface StepFunctionsApprovalTaskStore {
  getTask(taskId: string): Promise<StepFunctionsApprovalTaskRecord | null>;
  getTaskForPreparedAction(preparedActionId: string): Promise<StepFunctionsApprovalTaskRecord | null>;
  putTask(record: StepFunctionsApprovalTaskRecord): Promise<void>;
  updateTask(taskId: string, patch: Partial<StepFunctionsApprovalTaskRecord>): Promise<StepFunctionsApprovalTaskRecord>;
}

export interface EventBridgeRuntimeEventPublisherOptions {
  eventBridgeClient: unknown;
  eventBusName?: string;
  now?: () => Date;
  source?: string;
}

export interface CloudWatchTelemetryPublisherOptions {
  cloudWatchClient?: unknown;
  cloudWatchLogsClient?: unknown;
  logGroupName?: string;
  logStreamName?: string;
  namespace?: string;
  now?: () => Date;
}

export interface KmsRedactionProviderOptions {
  encryptionContext?: Record<string, string>;
  keyId: string;
  kmsClient: unknown;
  now?: () => Date;
}

export interface KmsRedactionRef {
  algorithm: "aws-kms-hmac-sha256";
  createdAt: string;
  keyId: string;
  ref: string;
}

export interface AwsBudgetUsageRecord {
  capabilityId?: string;
  createdAt: string;
  expiresAt?: string;
  model?: string;
  providerId?: string;
  runId?: string;
  schemaVersion: "1.0";
  scope: AicfControlScope;
  tenantId?: string;
  usage: BudgetUsage;
  usageId: string;
}

export interface DynamoDbBudgetUsageStoreOptions extends DynamoDbStoreOptions {}

export interface AicfRuntimeEventPublisher {
  publish(event: AicfRuntimeTraceEvent | AicfAuditEvent): Promise<void> | void;
}

export interface AicfAwsTestingCommandRecord {
  input: Record<string, unknown>;
  name: string;
}
