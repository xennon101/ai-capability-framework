import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  loadManifests,
  toOpenAIResponsesToolName,
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
  type AicfRuntimeContext,
  type AicfRuntimeUserInput
} from "../../runtime/index.js";
import {
  MockOpenAIResponsesClient,
  mockFunctionCallResponse,
  mockTextResponse,
  runOpenAIResponses
} from "../../openai/index.js";

const supportUserInput: AicfRuntimeUserInput = {
  text: "Look up support ticket TCK-100 and prepare a refund if needed."
};

describe("OpenAI Responses runtime", () => {
  it("returns a final answer without tool calls", async () => {
    const harness = await createOpenAIHarness();
    const client = new MockOpenAIResponsesClient([
      mockTextResponse("The ticket can be reviewed in the support workspace.", "resp_1")
    ]);

    const result = await runOpenAIResponses({
      ...harness.runRequest,
      client
    });

    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("The ticket can be reviewed in the support workspace.");
    expect(result.toolResults).toEqual([]);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.tools).toEqual(expect.any(Array));
  });

  it("executes one read tool call and continues with model-safe output", async () => {
    const harness = await createOpenAIHarness();
    const client = new MockOpenAIResponsesClient([
      mockFunctionCallResponse({
        args: { ticket_id: "TCK-100" },
        callId: "call_ticket",
        name: toOpenAIResponsesToolName("support.ticket.get")
      }),
      mockTextResponse("Ticket TCK-100 is open.", "resp_final")
    ]);

    const result = await runOpenAIResponses({
      ...harness.runRequest,
      client
    });
    const continuationInput = client.requests[1]?.input as Array<{ call_id: string; output: string }>;
    const envelope = JSON.parse(continuationInput[0]?.output ?? "{}") as { status?: string; capabilityId?: string };

    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("Ticket TCK-100 is open.");
    expect(result.toolResults[0]?.status).toBe("success");
    expect(result.toolResults[0]?.capabilityId).toBe("support.ticket.get");
    expect(continuationInput[0]?.call_id).toBe("call_ticket");
    expect(envelope.status).toBe("success");
    expect(envelope.capabilityId).toBe("support.ticket.get");
  });

  it("executes a prepare tool call that requires approval and continues safely", async () => {
    const harness = await createOpenAIHarness();
    const client = new MockOpenAIResponsesClient([
      mockFunctionCallResponse({
        args: {
          order_id: "ORD-100",
          reason_code: "customer_request",
          requested_amount: 750,
          ticket_id: "TCK-100"
        },
        callId: "call_refund",
        name: toOpenAIResponsesToolName("support.refund.prepare_case")
      }),
      mockTextResponse("A refund case was prepared and requires approval.", "resp_final")
    ]);

    const result = await runOpenAIResponses({
      ...harness.runRequest,
      client
    });
    const continuationInput = client.requests[1]?.input as Array<{ output: string }>;
    const envelope = JSON.parse(continuationInput[0]?.output ?? "{}") as {
      action?: { approvalRequired?: boolean };
      status?: string;
    };

    expect(result.status).toBe("completed");
    expect(result.toolResults[0]?.status).toBe("approval_required");
    expect(envelope.status).toBe("approval_required");
    expect(envelope.action?.approvalRequired).toBe(true);
  });

  it("returns validation-error envelopes for invalid tool arguments", async () => {
    const harness = await createOpenAIHarness();
    const client = new MockOpenAIResponsesClient([
      mockFunctionCallResponse({
        args: { ticket_id: "not-a-ticket" },
        callId: "call_invalid",
        name: toOpenAIResponsesToolName("support.ticket.get")
      }),
      mockTextResponse("The ticket lookup input was invalid.", "resp_final")
    ]);

    const result = await runOpenAIResponses({
      ...harness.runRequest,
      client
    });

    expect(result.status).toBe("completed");
    expect(result.toolResults[0]?.status).toBe("validation_error");
    expect(result.toolResults[0]?.errors?.[0]?.code).toBe("schema");
  });

  it("returns unavailable envelopes for unknown tool names", async () => {
    const harness = await createOpenAIHarness();
    const client = new MockOpenAIResponsesClient([
      mockFunctionCallResponse({
        args: {},
        callId: "call_unknown",
        name: "aicf_unknown_tool"
      }),
      mockTextResponse("That tool is not available.", "resp_final")
    ]);

    const result = await runOpenAIResponses({
      ...harness.runRequest,
      client
    });

    expect(result.status).toBe("completed");
    expect(result.toolResults[0]?.status).toBe("unavailable");
    expect(result.toolResults[0]?.capabilityId).toBe("unknown");
  });

  it("does not expose commit capabilities in the selected OpenAI toolset", async () => {
    const harness = await createOpenAIHarness();
    const client = new MockOpenAIResponsesClient([
      mockTextResponse("No tool needed.", "resp_1")
    ]);

    const result = await runOpenAIResponses({
      ...harness.runRequest,
      client
    });
    const tools = client.requests[0]?.tools as Array<{ name: string }>;

    expect(result.selectedCapabilities.items.map((item) => item.capabilityId)).not.toContain("support.refund.commit_case");
    expect(tools.map((tool) => tool.name)).not.toContain(toOpenAIResponsesToolName("support.refund.commit_case"));
  });

  it("fails safely when a function call is missing call_id", async () => {
    const harness = await createOpenAIHarness();
    const client = new MockOpenAIResponsesClient([
      {
        id: "resp_missing_call_id",
        output: [{
          arguments: JSON.stringify({ ticket_id: "TCK-100" }),
          name: toOpenAIResponsesToolName("support.ticket.get"),
          type: "function_call"
        }]
      }
    ]);

    const result = await runOpenAIResponses({
      ...harness.runRequest,
      client
    });

    expect(result.status).toBe("failed");
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "invalid_tool_call"
    }));
    expect(client.requests).toHaveLength(1);
  });

  it("enforces max tool calls", async () => {
    const harness = await createOpenAIHarness();
    const client = new MockOpenAIResponsesClient([
      mockFunctionCallResponse({
        args: { ticket_id: "TCK-100" },
        callId: "call_ticket",
        name: toOpenAIResponsesToolName("support.ticket.get")
      })
    ]);

    const result = await runOpenAIResponses({
      ...harness.runRequest,
      client,
      maxToolCalls: 0
    });

    expect(result.status).toBe("tool_limit_exceeded");
    expect(result.toolResults).toEqual([]);
  });

  it("enforces max turns", async () => {
    const harness = await createOpenAIHarness();
    const client = new MockOpenAIResponsesClient([
      mockFunctionCallResponse({
        args: { ticket_id: "TCK-100" },
        callId: "call_ticket",
        name: toOpenAIResponsesToolName("support.ticket.get")
      })
    ]);

    const result = await runOpenAIResponses({
      ...harness.runRequest,
      client,
      maxTurns: 1
    });

    expect(result.status).toBe("turn_limit_exceeded");
    expect(result.toolResults[0]?.status).toBe("success");
  });

  it("returns provider_error without raw provider payloads", async () => {
    const harness = await createOpenAIHarness();
    const client = new MockOpenAIResponsesClient([
      new Error("raw provider payload with secret token")
    ]);

    const result = await runOpenAIResponses({
      ...harness.runRequest,
      client
    });

    expect(result.status).toBe("provider_error");
    expect(result.errors).toEqual([{
      code: "provider_error",
      message: "The OpenAI request failed."
    }]);
    expect(JSON.stringify(result)).not.toContain("secret token");
  });

  it("root and runtime imports do not require OpenAI while the built OpenAI subpath exports runtime APIs", async () => {
    const root = await import("../../../dist/index.js") as Record<string, unknown>;
    const runtime = await import("../../../dist/runtime/index.js") as Record<string, unknown>;
    const openai = await import("../../../dist/openai/index.js") as Record<string, unknown>;

    expect(root.buildOpenAIResponsesTools).toEqual(expect.any(Function));
    expect(runtime.DefaultCapabilityRouter).toEqual(expect.any(Function));
    expect(openai.runOpenAIResponses).toEqual(expect.any(Function));
    expect(openai.createOpenAIResponsesClientFromSdk).toEqual(expect.any(Function));
    expect(openai.createDefaultOpenAIResponsesClient).toEqual(expect.any(Function));
    expect(openai.extractOpenAIResponsesFunctionCalls).toEqual(expect.any(Function));
    expect(openai.buildOpenAIFunctionCallOutput).toEqual(expect.any(Function));
    expect(openai.buildAgentsSdkTools).toEqual(expect.any(Function));
    expect(openai.createDefaultAgentsSdkBridgeFactory).toEqual(expect.any(Function));
  });
});

