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
  createProviderToolNameMap,
  toProviderToolName
} from "../../../providers/index.js";
import {
  buildAnthropicToolResultMessage,
  buildAnthropicTools,
  createAnthropicClientFromSdk,
  createDefaultAnthropicMessagesClient,
  MockAnthropicMessagesClient,
  mockAnthropicTextResponse,
  mockAnthropicToolUseBlock,
  mockAnthropicToolUseResponse,
  parseAnthropicToolUseBlocks,
  runAnthropicMessages
} from "../../../providers/anthropic/index.js";

describe("Anthropic Claude provider runtime tools", () => {
  it("builds valid strict descriptors and excludes commit capabilities", async () => {
    const harness = await createAnthropicHarness();
    const toolset = buildAnthropicTools({
      registry: harness.registry,
      slice: supportRuntimeSlice(["support.ticket.get", "support.refund.prepare_case", "support.refund.commit_case"]),
      strictTools: true
    });

    expect(toolset.diagnostics).toEqual([]);
    expect(toolset.tools.map((tool) => tool.name)).toEqual([
      "aicf_support_ticket_get",
      "aicf_support_refund_prepare_case"
    ]);
    expect(toolset.tools.every((tool) => tool.strict === true)).toBe(true);
    expect(toolset.tools.every((tool) => /^[a-zA-Z0-9_-]{1,64}$/.test(tool.name))).toBe(true);
    expect(toolset.toolNameMap.providerNameToCapabilityId("aicf_support_ticket_get")).toBe("support.ticket.get");
    expect(toolset.toolNameMap.toProviderToolName("support.refund.commit_case")).toBeUndefined();
  });

  it("uses stable Anthropic-safe truncation and reports collisions", async () => {
    const registry = await loadSupportRegistry();
    const longName = toProviderToolName("support.very.long.capability.identifier.with.many.segments.for.anthropic.runtime", {
      provider: "anthropic"
    });
    const first = cloneCapability(registry, "support.ticket.get", "support.ticket.get");
    const second = cloneCapability(registry, "support.ticket.get", "support_ticket_get");
    const collisionRegistry = buildRegistry([first, second]);
    const collisionToolset = buildAnthropicTools({
      registry: collisionRegistry,
      slice: supportRuntimeSlice(["support.ticket.get", "support_ticket_get"])
    });

    expect(longName.length).toBeLessThanOrEqual(64);
    expect(longName).toMatch(/^aicf_support_very_long_capability_identifier_with_many_[a-f0-9]{8}$/);
    expect(collisionToolset.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_name_collision",
      id: "support_ticket_get"
    }));
  });

  it("parses tool_use blocks and rejects malformed blocks", async () => {
    const harness = await createAnthropicHarness();
    const toolset = buildAnthropicTools({
      registry: harness.registry,
      slice: supportRuntimeSlice(["support.ticket.get"])
    });
    const parsed = parseAnthropicToolUseBlocks(toolset, [
      mockAnthropicToolUseBlock({
        id: "toolu_ticket",
        input: { ticket_id: "TCK-100" },
        name: "aicf_support_ticket_get"
      })
    ]);
    const malformed = parseAnthropicToolUseBlocks(toolset, [{
      input: "not-object",
      name: "",
      type: "tool_use"
    }]);

    expect(parsed.valid).toBe(true);
    expect(parsed.parsed[0]).toMatchObject({
      callId: "toolu_ticket",
      capabilityId: "support.ticket.get",
      providerToolName: "aicf_support_ticket_get"
    });
    expect(malformed.valid).toBe(false);
    expect(malformed.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_call_id_missing"
    }));
  });

  it("builds Claude tool_result messages with result blocks first", async () => {
    const harness = await createAnthropicHarness();
    const map = createProviderToolNameMap({
      capabilities: harness.registry,
      provider: "anthropic"
    });
    const client = new MockAnthropicMessagesClient([
      mockAnthropicToolUseResponse({
        id: "toolu_ticket",
        input: { ticket_id: "TCK-100" },
        name: map.toProviderToolName("support.ticket.get") ?? ""
      }),
      mockAnthropicTextResponse("Done.")
    ]);
    const result = await runAnthropicMessages({
      ...harness.runRequest,
      client
    });
    const toolResultMessage = client.requests[1]?.messages as Array<{ content: unknown; role: string }>;
    const content = toolResultMessage[toolResultMessage.length - 1]?.content as Array<{ tool_use_id?: string; type?: string }>;

    expect(result.status).toBe("completed");
    expect(content[0]).toMatchObject({
      tool_use_id: "toolu_ticket",
      type: "tool_result"
    });
  });
});

