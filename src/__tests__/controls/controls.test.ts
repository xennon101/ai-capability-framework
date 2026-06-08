import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  buildOpenAIResponsesTools,
  loadManifests,
  validateManifests,
  type ManifestRegistry
} from "../../index.js";
import { runCli } from "../../cli.js";
import {
  DefaultControlsEvaluator,
  evaluateBudget,
  evaluateCircuitBreakers,
  evaluateKillSwitches,
  InMemoryControlsStore,
  type KillSwitch
} from "../../controls/index.js";
import {
  AicfActionLifecycleManager,
  AicfHandlerRegistry,
  AicfToolExecutor,
  buildRuntimeContext,
  DefaultCapabilityRouter,
  DefaultContextBuilder,
  DefaultPolicyBroker,
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemoryIdempotencyStore,
  InMemoryPreparedActionStore,
  StaticAuthPlatformAdapter,
  type AicfRuntimeContext
} from "../../runtime/index.js";
import { runOpenAIResponses } from "../../openai/index.js";

const now = "2026-06-04T00:00:00.000Z";

describe("runtime controls", () => {
  it("exports controls APIs from the built package subpath", async () => {
    const controls = await import("../../../dist/controls/index.js") as Record<string, unknown>;

    expect(controls.DefaultControlsEvaluator).toEqual(expect.any(Function));
    expect(controls.InMemoryControlsStore).toEqual(expect.any(Function));
    expect(controls.LocalJsonControlsStore).toEqual(expect.any(Function));
    expect(controls.evaluateRuntimeControls).toEqual(expect.any(Function));
  });

  it("matches control scopes and applies kill switch precedence", async () => {
    const registry = await loadExampleRegistry();
    const capability = registry.capabilityById.get("support.refund.prepare_case");
    expect(capability).toBeDefined();

    const providerDeny = evaluateKillSwitches({
      capability,
      operation: "export",
      providerId: "openai",
      riskTier: "medium",
      tenantId: "tenant_example"
    }, [{
      createdAt: now,
      id: "ks_provider",
      mode: "deny",
      reason: "Provider incident.",
      scope: { providerId: "openai", type: "provider" }
    }], now);

    const riskReadOnly = evaluateKillSwitches({
      capability,
      operation: "prepare",
      riskTier: "high"
    }, [{
      createdAt: now,
      id: "ks_high_risk_read_only",
      mode: "read_only",
      reason: "High-risk review.",
      scope: { riskTier: "medium", type: "risk_tier" }
    }], now);

    expect(providerDeny.reasons[0]?.code).toBe("control_denied");
    expect(riskReadOnly.reasons[0]?.code).toBe("control_denied");
  });

  it("opens circuit breakers from observed threshold state", () => {
    const decision = evaluateCircuitBreakers({
      operation: "provider_call",
      providerId: "openai"
    }, {
      events: [
        event(true),
        event(true),
        event(true),
        event(false)
      ],
      now,
      policies: [{
        action: "open_deny",
        id: "cb_provider_errors",
        metric: "provider_error_rate",
        scope: { providerId: "openai", type: "provider" },
        threshold: 0.75,
        windowSeconds: 60
      }]
    });

    expect(decision.matchedCircuitBreakers).toEqual(["cb_provider_errors"]);
    expect(decision.reasons[0]?.code).toBe("control_denied");
  });

  it("denies hard budget overruns and warns near limits", () => {
    const denied = evaluateBudget({
      operation: "provider_call",
      usage: {
        providerCalls: 9,
        runtimeMs: 10,
        toolCalls: 0
      }
    });
    const warning = evaluateBudget({
      operation: "provider_call",
      usage: {
        providerCalls: 7,
        runtimeMs: 10,
        toolCalls: 0
      }
    });

    expect(denied.status).toBe("denied");
    expect(denied.reasons.map((reason) => reason.code)).toContain("budget_exceeded");
    expect(warning.status).toBe("warn");
  });

  it("excludes denied capabilities from runtime routing and descriptor export", async () => {
    const registry = await loadExampleRegistry();
    const builtContext = await buildSupportContext(registry);
    const controls = new DefaultControlsEvaluator({
      killSwitches: [killSwitch("support.refund.prepare_case", "deny")]
    });
    const slice = new DefaultCapabilityRouter().route({
      builtContext,
      controls,
      registry,
      userInput: { text: "Prepare a refund." }
    });
    const toolset = buildOpenAIResponsesTools(registry, {
      context: {
        autonomyTier: "A2",
        permissions: ["ticket.read", "refund.case.create"],
        tenantId: "tenant_example_support",
        userId: "user_example_support_agent"
      },
      controls
    });

    expect(slice.items.map((item) => item.capabilityId)).not.toContain("support.refund.prepare_case");
    expect(toolset.bindings.map((binding) => binding.capabilityId)).not.toContain("support.refund.prepare_case");
    expect(toolset.excluded.find((excluded) => excluded.capabilityId === "support.refund.prepare_case")?.reason).toBe("control_denied");
  });

  it("returns model-safe denied envelopes from executor and lifecycle controls", async () => {
    const deniedRead = await createRuntimeHarness({
      controls: new DefaultControlsEvaluator({
        killSwitches: [killSwitch("support.ticket.get", "deny")]
      })
    });
    const read = await deniedRead.executor.execute({
      args: { ticket_id: "TCK-100" },
      builtContext: deniedRead.builtContext,
      capabilityId: "support.ticket.get",
      operation: "read",
      runtimeContext: deniedRead.runtimeContext,
      source: "model_tool_call"
    });

    const readOnlyCommit = await createRuntimeHarness({
      controls: new DefaultControlsEvaluator({
        killSwitches: [{
          createdAt: now,
          id: "ks_high_read_only",
          mode: "read_only",
          reason: "High-risk actions are read-only.",
          scope: { riskTier: "high", type: "risk_tier" }
        }]
      })
    });
    const prepared = await readOnlyCommit.lifecycle.prepare({
      args: refundPrepareArgs(),
      builtContext: readOnlyCommit.builtContext,
      capabilityId: "support.refund.prepare_case",
      runtimeContext: readOnlyCommit.runtimeContext
    });
    const approval = await readOnlyCommit.lifecycle.recordApproval({
      approved: true,
      preparedActionId: prepared.action?.preparedActionId ?? "",
      runtimeContext: readOnlyCommit.commitRuntimeContext
    });
    const commit = await readOnlyCommit.lifecycle.commit({
      approval,
      builtContext: readOnlyCommit.builtContext,
      idempotencyKey: "idem_controls_1",
      preparedActionId: prepared.action?.preparedActionId ?? "",
      runtimeContext: readOnlyCommit.commitRuntimeContext
    });

    expect(read.status).toBe("denied");
    expect(read.policy?.reasons[0]?.message).not.toContain("secret");
    expect(commit.status).toBe("denied");
  });

  it("blocks OpenAI provider calls before the client is invoked", async () => {
    const registry = await loadExampleRegistry();
    const harness = await createRuntimeHarness({
      controls: new DefaultControlsEvaluator({
        killSwitches: [{
          createdAt: now,
          id: "ks_openai",
          mode: "deny",
          reason: "OpenAI incident.",
          scope: { providerId: "openai", type: "provider" }
        }]
      })
    });
    let providerCalls = 0;
    const result = await runOpenAIResponses({
      client: {
        responses: {
          async create() {
            providerCalls += 1;
            return { output_text: "should not run" };
          }
        }
      },
      contextBuilder: new DefaultContextBuilder(),
      controls: harness.controls,
      executor: harness.executor,
      model: "gpt-example",
      registry,
      router: new DefaultCapabilityRouter(),
      runtimeContext: harness.runtimeContext,
      userInput: { text: "Read ticket TCK-100." }
    });

    expect(providerCalls).toBe(0);
    expect(result.status).toBe("control_denied");
  });

  it("runs controls CLI commands with a local ignored store", async () => {
    const tempDirectory = await mkdtemp(path.join(tmpdir(), "aicf-controls-"));
    const storePath = path.join(tempDirectory, "controls.json");
    const create = await runWithBuffers([
      "controls",
      "kill-switch",
      "create",
      "--mode",
      "deny",
      "--reason",
      "Local test",
      "--capability",
      "support.ticket.get",
      "--store",
      storePath
    ]);
    const list = await runWithBuffers(["controls", "list", "--store", storePath, "--format", "json"]);
    const check = await runWithBuffers([
      "controls",
      "check",
      "examples",
      "--capability",
      "support.ticket.get",
      "--store",
      storePath,
      "--format",
      "json"
    ]);

    expect(create.exitCode).toBe(0);
    expect(JSON.parse(list.stdout).killSwitches).toHaveLength(1);
    expect(check.exitCode).toBe(1);
    expect(JSON.parse(check.stdout).status).toBe("denied");
  });
});

