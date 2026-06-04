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
  aicfProviderIds,
  aicfProviderMetadata,
  buildProviderToolDescriptor,
  createMockProviderToolCall,
  createProviderToolNameMap,
  executeProviderToolCall,
  loadOptionalProviderDependency,
  normalizeProviderToolSchema,
  parseProviderToolCall,
  toProviderToolName
} from "../../../providers/index.js";
import type { JsonObject } from "../../../types.js";

describe("shared provider metadata and import boundary", () => {
  it("exports provider metadata and built providers subpath APIs", async () => {
    const providers = await import("../../../../dist/providers/index.js") as Record<string, unknown>;

    expect(aicfProviderIds).toEqual([
      "anthropic",
      "gemini",
      "langchain",
      "mcp",
      "openai",
      "semantic-kernel",
      "vercel-ai-sdk"
    ]);
    expect(aicfProviderMetadata.anthropic.toolNamePattern.test("aicf_support_ticket_get")).toBe(true);
    expect(providers.createProviderToolNameMap).toEqual(expect.any(Function));
    expect(providers.executeProviderToolCall).toEqual(expect.any(Function));
  });

  it("keeps provider SDK imports out of root and runtime built subpaths", async () => {
    for (const file of [
      "dist/index.js",
      "dist/runtime/index.js",
      "dist/providers/index.js"
    ]) {
      const content = await readFile(file, "utf8");
      for (const forbidden of [
        "@anthropic-ai/sdk",
        "@google/genai",
        "@ai-sdk/",
        "@langchain/",
        "@modelcontextprotocol/sdk",
        "@semantic-kernel/"
      ]) {
        expect(content).not.toContain(forbidden);
      }
    }
  });
});

describe("shared provider tool naming", () => {
  it("normalizes names, truncates with a stable hash, and supports reverse lookup by binding map", async () => {
    const registry = await loadSupportRegistry();
    const map = createProviderToolNameMap({
      capabilities: registry,
      provider: "gemini"
    });
    const ticketName = map.toProviderToolName("support.ticket.get");
    const longName = toProviderToolName("support.very_long_capability_name_segment_for_provider_tool_export.with_many_more_segments.and_hashing", {
      provider: "gemini"
    });
    const repeatLongName = toProviderToolName("support.very_long_capability_name_segment_for_provider_tool_export.with_many_more_segments.and_hashing", {
      provider: "gemini"
    });

    expect(ticketName).toBe("aicf_support_ticket_get");
    expect(map.providerNameToCapabilityId(ticketName ?? "")).toBe("support.ticket.get");
    expect(map.providerNameToCapabilityId("support.ticket.get")).toBeUndefined();
    expect(longName.length).toBeLessThanOrEqual(64);
    expect(longName).toBe(repeatLongName);
    expect(longName).toMatch(/^aicf_support_very_long_capability_name_segment_for_prov_[a-f0-9]{8}$/);
  });

  it("reports deterministic collisions rather than guessing reverse mappings", async () => {
    const registry = await loadSupportRegistry();
    const first = cloneCapability(registry, "support.ticket.get", "support.ticket.get");
    const second = cloneCapability(registry, "support.ticket.get", "support-ticket-get");
    const map = createProviderToolNameMap({
      capabilities: [first, second],
      provider: "gemini"
    });

    expect(map.bindings).toHaveLength(1);
    expect(map.providerNameToCapabilityId("aicf_support_ticket_get")).toBe("support.ticket.get");
    expect(map.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_name_collision",
      id: "support-ticket-get"
    }));
  });
});

