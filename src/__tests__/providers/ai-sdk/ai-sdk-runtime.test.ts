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
  buildAiSdkTools,
  createAiSdkToolFactoriesFromSdk,
  createDefaultAiSdkToolFactories,
  createMockAiSdkToolFactories,
  isMockAiSdkTool,
  runAiSdkGenerateText,
  runAiSdkStreamText
} from "../../../providers/ai-sdk/index.js";

describe("Vercel AI SDK bridge tools", () => {
  it("builds AI SDK tools with JSON Schema input and excludes commit capabilities", async () => {
    const harness = await createAiSdkHarness();
    const toolset = buildAiSdkTools({
      ...harness.buildRequest,
      includeApprovalMetadata: true,
      strict: true,
      toolFactories: createMockAiSdkToolFactories()
    });
    const readTool = toolset.tools.aicf_support_ticket_get;
    const prepareTool = toolset.tools.aicf_support_refund_prepare_case;

    expect(toolset.diagnostics).toEqual([]);
    expect(Object.keys(toolset.tools)).toEqual([
      "aicf_support_ticket_get",
      "aicf_support_refund_prepare_case"
    ]);
    expect(toolset.toolNameMap.toProviderToolName("support.refund.commit_case")).toBeUndefined();
    expect(isMockAiSdkTool(readTool)).toBe(true);
    expect(isMockAiSdkTool(prepareTool)).toBe(true);
    if (!isMockAiSdkTool(readTool) || !isMockAiSdkTool(prepareTool)) throw new Error("unexpected test tool shape");
    expect(readTool.config.strict).toBe(true);
    expect(readTool.config.needsApproval).toBeUndefined();
    expect(prepareTool.config.needsApproval).toBe(true);
    expect(readTool.config.inputSchema).toMatchObject({
      kind: "mock-ai-sdk-json-schema",
      schema: {
        type: "object"
      }
    });
  });

  it("uses stable AI SDK-safe truncation and reports collisions", async () => {
    const registry = await loadSupportRegistry();
    const longName = toProviderToolName("support.very.long.capability.identifier.with.many.segments.for.ai.sdk.bridge", {
      provider: "vercel-ai-sdk"
    });
    const first = cloneCapability(registry, "support.ticket.get", "support.ticket.get");
    const second = cloneCapability(registry, "support.ticket.get", "support-ticket-get");
    const collisionRegistry = buildRegistry([first, second]);
    const harness = await createAiSdkHarness();
    const collisionToolset = buildAiSdkTools({
      ...harness.buildRequest,
      registry: collisionRegistry,
      slice: supportRuntimeSlice(["support.ticket.get", "support-ticket-get"]),
      toolFactories: createMockAiSdkToolFactories()
    });

    expect(longName.length).toBeLessThanOrEqual(64);
    expect(longName).toMatch(/^aicf_support_very_long_capability_identifier_with_many_[a-f0-9]{8}$/);
    expect(collisionToolset.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_name_collision",
      id: "support-ticket-get"
    }));
  });

  it("executes read and prepare tools through AICF runtime envelopes", async () => {
    const harness = await createAiSdkHarness();
    const toolset = buildAiSdkTools({
      ...harness.buildRequest,
      toolFactories: createMockAiSdkToolFactories()
    });
    const readTool = toolset.tools.aicf_support_ticket_get;
    const prepareTool = toolset.tools.aicf_support_refund_prepare_case;
    if (!isMockAiSdkTool(readTool) || !isMockAiSdkTool(prepareTool)) throw new Error("unexpected test tool shape");

    const read = await readTool.config.execute({ ticket_id: "TCK-100" }, { toolCallId: "call_ticket" });
    const prepare = await prepareTool.config.execute({
      order_id: "ORD-100",
      reason_code: "customer_request",
      requested_amount: 750,
      ticket_id: "TCK-100"
    }, { toolCallId: "call_refund" });

    expect(read).toMatchObject({
      capabilityId: "support.ticket.get",
      status: "success"
    });
    expect(prepare).toMatchObject({
      action: {
        approvalRequired: true
      },
      capabilityId: "support.refund.prepare_case",
      status: "approval_required"
    });
    expect(JSON.stringify(read)).not.toContain("diagnostics");
  });

  it("returns safe envelopes for invalid args, denied policy, and missing handlers", async () => {
    const invalidHarness = await createAiSdkHarness();
    const invalidToolset = buildAiSdkTools({
      ...invalidHarness.buildRequest,
      toolFactories: createMockAiSdkToolFactories()
    });
    const deniedHarness = await createAiSdkHarness({
      permissions: [],
      subjectUserId: "user_example_no_permissions"
    });
    const deniedToolset = buildAiSdkTools({
      ...deniedHarness.buildRequest,
      toolFactories: createMockAiSdkToolFactories()
    });
    const missingHandlerHarness = await createAiSdkHarness({ registerReadHandler: false });
    const missingHandlerToolset = buildAiSdkTools({
      ...missingHandlerHarness.buildRequest,
      toolFactories: createMockAiSdkToolFactories()
    });
    const invalidTool = invalidToolset.tools.aicf_support_ticket_get;
    const deniedTool = deniedToolset.tools.aicf_support_ticket_get;
    const missingHandlerTool = missingHandlerToolset.tools.aicf_support_ticket_get;
    if (!isMockAiSdkTool(invalidTool) || !isMockAiSdkTool(deniedTool) || !isMockAiSdkTool(missingHandlerTool)) {
      throw new Error("unexpected test tool shape");
    }

    const invalid = await invalidTool.config.execute({ ticket_id: "not-valid" });
    const denied = await deniedTool.config.execute({ ticket_id: "TCK-100" });
    const missingHandler = await missingHandlerTool.config.execute({ ticket_id: "TCK-100" });

    expect(invalid.status).toBe("validation_error");
    expect(denied.status).toBe("denied");
    expect(missingHandler.status).toBe("unavailable");
  });

  it("wraps compatible AI SDK factories and throws actionable missing optional dependency errors", async () => {
    const fakeSdk = {
      jsonSchema: (schema: unknown, options?: unknown) => ({ schema, options }),
      stepCountIs: (count: number) => ({ count }),
      tool: (config: unknown) => ({ config })
    };

    const factories = createAiSdkToolFactoriesFromSdk(fakeSdk);
    expect(factories.tool({ description: "x", execute: async () => ({}) as never, inputSchema: {} })).toEqual(expect.objectContaining({
      config: expect.any(Object)
    }));
    expect(() => createAiSdkToolFactoriesFromSdk({})).toThrow(AicfProviderError);
    await expect(createDefaultAiSdkToolFactories()).rejects.toMatchObject({
      code: "provider_dependency_missing",
      provider: "vercel-ai-sdk"
    });
  });
});

