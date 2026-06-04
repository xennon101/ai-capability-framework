import type {
  AicfAuditEvent,
  AicfAuditSink,
  AicfRuntimeContext,
  AicfToolResultOperation
} from "./types.js";

export class InMemoryAuditSink implements AicfAuditSink {
  readonly events: AicfAuditEvent[] = [];

  async write(event: AicfAuditEvent): Promise<void> {
    this.events.push(clone(event));
  }

  list(): AicfAuditEvent[] {
    return this.events.map(clone);
  }
}

export function buildAuditEvent(input: {
  actionState?: AicfAuditEvent["actionState"];
  capabilityId?: string;
  details?: Record<string, unknown>;
  message?: string;
  operation?: AicfToolResultOperation;
  preparedActionId?: string;
  runtimeContext: AicfRuntimeContext;
  status: AicfAuditEvent["status"];
  type: AicfAuditEvent["type"];
}): AicfAuditEvent {
  return {
    actionState: input.actionState,
    capabilityId: input.capabilityId,
    createdAt: new Date().toISOString(),
    details: input.details,
    eventId: `audit_${input.runtimeContext.runId}_${input.runtimeContext.requestId}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    message: input.message,
    operation: input.operation,
    preparedActionId: input.preparedActionId,
    requestId: input.runtimeContext.requestId,
    runId: input.runtimeContext.runId,
    status: input.status,
    type: input.type
  };
}

export async function writeAuditEvent(
  sink: AicfAuditSink | undefined,
  input: Parameters<typeof buildAuditEvent>[0]
): Promise<void> {
  if (!sink) {
    return;
  }

  await sink.write(buildAuditEvent(input));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