describe("shared provider schema and call helpers", () => {
  it("normalizes object schemas without mutating the source", () => {
    const source = {
      additionalProperties: false,
      properties: {
        ticket_id: {
          type: "string"
        }
      },
      required: ["ticket_id"],
      type: "object"
    } satisfies JsonObject;
    const before = JSON.stringify(source);
    const result = normalizeProviderToolSchema(source);

    expect(result.valid).toBe(true);
    expect(result.normalizedSchema).toEqual(source);
    expect(JSON.stringify(source)).toBe(before);
    if (result.normalizedSchema?.properties && typeof result.normalizedSchema.properties === "object" && !Array.isArray(result.normalizedSchema.properties)) {
      (result.normalizedSchema.properties as Record<string, unknown>).ticket_id = { type: "number" };
    }
    expect(source.properties.ticket_id).toEqual({ type: "string" });
  });

  it("rejects non-object roots and unsupported schema features", () => {
    const nonObject = normalizeProviderToolSchema({
      type: "string"
    });
    const unsupported = normalizeProviderToolSchema({
      oneOf: [{ type: "object" }],
      type: "object"
    });

    expect(nonObject.valid).toBe(false);
    expect(nonObject.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_schema_unsupported"
    }));
    expect(unsupported.valid).toBe(false);
    expect(unsupported.diagnostics).toContainEqual(expect.objectContaining({
      details: { keyword: "oneOf" }
    }));
  });

  it("parses provider calls through the generated binding map and preserves safe refs", async () => {
    const registry = await loadSupportRegistry();
    const map = createProviderToolNameMap({
      capabilities: registry,
      provider: "anthropic"
    });
    const toolName = map.toProviderToolName("support.ticket.get") ?? "";
    const parsed = parseProviderToolCall({
      args: { ticket_id: "TCK-100" },
      callId: "toolu_1",
      provider: "anthropic",
      providerToolName: toolName,
      rawProviderRef: {
        id: "toolu_1",
        type: "tool_use"
      },
      requireCallId: true,
      toolNameMap: map
    });
    const missingCallId = parseProviderToolCall({
      args: {},
      provider: "anthropic",
      providerToolName: toolName,
      requireCallId: true,
      toolNameMap: map
    });

    expect(parsed.valid).toBe(true);
    expect(parsed.parsed).toMatchObject({
      callId: "toolu_1",
      capabilityId: "support.ticket.get",
      rawProviderRef: {
        id: "toolu_1",
        type: "tool_use"
      }
    });
    expect(missingCallId.valid).toBe(false);
    expect(missingCallId.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_call_id_missing"
    }));
  });

  it("builds provider-neutral descriptors from bindings and normalized schemas", async () => {
    const registry = await loadSupportRegistry();
    const capability = mustCapability(registry, "support.ticket.get");
    const map = createProviderToolNameMap({
      capabilities: registry,
      provider: "openai"
    });
    const binding = map.bindingByCapabilityId.get("support.ticket.get");
    if (!binding) {
      throw new Error("Expected provider binding.");
    }

    const schema = normalizeProviderToolSchema(capability.manifest.input_schema);
    if (!schema.normalizedSchema) {
      throw new Error("Expected normalized schema.");
    }
    const descriptor = buildProviderToolDescriptor({
      binding,
      loadedCapability: capability,
      normalizedInputSchema: schema.normalizedSchema
    });

    expect(descriptor).toMatchObject({
      capabilityId: "support.ticket.get",
      metadata: {
        capabilityType: "read_data",
        restricted: false,
        riskTier: "low"
      },
      provider: "openai",
      providerToolName: "aicf_support_ticket_get"
    });
    expect(descriptor.description).toContain("low");
  });
});