async function loadExampleRegistry(): Promise<ManifestRegistry> {
  const loaded = await loadManifests({ path: "examples" });
  const validation = validateManifests(loaded.manifests);
  expect(loaded.errors).toEqual([]);
  expect(validation.errors).toEqual([]);
  return buildRegistry(loaded.manifests);
}

async function buildSupportContext(registry: ManifestRegistry) {
  const runtimeContext = await buildSupportRuntimeContext();
  return new DefaultContextBuilder().build({
    baseContext: runtimeContext,
    registry,
    userInput: { text: "Prepare a refund for support ticket TCK-100." }
  });
}

async function buildSupportRuntimeContext(options: {
  allowMoneyMovement?: boolean;
  autonomyTier?: AicfRuntimeContext["autonomy"]["autonomyTier"];
  facts?: Record<string, unknown>;
  maxRiskTier?: AicfRuntimeContext["autonomy"]["maxRiskTier"];
  permissions?: string[];
} = {}): Promise<AicfRuntimeContext> {
  return buildRuntimeContext({
    adapter: new StaticAuthPlatformAdapter({
      account: {
        accountId: "acct_example_support",
        tenantId: "tenant_example_support"
      },
      subject: {
        permissions: options.permissions ?? ["ticket.read", "refund.case.create"],
        roles: ["support_agent"],
        userId: "user_example_support_agent"
      }
    }),
    autonomy: {
      allowExternalMessages: false,
      allowMoneyMovement: options.allowMoneyMovement ?? false,
      allowPermissionChanges: false,
      allowSideEffects: true,
      autonomyTier: options.autonomyTier ?? "A2",
      maxRiskTier: options.maxRiskTier ?? "medium"
    },
    environment: "test",
    facts: options.facts ?? {
      "refund.order_not_refundable": false
    },
    workflow: {
      currentEntityId: "TCK-100",
      currentEntityType: "ticket",
      workflowType: "support"
    }
  });
}

