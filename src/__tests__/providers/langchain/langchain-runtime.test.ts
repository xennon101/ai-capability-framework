import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  loadManifests,
  validateManifests,
  validatePublicFixtures,
  type LoadedCapabilityManifest,
  type ManifestRegistry
} from "../../../index.js";
import {
  AicfActionLifecycleManager,
  AicfHandlerRegistry,
  AicfToolExecutor,
  buildRuntimeContext,
  DefaultContextBuilder,
  DefaultPolicyBroker,
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemoryIdempotencyStore,
  InMemoryPreparedActionStore,
  StaticAuthPlatformAdapter,
  type AicfBuiltContext,
  type AicfRuntimeContext,
  type RuntimeCapabilitySlice
} from "../../../runtime/index.js";
import {
  AicfProviderError,
  toProviderToolName
} from "../../../providers/index.js";
import {
  buildLangChainTools,
  buildLangGraphToolNode,
  createDefaultLangChainToolFactory,
  createLangChainToolFactoryFromSdk,
  createLangChainZodSchemaFactory,
  createMockLangChainSchemaFactory,
  createMockLangChainToolFactory,
  isMockLangChainTool,
  MockLangGraphToolNode
} from "../../../providers/langchain/index.js";

describe("LangChain provider bridge tools", () => {
  it("builds LangChain tools from a routed slice and excludes commit capabilities", async () => {
    const harness = await createLangChainHarness();
    const toolset = buildLangChainTools({
      ...harness.buildRequest,
      schemaFactory: createMockLangChainSchemaFactory(),
      toolFactory: createMockLangChainToolFactory()
    });
    const tools = toolset.tools.filter(isMockLangChainTool);

    expect(toolset.diagnostics).toEqual([]);
    expect(tools.map((tool) => tool.config.name)).toEqual([
      "aicf_support_ticket_get",
      "aicf_support_refund_prepare_case"
    ]);
    expect(toolset.toolNameMap.toProviderToolName("support.refund.commit_case")).toBeUndefined();
    expect(tools[0]?.config.description).toContain("retrieve a synthetic support ticket");
    expect(tools[0]?.config.schema).toMatchObject({
      kind: "mock-langchain-schema",
      schema: {
        type: "object"
      }
    });
    expect(tools[0]?.config.metadata).toMatchObject({
      capabilityId: "support.ticket.get"
    });
  });

  it("uses stable LangChain-safe truncation and reports collisions", async () => {
    const registry = await loadSupportRegistry();
    const longName = toProviderToolName("support.very.long.capability.identifier.with.many.segments.for.langchain.bridge", {
      provider: "langchain"
    });
    const first = cloneCapability(registry, "support.ticket.get", "support.ticket.get");
    const second = cloneCapability(registry, "support.ticket.get", "support-ticket-get");
    const collisionRegistry = buildRegistry([first, second]);
    const harness = await createLangChainHarness();
    const collisionToolset = buildLangChainTools({
      ...harness.buildRequest,
      registry: collisionRegistry,
      schemaFactory: createMockLangChainSchemaFactory(),
      slice: supportRuntimeSlice(["support.ticket.get", "support-ticket-get"]),
      toolFactory: createMockLangChainToolFactory()
    });

    expect(longName.length).toBeLessThanOrEqual(64);
    expect(longName).toMatch(/^aicf_support_very_long_capability_identifier_with_many_[a-f0-9]{8}$/);
    expect(collisionToolset.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_name_collision",
      id: "support-ticket-get"
    }));
  });

  it("executes tools through AICF runtime and returns serialized model-safe envelopes", async () => {
    const harness = await createLangChainHarness();
    const toolset = buildLangChainTools({
      ...harness.buildRequest,
      schemaFactory: createMockLangChainSchemaFactory(),
      toolFactory: createMockLangChainToolFactory()
    });
    const tools = toolset.tools.filter(isMockLangChainTool);
    const readTool = tools.find((tool) => tool.config.name === "aicf_support_ticket_get");
    const prepareTool = tools.find((tool) => tool.config.name === "aicf_support_refund_prepare_case");
    if (!readTool || !prepareTool) throw new Error("missing test tool");

    const read = JSON.parse(await readTool.invoke({ ticket_id: "TCK-100" }, { toolCallId: "call_ticket" })) as {
      capabilityId?: string;
      diagnostics?: unknown;
      status?: string;
    };
    const prepare = JSON.parse(await prepareTool.invoke({
      order_id: "ORD-100",
      reason_code: "customer_request",
      requested_amount: 750,
      ticket_id: "TCK-100"
    }, { toolCall: { id: "call_refund" } })) as {
      action?: { approvalRequired?: boolean };
      capabilityId?: string;
      status?: string;
    };

    expect(read).toMatchObject({
      capabilityId: "support.ticket.get",
      status: "success"
    });
    expect(read.diagnostics).toBeUndefined();
    expect(prepare).toMatchObject({
      action: {
        approvalRequired: true
      },
      capabilityId: "support.refund.prepare_case",
      status: "approval_required"
    });
  });

  it("returns controlled model-safe output for invalid args, denied policy, and missing handlers", async () => {
    const invalidHarness = await createLangChainHarness();
    const invalidTool = mustMockTool(buildLangChainTools({
      ...invalidHarness.buildRequest,
      schemaFactory: createMockLangChainSchemaFactory(),
      toolFactory: createMockLangChainToolFactory()
    }), "aicf_support_ticket_get");
    const deniedHarness = await createLangChainHarness({
      permissions: [],
      subjectUserId: "user_example_no_permissions"
    });
    const deniedTool = mustMockTool(buildLangChainTools({
      ...deniedHarness.buildRequest,
      schemaFactory: createMockLangChainSchemaFactory(),
      toolFactory: createMockLangChainToolFactory()
    }), "aicf_support_ticket_get");
    const missingHandlerHarness = await createLangChainHarness({ registerReadHandler: false });
    const missingHandlerTool = mustMockTool(buildLangChainTools({
      ...missingHandlerHarness.buildRequest,
      schemaFactory: createMockLangChainSchemaFactory(),
      toolFactory: createMockLangChainToolFactory()
    }), "aicf_support_ticket_get");

    const invalid = JSON.parse(await invalidTool.invoke({ ticket_id: "not-valid" })) as { status?: string };
    const denied = JSON.parse(await deniedTool.invoke({ ticket_id: "TCK-100" })) as { status?: string };
    const missingHandler = JSON.parse(await missingHandlerTool.invoke({ ticket_id: "TCK-100" })) as { status?: string };

    expect(invalid.status).toBe("validation_error");
    expect(denied.status).toBe("denied");
    expect(missingHandler.status).toBe("unavailable");
  });

  it("converts supported schemas to Zod-like objects and fails closed for unsupported schema properties", async () => {
    const registry = await loadSupportRegistry();
    const fakeZod = createFakeZod();
    const zodFactory = createLangChainZodSchemaFactory(fakeZod);
    const supportedHarness = await createLangChainHarness();
    const supportedToolset = buildLangChainTools({
      ...supportedHarness.buildRequest,
      schemaFactory: zodFactory,
      toolFactory: createMockLangChainToolFactory()
    });
    const unsupported = cloneCapability(registry, "support.ticket.get", "support.ticket.unsupported_schema", {
      input_schema: {
        additionalProperties: false,
        properties: {
          unsupported: { type: "null" }
        },
        type: "object"
      }
    });
    const unsupportedRegistry = buildRegistry([unsupported]);
    const unsupportedHarness = await createLangChainHarness();
    const unsupportedToolset = buildLangChainTools({
      ...unsupportedHarness.buildRequest,
      registry: unsupportedRegistry,
      schemaFactory: zodFactory,
      slice: supportRuntimeSlice(["support.ticket.unsupported_schema"]),
      toolFactory: createMockLangChainToolFactory()
    });

    expect((supportedToolset.tools.filter(isMockLangChainTool)[0]?.config.schema as { kind?: string } | undefined)?.kind).toContain("zod-object");
    expect(unsupportedToolset.tools).toEqual([]);
    expect(unsupportedToolset.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_schema_unsupported",
      path: expect.stringContaining("unsupported")
    }));
  });

  it("wraps compatible LangChain factories and throws actionable missing optional dependency errors", async () => {
    const fakeSdk = {
      tool: (fn: unknown, config: unknown) => ({ config, fn })
    };

    const factory = createLangChainToolFactoryFromSdk(fakeSdk);
    expect(factory.tool(async () => "{}", {
      description: "x",
      name: "x",
      schema: {}
    })).toEqual(expect.objectContaining({
      config: expect.any(Object)
    }));
    expect(() => createLangChainToolFactoryFromSdk({})).toThrow(AicfProviderError);
    await expect(createDefaultLangChainToolFactory()).rejects.toMatchObject({
      code: "provider_dependency_missing",
      provider: "langchain"
    });
  });

  it("builds a LangGraph ToolNode through a host-supplied constructor", async () => {
    const harness = await createLangChainHarness();
    const node = buildLangGraphToolNode({
      ...harness.buildRequest,
      ToolNode: MockLangGraphToolNode,
      schemaFactory: createMockLangChainSchemaFactory(),
      toolFactory: createMockLangChainToolFactory(),
      toolNodeOptions: {
        name: "aicf_tools"
      }
    });

    expect(node).toBeInstanceOf(MockLangGraphToolNode);
    expect((node as MockLangGraphToolNode).tools).toHaveLength(2);
    expect((node as MockLangGraphToolNode).options).toMatchObject({
      aicf: {
        provider: "langchain"
      },
      name: "aicf_tools"
    });
    expect(() => buildLangGraphToolNode({
      ...harness.buildRequest,
      schemaFactory: createMockLangChainSchemaFactory(),
      toolFactory: createMockLangChainToolFactory()
    })).toThrow(AicfProviderError);
  });

  it("keeps LangChain optional dependency isolated to its provider subpath", async () => {
    const root = await import("../../../../dist/index.js") as Record<string, unknown>;
    const runtime = await import("../../../../dist/runtime/index.js") as Record<string, unknown>;
    const providers = await import("../../../../dist/providers/index.js") as Record<string, unknown>;
    const langchain = await import("../../../../dist/providers/langchain/index.js") as Record<string, unknown>;

    expect(root.loadManifests).toEqual(expect.any(Function));
    expect(runtime.DefaultCapabilityRouter).toEqual(expect.any(Function));
    expect(providers.createProviderToolNameMap).toEqual(expect.any(Function));
    expect(langchain.buildLangChainTools).toEqual(expect.any(Function));
    for (const file of ["dist/index.js", "dist/runtime/index.js", "dist/providers/index.js"]) {
      const content = await readFile(file, "utf8");
      expect(content).not.toContain("@langchain/");
      expect(content).not.toContain("from \"langchain\"");
      expect(content).not.toContain("from 'langchain'");
    }
  });
});

