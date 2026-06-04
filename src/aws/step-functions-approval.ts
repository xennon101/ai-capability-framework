import {
  asAwsClient,
  sanitizeAwsDetail
} from "./helpers.js";
import type {
  AwsClientLike,
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
    const output = await this.client.send(await stepFunctionsCommand("StartExecutionCommand", {
      input: JSON.stringify({
        approvalRequirement: sanitizeAwsDetail(input.approvalRequirement),
        callbackUrl: input.callbackUrl,
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
        startedAt: (this.options.now?.() ?? new Date()).toISOString()
      }),
      name: executionName(input.preparedAction.preparedActionId),
      stateMachineArn: this.options.stateMachineArn
    })) as { executionArn?: string };

    return {
      executionArn: output.executionArn ?? ""
    };
  }

  async sendApprovalResult(input: StepFunctionsSendApprovalResultInput): Promise<void> {
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
      return;
    }

    await this.client.send(await stepFunctionsCommand("SendTaskFailureCommand", {
      cause: input.decision.reason ?? "Approval was rejected.",
      error: "AICFApprovalRejected",
      taskToken: input.taskToken
    }));
  }
}

type StepFunctionsCommandName =
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
