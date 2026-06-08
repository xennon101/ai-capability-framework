import type { AicfAuditEvent } from "../runtime/index.js";
import type { AicfRuntimeTraceEvent } from "../observability/index.js";
import {
  asAwsClient,
  sanitizeAuditEvent,
  sanitizeTraceForAws
} from "./helpers.js";
import type {
  AwsClientLike,
  CloudWatchTelemetryPublisherOptions
} from "./types.js";

export class CloudWatchTelemetryPublisher {
  private cloudWatchClient?: AwsClientLike;
  private cloudWatchLogsClient?: AwsClientLike;
  private options: CloudWatchTelemetryPublisherOptions;

  constructor(options: CloudWatchTelemetryPublisherOptions) {
    this.options = options;
    this.cloudWatchClient = options.cloudWatchClient
      ? asAwsClient(options.cloudWatchClient, "CloudWatch client")
      : undefined;
    this.cloudWatchLogsClient = options.cloudWatchLogsClient
      ? asAwsClient(options.cloudWatchLogsClient, "CloudWatch Logs client")
      : undefined;
  }

  async publish(event: AicfRuntimeTraceEvent | AicfAuditEvent): Promise<void> {
    const sanitized = sanitizeEvent(event);
    await Promise.all([
      this.publishMetric(sanitized),
      this.publishLog(sanitized)
    ]);
  }

  private async publishMetric(event: AicfRuntimeTraceEvent | AicfAuditEvent): Promise<void> {
    if (!this.cloudWatchClient) {
      return;
    }

    await this.cloudWatchClient.send(await cloudWatchCommand("PutMetricDataCommand", {
      MetricData: [{
        MetricName: metricName(event),
        Timestamp: new Date(timestampOf(event)),
        Unit: "Count",
        Value: 1
      }],
      Namespace: this.options.namespace ?? "AICF"
    }));
  }

  private async publishLog(event: AicfRuntimeTraceEvent | AicfAuditEvent): Promise<void> {
    if (!this.cloudWatchLogsClient || !this.options.logGroupName || !this.options.logStreamName) {
      return;
    }

    await this.cloudWatchLogsClient.send(await cloudWatchLogsCommand("PutLogEventsCommand", {
      logEvents: [{
        message: JSON.stringify(event),
        timestamp: Date.parse(timestampOf(event))
      }],
      logGroupName: this.options.logGroupName,
      logStreamName: this.options.logStreamName
    }));
  }
}

function sanitizeEvent(event: AicfRuntimeTraceEvent | AicfAuditEvent): AicfRuntimeTraceEvent | AicfAuditEvent {
  if ("eventId" in event) {
    return sanitizeAuditEvent(event);
  }
  return sanitizeTraceForAws(event);
}

function metricName(event: AicfRuntimeTraceEvent | AicfAuditEvent): string {
  const raw = "eventId" in event ? `audit_${event.type}` : `trace_${event.type}`;
  return raw.replace(/[^A-Za-z0-9_]+/g, "_").slice(0, 255);
}

function timestampOf(event: AicfRuntimeTraceEvent | AicfAuditEvent): string {
  return "eventId" in event ? event.createdAt : event.timestamp;
}

type CloudWatchCommandName = "PutMetricDataCommand";
type CloudWatchLogsCommandName = "PutLogEventsCommand";

async function cloudWatchCommand(commandName: CloudWatchCommandName, input: Record<string, unknown>): Promise<unknown> {
  let module: Record<CloudWatchCommandName, new (input: Record<string, unknown>) => unknown>;
  try {
    module = await import("@aws-sdk/client-cloudwatch") as unknown as Record<CloudWatchCommandName, new (input: Record<string, unknown>) => unknown>;
  } catch {
    throw new Error(`Optional AWS SDK dependency "@aws-sdk/client-cloudwatch" is required to use ${commandName}.`);
  }
  const Command = module[commandName];
  if (typeof Command !== "function") {
    throw new Error(`Optional AWS SDK dependency "@aws-sdk/client-cloudwatch" did not export ${commandName}.`);
  }
  return new Command(input);
}

async function cloudWatchLogsCommand(commandName: CloudWatchLogsCommandName, input: Record<string, unknown>): Promise<unknown> {
  let module: Record<CloudWatchLogsCommandName, new (input: Record<string, unknown>) => unknown>;
  try {
    module = await import("@aws-sdk/client-cloudwatch-logs") as unknown as Record<CloudWatchLogsCommandName, new (input: Record<string, unknown>) => unknown>;
  } catch {
    throw new Error(`Optional AWS SDK dependency "@aws-sdk/client-cloudwatch-logs" is required to use ${commandName}.`);
  }
  const Command = module[commandName];
  if (typeof Command !== "function") {
    throw new Error(`Optional AWS SDK dependency "@aws-sdk/client-cloudwatch-logs" did not export ${commandName}.`);
  }
  return new Command(input);
}