describe("Vercel AI SDK generateText and streamText wrappers", () => {
  it("passes model, prompt, tools, stop configuration, and provider options to generateText", async () => {
    const harness = await createAiSdkHarness();
    const captured: Record<string, unknown>[] = [];
    const generateText = async (input: Record<string, unknown>) => {
      captured.push(input);
      const tool = (input.tools as Record<string, { config: { execute(args: unknown): Promise<unknown> } }>).aicf_support_ticket_get;
      const envelope = await tool.config.execute({ ticket_id: "TCK-100" });
      return {
        finishReason: "stop",
        text: "Ticket TCK-100 is open.",
        toolCalls: [{
          toolCallId: "call_ticket",
          toolName: "aicf_support_ticket_get"
        }],
        toolResults: [{
          result: envelope
        }],
        totalUsage: {
          inputTokens: 12,
          outputTokens: 8
        }
      };
    };

    const result = await runAiSdkGenerateText({
      ...harness.buildRequest,
      generateText,
      maxSteps: 4,
      model: { id: "mock-model" },
      prompt: "Read ticket TCK-100.",
      providerOptions: {
        mock: {
          safe: true
        }
      },
      system: "Use only listed tools.",
      toolFactories: createMockAiSdkToolFactories()
    });

    expect(result.status).toBe("completed");
    expect(result.text).toBe("Ticket TCK-100 is open.");
    expect(result.toolCalls[0]).toMatchObject({
      capabilityId: "support.ticket.get",
      toolName: "aicf_support_ticket_get"
    });
    expect(result.toolResults[0]?.status).toBe("success");
    expect(captured[0]).toMatchObject({
      model: { id: "mock-model" },
      prompt: "Read ticket TCK-100.",
      stopWhen: {
        count: 4,
        kind: "mock-ai-sdk-step-count"
      },
      system: "Use only listed tools."
    });
    expect(Object.keys(captured[0]?.tools as Record<string, unknown>)).toContain("aicf_support_ticket_get");
  });

  it("returns safe provider errors from generateText without leaking thrown details", async () => {
    const harness = await createAiSdkHarness();
    const result = await runAiSdkGenerateText({
      ...harness.buildRequest,
      generateText: async () => {
        throw new Error("raw provider payload with secret token");
      },
      model: { id: "mock-model" },
      prompt: "Read ticket TCK-100.",
      toolFactories: createMockAiSdkToolFactories()
    });

    expect(result.status).toBe("provider_error");
    expect(JSON.stringify(result)).not.toContain("secret token");
  });

  it("passes tools safely to streamText and does not inspect raw stream payloads", async () => {
    const harness = await createAiSdkHarness();
    const captured: Record<string, unknown>[] = [];
    const streamResult = {
      rawProviderPayload: "secret token in stream result",
      textStream: {}
    };
    const result = await runAiSdkStreamText({
      ...harness.buildRequest,
      model: { id: "mock-model" },
      prompt: "Read ticket TCK-100.",
      streamText: (input) => {
        captured.push(input);
        return streamResult;
      },
      toolFactories: createMockAiSdkToolFactories()
    });

    expect(result.status).toBe("completed");
    expect(result.streamResult).toBe(streamResult);
    expect(captured[0]).toMatchObject({
      includeRawChunks: false,
      model: { id: "mock-model" },
      prompt: "Read ticket TCK-100."
    });
    expect(Object.keys(captured[0]?.tools as Record<string, unknown>)).toContain("aicf_support_ticket_get");
    expect(JSON.stringify(result.traceEvents)).not.toContain("secret token");
  });

  it("keeps AI SDK optional dependency isolated to its provider subpath", async () => {
    const root = await import("../../../../dist/index.js") as Record<string, unknown>;
    const runtime = await import("../../../../dist/runtime/index.js") as Record<string, unknown>;
    const providers = await import("../../../../dist/providers/index.js") as Record<string, unknown>;
    const aiSdk = await import("../../../../dist/providers/ai-sdk/index.js") as Record<string, unknown>;

    expect(root.loadManifests).toEqual(expect.any(Function));
    expect(runtime.DefaultCapabilityRouter).toEqual(expect.any(Function));
    expect(providers.createProviderToolNameMap).toEqual(expect.any(Function));
    expect(aiSdk.buildAiSdkTools).toEqual(expect.any(Function));
    for (const file of ["dist/index.js", "dist/runtime/index.js", "dist/providers/index.js"]) {
      const content = await readFile(file, "utf8");
      expect(content).not.toContain("from \"ai\"");
      expect(content).not.toContain("from 'ai'");
      expect(content).not.toContain("@ai-sdk/");
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

async function createAiSdkHarness(options: {
  permissions?: string[];
  registerReadHandler?: boolean;
  registry?: ManifestRegistry;
  subjectUserId?: string;
} = {}): Promise<{
  buildRequest: Omit<Parameters<typeof buildAiSdkTools>[0], "toolFactories">;
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
  nextCapabilityId: string
): LoadedCapabilityManifest {
  const source = mustCapability(registry, sourceCapabilityId);
  return {
    ...source,
    manifest: {
      ...source.manifest,
      id: nextCapabilityId
    },
    path: `${nextCapabilityId}.yaml`
  };
}
