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
  type AicfRuntimeContext
} from "../../runtime/index.js";
import {
  AicfMcpServer,
  registerAicfMcpTools
} from "../../mcp-server/index.js";

describe("AICF MCP server runtime", () => {
  it("lists routed read and prepare tools while excluding commit tools", async () => {
    const harness = await createMcpHarness();
    const list = await harness.server.listTools({
      userInput: "Prepare a refund for ticket TCK-100."
    });

    expect(list.tools.map((tool) => tool.name)).toEqual([
      "aicf_support.ticket.get",
      "aicf_support.refund.prepare_case"
    ]);
    expect(list.tools.map((tool) => tool.name)).not.toContain("aicf_support.refund.commit_case");
    expect(list.tools[0]).toMatchObject({
      _meta: {
        aicf: {
          capabilityId: "support.ticket.get",
          lifecycleOperation: "read"
        }
      },
      annotations: expect.objectContaining({
        destructiveHint: false
      }),
      inputSchema: expect.any(Object)
    });
  });

  it("executes MCP read and prepare tool calls through the runtime executor", async () => {
    const harness = await createMcpHarness();
    const list = await harness.server.listTools({
      userInput: "Prepare a refund for ticket TCK-100."
    });
    const readTool = list.tools.find((tool) => tool.name === "aicf_support.ticket.get");
    const prepareTool = list.tools.find((tool) => tool.name === "aicf_support.refund.prepare_case");

    const read = await harness.server.callTool({
      params: {
        arguments: {
          ticket_id: "TCK-100"
        },
        name: readTool?.name
      },
      userInput: "Read ticket TCK-100."
    });
    const prepare = await harness.server.callTool({
      params: {
        arguments: refundPrepareArgs(),
        name: prepareTool?.name
      },
      userInput: "Prepare a refund for ticket TCK-100."
    });

    expect(read.isError).toBe(false);
    expect(read.structuredContent).toMatchObject({
      capabilityId: "support.ticket.get",
      status: "success"
    });
    expect(prepare.isError).toBe(false);
    expect(prepare.structuredContent).toMatchObject({
      capabilityId: "support.refund.prepare_case",
      status: "approval_required"
    });
  });

  it("returns safe MCP results for invalid args, unknown tools, denied policy, and missing handlers", async () => {
    const harness = await createMcpHarness();
    const deniedHarness = await createMcpHarness({
      forceSlice: ["support.ticket.get"],
      permissions: []
    });
    const missingHandlerHarness = await createMcpHarness({ registerReadHandler: false });
    const invalid = await harness.server.callTool({
      params: {
        arguments: {
          ticket_id: "not-a-ticket"
        },
        name: "aicf_support.ticket.get"
      },
      userInput: "Read ticket."
    });
    const unknown = await harness.server.callTool({
      params: {
        arguments: {},
        name: "aicf_missing_tool"
      },
      userInput: "Call missing tool."
    });
    const denied = await deniedHarness.server.callTool({
      params: {
        arguments: {
          ticket_id: "TCK-100"
        },
        name: "aicf_support.ticket.get"
      },
      userInput: "Read ticket."
    });
    const missingHandler = await missingHandlerHarness.server.callTool({
      params: {
        arguments: {
          ticket_id: "TCK-100"
        },
        name: "aicf_support.ticket.get"
      },
      userInput: "Read ticket."
    });

    expect(invalid.isError).toBe(true);
    expect(invalid.structuredContent).toMatchObject({ status: "validation_error" });
    expect(unknown.isError).toBe(true);
    expect(JSON.stringify(unknown.structuredContent)).toContain("does not map to an AICF capability");
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({ status: "denied" });
    expect(missingHandler.isError).toBe(true);
    expect(missingHandler.structuredContent).toMatchObject({ status: "unavailable" });
  });

  it("returns a safe empty tool list when the runtime context factory throws", async () => {
    const harness = await createMcpHarness({
      runtimeContextFactory: () => {
        throw new Error("private auth outage");
      }
    });

    const list = await harness.server.listTools({
      userInput: "Prepare a refund."
    });

    expect(list.tools).toEqual([]);
    expect(list.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid_context",
      message: "MCP runtime context could not be resolved."
    }));
    expect(JSON.stringify(list)).not.toContain("private auth outage");
  });

  it("fails closed when the runtime context factory throws", async () => {
    const harness = await createMcpHarness({
      runtimeContextFactory: () => {
        throw new Error("private auth outage");
      }
    });

    const result = await harness.server.callTool({
      params: {
        arguments: {
          ticket_id: "TCK-100"
        },
        name: "aicf_support.ticket.get"
      }
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain("runtime_context_invalid");
    expect(JSON.stringify(result.structuredContent)).not.toContain("private auth outage");
  });

  it("does not execute commit capabilities through MCP tool calls", async () => {
    const harness = await createMcpHarness();
    const result = await harness.server.callTool({
      params: {
        arguments: {
          approval_id: "approval_example",
          prepared_action_id: "prepared_example"
        },
        name: "aicf_support.refund.commit_case"
      },
      userInput: "Commit the refund."
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain("does not map to an AICF capability");
  });

  it("registers tools against a caller-provided MCP SDK-like server", async () => {
    const harness = await createMcpHarness();
    const registered: Array<{
      config: Record<string, unknown>;
      handler: (args: unknown, extra?: unknown) => Promise<unknown>;
      name: string;
    }> = [];
    const fakeSdkServer = {
      registerTool(name: string, config: Record<string, unknown>, handler: (args: unknown, extra?: unknown) => Promise<unknown>) {
        registered.push({ config, handler, name });
      }
    };

    const result = await registerAicfMcpTools({
      aicfServer: harness.server,
      mcpServer: fakeSdkServer,
      request: {
        userInput: "Prepare a refund."
      }
    });
    const toolResult = await registered[0]?.handler(refundPrepareArgs());

    expect(result.registered).toBe(2);
    expect(result.toolNames).toContain("aicf_support.refund.prepare_case");
    expect(registered[0]?.config).toMatchObject({
      description: expect.any(String),
      inputSchema: expect.any(Object)
    });
    expect(JSON.stringify(toolResult)).toContain("schemaVersion");
  });

  it("exports MCP server APIs from the built package subpath", async () => {
    const mcpServer = await import("../../../dist/mcp-server/index.js") as Record<string, unknown>;

    expect(mcpServer.AicfMcpServer).toEqual(expect.any(Function));
    expect(mcpServer.registerAicfMcpTools).toEqual(expect.any(Function));
  });

  it("keeps MCP SDK imports out of root, runtime, and OpenAI built subpaths", async () => {
    for (const file of [
      "dist/index.js",
      "dist/runtime/index.js",
      "dist/openai/index.js"
    ]) {
      const content = await readFile(file, "utf8");
      expect(content).not.toContain("@modelcontextprotocol/sdk");
      expect(content).not.toContain("dist/mcp-server/");
    }
  });
});

async function createMcpHarness(options: {
  forceSlice?: string[];
  permissions?: string[];
  registerReadHandler?: boolean;
  runtimeContextFactory?: () => Promise<AicfRuntimeContext> | AicfRuntimeContext;
} = {}) {
  const registry = await loadExampleRegistry();
  const runtimeContext = await buildSupportRuntimeContext({ permissions: options.permissions });
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
    userInput: {
      text: "Prepare a refund for ticket TCK-100."
    }
  });
  const handlers = new AicfHandlerRegistry({ registry });
  if (options.registerReadHandler !== false) {
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
  }
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
  const server = new AicfMcpServer({
    contextBuilder,
    executor,
    registry,
    router: options.forceSlice ? forcedRouter(options.forceSlice) : new DefaultCapabilityRouter(),
    runtimeContextFactory: options.runtimeContextFactory ?? (() => runtimeContext)
  });

  return {
    builtContext,
    registry,
    runtimeContext,
    server
  };
}

function forcedRouter(capabilityIds: string[]) {
  return {
    route: () => ({
      excluded: [],
      items: capabilityIds.map((capabilityId) => ({
        capabilityId,
        exposedOperations: ["select"] as Array<"select" | "prepare">,
        reasons: ["forced test slice"],
        score: 1
      })),
      warnings: []
    })
  };
}

async function loadExampleRegistry(): Promise<ManifestRegistry> {
  const loaded = await loadManifests({ path: "examples" });
  const validation = validateManifests(loaded.manifests);
  expect(loaded.errors).toEqual([]);
  expect(validation.errors).toEqual([]);
  return buildRegistry(loaded.manifests);
}

async function buildSupportRuntimeContext(options: {
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
    requestId: "req_mcp",
    runId: "run_mcp",
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
    requested_amount: 750,
    ticket_id: "TCK-100"
  };
}
