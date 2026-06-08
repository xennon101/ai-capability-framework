import Ajv2020 from "ajv/dist/2020.js";
import { selectCapabilitySlice } from "../capability-slice.js";
import { decideCapability } from "../decision.js";
import type {
  AicfDiagnostic,
  DecisionOperation,
  DecisionRequest,
  DecisionStatus,
  JsonObject,
  ManifestRegistry
} from "../types.js";
import { validateReplayTrace } from "./validation.js";
import type {
  CanonicalToolCallSnapshot,
  ReplayMode,
  ReplayResult,
  ReplayStepResult,
  ReplayTrace,
  RunReplayOptions
} from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });

export async function runReplay(trace: ReplayTrace, options: RunReplayOptions): Promise<ReplayResult> {
  const validation = validateReplayTrace(trace);
  if (!validation.valid) {
    return result(trace.traceId ?? "unknown", options.mode, validation.diagnostics, [{
      message: "Replay trace failed schema or public-safety validation.",
      name: "validate_trace",
      status: "failed"
    }]);
  }

  if (options.mode === "provider_live") {
    return runProviderLiveReplay(trace, options);
  }

  if (options.mode === "deterministic_mock") {
    return result(trace.traceId, options.mode, [], deterministicMockSteps(trace));
  }

  if (options.mode === "policy_only") {
    return result(trace.traceId, options.mode, [], policyOnlySteps(trace, options));
  }

  if (options.mode === "router_only") {
    return result(trace.traceId, options.mode, [], routerOnlySteps(trace, options));
  }

  return result(trace.traceId, options.mode, [], toolValidationSteps(trace, options));
}

function deterministicMockSteps(trace: ReplayTrace): ReplayStepResult[] {
  return [
    {
      actual: trace.capabilitySlice.capabilityIds,
      expected: trace.capabilitySlice.capabilityIds,
      message: "Recorded capability slice is replayable without provider calls.",
      name: "capability_slice_snapshot",
      status: "passed"
    },
    {
      actual: trace.toolCalls.map((call) => call.capabilityId),
      expected: trace.toolCalls.map((call) => call.capabilityId),
      message: "Recorded tool-call sequence is stable.",
      name: "tool_call_snapshot",
      status: "passed"
    },
    {
      actual: trace.toolResults.map((toolResult) => toolResult.status),
      expected: trace.toolResults.map((toolResult) => toolResult.status),
      message: "Recorded tool-result statuses are stable.",
      name: "tool_result_snapshot",
      status: "passed"
    },
    {
      actual: trace.policyDecisions.map((decision) => decision.decision),
      expected: trace.policyDecisions.map((decision) => decision.decision),
      message: "Recorded policy decisions are available for deterministic comparison.",
      name: "policy_decision_snapshot",
      status: "passed"
    },
    {
      actual: trace.actions.map((action) => action.actionState),
      expected: trace.actions.map((action) => action.actionState),
      message: "Recorded action states are available for deterministic comparison.",
      name: "action_state_snapshot",
      status: "passed"
    }
  ];
}

function policyOnlySteps(trace: ReplayTrace, options: RunReplayOptions): ReplayStepResult[] {
  const registryStep = requireRegistry(options.registry, "policy_only");
  if (registryStep) {
    return [registryStep];
  }

  const context = options.context ?? trace.context.decisionContext;
  const facts = options.facts ?? trace.context.facts;
  const steps: ReplayStepResult[] = [];

  for (const recorded of trace.policyDecisions) {
    if (recorded.operation === "read") {
      steps.push({
        message: "Read ledger records do not map to a Core decision operation and were skipped.",
        name: `policy:${recorded.capabilityId}:read`,
        status: "skipped"
      });
      continue;
    }

    if (recorded.operation === "approve") {
      steps.push({
        message: "Approval ledger records are not policy decisions and were skipped.",
        name: `policy:${recorded.capabilityId}:approve`,
        status: "skipped"
      });
      continue;
    }

    const request = decisionRequestForPolicy(recorded, trace.toolCalls, context, facts);
    if (!request) {
      steps.push({
        expected: recorded.decision,
        message: `Could not build a policy replay request for ${recorded.capabilityId}.`,
        name: `policy:${recorded.capabilityId}:${recorded.operation}`,
        status: "failed"
      });
      continue;
    }

    const current = decideCapability(options.registry!, request);
    steps.push(compareStep({
      actual: current.status,
      expected: recorded.decision,
      messagePrefix: `Policy decision for ${recorded.capabilityId} ${recorded.operation}`,
      name: `policy:${recorded.capabilityId}:${recorded.operation}`
    }));
  }

  return steps.length > 0 ? steps : [{
    message: "Replay trace did not include policy decisions.",
    name: "policy_decisions",
    status: "skipped"
  }];
}

function routerOnlySteps(trace: ReplayTrace, options: RunReplayOptions): ReplayStepResult[] {
  const registryStep = requireRegistry(options.registry, "router_only");
  if (registryStep) {
    return [registryStep];
  }

  const slice = selectCapabilitySlice({
    context: options.context ?? trace.context.decisionContext,
    includeRestricted: trace.capabilitySlice.includeRestricted,
    maxCapabilities: trace.capabilitySlice.maxCapabilities,
    registry: options.registry!
  });
  const actual = slice.capabilities.map((capability) => capability.manifest.id).sort();
  const expected = [...trace.capabilitySlice.capabilityIds].sort();

  return [compareArrayStep({
    actual,
    expected,
    messagePrefix: "Routed capability slice",
    name: "router:capability_slice"
  })];
}

