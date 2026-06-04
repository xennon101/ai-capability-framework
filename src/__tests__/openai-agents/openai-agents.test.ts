import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  loadManifests,
  validateManifests,
  type ManifestRegistry
} from "../../index.js";
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
  type AicfBuiltContext,
  type AicfRuntimeContext
} from "../../runtime/index.js";
import {
  buildAgentsSdkTools,
  createDefaultAgentsSdkBridgeFactory
} from "../../openai/index.js";

describe("OpenAI Agents SDK bridge", () => {
  it("builds executor-backed function-tool-like objects without commit tools", async () => {
    const harness = await createAgentsHarness();
    const tools = await buildAgentsSdkTools({
      builtContext: harness.builtContext,
      executor: harness.executor,
      registry: harness.registry,
      router: new DefaultCapabilityRouter(),
      runtimeContext: harness.runtimeContext,
      userInput: {
        text: "Prepare a refund for ticket TCK-100."
      }
    }) as Array<{
      description: string;
      execute(input: unknown): Promise<string>;
      name: string;
      parameters: Record<string, unknown>;
      strict: true;
      type: "function";
    }>;

    expect(tools.map((tool) => tool.name)).toEqual([
      "aicf_support_ticket_get",
      "aicf_support_refund_prepare_case"
    ]);
    expect(tools.map((tool) => tool.name)).not.toContain("aicf_support_refund_commit_case");
    expect(tools[0]).toMatchObject({
      description: expect.any(String),
      parameters: expect.any(Object),
      strict: true,
      type: "function"
    });
  });

  it("delegates read and prepare invocations to AICF runtime executor", async () => {
    const harness = await createAgentsHarness();
    const tools = await buildAgentsSdkTools({
      builtContext: harness.builtContext,
      executor: harness.executor,
      registry: harness.registry,
      router: new DefaultCapabilityRouter(),
      runtimeContext: harness.runtimeContext,
      userInput: {
        text: "Prepare a refund for ticket TCK-100."
      }
    }) as Array<{ execute(input: unknown): Promise<string>; name: string }>;
    const readTool = mustTool(tools, "aicf_support_ticket_get");
    const prepareTool = mustTool(tools, "aicf_support_refund_prepare_case");

    const read = JSON.parse(await readTool.execute({ ticket_id: "TCK-100" })) as Record<string, unknown>;
    const prepare = JSON.parse(await prepareTool.execute(refundPrepareArgs())) as Record<string, unknown>;

    expect(read).toMatchObject({
      capabilityId: "support.ticket.get",
      status: "success"
    });
    expect(prepare).toMatchObject({
      action: {
        preparedActionId: expect.any(String)
      },
      capabilityId: "support.refund.prepare_case",
      status: "prepared"
    });
  });

  it("returns approval-required prepared action references as safe envelopes", async () => {
    const harness = await createAgentsHarness();
    const tools = await buildAgentsSdkTools({
      builtContext: harness.builtContext,
      executor: harness.executor,
      registry: harness.registry,
      router: new DefaultCapabilityRouter(),
      runtimeContext: harness.runtimeContext,
      userInput: {
        text: "Prepare a high amount refund."
      }
    }) as Array<{ execute(input: unknown): Promise<string>; name: string }>;
    const prepareTool = mustTool(tools, "aicf_support_refund_prepare_case");

    const result = JSON.parse(await prepareTool.execute({
      ...refundPrepareArgs(),
      requested_amount: 750
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      action: {
        approvalRequired: true,
        preparedActionId: expect.any(String)
      },
      status: "approval_required"
    });
    expect(JSON.stringify(result)).not.toContain("diagnostics");
  });

  it("throws an actionable error when the optional Agents SDK is unavailable", async () => {
    await expect(createDefaultAgentsSdkBridgeFactory({
      moduleName: "@aicf/not-installed-agents-sdk"
    })).rejects.toMatchObject({
      code: "missing_agents_sdk",
      safeMessage: "The optional OpenAI Agents SDK is not installed. Install @openai/agents or pass a compatible tool factory."
    });
  });

  it("keeps OpenAI Agents SDK imports out of root and runtime built subpaths", async () => {
    for (const file of [
      "dist/index.js",
      "dist/runtime/index.js"
    ]) {
      const content = await readFile(file, "utf8");
      expect(content).not.toContain("@openai/agents");
      expect(content).not.toContain("agents-sdk-bridge");
    }
  });
});

async function createAgentsHarness(): Promise<{
  builtContext: AicfBuiltContext;
  executor: AicfToolExecutor;
  registry: ManifestRegistry;
  runtimeContext: AicfRuntimeContext;
}> {
  const registry = await loadExampleRegistry();
  const runtimeContext = await buildSupportRuntimeContext();
  const builtContext = await new DefaultContextBuilder({
    hostItems: [{
      data: {
        ticket_id: "TCK-100"
      },
      id: "ticket_TCK_100",
      kind: "entity",
      title: "Support ticket",
      trusted: true,
      visibleToModel: true
    }]
  }).build({
    baseContext: runtimeContext,
    registry,
    userInput: {
      text: "Prepare a refund for ticket TCK-100."
    }
  });
  const handlers = new AicfHandlerRegistry({ registry });
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
      summary: "Refund case prepared for review."
    })
  });
  handlers.register({
    capabilityId: "support.refund.commit_case",
    commit: () => ({
      committedActionId: "commit_1",
      data: {
        audit_event_id: "AUD-1",
        refund_id: "RF-1",
        status: "committed"
      },
      status: "committed"
    })
  });
  const policyBroker = new DefaultPolicyBroker();
  const lifecycle = new AicfActionLifecycleManager({
    approvalStore: new InMemoryApprovalStore(),
    auditSink: new InMemoryAuditSink(),
    handlers,
    idempotencyStore: new InMemoryIdempotencyStore(),
    policyBroker,
    preparedActionStore: new InMemoryPreparedActionStore(),
    registry
  });
  const executor = new AicfToolExecutor({
    actionLifecycle: lifecycle,
    handlers,
    policyBroker,
    registry
  });

  return {
    builtContext,
    executor,
    registry,
    runtimeContext
  };
}

