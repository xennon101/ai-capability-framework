import type {
  AicfPreparedActionSummary,
  AicfPolicyDecisionSummary,
  AicfToolResultEnvelope
} from "./types.js";

type ToolResultInput<TData = unknown> = Omit<
  AicfToolResultEnvelope<TData>,
  "schema_version" | "status"
>;

export function okToolResult<TData = unknown>(
  input: ToolResultInput<TData>
): AicfToolResultEnvelope<TData> {
  return buildToolResult("ok", input);
}

export function deniedToolResult<TData = unknown>(
  input: ToolResultInput<TData> & { policy: AicfPolicyDecisionSummary }
): AicfToolResultEnvelope<TData> {
  return buildToolResult("denied", input);
}

export function approvalRequiredToolResult<TData = unknown>(
  input: ToolResultInput<TData> & {
    action?: AicfPreparedActionSummary;
    policy: AicfPolicyDecisionSummary;
  }
): AicfToolResultEnvelope<TData> {
  return buildToolResult("approval_required", input);
}

export function unavailableToolResult<TData = unknown>(
  input: ToolResultInput<TData>
): AicfToolResultEnvelope<TData> {
  return buildToolResult("unavailable", input);
}

export function errorToolResult<TData = unknown>(
  input: ToolResultInput<TData>
): AicfToolResultEnvelope<TData> {
  return buildToolResult("error", input);
}

export function toModelFacingToolResult<TData = unknown>(
  envelope: AicfToolResultEnvelope<TData>
): Omit<AicfToolResultEnvelope<TData>, "private_diagnostics"> {
  const { private_diagnostics: _privateDiagnostics, ...publicEnvelope } = envelope;
  return publicEnvelope;
}

function buildToolResult<TData>(
  status: AicfToolResultEnvelope<TData>["status"],
  input: ToolResultInput<TData>
): AicfToolResultEnvelope<TData> {
  return {
    schema_version: "1.0",
    status,
    ...input
  };
}