function toolValidationSteps(trace: ReplayTrace, options: RunReplayOptions): ReplayStepResult[] {
  const registryStep = requireRegistry(options.registry, "tool_validation_only");
  if (registryStep) {
    return [registryStep];
  }

  const steps: ReplayStepResult[] = [];
  for (const call of trace.toolCalls) {
    const loadedCapability = options.registry!.capabilityById.get(call.capabilityId);
    if (!loadedCapability) {
      steps.push({
        actual: call.capabilityId,
        message: `Tool call references unknown capability "${call.capabilityId}".`,
        name: `tool_validation:${call.capabilityId}`,
        status: "failed"
      });
      continue;
    }

    if (call.operation === "commit") {
      steps.push({
        actual: call.operation,
        expected: "read or prepare",
        message: "Replay tool validation rejects model-facing commit tool calls.",
        name: `tool_validation:${call.capabilityId}`,
        status: "failed"
      });
      continue;
    }

    const validate = ajv.compile(loadedCapability.manifest.input_schema);
    const valid = validate(call.args);
    steps.push({
      actual: valid ? call.args : validate.errors,
      expected: loadedCapability.manifest.input_schema,
      message: valid
        ? `Tool call args for ${call.capabilityId} satisfy the current input schema.`
        : `Tool call args for ${call.capabilityId} no longer satisfy the current input schema.`,
      name: `tool_validation:${call.capabilityId}`,
      status: valid ? "passed" : "failed"
    });
  }

  return steps.length > 0 ? steps : [{
    message: "Replay trace did not include tool calls.",
    name: "tool_validation",
    status: "skipped"
  }];
}

async function runProviderLiveReplay(trace: ReplayTrace, options: RunReplayOptions): Promise<ReplayResult> {
  const enabled = options.allowProviderLive || process.env.AICF_ENABLE_LIVE_REPLAY === "1";
  if (!enabled || !options.providerRunner) {
    return result(trace.traceId, "provider_live", [{
      code: "replay_provider_live_disabled",
      message: "provider_live replay requires AICF_ENABLE_LIVE_REPLAY=1 or allowProviderLive plus a caller-provided providerRunner.",
      path: "mode"
    }], [{
      message: "Live provider replay was refused by default.",
      name: "provider_live_guard",
      status: "failed"
    }], "refused");
  }

  return options.providerRunner(trace, options);
}

function requireRegistry(registry: ManifestRegistry | undefined, mode: ReplayMode): ReplayStepResult | null {
  if (registry) {
    return null;
  }

  return {
    message: `${mode} replay requires a validated manifest registry.`,
    name: "registry_required",
    status: "failed"
  };
}

function decisionRequestForPolicy(
  recorded: ReplayTrace["policyDecisions"][number],
  calls: CanonicalToolCallSnapshot[],
  context: DecisionRequest["context"],
  facts: DecisionRequest["facts"] | undefined
): DecisionRequest | null {
  const operation = decisionOperation(recorded.operation);
  if (!operation) {
    return null;
  }

  const call = calls.find((candidate) => (
    candidate.capabilityId === recorded.capabilityId
    && decisionOperation(candidate.operation) === operation
  ));

  return {
    args: call?.args,
    capabilityId: recorded.capabilityId,
    context,
    facts,
    operation
  };
}

function decisionOperation(operation: string): DecisionOperation | null {
  if (operation === "select" || operation === "prepare" || operation === "commit") {
    return operation;
  }
  if (operation === "read") {
    return "select";
  }
  return null;
}

function compareStep(input: {
  actual: DecisionStatus;
  expected: DecisionStatus;
  messagePrefix: string;
  name: string;
}): ReplayStepResult {
  const passed = input.actual === input.expected;
  return {
    actual: input.actual,
    expected: input.expected,
    message: passed
      ? `${input.messagePrefix} matched recorded status ${input.expected}.`
      : `${input.messagePrefix} changed from ${input.expected} to ${input.actual}.`,
    name: input.name,
    status: passed ? "passed" : "failed"
  };
}

function compareArrayStep(input: {
  actual: string[];
  expected: string[];
  messagePrefix: string;
  name: string;
}): ReplayStepResult {
  const passed = input.actual.length === input.expected.length
    && input.actual.every((value, index) => value === input.expected[index]);
  return {
    actual: input.actual,
    expected: input.expected,
    message: passed
      ? `${input.messagePrefix} matched recorded capability IDs.`
      : `${input.messagePrefix} changed.`,
    name: input.name,
    status: passed ? "passed" : "failed"
  };
}

function result(
  traceId: string,
  mode: ReplayMode,
  diagnostics: AicfDiagnostic[],
  steps: ReplayStepResult[],
  forcedStatus?: ReplayResult["status"]
): ReplayResult {
  const passed = steps.filter((step) => step.status === "passed").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const skipped = steps.filter((step) => step.status === "skipped").length;

  return {
    diagnostics,
    mode,
    schemaVersion: "1.0",
    status: forcedStatus ?? (diagnostics.length === 0 && failed === 0 ? "passed" : "failed"),
    steps,
    summary: {
      failed,
      passed,
      skipped,
      total: steps.length
    },
    traceId
  };
}