describe("Anthropic Claude Messages runtime", () => {
  it("returns final text when Claude makes no tool calls", async () => {
    const harness = await createAnthropicHarness();
    const client = new MockAnthropicMessagesClient([
      mockAnthropicTextResponse("Ticket TCK-100 is open.")
    ]);

    const result = await runAnthropicMessages({
      ...harness.runRequest,
      client
    });

    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("Ticket TCK-100 is open.");
    expect(result.toolResults).toEqual([]);
    expect(client.requests[0]?.tools).toEqual(expect.any(Array));
  });

  it("executes one read tool call and continues with model-safe tool_result content", async () => {
    const harness = await createAnthropicHarness();
    const client = new MockAnthropicMessagesClient([
      mockAnthropicToolUseResponse({
        id: "toolu_ticket",
        input: { ticket_id: "TCK-100" },
        name: "aicf_support_ticket_get"
      }),
      mockAnthropicTextResponse("Ticket TCK-100 is open.")
    ]);

    const result = await runAnthropicMessages({
      ...harness.runRequest,
      client
    });
    const sentMessages = client.requests[1]?.messages as Array<{ content: unknown; role: string }>;
    const toolResultMessage = sentMessages[sentMessages.length - 1] as { content: Array<{ content: string; is_error?: true; tool_use_id: string; type: string }> };
    const envelope = JSON.parse(toolResultMessage.content[0]?.content ?? "{}") as { capabilityId?: string; diagnostics?: unknown; status?: string };

    expect(result.status).toBe("completed");
    expect(result.toolResults[0]?.status).toBe("success");
    expect(result.toolCalls[0]?.callId).toBe("toolu_ticket");
    expect(toolResultMessage.content[0]).toMatchObject({
      tool_use_id: "toolu_ticket",
      type: "tool_result"
    });
    expect(toolResultMessage.content[0]?.is_error).toBeUndefined();
    expect(envelope.status).toBe("success");
    expect(envelope.capabilityId).toBe("support.ticket.get");
    expect(envelope.diagnostics).toBeUndefined();
  });

  it("executes approval-required prepare without treating it as a commit failure", async () => {
    const harness = await createAnthropicHarness();
    const client = new MockAnthropicMessagesClient([
      mockAnthropicToolUseResponse({
        id: "toolu_refund",
        input: {
          order_id: "ORD-100",
          reason_code: "customer_request",
          requested_amount: 750,
          ticket_id: "TCK-100"
        },
        name: "aicf_support_refund_prepare_case"
      }),
      mockAnthropicTextResponse("Refund preparation requires approval.")
    ]);

    const result = await runAnthropicMessages({
      ...harness.runRequest,
      client
    });
    const sentMessages = client.requests[1]?.messages as Array<{ content: unknown; role: string }>;
    const toolResultMessage = sentMessages[sentMessages.length - 1] as { content: Array<{ content: string; is_error?: true }> };
    const envelope = JSON.parse(toolResultMessage.content[0]?.content ?? "{}") as {
      action?: { approvalRequired?: boolean };
      status?: string;
    };

    expect(result.status).toBe("completed");
    expect(result.toolResults[0]?.status).toBe("approval_required");
    expect(toolResultMessage.content[0]?.is_error).toBeUndefined();
    expect(envelope.status).toBe("approval_required");
    expect(envelope.action?.approvalRequired).toBe(true);
  });

  it("returns error tool_result blocks for invalid arguments and denied policy", async () => {
    const invalidHarness = await createAnthropicHarness();
    const invalidClient = new MockAnthropicMessagesClient([
      mockAnthropicToolUseResponse({
        id: "toolu_invalid",
        input: { ticket_id: "not-valid" },
        name: "aicf_support_ticket_get"
      }),
      mockAnthropicTextResponse("The input was invalid.")
    ]);
    const deniedHarness = await createAnthropicHarness({
      permissions: [],
      subjectUserId: "user_example_no_permissions"
    });
    const deniedClient = new MockAnthropicMessagesClient([
      mockAnthropicToolUseResponse({
        id: "toolu_denied",
        input: { ticket_id: "TCK-100" },
        name: "aicf_support_ticket_get"
      }),
      mockAnthropicTextResponse("Access was denied.")
    ]);

    const invalid = await runAnthropicMessages({
      ...invalidHarness.runRequest,
      client: invalidClient
    });
    const denied = await runAnthropicMessages({
      ...deniedHarness.runRequest,
      client: deniedClient
    });
    const invalidSent = invalidClient.requests[1]?.messages as Array<{ content: unknown }>;
    const invalidResult = invalidSent[invalidSent.length - 1] as { content: Array<{ is_error?: true }> };
    const deniedSent = deniedClient.requests[1]?.messages as Array<{ content: unknown }>;
    const deniedResult = deniedSent[deniedSent.length - 1] as { content: Array<{ is_error?: true }> };

    expect(invalid.toolResults[0]?.status).toBe("validation_error");
    expect(invalidResult.content[0]?.is_error).toBe(true);
    expect(denied.toolResults[0]?.status).toBe("denied");
    expect(deniedResult.content[0]?.is_error).toBe(true);
  });

  it("fails safely for missing handlers, provider errors, max iterations, and max tool calls", async () => {
    const missingHandlerHarness = await createAnthropicHarness({ registerReadHandler: false });
    const missingHandlerClient = new MockAnthropicMessagesClient([
      mockAnthropicToolUseResponse({
        id: "toolu_missing_handler",
        input: { ticket_id: "TCK-100" },
        name: "aicf_support_ticket_get"
      }),
      mockAnthropicTextResponse("Handler was unavailable.")
    ]);
    const providerErrorHarness = await createAnthropicHarness();
    const providerErrorClient = new MockAnthropicMessagesClient([
      new Error("raw provider payload with secret token")
    ]);
    const iterationHarness = await createAnthropicHarness();
    const iterationClient = new MockAnthropicMessagesClient([
      mockAnthropicToolUseResponse({
        id: "toolu_repeat",
        input: { ticket_id: "TCK-100" },
        name: "aicf_support_ticket_get"
      })
    ]);
    const toolLimitHarness = await createAnthropicHarness();
    const toolLimitClient = new MockAnthropicMessagesClient([
      mockAnthropicToolUseResponse({
        id: "toolu_limit",
        input: { ticket_id: "TCK-100" },
        name: "aicf_support_ticket_get"
      })
    ]);

    const missingHandler = await runAnthropicMessages({
      ...missingHandlerHarness.runRequest,
      client: missingHandlerClient
    });
    const providerError = await runAnthropicMessages({
      ...providerErrorHarness.runRequest,
      client: providerErrorClient
    });
    const maxIterations = await runAnthropicMessages({
      ...iterationHarness.runRequest,
      client: iterationClient,
      maxToolIterations: 1
    });
    const maxToolCalls = await runAnthropicMessages({
      ...toolLimitHarness.runRequest,
      client: toolLimitClient,
      maxToolCalls: 0
    });

    expect(missingHandler.toolResults[0]?.status).toBe("unavailable");
    expect(providerError.status).toBe("provider_error");
    expect(JSON.stringify(providerError)).not.toContain("secret token");
    expect(maxIterations.status).toBe("turn_limit_exceeded");
    expect(maxToolCalls.status).toBe("tool_limit_exceeded");
  });

  it("fails safely when a tool_use block is missing an id", async () => {
    const harness = await createAnthropicHarness();
    const client = new MockAnthropicMessagesClient([
      {
        content: [{
          input: { ticket_id: "TCK-100" },
          name: "aicf_support_ticket_get",
          type: "tool_use"
        }],
        id: "msg_missing_tool_id",
        stop_reason: "tool_use"
      }
    ]);

    const result = await runAnthropicMessages({
      ...harness.runRequest,
      client
    });

    expect(result.status).toBe("failed");
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "provider_tool_call_id_missing"
    }));
    expect(client.requests).toHaveLength(1);
  });

  it("keeps provider payloads out of trace events and import boundaries clean", async () => {
    const harness = await createAnthropicHarness();
    const client = new MockAnthropicMessagesClient([
      mockAnthropicTextResponse("No tool needed.")
    ]);

    const result = await runAnthropicMessages({
      ...harness.runRequest,
      client
    });
    const root = await import("../../../../dist/index.js") as Record<string, unknown>;
    const runtime = await import("../../../../dist/runtime/index.js") as Record<string, unknown>;
    const providers = await import("../../../../dist/providers/index.js") as Record<string, unknown>;
    const anthropic = await import("../../../../dist/providers/anthropic/index.js") as Record<string, unknown>;

    expect(JSON.stringify(result.traceEvents)).not.toContain("No tool needed.");
    expect(root.loadManifests).toEqual(expect.any(Function));
    expect(runtime.DefaultCapabilityRouter).toEqual(expect.any(Function));
    expect(providers.createProviderToolNameMap).toEqual(expect.any(Function));
    expect(anthropic.runAnthropicMessages).toEqual(expect.any(Function));
    for (const file of ["dist/index.js", "dist/runtime/index.js", "dist/providers/index.js"]) {
      const content = await readFile(file, "utf8");
      expect(content).not.toContain("@anthropic-ai/sdk");
    }
  });

  it("wraps compatible clients and throws actionable missing optional dependency errors", async () => {
    const client = new MockAnthropicMessagesClient([]);
    expect(createAnthropicClientFromSdk(client)).toBe(client);
    expect(() => createAnthropicClientFromSdk({})).toThrow(AicfProviderError);
    await expect(createDefaultAnthropicMessagesClient()).rejects.toMatchObject({
      code: "provider_dependency_missing",
      provider: "anthropic"
    });
  });

  it("formats tool_result messages directly from provider results", async () => {
    const harness = await createAnthropicHarness();
    const client = new MockAnthropicMessagesClient([
      mockAnthropicToolUseResponse({
        id: "toolu_ticket",
        input: { ticket_id: "TCK-100" },
        name: "aicf_support_ticket_get"
      }),
      mockAnthropicTextResponse("Done.")
    ]);
    const result = await runAnthropicMessages({
      ...harness.runRequest,
      client
    });
    const toolset = buildAnthropicTools({
      registry: harness.registry,
      slice: supportRuntimeSlice(["support.ticket.get"])
    });
    const parsed = parseAnthropicToolUseBlocks(toolset, [
      mockAnthropicToolUseBlock({
        id: "toolu_ticket",
        input: { ticket_id: "TCK-100" },
        name: "aicf_support_ticket_get"
      })
    ]);

    expect(parsed.parsed[0]).toBeDefined();
    const message = buildAnthropicToolResultMessage([{
      callId: "toolu_ticket",
      capabilityId: "support.ticket.get",
      envelope: result.toolResults[0] ?? (() => { throw new Error("missing envelope"); })(),
      isError: false,
      output: JSON.stringify(result.toolResults[0]),
      provider: "anthropic",
      providerToolName: "aicf_support_ticket_get"
    }]);

    expect(message.role).toBe("user");
    expect(message.content[0]).toMatchObject({
      tool_use_id: "toolu_ticket",
      type: "tool_result"
    });
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

async function createAnthropicHarness(options: {
  permissions?: string[];
  registerReadHandler?: boolean;
  subjectUserId?: string;
} = {}): Promise<{
  builtContext: AicfBuiltContext;
  registry: ManifestRegistry;
  runRequest: Omit<Parameters<typeof runAnthropicMessages>[0], "client">;
  runtimeContext: AicfRuntimeContext;
}> {
  const registry = await loadSupportRegistry();
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
    builtContext,
    registry,
    runRequest: {
      builtContext,
      executor,
      messages: [{
        content: "Read ticket TCK-100 and prepare a refund case if appropriate.",
        role: "user"
      }],
      model: "claude-sonnet-4-5",
      registry,
      runtimeContext,
      slice: supportRuntimeSlice(["support.ticket.get", "support.refund.prepare_case"])
    },
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