async function loadExampleRegistry(): Promise<ManifestRegistry> {
  const loaded = await loadManifests({ path: "examples" });
  const validation = validateManifests(loaded.manifests);
  expect(loaded.errors).toEqual([]);
  expect(validation.errors).toEqual([]);
  return buildRegistry(loaded.manifests);
}

async function buildSupportRuntimeContext(): Promise<AicfRuntimeContext> {
  return buildRuntimeContext({
    adapter: new StaticAuthPlatformAdapter({
      account: {
        accountId: "acct_example_support",
        tenantId: "tenant_example_support"
      },
      subject: {
        permissions: ["ticket.read", "refund.case.create"],
        roles: ["support_agent"],
        userId: "user_example_support_agent"
      }
    }),
    autonomy: {
      allowExternalMessages: false,
      allowMoneyMovement: false,
      allowPermissionChanges: false,
      allowSideEffects: true,
      autonomyTier: "A2",
      maxRiskTier: "medium"
    },
    environment: "test",
    facts: {
      "refund.order_not_refundable": false
    },
    requestId: "req_agents",
    runId: "run_agents",
    workflow: {
      currentEntityId: "TCK-100",
      currentEntityType: "ticket",
      workflowType: "support"
    }
  });
}

function refundPrepareArgs(): Record<string, unknown> {
  return {
    order_id: "ORD-100",
    reason_code: "customer_request",
    requested_amount: 25,
    ticket_id: "TCK-100"
  };
}

function mustTool<T extends { name: string }>(tools: T[], name: string): T {
  const tool = tools.find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool as T;
}