async function loadSupportRegistry(): Promise<ManifestRegistry> {
  const loaded = await loadManifests({ path: "examples/support" });
  const manifestValidation = validateManifests(loaded.manifests);
  const fixtureValidation = validatePublicFixtures(loaded.fixtures);
  const errors = [
    ...loaded.errors,
    ...manifestValidation.errors,
    ...fixtureValidation.errors
  ];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }

  return buildRegistry(loaded.manifests);
}

async function createLangChainHarness(options: {
  permissions?: string[];
  registerReadHandler?: boolean;
  registry?: ManifestRegistry;
  subjectUserId?: string;
} = {}): Promise<{
  buildRequest: Omit<Parameters<typeof buildLangChainTools>[0], "schemaFactory" | "toolFactory">;
  builtContext: AicfBuiltContext;
  registry: ManifestRegistry;
  runtimeContext: AicfRuntimeContext;
}> {
  const registry = options.registry ?? await loadSupportRegistry();
  const runtimeContext = await buildRuntimeContext({
    adapter: new StaticAuthPlatformAdapter({
      account: {
        accountId: "acct_example_support",
        tenantId: "tenant_example_support"
      },
      subject: {
        permissions: options.permissions ?? ["ticket.read", "refund.case.create"],
        roles: ["support_agent"],
        userId: options.subjectUserId ?? "user_example_support_agent"
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
    workflow: {
      currentEntityId: "TCK-100",
      currentEntityType: "ticket",
      workflowType: "support"
    }
  });
  const builtContext = await new DefaultContextBuilder().build({
    baseContext: runtimeContext,
    registry,
    userInput: {
      text: "Read ticket TCK-100 and prepare a refund case."
    }
  });
  const handlers = new AicfHandlerRegistry({ registry });
  const preparedActionStore = new InMemoryPreparedActionStore();
  const approvalStore = new InMemoryApprovalStore();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const auditSink = new InMemoryAuditSink();
  const policyBroker = new DefaultPolicyBroker();

  if (options.registerReadHandler !== false) {
    handlers.register({
      capabilityId: "support.ticket.get",
      read: ({ args }) => ({
        ticket: {
          order_id: "ORD-100",
          status: "open",
          ticket_id: args.ticket_id
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
    buildRequest: {
      builtContext,
      executor,
      registry,
      runtimeContext,
      slice: supportRuntimeSlice(["support.ticket.get", "support.refund.prepare_case", "support.refund.commit_case"])
    },
    builtContext,
    registry,
    runtimeContext
  };
}

function supportRuntimeSlice(capabilityIds: string[]): RuntimeCapabilitySlice {
  return {
    excluded: [],
    items: capabilityIds.map((capabilityId) => ({
      capabilityId,
      exposedOperations: ["select", capabilityId.includes("prepare") ? "prepare" : "select"].filter((operation, index, array) => array.indexOf(operation) === index) as Array<"select" | "prepare">,
      reasons: ["test slice"],
      score: 1
    })),
    warnings: []
  };
}

function mustCapability(registry: ManifestRegistry, capabilityId: string): LoadedCapabilityManifest {
  const capability = registry.capabilityById.get(capabilityId);
  if (!capability) {
    throw new Error(`Missing capability ${capabilityId}`);
  }
  return capability;
}

function cloneCapability(
  registry: ManifestRegistry,
  sourceCapabilityId: string,
  nextCapabilityId: string,
  overrides: Partial<LoadedCapabilityManifest["manifest"]> = {}
): LoadedCapabilityManifest {
  const source = mustCapability(registry, sourceCapabilityId);
  return {
    ...source,
    manifest: {
      ...source.manifest,
      ...overrides,
      id: nextCapabilityId
    },
    path: `${nextCapabilityId}.yaml`
  };
}

function mustMockTool(toolset: ReturnType<typeof buildLangChainTools>, name: string) {
  const tool = toolset.tools.filter(isMockLangChainTool).find((item) => item.config.name === name);
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }
  return tool;
}

function createFakeZod() {
  const wrap = (kind: string, extra: Record<string, unknown> = {}) => ({
    ...extra,
    kind,
    nullable() {
      return wrap(`${kind}.nullable`, extra);
    },
    optional() {
      return wrap(`${kind}.optional`, extra);
    },
    strict() {
      return wrap(`${kind}.strict`, extra);
    }
  });

  return {
    array: (item: unknown) => wrap("zod-array", { item }),
    boolean: () => wrap("zod-boolean"),
    enum: (values: string[]) => wrap("zod-enum", { values }),
    number: () => wrap("zod-number"),
    object: (shape: Record<string, unknown>) => wrap("zod-object", { shape }),
    string: () => wrap("zod-string")
  };
}