async function createOpenAIHarness() {
  const registry = await loadExampleRegistry();
  const runtimeContext = await buildSupportRuntimeContext();
  const contextBuilder = new DefaultContextBuilder({
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
  });
  const builtContext = await contextBuilder.build({
    baseContext: runtimeContext,
    registry,
    userInput: supportUserInput
  });
  const handlers = new AicfHandlerRegistry({ registry });
  const preparedActionStore = new InMemoryPreparedActionStore();
  const approvalStore = new InMemoryApprovalStore();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const auditSink = new InMemoryAuditSink();
  const policyBroker = new DefaultPolicyBroker();

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
      summary: "Refund case prepared for review.",
      userMessage: "Refund case prepared."
    })
  });

  const lifecycle = new AicfActionLifecycleManager({
    approvalStore,
    auditSink,
    handlers,
    idempotencyStore,
    policyBroker,
    preparedActionStore,
    registry
  });
  const executor = new AicfToolExecutor({
    actionLifecycle: lifecycle,
    auditSink,
    handlers,
    policyBroker,
    registry
  });

  return {
    builtContext,
    runRequest: {
      client: new MockOpenAIResponsesClient([]),
      contextBuilder,
      executor,
      model: "gpt-4.1-mini",
      registry,
      router: new DefaultCapabilityRouter(),
      runtimeContext,
      userInput: supportUserInput
    }
  };
}

async function loadExampleRegistry(): Promise<ManifestRegistry> {
  const loaded = await loadManifests({ path: "examples" });
  const validation = validateManifests(loaded.manifests);
  expect(loaded.errors).toEqual([]);
  expect(validation.errors).toEqual([]);
  return buildRegistry(loaded.manifests);
}

async function buildSupportRuntimeContext(
  options: Partial<AicfRuntimeContext["autonomy"]> = {}
): Promise<AicfRuntimeContext> {
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
      maxRiskTier: "medium",
      ...options
    },
    environment: "test",
    facts: {
      "refund.order_not_refundable": false
    },
    workflow: {
      currentEntityId: "TCK-100",
      currentEntityType: "ticket",
      workflowType: "support"
    }
  });
}
