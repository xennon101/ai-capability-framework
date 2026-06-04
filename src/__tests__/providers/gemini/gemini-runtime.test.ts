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
  buildGeminiFunctionDeclarations,
  buildGeminiFunctionResponseParts,
  createDefaultGeminiClient,
  createGeminiClientFromSdk,
  extractGeminiFunctionCalls,
  MockGeminiClient,
  mockGeminiCandidateFunctionCallResponse,
  mockGeminiFunctionCall,
  mockGeminiFunctionCallResponse,
  mockGeminiTextResponse,
  parseGeminiFunctionCalls,
  runGeminiGenerateContent
} from "../../../providers/gemini/index.js";

describe("Gemini provider runtime declarations", () => {
  it("builds valid function declarations and excludes commit capabilities", async () => {
    const harness = await createGeminiHarness();
    const declarations = buildGeminiFunctionDeclarations({
      registry: harness.registry,
      slice: supportRuntimeSlice(["support.ticket.get", "support.refund.prepare_case", "support.refund.commit_case"])
    });

    expect(declarations.diagnostics).toEqual([]);
    expect(declarations.functionDeclarations.map((declaration) => declaration.name)).toEqual([
      "aicf_support_ticket_get",
      "aicf_support_refund_prepare_case"
    ]);
    expect(declarations.functionDeclarations.every((declaration) => /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(declaration.name))).toBe(true);
    expect(declarations.toolNameMap.providerNameToCapabilityId("aicf_support_ticket_get")).toBe("support.ticket.get");
    expect(declarations.toolNameMap.toProviderToolName("support.refund.commit_case")).toBeUndefined();
  });

  it("uses stable Gemini-safe truncation and reports collisions", async () => {
    const registry = await loadSupportRegistry();
    const longName = toProviderToolName("support.very.long.capability.identifier.with.many.segments.for.gemini.runtime", {
      provider: "gemini"
    });
    const first = cloneCapability(registry, "support.ticket.get", "support.ticket.get");
    const second = cloneCapability(registry, "support.ticket.get", "support-ticket-get");
    const collisionRegistry = buildRegistry([first, second]);
    const collisionDeclarations = buildGeminiFunctionDeclarations({
      registry: collisionRegistry,
      slice: supportRuntimeSlice(["support.ticket.get", "support-ticket-get"])
    });

    expect(longName.length).toBeLessThanOrEqual(64);
    expect(longName).toMatch(/^aicf_support_very_long_capability_identifier_with_many_[a-f0-9]{8}$/);
    expect(collisionDeclarations.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_name_collision",
      id: "support-ticket-get"
    }));
  });

  it("reports schema subset diagnostics and rejects non-object callable schemas", async () => {
    const registry = await loadSupportRegistry();
    const nonObject = cloneCapability(registry, "support.ticket.get", "support.ticket.non_object_schema", {
      input_schema: { type: "string" }
    });
    const unsupported = cloneCapability(registry, "support.ticket.get", "support.ticket.unsupported_schema", {
      input_schema: {
        additionalProperties: false,
        oneOf: [{ required: ["ticket_id"] }],
        properties: {
          ticket_id: { type: "string" }
        },
        type: "object"
      }
    });
    const schemaRegistry = buildRegistry([nonObject, unsupported]);
    const declarations = buildGeminiFunctionDeclarations({
      registry: schemaRegistry,
      slice: supportRuntimeSlice(["support.ticket.non_object_schema", "support.ticket.unsupported_schema"])
    });

    expect(declarations.functionDeclarations).toEqual([]);
    expect(declarations.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "provider_schema_unsupported",
        path: expect.stringContaining("non_object_schema")
      }),
      expect.objectContaining({
        code: "provider_schema_unsupported",
        details: { keyword: "oneOf" }
      })
    ]));
  });

  it("parses top-level and candidate function calls", async () => {
    const harness = await createGeminiHarness();
    const declarations = buildGeminiFunctionDeclarations({
      registry: harness.registry,
      slice: supportRuntimeSlice(["support.ticket.get"])
    });
    const topLevelCalls = extractGeminiFunctionCalls(mockGeminiFunctionCallResponse({
      args: { ticket_id: "TCK-100" },
      id: "func_ticket",
      name: "aicf_support_ticket_get"
    }));
    const candidateCalls = extractGeminiFunctionCalls(mockGeminiCandidateFunctionCallResponse({
      args: { ticket_id: "TCK-100" },
      id: "func_candidate",
      name: "aicf_support_ticket_get"
    }));
    const parsed = parseGeminiFunctionCalls(declarations, topLevelCalls);
    const parsedCandidate = parseGeminiFunctionCalls(declarations, candidateCalls);
    const malformed = parseGeminiFunctionCalls(declarations, [{
      args: "not-object",
      name: ""
    }]);

    expect(parsed.valid).toBe(true);
    expect(parsed.parsed[0]).toMatchObject({
      callId: "func_ticket",
      capabilityId: "support.ticket.get",
      providerToolName: "aicf_support_ticket_get"
    });
    expect(parsedCandidate.valid).toBe(true);
    expect(parsedCandidate.parsed[0]?.callId).toBe("func_candidate");
    expect(malformed.valid).toBe(false);
    expect(malformed.diagnostics).toContainEqual(expect.objectContaining({
      code: "provider_tool_call_parse_failed",
      path: "functionCalls/0/name"
    }));
  });

  it("formats Gemini functionResponse parts with preserved ids and model-safe envelopes", async () => {
    const harness = await createGeminiHarness();
    const client = new MockGeminiClient([
      mockGeminiFunctionCallResponse({
        args: { ticket_id: "TCK-100" },
        id: "func_ticket",
        name: "aicf_support_ticket_get"
      }),
      mockGeminiTextResponse("Done.")
    ]);
    const result = await runGeminiGenerateContent({
      ...harness.runRequest,
      client
    });
    const parts = buildGeminiFunctionResponseParts([{
      callId: "func_ticket",
      capabilityId: "support.ticket.get",
      envelope: result.toolResults[0] ?? (() => { throw new Error("missing envelope"); })(),
      isError: false,
      output: JSON.stringify(result.toolResults[0]),
      provider: "gemini",
      providerToolName: "aicf_support_ticket_get"
    }]);

    expect(parts[0]).toMatchObject({
      functionResponse: {
        id: "func_ticket",
        name: "aicf_support_ticket_get",
        response: {
          result: {
            capabilityId: "support.ticket.get",
            status: "success"
          }
        }
      }
    });
  });
});

