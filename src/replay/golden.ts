import type { EvalCandidateResult, EvalCase } from "../types.js";
import { hashReplayValue } from "./hash.js";
import { redactedPlaceholder } from "./redaction.js";
import type {
  CanonicalToolCallSnapshot,
  CreateEvalCandidateFromReplayTraceOptions,
  ReplayTrace,
  TraceToGoldenOptions
} from "./types.js";

export function createGoldenFromTrace(trace: ReplayTrace, options: TraceToGoldenOptions): EvalCase {
  const evalId = normalizeEvalId(options.evalId ?? `${options.suiteId}.${trace.traceId}`);
  const selectedIncludes = [...trace.capabilitySlice.capabilityIds];
  const selectedExcludes = [...(trace.capabilitySlice.excludedCapabilityIds ?? [])];
  const toolCalls = trace.toolCalls
    .filter((call) => call.operation !== "commit")
    .map((call) => ({
      args_match: sanitizeArgs(call.args),
      capability_id: call.capabilityId
    }));
  const forbiddenToolCalls = trace.toolCalls
    .filter((call) => call.operation === "commit")
    .map((call) => ({ capability_id: call.capabilityId }));
  const policyDecision = strongestPolicyDecision(trace);
  const actionState = evalActionState(trace);
  const committedCapabilities = trace.actions
    .filter((action) => action.actionState === "committed")
    .map((action) => action.capabilityId);
  const scorers = scorersForTrace(trace);

  return {
    capability_under_test: options.capabilityUnderTest ?? trace.toolCalls[0]?.capabilityId ?? selectedIncludes[0],
    context: {
      replay_trace_id: trace.traceId,
      replay_trace_hash: hashReplayValue(trace)
    },
    expected: {
      action_state: actionState,
      forbidden_tool_calls: forbiddenToolCalls.length > 0 ? forbiddenToolCalls : undefined,
      no_commit: committedCapabilities.length === 0,
      policy_decision: policyDecision,
      response: {
        must_not_include: [
          "private_diagnostics",
          "raw provider payload",
          "raw prompt",
          "secret",
          "token"
        ]
      },
      selected_capabilities: {
        excludes: selectedExcludes.length > 0 ? selectedExcludes : undefined,
        includes: selectedIncludes
      },
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    },
    extensions: {
      aicf_replay: {
        raw_content_included: options.includeRawContent === true,
        redaction_summary: trace.redaction,
        require_review: options.requireReview !== false,
        run_id: trace.runId,
        trace_id: trace.traceId,
        trace_hash: hashReplayValue(trace)
      }
    },
    id: evalId,
    input: {
      user_message: options.includeRawContent && trace.context.userInputSummary
        ? trace.context.userInputSummary
        : "Replay-derived request with redacted user text."
    },
    name: `Replay golden: ${trace.traceId}`,
    schema_version: "1.0",
    scorers,
    tags: [
      "replay",
      "trace_to_golden",
      ...(options.requireReview === false ? [] : ["review_required"]),
      ...(options.tags ?? [])
    ]
  };
}

export function createEvalCandidateFromReplayTrace(
  trace: ReplayTrace,
  options: CreateEvalCandidateFromReplayTraceOptions = {}
): EvalCandidateResult {
  return {
    action_state: evalActionState(trace),
    committed_capabilities: trace.actions
      .filter((action) => action.actionState === "committed")
      .map((action) => action.capabilityId),
    eval_id: options.evalId ?? normalizeEvalId(`replay.${trace.traceId}`),
    policy_decision: strongestPolicyDecision(trace),
    response: {
      text: trace.finalResponse?.text ?? "Replay final response was redacted."
    },
    selected_capabilities: [...trace.capabilitySlice.capabilityIds],
    tool_calls: trace.toolCalls
      .filter((call) => call.operation !== "commit")
      .map((call) => ({
        args: call.args,
        capability_id: call.capabilityId
      }))
  };
}

function scorersForTrace(trace: ReplayTrace): EvalCase["scorers"] {
  const scorers = [
    { type: "tool_selection_includes" },
    { type: "tool_input_json_subset" },
    { type: "no_unapproved_commit" },
    { type: "no_forbidden_tool_call" },
    { type: "response_excludes_private_detail" }
  ];

  if (trace.policyDecisions.length > 0) {
    scorers.push({ type: "policy_decision_matches" });
  }
  if (trace.actions.length > 0) {
    scorers.push({ type: "action_state_matches" });
  }

  return scorers as EvalCase["scorers"];
}

function strongestPolicyDecision(trace: ReplayTrace): "allowed" | "approval_required" | "denied" | undefined {
  const decisions = trace.policyDecisions.map((decision) => decision.decision);
  if (decisions.includes("denied")) return "denied";
  if (decisions.includes("approval_required")) return "approval_required";
  if (decisions.includes("allowed")) return "allowed";
  return undefined;
}

function evalActionState(trace: ReplayTrace): EvalCandidateResult["action_state"] {
  const states = trace.actions.map((action) => action.actionState);
  if (states.includes("committed")) return "committed";
  if (states.includes("approval_required")) return "approval_required";
  if (states.includes("prepared")) return "prepared";
  if (states.some((state) => state === "rejected" || state === "failed" || state === "expired" || state === "cancelled")) return "denied";
  return "none";
}

function sanitizeArgs(args: CanonicalToolCallSnapshot["args"]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, sanitizeArgValue(key, value)]));
}

function sanitizeArgValue(key: string, value: unknown): unknown {
  if (/password|token|secret|api_?key|authorization|cookie|session|card|cvv|private_?key/i.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeArgValue(key, entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeArgValue(childKey, childValue)]));
  }
  return redactedPlaceholder(value);
}

function normalizeEvalId(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/\.+/g, ".")
    .replace(/^_+|_+$/g, "")
    .replace(/^\.+|\.+$/g, "");
  const segments = normalized.split(".")
    .map((segment) => segment.replace(/^([^a-z])/, "a_$1"))
    .filter(Boolean);
  return segments.length > 0 ? segments.join(".") : "replay.generated";
}
