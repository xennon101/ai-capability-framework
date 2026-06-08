import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  loadManifests
} from "../../index.js";
import { runCli } from "../../cli.js";
import {
  createEvalCandidateFromReplayTrace,
  createGoldenFromTrace,
  hashReplayValue,
  runReplay,
  validateReplayTrace,
  type ReplayTrace
} from "../../replay/index.js";

const tracePath = "examples/support/replay/support.refund.approval_required.trace.json";

describe("runtime replay", () => {
  it("exports replay APIs from the built package subpath", async () => {
    const replay = await import("../../../dist/replay/index.js") as Record<string, unknown>;

    expect(replay.runReplay).toEqual(expect.any(Function));
    expect(replay.createGoldenFromTrace).toEqual(expect.any(Function));
    expect(replay.DefaultReplayRecorder).toEqual(expect.any(Function));
    expect(replay.validateReplayTrace).toEqual(expect.any(Function));
  });

  it("validates public-safe replay traces and rejects raw payload-looking fields", async () => {
    const trace = await loadReplayTrace();
    expect(validateReplayTrace(trace).valid).toBe(true);

    const unsafe = clone(trace);
    unsafe.extensions = {
      rawProviderPayload: {
        id: "provider_payload_example"
      }
    };

    const validation = validateReplayTrace(unsafe);
    expect(validation.valid).toBe(false);
    expect(validation.diagnostics.some((diagnostic) => diagnostic.code === "invalid_replay_trace")).toBe(true);
  });

  it("runs deterministic mock replay from the support fixture", async () => {
    const result = await runReplay(await loadReplayTrace(), {
      mode: "deterministic_mock"
    });

    expect(result.status).toBe("passed");
    expect(result.summary.failed).toBe(0);
    expect(result.steps.map((step) => step.name)).toContain("tool_call_snapshot");
  });

  it("creates a review-required golden eval and redacts sensitive args", async () => {
    const trace = await loadReplayTrace();
    trace.toolCalls[0]!.args.session_token = "sk-example-secret";

    const evalCase = createGoldenFromTrace(trace, {
      suiteId: "support-refunds"
    });
    const expectedArgs = evalCase.expected.tool_calls?.[0]?.args_match as Record<string, unknown>;

    expect(evalCase.id).toBe("support_refunds.support_refund_approval_required_trace");
    expect(evalCase.tags).toContain("review_required");
    expect(evalCase.input.user_message).toBe("Replay-derived request with redacted user text.");
    expect(expectedArgs.session_token).toBe("[REDACTED]");
    expect(evalCase.extensions).toEqual(expect.objectContaining({
      aicf_replay: expect.objectContaining({
        raw_content_included: false,
        require_review: true
      })
    }));
  });

  it("creates an eval candidate result from a replay trace", async () => {
    const candidate = createEvalCandidateFromReplayTrace(await loadReplayTrace(), {
      evalId: "support.replay.generated"
    });

    expect(candidate.eval_id).toBe("support.replay.generated");
    expect(candidate.selected_capabilities).toContain("support.refund.prepare_case");
    expect(candidate.policy_decision).toBe("approval_required");
    expect(candidate.action_state).toBe("approval_required");
  });

  it("policy-only replay detects changed approval outcomes", async () => {
    const trace = await loadReplayTrace();
    trace.policyDecisions = trace.policyDecisions.map((decision) => decision.capabilityId === "support.refund.prepare_case"
      ? { ...decision, decision: "allowed" }
      : decision);

    const result = await runReplay(trace, {
      mode: "policy_only",
      registry: await loadExampleRegistry()
    });

    expect(result.status).toBe("failed");
    expect(result.steps.some((step) => step.status === "failed" && step.name.includes("support.refund.prepare_case"))).toBe(true);
  });

  it("router-only replay detects selected slice drift", async () => {
    const trace = await loadReplayTrace();
    trace.capabilitySlice.capabilityIds = ["support.ticket.get"];

    const result = await runReplay(trace, {
      mode: "router_only",
      registry: await loadExampleRegistry()
    });

    expect(result.status).toBe("failed");
    expect(result.steps[0]?.name).toBe("router:capability_slice");
  });

  it("tool-validation replay catches invalid args and unknown capabilities", async () => {
    const trace = await loadReplayTrace();
    trace.toolCalls[0]!.args.ticket_id = "INVALID";
    trace.toolCalls.push({
      args: {},
      argsHash: hashReplayValue({}),
      capabilityId: "support.unknown",
      operation: "read"
    });

    const result = await runReplay(trace, {
      mode: "tool_validation_only",
      registry: await loadExampleRegistry()
    });

    expect(result.status).toBe("failed");
    expect(result.steps.filter((step) => step.status === "failed").length).toBeGreaterThanOrEqual(2);
  });

  it("provider-live replay refuses without explicit opt-in and runner", async () => {
    const result = await runReplay(await loadReplayTrace(), {
      mode: "provider_live"
    });

    expect(result.status).toBe("refused");
    expect(result.diagnostics[0]?.code).toBe("replay_provider_live_disabled");
  });

  it("supports replay and trace-to-golden CLI commands", async () => {
    const textReplay = await runCliCapture([
      "replay",
      "run",
      tracePath,
      "--mode",
      "deterministic_mock"
    ]);
    expect(textReplay.exitCode).toBe(0);
    expect(textReplay.stdout).toContain("Replay deterministic_mock passed");

    const jsonReplay = await runCliCapture([
      "replay",
      "run",
      tracePath,
      "--mode",
      "policy_only",
      "--manifest-root",
      "examples",
      "--format",
      "json"
    ]);
    expect(jsonReplay.exitCode).toBe(0);
    expect(JSON.parse(jsonReplay.stdout)).toEqual(expect.objectContaining({
      mode: "policy_only",
      status: "passed"
    }));

    const tempDirectory = await mkdtemp(path.join(tmpdir(), "aicf-replay-test-"));
    const outPath = path.join(tempDirectory, "support.refund.from_trace.yaml");
    const createResult = await runCliCapture([
      "evals",
      "create-from-trace",
      tracePath,
      "--suite",
      "support-refunds",
      "--out",
      outPath
    ]);
    expect(createResult.exitCode).toBe(0);
    expect(createResult.stdout).toContain("support_refunds.support_refund_approval_required_trace");
    expect(await readFile(outPath, "utf8")).toContain("review_required");
  });
});

async function loadReplayTrace(): Promise<ReplayTrace> {
  return JSON.parse(await readFile(tracePath, "utf8")) as ReplayTrace;
}

async function loadExampleRegistry() {
  const loadResult = await loadManifests({ path: "examples" });
  return buildRegistry(loadResult.manifests);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function runCliCapture(argv: string[]): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  const stdout = { value: "", write(message: string) { this.value += message; } };
  const stderr = { value: "", write(message: string) { this.value += message; } };
  const exitCode = await runCli(argv, { stderr, stdout });
  return {
    exitCode,
    stderr: stderr.value,
    stdout: stdout.value
  };
}