describe("Gemini GenerateContent runtime", () => {
  it("returns final text when Gemini makes no function calls", async () => {
    const harness = await createGeminiHarness();
    const client = new MockGeminiClient([
      mockGeminiTextResponse("Ticket TCK-100 is open.")
    ]);

    const result = await runGeminiGenerateContent({
      ...harness.runRequest,
      client
    });

    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("Ticket TCK-100 is open.");
    expect(result.toolResults).toEqual([]);
    expect((client.requests[0]?.config as { tools?: unknown[] }).tools).toEqual(expect.any(Array));
  });

  it("executes one read function call and continues with model-safe functionResponse content", async () => {
    const harness = await createGeminiHarness();
    const client = new MockGeminiClient([
      mockGeminiFunctionCallResponse({
        args: { ticket_id: "TCK-100" },
        id: "func_ticket",
        name: "aicf_support_ticket_get"
      }),
      mockGeminiTextResponse("Ticket TCK-100 is open.")
    ]);

    const result = await runGeminiGenerateContent({
      ...harness.runRequest,
      client
    });
    const sentContents = client.requests[1]?.contents as Array<{ parts: Array<{ functionResponse?: { id?: string; response?: { result?: { diagnostics?: unknown; status?: string } } } }>; role: string }>;
    const responsePart = sentContents[sentContents.length - 1]?.parts[0];

    expect(result.status).toBe("completed");
    expect(result.toolResults[0]?.status).toBe("success");
    expect(result.toolCalls[0]?.callId).toBe("func_ticket");
    expect(responsePart?.functionResponse).toMatchObject({
      id: "func_ticket",
      name: "aicf_support_ticket_get",
      response: {
        result: {
          capabilityId: "support.ticket.get",
          status: "success"
        }
      }
    });
    expect(responsePart?.functionResponse?.response?.result?.diagnostics).toBeUndefined();
  });

  it("executes approval-required prepare without treating it as a commit failure", async () => {
    const harness = await createGeminiHarness();
    const client = new MockGeminiClient([
      mockGeminiFunctionCallResponse({
        args: {
          order_id: "ORD-100",
          reason_code: "customer_request",
          requested_amount: 750,
          ticket_id: "TCK-100"
        },
        id: "func_refund",
        name: "aicf_support_refund_prepare_case"
      }),
      mockGeminiTextResponse("Refund preparation requires approval.")
    ]);

    const result = await runGeminiGenerateContent({
      ...harness.runRequest,
      client
    });
    const sentContents = client.requests[1]?.contents as Array<{ parts: Array<{ functionResponse?: { response?: { result?: { action?: { approvalRequired?: boolean }; status?: string } } } }>; role: string }>;
    const envelope = sentContents[sentContents.length - 1]?.parts[0]?.functionResponse?.response?.result;

    expect(result.status).toBe("completed");
    expect(result.toolResults[0]?.status).toBe("approval_required");
    expect(envelope?.status).toBe("approval_required");
    expect(envelope?.action?.approvalRequired).toBe(true);
  });

  it("returns safe functionResponse envelopes for invalid arguments and denied policy", async () => {
    const invalidHarness = await createGeminiHarness();
    const invalidClient = new MockGeminiClient([
      mockGeminiFunctionCallResponse({
        args: { ticket_id: "not-valid" },
        id: "func_invalid",
        name: "aicf_support_ticket_get"
      }),
      mockGeminiTextResponse("The input was invalid.")
    ]);
    const deniedHarness = await createGeminiHarness({
      permissions: [],
      subjectUserId: "user_example_no_permissions"
    });
    const deniedClient = new MockGeminiClient([
      mockGeminiFunctionCallResponse({
        args: { ticket_id: "TCK-100" },
        id: "func_denied",
        name: "aicf_support_ticket_get"
      }),
      mockGeminiTextResponse("Access was denied.")
    ]);

    const invalid = await runGeminiGenerateContent({
      ...invalidHarness.runRequest,
      client: invalidClient
    });
    const denied = await runGeminiGenerateContent({
      ...deniedHarness.runRequest,
      client: deniedClient
    });
    const invalidContents = invalidClient.requests[1]?.contents as Array<{ parts: Array<{ functionResponse?: { response?: { result?: { status?: string } } } }> }>;
    const deniedContents = deniedClient.requests[1]?.contents as Array<{ parts: Array<{ functionResponse?: { response?: { result?: { status?: string } } } }> }>;

    expect(invalid.toolResults[0]?.status).toBe("validation_error");
    expect(invalidContents.at(-1)?.parts[0]?.functionResponse?.response?.result?.status).toBe("validation_error");
    expect(denied.toolResults[0]?.status).toBe("denied");
    expect(deniedContents.at(-1)?.parts[0]?.functionResponse?.response?.result?.status).toBe("denied");
  });

  it("fails safely for missing handlers, provider errors, max iterations, and max tool calls", async () => {
    const missingHandlerHarness = await createGeminiHarness({ registerReadHandler: false });
    const missingHandlerClient = new MockGeminiClient([
      mockGeminiFunctionCallResponse({
        args: { ticket_id: "TCK-100" },
        id: "func_missing_handler",
        name: "aicf_support_ticket_get"
      }),
      mockGeminiTextResponse("Handler was unavailable.")
    ]);
    const providerErrorHarness = await createGeminiHarness();
    const providerErrorClient = new MockGeminiClient([
      new Error("raw provider payload with secret token")
    ]);
    const iterationHarness = await createGeminiHarness();
    const iterationClient = new MockGeminiClient([
      mockGeminiFunctionCallResponse({
        args: { ticket_id: "TCK-100" },
        id: "func_repeat",
        name: "aicf_support_ticket_get"
      })
    ]);
    const toolLimitHarness = await createGeminiHarness();
    const toolLimitClient = new MockGeminiClient([
      mockGeminiFunctionCallResponse({
        args: { ticket_id: "TCK-100" },
        id: "func_limit",
        name: "aicf_support_ticket_get"
      })
    ]);

    const missingHandler = await runGeminiGenerateContent({
      ...missingHandlerHarness.runRequest,
      client: missingHandlerClient
    });
    const providerError = await runGeminiGenerateContent({
      ...providerErrorHarness.runRequest,
      client: providerErrorClient
    });
    const maxIterations = await runGeminiGenerateContent({
      ...iterationHarness.runRequest,
      client: iterationClient,
      maxToolIterations: 1
    });
    const maxToolCalls = await runGeminiGenerateContent({
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

  it("keeps provider payloads out of trace events and import boundaries clean", async () => {
    const harness = await createGeminiHarness();
    const client = new MockGeminiClient([
      mockGeminiTextResponse("No tool needed.")
    ]);

    const result = await runGeminiGenerateContent({
      ...harness.runRequest,
      client
    });
    const root = await import("../../../../dist/index.js") as Record<string, unknown>;
    const runtime = await import("../../../../dist/runtime/index.js") as Record<string, unknown>;
    const providers = await import("../../../../dist/providers/index.js") as Record<string, unknown>;
    const gemini = await import("../../../../dist/providers/gemini/index.js") as Record<string, unknown>;

    expect(JSON.stringify(result.traceEvents)).not.toContain("No tool needed.");
    expect(root.loadManifests).toEqual(expect.any(Function));
    expect(runtime.DefaultCapabilityRouter).toEqual(expect.any(Function));
    expect(providers.createProviderToolNameMap).toEqual(expect.any(Function));
    expect(gemini.runGeminiGenerateContent).toEqual(expect.any(Function));
    for (const file of ["dist/index.js", "dist/runtime/index.js", "dist/providers/index.js"]) {
      const content = await readFile(file, "utf8");
      expect(content).not.toContain("@google/genai");
    }
  });

  it("wraps compatible clients and throws actionable missing optional dependency errors", async () => {
    const client = new MockGeminiClient([]);
    expect(createGeminiClientFromSdk(client)).toBe(client);
    expect(() => createGeminiClientFromSdk({})).toThrow(AicfProviderError);
    await expect(createDefaultGeminiClient()).rejects.toMatchObject({
      code: "provider_dependency_missing",
      provider: "gemini"
    });
  });

  it("accepts function calls without ids and preserves ids when present", async () => {
    const harness = await createGeminiHarness();
    const declarations = buildGeminiFunctionDeclarations({
      registry: harness.registry,
      slice: supportRuntimeSlice(["support.ticket.get"])
    });
    const withoutId = parseGeminiFunctionCalls(declarations, [
      {
        args: { ticket_id: "TCK-100" },
        name: "aicf_support_ticket_get"
      }
    ]);
    const withId = parseGeminiFunctionCalls(declarations, [
      mockGeminiFunctionCall({
        args: { ticket_id: "TCK-100" },
        id: "func_ticket",
        name: "aicf_support_ticket_get"
      })
    ]);

    expect(withoutId.valid).toBe(true);
    expect(withoutId.parsed[0]?.callId).toBeUndefined();
    expect(withId.parsed[0]?.callId).toBe("func_ticket");
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

async function createGeminiHarness(options: {
  permissions?: string[];
  registerReadHandler?: boolean;
  subjectUserId?: string;
} = {}): Promise<{
  builtContext: AicfBuiltContext;
  registry: ManifestRegistry;
  runRequest: Omit<Parameters<typeof runGeminiGenerateContent>[0], "client">;
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
      contents: "Read ticket TCK-100 and prepare a refund case if appropriate.",
      executor,
      model: "gemini-3-pro-preview",
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
