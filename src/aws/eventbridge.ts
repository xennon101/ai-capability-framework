import type { AicfAuditEvent } from "../runtime/index.js";
import type { AicfRuntimeTraceEvent } from "../observability/index.js";
import {
  asAwsClient,
  sanitizeAuditEvent,
  sanitizeTraceForAws
} from "./helpers.js";
import type {
  AicfRuntimeEventPublisher,
  AwsClientLike,
  EventBridgeRuntimeEventPublisherOptions
} from "./types.js";

export class EventBridgeRuntimeEventPublisher implements AicfRuntimeEventPublisher {
  private client: AwsClientLike;
  private options: EventBridgeRuntimeEventPublisherOptions;

  constructor(options: EventBridgeRuntimeEventPublisherOptions) {
    this.options = options;
    this.client = asAwsClient(options.eventBridgeClient, "EventBridge client");
  }

  async publish(event: AicfRuntimeTraceEvent | AicfAuditEvent): Promise<void> {
    const isTrace = isTraceEvent(event);
    const detail = isTrace ? sanitizeTraceForAws(event) : sanitizeAuditEvent(event);
    const timestamp = isTrace ? event.timestamp : event.createdAt;
    await this.client.send(await eventBridgeCommand("PutEventsCommand", {
      Entries: [{
        Detail: JSON.stringify({
          event: detail,
          schemaVersion: "0.1"
        }),
        DetailType: isTrace ? `AICF Trace ${event.type}` : `AICF Audit ${event.type}`,
        EventBusName: this.options.eventBusName,
        Source: this.options.source ?? "ai-capability-framework",
        Time: new Date(timestamp)
      }]
    }));
  }
}

type EventBridgeCommandName = "PutEventsCommand";

async function eventBridgeCommand(commandName: EventBridgeCommandName, input: Record<string, unknown>): Promise<unknown> {
  let module: Record<EventBridgeCommandName, new (input: Record<string, unknown>) => unknown>;
  try {
    module = await import("@aws-sdk/client-eventbridge") as unknown as Record<EventBridgeCommandName, new (input: Record<string, unknown>) => unknown>;
  } catch {
    throw new Error(`Optional AWS SDK dependency "@aws-sdk/client-eventbridge" is required to use ${commandName}.`);
  }
  const Command = module[commandName];
  if (typeof Command !== "function") {
    throw new Error(`Optional AWS SDK dependency "@aws-sdk/client-eventbridge" did not export ${commandName}.`);
  }
  return new Command(input);
}

function isTraceEvent(event: AicfRuntimeTraceEvent | AicfAuditEvent): event is AicfRuntimeTraceEvent {
  return "timestamp" in event && "attributes" in event;
}

export type { AicfRuntimeEventPublisher };