describe("shared provider execution helper", () => {
  it("executes allowed read and prepare calls through AICF runtime envelopes", async () => {
    const harness = await createProviderHarness();
    const map = createProviderToolNameMap({
      capabilities: harness.registry,
      provider: "openai"
    });
    const read = await executeProviderToolCall({
      builtContext: harness.builtContext,
      executor: harness.executor,
      providerCall: createMockProviderToolCall({
        args: { ticket_id: "TCK-100" },
        capabilityId: "support.ticket.get",
        providerToolName: map.toProviderToolName("support.ticket.get") ?? ""
      }),
      registry: harness.registry,
      runtimeContext: harness.runtimeContext,
      runtimeSlice: supportRuntimeSlice(["support.ticket.get", "support.refund.prepare_case"]),
      toolNameMap: map
    });
    const prepare = await executeProviderToolCall({
      builtContext: harness.builtContext,
      executor: harness.executor,
      providerCall: createMockProviderToolCall({
        args: {
          order_id: "ORD-100",
          reason_code: "customer_request",
          requested_amount: 750,
          ticket_id: "TCK-100"
        },
        capabilityId: "support.refund.prepare_case",
        providerToolName: map.toProviderToolName("support.refund.prepare_case") ?? ""
      }),
      registry: harness.registry,
      runtimeContext: harness.runtimeContext,
      runtimeSlice: supportRuntimeSlice(["support.ticket.get", "support.refund.prepare_case"]),
      toolNameMap: map
    });

    expect(read.envelope.status).toBe("success");
    expect(read.output).toContain("\"schemaVersion\":\"1.0\"");
    expect(prepare.envelope.status).toBe("approval_required");
    expect(prepare.envelope.action?.preparedActionId).toEqual(expect.any(String));
    expect(prepare.isError).toBe(false);
  });

  it("fails closed for unknown tools, invalid args, tools outside the slice, and commit capabilities", async () => {
    const harness = await createProviderHarness();
    const map = createProviderToolNameMap({
      capabilities: harness.registry,
      provider: "openai"
    });
    const unknown = await executeProviderToolCall({
      builtContext: harness.builtContext,
      executor: harness.executor,
      providerCall: createMockProviderToolCall({
        capabilityId: "missing",
        providerToolName: "aicf_missing_tool"
      }),
      registry: harness.registry,
      runtimeContext: harness.runtimeContext,
      toolNameMap: map
    });
    const invalidArgs = await executeProviderToolCall({
      builtContext: harness.builtContext,
      executor: harness.executor,
      providerCall: createMockProviderToolCall({
        args: { ticket_id: "not-valid" },
        capabilityId: "support.ticket.get",
        providerToolName: map.toProviderToolName("support.ticket.get") ?? ""
      }),
      registry: harness.registry,
      runtimeContext: harness.runtimeContext,
      runtimeSlice: supportRuntimeSlice(["support.ticket.get"]),
      toolNameMap: map
    });
    const outsideSlice = await executeProviderToolCall({
      builtContext: harness.builtContext,
      executor: harness.executor,
      providerCall: createMockProviderToolCall({
        args: {
          order_id: "ORD-100",
          reason_code: "customer_request",
          ticket_id: "TCK-100"
        },
        capabilityId: "support.refund.prepare_case",
        providerToolName: map.toProviderToolName("support.refund.prepare_case") ?? ""
      }),
      registry: harness.registry,
      runtimeContext: harness.runtimeContext,
      runtimeSlice: supportRuntimeSlice(["support.ticket.get"]),
      toolNameMap: map
    });
    const commit = await executeProviderToolCall({
      builtContext: harness.builtContext,
      executor: harness.executor,
      providerCall: createMockProviderToolCall({
        args: {
          approval_id: "approval_1",
          prepared_action_id: "prepared_1"
        },
        capabilityId: "support.refund.commit_case",
        providerToolName: map.toProviderToolName("support.refund.commit_case") ?? ""
      }),
      registry: harness.registry,
      runtimeContext: harness.commitRuntimeContext,
      runtimeSlice: supportRuntimeSlice(["support.refund.commit_case"]),
      toolNameMap: map
    });

    expect(unknown.envelope.status).toBe("unavailable");
    expect(unknown.isError).toBe(true);
    expect(invalidArgs.envelope.status).toBe("validation_error");
    expect(outsideSlice.envelope.status).toBe("denied");
    expect(commit.envelope.status).toBe("denied");
    expect(commit.envelope.operation).toBe("commit");
  });
});

describe("shared optional provider dependency helper", () => {
  it("throws an actionable safe provider error when an optional dependency is missing", async () => {
    await expect(loadOptionalProviderDependency({
      dependencyName: "@aicf/missing-provider-test-dependency",
      provider: "anthropic"
    })).rejects.toMatchObject({
      code: "provider_dependency_missing",
      provider: "anthropic",
      safeMessage: expect.stringContaining("@aicf/missing-provider-test-dependency")
    });

    try {
      await loadOptionalProviderDependency({
        dependencyName: "@aicf/missing-provider-test-dependency",
        provider: "anthropic"
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AicfProviderError);
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

async function createProviderHarness(): Promise<{
  builtContext: AicfBuiltContext;
  commitRuntimeContext: AicfRuntimeContext;
  executor: AicfToolExecutor;
  registry: ManifestRegistry;
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
    workflow: {
      currentEntityId: "TCK-100",
      currentEntityType: "ticket",
      workflowType: "support"
    }
  });
  const commitRuntimeContext = await buildRuntimeContext({
    adapter: new StaticAuthPlatformAdapter({
      account: {
        accountId: "acct_example_support",
        tenantId: "tenant_example_support"
      },
      subject: {
        actorType: "operator",
        permissions: ["refund.case.commit"],
        roles: ["support_operator"],
        userId: "operator_example_support"
      }
    }),
    autonomy: {
      allowExternalMessages: false,
      allowMoneyMovement: true,
      allowPermissionChanges: false,
      allowSideEffects: true,
      autonomyTier: "A0",
      maxRiskTier: "high"
    },
    environment: "test",
    facts: {
      "refund.approval_missing_or_invalid": false
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
    commitRuntimeContext,
    executor,
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
