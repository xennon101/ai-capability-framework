import type {
  AicfApprovalDecision,
  AicfAuditEvent,
  AicfPreparedAction,
  AicfApprovalRequirement
} from "../runtime/index.js";
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
  now?: () => Date;
  sfnClient: unknown;
  stateMachineArn: string;
}

export interface StepFunctionsStartApprovalInput {
  approvalRequirement: AicfApprovalRequirement;
  callbackUrl?: string;
  preparedAction: AicfPreparedAction;
}

export interface StepFunctionsSendApprovalResultInput {
  decision: AicfApprovalDecision;
  taskToken: string;
}

export interface EventBridgeRuntimeEventPublisherOptions {
  eventBridgeClient: unknown;
  eventBusName?: string;
  now?: () => Date;
  source?: string;
}

export interface AicfRuntimeEventPublisher {
  publish(event: AicfRuntimeTraceEvent | AicfAuditEvent): Promise<void> | void;
}

export interface AicfAwsTestingCommandRecord {
  input: Record<string, unknown>;
  name: string;
}

