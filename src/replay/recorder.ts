import { hashReplayValue } from "./hash.js";
import { redactReplayTrace } from "./redaction.js";
import type {
  ReplayTrace,
  ReplayTraceRecorder,
  ReplayTraceRecorderInput
} from "./types.js";

export class DefaultReplayRecorder implements ReplayTraceRecorder {
  record(input: ReplayTraceRecorderInput): ReplayTrace {
    const trace: ReplayTrace = {
      actions: input.actions ?? [],
      approvals: input.approvals,
      capabilitySlice: {
        ...input.capabilitySlice,
        hash: input.capabilitySlice.hash ?? hashReplayValue(input.capabilitySlice.capabilityIds)
      },
      capabilityVersions: { ...input.capabilityVersions },
      context: input.context,
      createdAt: input.createdAt ?? new Date(0).toISOString(),
      finalResponse: input.finalResponse,
      policyDecisions: input.policyDecisions ?? [],
      provider: input.provider,
      redaction: input.redaction ?? {
        fieldsRedacted: [],
        hashAlgorithm: "sha256",
        mode: "redacted"
      },
      runId: input.runId,
      runtimeVersion: input.runtimeVersion,
      schemaVersion: "1.0",
      toolCalls: input.toolCalls ?? [],
      toolResults: input.toolResults ?? [],
      traceId: input.traceId ?? `trace_${hashReplayValue({ runId: input.runId, createdAt: input.createdAt }).slice(0, 16)}`
    };

    return redactReplayTrace(trace);
  }
}