async function createRuntimeHarness(options: {
  controls?: DefaultControlsEvaluator;
} = {}) {
  const registry = await loadExampleRegistry();
  const runtimeContext = await buildSupportRuntimeContext();
  const commitRuntimeContext = await buildSupportRuntimeContext({
    allowMoneyMovement: true,
    autonomyTier: "A0",
    facts: {
      "refund.approval_missing_or_invalid": false
    },
    maxRiskTier: "high",
    permissions: ["refund.case.commit"]
  });
  const builtContext = await buildSupportContext(registry);
  const handlers = new AicfHandlerRegistry({ registry });
  const preparedActionStore = new InMemoryPreparedActionStore();
  const approvalStore = new InMemoryApprovalStore();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const auditSink = new InMemoryAuditSink();
  const policyBroker = new DefaultPolicyBroker();
  const controls = options.controls;

  handlers.register({
    capabilityId: "support.ticket.get",
    read: () => ({
      ticket: {
        order_id: "ORD-100",
        status: "open",
        ticket_id: "TCK-100"
      }
    })
  });
  handlers.register({
    capabilityId: "support.refund.prepare_case",
    prepare: ({ args }) => ({
      data: {
        order_id: args.order_id,
        requested_amount: args.requested_amount ?? null,
        ticket_id: args.ticket_id
      },
      summary: "Refund case prepared."
    })
  });
  handlers.register({
    capabilityId: "support.refund.commit_case",
    commit: () => ({
      committedActionId: "commit_controls_1",
      data: {
        audit_event_id: "AUD-CONTROLS-1",
        refund_id: "RF-CONTROLS-1",
        status: "committed"
      },
      status: "committed"
    })
  });

  const lifecycle = new AicfActionLifecycleManager({
    approvalStore,
    auditSink,
    controls,
    handlers,
    idempotencyStore,
    policyBroker,
    preparedActionStore,
    registry
  });
  const executor = new AicfToolExecutor({
    actionLifecycle: lifecycle,
    auditSink,
    controls,
    handlers,
    policyBroker,
    registry
  });

  return {
    builtContext,
    commitRuntimeContext,
    controls,
    executor,
    lifecycle,
    registry,
    runtimeContext
  };
}

function killSwitch(capabilityId: string, mode: KillSwitch["mode"]): KillSwitch {
  return {
    createdAt: now,
    id: `ks_${capabilityId.replaceAll(".", "_")}_${mode}`,
    mode,
    reason: "Synthetic control test.",
    scope: { capabilityId, type: "capability" }
  };
}

function event(triggered: boolean) {
  return {
    metric: "provider_error_rate" as const,
    occurredAt: now,
    scope: { providerId: "openai", type: "provider" as const },
    triggered
  };
}

function refundPrepareArgs(): Record<string, unknown> {
  return {
    order_id: "ORD-100",
    reason_code: "customer_request",
    requested_amount: 25,
    ticket_id: "TCK-100"
  };
}

async function runWithBuffers(argv: string[]): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(argv, {
    stderr: { write: (message) => { stderr += message; } },
    stdout: { write: (message) => { stdout += message; } }
  });
  return { exitCode, stderr, stdout };
}
