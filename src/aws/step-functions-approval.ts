import {
  asAwsClient,
  sanitizeAwsDetail
} from "./helpers.js";
import { hashAuditValue } from "../audit/index.js";
import type {
  AwsClientLike,
  StepFunctionsApprovalTaskRecord,
  StepFunctionsApprovalAdapterOptions,
  StepFunctionsSendApprovalResultInput,
  StepFunctionsStartApprovalInput
} from "./types.js";

export class StepFunctionsApprovalAdapter {
  private client: AwsClientLike;
  private options: StepFunctionsApprovalAdapterOptions;

  constructor(options: StepFunctionsApprovalAdapterOptions) {
    this.options = options;
    this.client = asAwsClient(options.sfnClient, "Step Functions client");
  }

  async startApproval(input: StepFunctionsStartApprovalInput): Promise<{ executionArn: string }> {
    const payload = createStepFunctionsApprovalPayload(input, this.options);
    const output = await this.client.send(await stepFunctionsCommand("StartExecutionCommand", {
      input: JSON.stringify(payload),
      name: executionName(input.preparedAction.preparedActionId),
      stateMachineArn: this.options.stateMachineArn
    })) as { executionArn?: string };

    const result = {
      executionArn: output.executionArn ?? ""
    };

    await this.options.taskStore?.putTask(createStepFunctionsApprovalTaskRecord({
      executionArn: result.executionArn,
      input,
      options: this.options
    }));

    return result;
  }

  async sendApprovalResult(input: StepFunctionsSendApprovalResultInput): Promise<void> {
    const taskId = input.approvalRecordId ?? input.decision.preparedActionId ?? input.decision.approvalId;
    if (input.decision.approved) {
      await this.client.send(await stepFunctionsCommand("SendTaskSuccessCommand", {
        output: JSON.stringify({
          approval: {
            approvalId: input.decision.approvalId,
            approved: input.decision.approved,
            decidedAt: input.decision.decidedAt,
            preparedActionId: input.decision.preparedActionId
          },
          schemaVersion: "0.1"
        }),
        taskToken: input.taskToken
      }));
      await this.options.taskStore?.updateTask(taskId, {
        status: "approved",
        taskTokenHash: hashAuditValue({ taskToken: input.taskToken }),
        updatedAt: (this.options.now?.() ?? new Date()).toISOString()
      });
      return;
    }

    await this.client.send(await stepFunctionsCommand("SendTaskFailureCommand", {
      cause: input.decision.reason ?? "Approval was rejected.",
      error: "AICFApprovalRejected",
      taskToken: input.taskToken
    }));
    await this.options.taskStore?.updateTask(taskId, {
      status: "rejected",
      taskTokenHash: hashAuditValue({ taskToken: input.taskToken }),
      updatedAt: (this.options.now?.() ?? new Date()).toISOString()
    });
  }

  async expireApprovalTask(input: { taskId: string; taskToken: string; reason?: string }): Promise<void> {
    await this.failTask(input, "AICFApprovalExpired", input.reason ?? "Approval task expired.", "expired");
  }

  async cancelApprovalTask(input: { taskId: string; taskToken: string; reason?: string }): Promise<void> {
    await this.failTask(input, "AICFApprovalCancelled", input.reason ?? "Approval task was cancelled.", "cancelled");
  }

  async heartbeatApprovalTask(input: { taskToken: string }): Promise<void> {
    await this.client.send(await stepFunctionsCommand("SendTaskHeartbeatCommand", {
      taskToken: input.taskToken
    }));
  }

  private async failTask(
    input: { taskId: string; taskToken: string; reason?: string },
    error: string,
    cause: string,
    status: "expired" | "cancelled"
  ): Promise<void> {
    await this.client.send(await stepFunctionsCommand("SendTaskFailureCommand", {
      cause,
      error,
      taskToken: input.taskToken
    }));
    await this.options.taskStore?.updateTask(input.taskId, {
      status,
      taskTokenHash: hashAuditValue({ taskToken: input.taskToken }),
      updatedAt: (this.options.now?.() ?? new Date()).toISOString()
    });
  }
}

export function createStepFunctionsApprovalPayload(
  input: StepFunctionsStartApprovalInput,
  options: Pick<StepFunctionsApprovalAdapterOptions, "heartbeatSeconds" | "now" | "taskTokenTtlSeconds">
): Record<string, unknown> {
  const startedAt = (options.now?.() ?? new Date()).toISOString();
  return {
    approvalRequirement: sanitizeAwsDetail(input.approvalRequirement),
    callbackUrl: input.callbackUrl,
    heartbeatSeconds: options.heartbeatSeconds,
    preparedAction: {
      accountId: input.preparedAction.accountId,
      capabilityId: input.preparedAction.capabilityId,
      capabilityVersion: input.preparedAction.capabilityVersion,
      expiresAt: input.preparedAction.expiresAt,
      preparedActionId: input.preparedAction.preparedActionId,
      preview: {
        riskTier: input.preparedAction.preview.riskTier,
        summary: input.preparedAction.preview.summary
      },
      requestId: input.preparedAction.requestId,
      runId: input.preparedAction.runId,
      state: input.preparedAction.state,
      subjectId: input.preparedAction.subjectId,
      tenantId: input.preparedAction.tenantId
    },
    schemaVersion: "0.1",
    startedAt,
    taskTokenTtlSeconds: options.taskTokenTtlSeconds
  };
}

export function createStepFunctionsApprovalTaskRecord(input: {
  executionArn?: string;
  input: StepFunctionsStartApprovalInput;
  options: Pick<StepFunctionsApprovalAdapterOptions, "heartbeatSeconds" | "now" | "taskTokenTtlSeconds">;
}): StepFunctionsApprovalTaskRecord {
  const createdAt = (input.options.now?.() ?? new Date()).toISOString();
  const expiresAt = input.options.taskTokenTtlSeconds && input.options.taskTokenTtlSeconds > 0
    ? new Date(Date.parse(createdAt) + input.options.taskTokenTtlSeconds * 1000).toISOString()
    : input.input.preparedAction.expiresAt;
  const payload = createStepFunctionsApprovalPayload(input.input, input.options);
  return {
    createdAt,
    executionArn: input.executionArn,
    expiresAt,
    heartbeatSeconds: input.options.heartbeatSeconds,
    payloadHash: hashAuditValue(payload),
    preparedActionId: input.input.preparedAction.preparedActionId,
    schemaVersion: "1.0",
    status: "started",
    taskId: input.input.preparedAction.preparedActionId,
    updatedAt: createdAt
  };
}

type StepFunctionsCommandName =
  | "SendTaskHeartbeatCommand"
  | "SendTaskFailureCommand"
  | "SendTaskSuccessCommand"
  | "StartExecutionCommand";

async function stepFunctionsCommand(commandName: StepFunctionsCommandName, input: Record<string, unknown>): Promise<unknown> {
  let module: Record<StepFunctionsCommandName, new (input: Record<string, unknown>) => unknown>;
  try {
    module = await import("@aws-sdk/client-sfn") as unknown as Record<StepFunctionsCommandName, new (input: Record<string, unknown>) => unknown>;
  } catch {
    throw new Error(`Optional AWS SDK dependency "@aws-sdk/client-sfn" is required to use ${commandName}.`);
  }
  const Command = module[commandName];
  if (typeof Command !== "function") {
    throw new Error(`Optional AWS SDK dependency "@aws-sdk/client-sfn" did not export ${commandName}.`);
  }
  return new Command(input);
}

function executionName(preparedActionId: string): string {
  const safe = preparedActionId.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `aicf-${safe}`.slice(0, 80);
}
