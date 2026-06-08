import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  loadManifests,
  validateManifests,
  type LoadedCapabilityManifest,
  type ManifestRegistry
} from "../../index.js";
import {
  AicfActionLifecycleManager,
  AicfHandlerRegistry,
  AicfRuntimeError,
  AicfToolExecutor,
  buildRuntimeContext,
  createToolEnvelope,
  DefaultCapabilityRouter,
  DefaultContextBuilder,
  DefaultPolicyBroker,
  DefaultRedactionPolicy,
  formatCapabilitySliceForModel,
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemoryIdempotencyStore,
  InMemoryPreparedActionStore,
  runtimeErrorToEnvelopeError,
  serializeToolEnvelopeForModel,
  StaticAuthPlatformAdapter,
  toModelSafeToolEnvelope,
  validateRuntimeContext,
  type AicfCapabilityHandler,
  type AicfAuthPlatformAdapter,
  type AicfCommittedAction,
  type AicfRuntimeContext,
  type AicfRuntimeUserInput
} from "../../runtime/index.js";
import { DefaultAuditLedger } from "../../audit/index.js";
import type { AicfRuntimeLedgerRecorder, DefaultAuditLedgerOptions } from "../../audit/index.js";

const supportPermissions = ["ticket.read", "refund.case.create"];
const supportUserInput: AicfRuntimeUserInput = {
  text: "Prepare a refund for support ticket TCK-100."
};

describe("AICF runtime subpath", () => {
  it("exports runtime APIs from the built package subpath", async () => {
    const runtime = await import("../../../dist/runtime/index.js") as Record<string, unknown>;

    expect(runtime.AicfActionLifecycleManager).toEqual(expect.any(Function));
    expect(runtime.AicfHandlerRegistry).toEqual(expect.any(Function));
    expect(runtime.AicfToolExecutor).toEqual(expect.any(Function));
    expect(runtime.DefaultCapabilityRouter).toEqual(expect.any(Function));
    expect(runtime.DefaultContextBuilder).toEqual(expect.any(Function));
    expect(runtime.DefaultPolicyBroker).toEqual(expect.any(Function));
    expect(runtime.InMemoryApprovalStore).toEqual(expect.any(Function));
    expect(runtime.InMemoryAuditSink).toEqual(expect.any(Function));
    expect(runtime.InMemoryIdempotencyStore).toEqual(expect.any(Function));
    expect(runtime.InMemoryPreparedActionStore).toEqual(expect.any(Function));
    expect(runtime.createToolEnvelope).toEqual(expect.any(Function));
  });
});

describe("runtime context and redaction", () => {
  it("builds deterministic non-production context and labels user text as untrusted", async () => {
    const registry = await loadExampleRegistry();
    const runtimeContext = await buildSupportRuntimeContext();
    const builtContext = await new DefaultContextBuilder().build({
      baseContext: runtimeContext,
      registry,
      userInput: supportUserInput
    });

    expect(runtimeContext.runId).toBe("run_test_0001");
    expect(runtimeContext.requestId).toBe("req_test_0001");
    expect(builtContext.modelContextText).toContain("<untrusted_user_text>");
    expect(builtContext.modelContextText).toContain("Prepare a refund");
    expect(builtContext.items.find((item) => item.id === "user_input")?.trusted).toBe(false);
  });

  it("rejects incomplete production context safely", async () => {
    const adapter = new StaticAuthPlatformAdapter({
      account: {
        accountId: "",
        tenantId: ""
      },
      subject: {
        userId: ""
      }
    });

    await expect(buildRuntimeContext({
      adapter,
      environment: "production",
      requestId: "req_prod",
      runId: "run_prod"
    })).rejects.toMatchObject({
      code: "runtime_context_invalid",
      safeMessage: expect.any(String)
    });
  });

  it("converts auth adapter failures to safe runtime errors", async () => {
    const adapter: AicfAuthPlatformAdapter = {
      async getCapabilityPermissions() {
        return {};
      },
      async getEntitlements() {
        return [];
      },
      async resolveAccount() {
        throw new Error("database password was unavailable");
      },
      async resolveSubject() {
        return {
          actorType: "user",
          permissions: [],
          roles: [],
          userId: "user_example"
        };
      }
    };

    await expect(buildRuntimeContext({
      adapter,
      environment: "test"
    })).rejects.toMatchObject({
      code: "runtime_context_invalid",
      safeMessage: "Runtime context could not be resolved."
    });
  });

  it("redacts sensitive keyed values without pretending to scrub all PII", async () => {
    const runtimeContext = await buildSupportRuntimeContext();
    const item = {
      data: {
        apiKey: "secret_value",
        customer_email: "person@example.com",
        nested: {
          sessionToken: "token_value"
        }
      },
      id: "entity_order",
      kind: "entity" as const,
      trusted: true,
      visibleToModel: true
    };

    const result = new DefaultRedactionPolicy().redact({ item, runtimeContext });

    expect(result.item.data?.apiKey).toBe("[REDACTED]");
    expect((result.item.data?.nested as Record<string, unknown>).sessionToken).toBe("[REDACTED]");
    expect(result.item.data?.customer_email).toBe("person@example.com");
    expect(result.redactions).toHaveLength(2);
  });

  it("enforces character budgets and rejects raw attachment content", async () => {
    const registry = await loadExampleRegistry();
    const runtimeContext = await buildSupportRuntimeContext();
    const builder = new DefaultContextBuilder({
      maxCharacters: 120
    });

    const builtContext = await builder.build({
      baseContext: runtimeContext,
      registry,
      userInput: {
        text: "x".repeat(500)
      }
    });

    expect(builtContext.modelContextText.length).toBeLessThanOrEqual(120);
    expect(builtContext.warnings.some((warning) => warning.code === "context_character_limit")).toBe(true);

    await expect(builder.build({
      baseContext: runtimeContext,
      registry,
      userInput: {
        attachments: [{
          buffer: "raw bytes",
          id: "file_1",
          mediaType: "text/plain"
        } as never],
        text: "Read this file."
      }
    })).rejects.toBeInstanceOf(AicfRuntimeError);
  });
});

describe("runtime capability router", () => {
  it("filters restricted capabilities and exposes only select/prepare operations", async () => {
    const registry = await loadExampleRegistry();
    const builtContext = await buildSupportContext(registry);
    const slice = new DefaultCapabilityRouter().route({
      builtContext,
      maxRiskTier: "medium",
      registry,
      userInput: supportUserInput
    });

    expect(slice.items.map((item) => item.capabilityId)).toContain("support.refund.prepare_case");
    expect(slice.items.map((item) => item.capabilityId)).not.toContain("support.refund.commit_case");
    expect(slice.excluded).toContainEqual(expect.objectContaining({
      capabilityId: "support.refund.commit_case"
    }));
    expect(slice.items.flatMap((item) => item.exposedOperations)).not.toContain("commit");
  });

  it("respects risk, permission, include/exclude, domain, and max-count filters deterministically", async () => {
    const registry = await loadExampleRegistry();
    const builtContext = await buildSupportContext(registry);
    const router = new DefaultCapabilityRouter();
    const lowRiskSlice = router.route({
      builtContext,
      maxRiskTier: "low",
      registry,
      userInput: supportUserInput
    });
    const missingPermissionContext = await buildSupportContext(registry, {
      permissions: ["ticket.read"]
    });
    const missingPermissionSlice = router.route({
      builtContext: missingPermissionContext,
      registry,
      userInput: supportUserInput
    });
    const explicitSlice = router.route({
      allowedDomains: ["support"],
      builtContext,
      excludeCapabilityIds: ["support.ticket.get"],
      includeCapabilityIds: ["support.ticket.get", "support.refund.prepare_case"],
      maxCapabilities: 1,
      registry,
      userInput: supportUserInput
    });
    const repeatSlice = router.route({
      allowedDomains: ["support"],
      builtContext,
      excludeCapabilityIds: ["support.ticket.get"],
      includeCapabilityIds: ["support.ticket.get", "support.refund.prepare_case"],
      maxCapabilities: 1,
      registry,
      userInput: supportUserInput
    });

    expect(lowRiskSlice.items.map((item) => item.capabilityId)).toContain("support.ticket.get");
    expect(lowRiskSlice.items.map((item) => item.capabilityId)).not.toContain("support.refund.prepare_case");
    expect(missingPermissionSlice.items.map((item) => item.capabilityId)).not.toContain("support.refund.prepare_case");
    expect(explicitSlice.items).toHaveLength(1);
    expect(explicitSlice.items[0]?.capabilityId).toBe("support.refund.prepare_case");
    expect(repeatSlice.items).toEqual(explicitSlice.items);
  });

  it("excludes non-active statuses by default and formats model-facing slices safely", async () => {
    const registry = await loadExampleRegistry();
    const builtContext = await buildSupportContext(registry);
    const deprecatedRegistry = registryWithCapabilityStatus(registry, "support.ticket.get", "deprecated");
    const router = new DefaultCapabilityRouter();
    const defaultSlice = router.route({
      builtContext,
      registry: deprecatedRegistry,
      userInput: supportUserInput
    });
    const includedSlice = router.route({
      builtContext,
      includeDeprecated: true,
      registry: deprecatedRegistry,
      userInput: supportUserInput
    });
    const modelText = formatCapabilitySliceForModel({
      registry,
      slice: router.route({
        builtContext,
        registry,
        userInput: supportUserInput
      })
    });

    expect(defaultSlice.items.map((item) => item.capabilityId)).not.toContain("support.ticket.get");
    expect(includedSlice.items.map((item) => item.capabilityId)).toContain("support.ticket.get");
    expect(modelText).toContain("# Available capabilities");
    expect(modelText).toContain("support.refund.prepare_case");
    expect(modelText).not.toContain("private_diagnostics");
    expect(modelText).not.toContain("deny_if");
  });
});

describe("runtime policy broker", () => {
  it("denies missing permissions, tenant context, and risk ceiling failures", async () => {
    const registry = await loadExampleRegistry();
    const capability = mustCapability(registry, "support.refund.prepare_case");
    const broker = new DefaultPolicyBroker();
    const validArgs = refundPrepareArgs();
    const missingPermissionContext = await buildSupportRuntimeContext({
      permissions: ["ticket.read"]
    });
    const missingTenantContext = {
      ...await buildSupportRuntimeContext(),
      account: {
        accountId: "acct_example",
        tenantId: ""
      }
    } satisfies AicfRuntimeContext;
    const lowRiskContext = await buildSupportRuntimeContext({
      maxRiskTier: "low"
    });

    await expect(broker.evaluate({
      args: validArgs,
      capability,
      facts: { "refund.order_not_refundable": false },
      operation: "prepare",
      runtimeContext: missingPermissionContext
    })).resolves.toMatchObject({ status: "denied" });
    await expect(broker.evaluate({
      args: validArgs,
      capability,
      facts: { "refund.order_not_refundable": false },
      operation: "prepare",
      runtimeContext: missingTenantContext
    })).resolves.toMatchObject({ status: "denied" });
    await expect(broker.evaluate({
      args: validArgs,
      capability,
      facts: { "refund.order_not_refundable": false },
      operation: "prepare",
      runtimeContext: lowRiskContext
    })).resolves.toMatchObject({ status: "denied" });
  });

  it("surfaces approval requirements and denies rejected approval or missing idempotency", async () => {
    const registry = await loadExampleRegistry();
    const broker = new DefaultPolicyBroker();
    const prepareDecision = await broker.evaluate({
      args: {
        ...refundPrepareArgs(),
        requested_amount: 750
      },
      capability: mustCapability(registry, "support.refund.prepare_case"),
      facts: { "refund.order_not_refundable": false },
      operation: "prepare",
      runtimeContext: await buildSupportRuntimeContext({
        allowSideEffects: true,
        maxRiskTier: "medium"
      })
    });
    const rejectedApprovalDecision = await broker.evaluate({
      approval: {
        approvalId: "approval_1",
        approved: false
      },
      args: {
        approval_id: "approval_1",
        prepared_action_id: "prepared_1"
      },
      capability: mustCapability(registry, "support.refund.commit_case"),
      facts: { "refund.approval_missing_or_invalid": false },
      operation: "commit",
      runtimeContext: await buildSupportRuntimeContext({
        allowMoneyMovement: true,
        allowSideEffects: true,
        autonomyTier: "A0",
        maxRiskTier: "critical",
        permissions: ["refund.case.commit"]
      })
    });
    const missingIdempotencyDecision = await broker.evaluate({
      approval: {
        approvalId: "approval_1",
        approved: true
      },
      args: {
        approval_id: "approval_1",
        prepared_action_id: "prepared_1"
      },
      capability: mustCapability(registry, "support.refund.commit_case"),
      facts: { "refund.approval_missing_or_invalid": false },
      operation: "commit",
      runtimeContext: await buildSupportRuntimeContext({
        allowMoneyMovement: true,
        allowSideEffects: true,
        autonomyTier: "A0",
        maxRiskTier: "critical",
        permissions: ["refund.case.commit"]
      })
    });

    expect(prepareDecision.status).toBe("approval_required");
    expect(prepareDecision.requiredApprovals.length).toBeGreaterThan(0);
    expect(rejectedApprovalDecision.status).toBe("denied");
    expect(missingIdempotencyDecision.status).toBe("denied");
    expect(missingIdempotencyDecision.reasons.map((reason) => reason.code)).toContain("idempotency_required");
  });

  it("fails closed for host hooks and does not let hooks override denial", async () => {
    const registry = await loadExampleRegistry();
    const ticketCapability = mustCapability(registry, "support.ticket.get");
    const throwingBroker = new DefaultPolicyBroker({
      hostPolicyHook: () => {
        throw new Error("policy engine unavailable");
      }
    });
    const allowOverrideBroker = new DefaultPolicyBroker({
      hostPolicyHook: () => ({
        reasons: [{
          code: "host_allow",
          message: "Host would allow.",
          severity: "info",
          source: "host"
        }],
        requiredApprovals: [],
        status: "allowed"
      })
    });

    const thrown = await throwingBroker.evaluate({
      args: { ticket_id: "TCK-100" },
      capability: ticketCapability,
      operation: "prepare",
      runtimeContext: await buildSupportRuntimeContext()
    });
    const cannotOverride = await allowOverrideBroker.evaluate({
      args: { ticket_id: "TCK-100" },
      capability: ticketCapability,
      operation: "prepare",
      runtimeContext: await buildSupportRuntimeContext({
        permissions: []
      })
    });

    expect(thrown.status).toBe("denied");
    expect(thrown.reasons.map((reason) => reason.code)).toContain("host_policy_error");
    expect(cannotOverride.status).toBe("denied");
    expect(cannotOverride.reasons.map((reason) => reason.code)).toContain("missing_permission");
  });
});

describe("runtime tool envelopes", () => {
  it("serializes model-safe envelopes without diagnostics or stack traces", () => {
    const envelope = createToolEnvelope({
      capabilityId: "support.ticket.get",
      capabilityVersion: "1.0.0",
      diagnostics: {
        stack: "Error: secret\n    at internal"
      },
      errors: [{
        code: "handler_failed",
        message: "Handler failed\n    at internal stack"
      }],
      operation: "read",
      requestId: "req_test",
      runId: "run_test",
      status: "failed",
      userMessage: "The ticket could not be read."
    });
    const modelSafe = toModelSafeToolEnvelope(envelope);
    const serialized = serializeToolEnvelopeForModel(envelope);

    expect(modelSafe.diagnostics).toBeUndefined();
    expect(modelSafe.errors?.[0]?.message).toBe("Handler failed");
    expect(serialized).toContain("\"schemaVersion\":\"1.0\"");
    expect(serialized).not.toContain("internal stack");
  });

  it("keeps approval-required action references and converts runtime errors safely", () => {
    const envelope = createToolEnvelope({
      action: {
        approvalRequired: true,
        preparedActionId: "prepared_1",
        state: "approval_pending"
      },
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      policy: {
        reasons: [],
        requiredApprovals: [{
          approvalType: "user_confirmation",
          reason: "Refund requires approval."
        }],
        status: "approval_required"
      },
      requestId: "req_test",
      runId: "run_test",
      status: "approval_required",
      userMessage: "Approval is required before continuing."
    });
    const error = runtimeErrorToEnvelopeError(new AicfRuntimeError({
      code: "policy_denied",
      message: "internal policy failure",
      safeMessage: "The action is not allowed."
    }));

    expect(envelope.action?.preparedActionId).toBe("prepared_1");
    expect(error).toEqual({
      code: "policy_denied",
      message: "The action is not allowed."
    });
  });
});

describe("runtime handler registry and execution lifecycle", () => {
  it("scopes in-memory idempotency reservations by scope and key", async () => {
    const store = new InMemoryIdempotencyStore();
    const first = await store.reserve({
      expiresAt: "2099-01-01T00:00:00.000Z",
      key: "same-key",
      scope: "tenant:a|prepared:one"
    });
    const sameScopeDuplicate = await store.reserve({
      expiresAt: "2099-01-01T00:00:00.000Z",
      key: "same-key",
      scope: "tenant:a|prepared:one"
    });

    await store.complete({
      key: "same-key",
      result: { committedActionId: "commit_a" },
      scope: "tenant:a|prepared:one"
    });
    const sameScopeCompleted = await store.reserve({
      expiresAt: "2099-01-01T00:00:00.000Z",
      key: "same-key",
      scope: "tenant:a|prepared:one"
    });
    const differentScope = await store.reserve({
      expiresAt: "2099-01-01T00:00:00.000Z",
      key: "same-key",
      scope: "tenant:b|prepared:two"
    });

    expect(first).toEqual({ reserved: true });
    expect(sameScopeDuplicate).toEqual({ existing: undefined, reserved: false });
    expect(sameScopeCompleted).toEqual({ existing: { committedActionId: "commit_a" }, reserved: false });
    expect(differentScope).toEqual({ reserved: true });
  });

  it("registers, retrieves, lists, and validates handlers against a manifest registry", async () => {
    const registry = await loadExampleRegistry();
    const handlers = new AicfHandlerRegistry({ registry });
    const handler: AicfCapabilityHandler = {
      capabilityId: "support.ticket.get",
      read: () => ticketOutput()
    };

    handlers.register(handler);

    expect(handlers.get("support.ticket.get")).toBe(handler);
    expect(handlers.require("support.ticket.get")).toBe(handler);
    expect(handlers.list()).toEqual([handler]);
    expect(() => handlers.register(handler)).toThrow(AicfRuntimeError);
    expect(() => handlers.register({ capabilityId: "missing.capability.id" })).toThrow(AicfRuntimeError);
  });

  it("executes read and prepare capabilities without a model", async () => {
    const harness = await createRuntimeHarness();
    const read = await harness.executor.execute({
      args: { ticket_id: "TCK-100" },
      builtContext: harness.builtContext,
      capabilityId: "support.ticket.get",
      operation: "read",
      runtimeContext: harness.runtimeContext,
      source: "model_tool_call"
    });
    const prepare = await harness.executor.execute({
      args: refundPrepareArgs(),
      builtContext: harness.builtContext,
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      runtimeContext: harness.runtimeContext,
      source: "model_tool_call"
    });

    expect(read.status).toBe("success");
    expect(read.data).toEqual(ticketOutput());
    expect(prepare.status).toBe("prepared");
    expect(prepare.action?.preparedActionId).toEqual(expect.any(String));
    expect(await harness.preparedActionStore.get(prepare.action?.preparedActionId ?? "")).toMatchObject({
      capabilityId: "support.refund.prepare_case",
      commitCapabilityId: "support.refund.commit_case",
      state: "prepared"
    });
  });

  it("records read and prepare ledger evidence when configured", async () => {
    const ledger = new DefaultAuditLedger();
    const harness = await createRuntimeHarness({ ledger });
    const read = await harness.executor.execute({
      args: { ticket_id: "TCK-100" },
      builtContext: harness.builtContext,
      capabilityId: "support.ticket.get",
      operation: "read",
      runtimeContext: harness.runtimeContext,
      source: "model_tool_call"
    });
    const prepare = await harness.executor.execute({
      args: {
        ...refundPrepareArgs(),
        requested_amount: 750
      },
      builtContext: harness.builtContext,
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      runtimeContext: harness.runtimeContext,
      source: "model_tool_call"
    });
    const decisions = await ledger.policyDecisionStore.listDecisions();
    const actions = await ledger.actionStore.listActions();
    const approvals = await ledger.approvalStore.listApprovals();

    expect(read.status).toBe("success");
    expect(prepare.status).toBe("approval_required");
    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: "support.ticket.get", operation: "read" }),
      expect.objectContaining({ capabilityId: "support.refund.prepare_case", operation: "prepare" })
    ]));
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionState: "proposed", capabilityId: "support.ticket.get" }),
      expect.objectContaining({ actionState: "approval_required", capabilityId: "support.refund.prepare_case" })
    ]));
    expect(approvals).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: "support.refund.prepare_case", status: "pending" })
    ]));
  });

  it("creates approval-required prepared actions and denies commit without approval", async () => {
    const harness = await createRuntimeHarness();
    const prepare = await harness.executor.execute({
      args: {
        ...refundPrepareArgs(),
        requested_amount: 750
      },
      builtContext: harness.builtContext,
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      runtimeContext: harness.runtimeContext,
      source: "model_tool_call"
    });
    const commit = await harness.lifecycle.commit({
      commitCapabilityId: "support.refund.commit_case",
      idempotencyKey: "refund:TCK-100:1",
      preparedActionId: prepare.action?.preparedActionId ?? "",
      runtimeContext: harness.commitRuntimeContext
    });

    expect(prepare.status).toBe("approval_required");
    expect(prepare.action?.state).toBe("approval_pending");
    expect(commit.status).toBe("denied");
    expect(commit.userMessage).toContain("approval");
  });

  it("records approval and commits once with idempotency protection", async () => {
    const harness = await createRuntimeHarness();
    const prepare = await harness.executor.execute({
      args: {
        ...refundPrepareArgs(),
        requested_amount: 750
      },
      builtContext: harness.builtContext,
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      runtimeContext: harness.runtimeContext,
      source: "host_call"
    });
    const preparedActionId = prepare.action?.preparedActionId ?? "";
    const approval = await harness.lifecycle.recordApproval({
      approved: true,
      preparedActionId,
      runtimeContext: harness.commitRuntimeContext
    });
    const firstCommit = await harness.lifecycle.commit({
      approvalId: approval.approvalId,
      commitCapabilityId: "support.refund.commit_case",
      idempotencyKey: "refund:TCK-100:2",
      preparedActionId,
      runtimeContext: harness.commitRuntimeContext
    });
    const secondCommit = await harness.lifecycle.commit({
      approvalId: approval.approvalId,
      commitCapabilityId: "support.refund.commit_case",
      idempotencyKey: "refund:TCK-100:2",
      preparedActionId,
      runtimeContext: harness.commitRuntimeContext
    });

    expect(firstCommit.status).toBe("committed");
    expect(secondCommit.status).toBe("committed");
    expect(harness.commitCount()).toBe(1);
    expect(await harness.preparedActionStore.get(preparedActionId)).toMatchObject({
      state: "committed"
    });
  });

  it("updates ledger approval, action, and idempotency records across commit", async () => {
    const ledger = new DefaultAuditLedger();
    const harness = await createRuntimeHarness({ ledger });
    const prepare = await harness.executor.execute({
      args: {
        ...refundPrepareArgs(),
        requested_amount: 750
      },
      builtContext: harness.builtContext,
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      runtimeContext: harness.runtimeContext,
      source: "host_call"
    });
    const preparedActionId = prepare.action?.preparedActionId ?? "";
    const approval = await harness.lifecycle.recordApproval({
      approved: true,
      preparedActionId,
      runtimeContext: harness.commitRuntimeContext
    });
    const commit = await harness.lifecycle.commit({
      approvalId: approval.approvalId,
      commitCapabilityId: "support.refund.commit_case",
      idempotencyKey: "refund:TCK-100:ledger",
      preparedActionId,
      runtimeContext: harness.commitRuntimeContext
    });
    const actions = await ledger.actionStore.listActions({ preparedActionId });
    const approvals = await ledger.approvalStore.listApprovals({ preparedActionId });
    const idempotencyRecords = await ledger.idempotencyStore.listIdempotencyRecords();

    expect(commit.status).toBe("committed");
    expect(actions).toEqual([expect.objectContaining({
      actionState: "committed",
      capabilityId: "support.refund.prepare_case",
      resultHash: expect.stringMatching(/^sha256:/)
    })]);
    expect(approvals).toContainEqual(expect.objectContaining({
      status: "approved"
    }));
    expect(idempotencyRecords).toContainEqual(expect.objectContaining({
      resultRef: expect.objectContaining({ resultHash: expect.stringMatching(/^sha256:/) }),
      status: "completed"
    }));
  });

  it("denies commit through an unrelated or undeclared commit capability", async () => {
    const harness = await createRuntimeHarness();
    const prepare = await harness.executor.execute({
      args: {
        ...refundPrepareArgs(),
        requested_amount: 750
      },
      builtContext: harness.builtContext,
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      runtimeContext: harness.runtimeContext,
      source: "host_call"
    });
    const preparedActionId = prepare.action?.preparedActionId ?? "";
    const approval = await harness.lifecycle.recordApproval({
      approved: true,
      preparedActionId,
      runtimeContext: harness.commitRuntimeContext
    });
    const unrelatedCommit = await harness.lifecycle.commit({
      approvalId: approval.approvalId,
      commitCapabilityId: "scheduling.invite.send",
      idempotencyKey: "refund:TCK-100:mismatch",
      preparedActionId,
      runtimeContext: harness.commitRuntimeContext
    });
    const originalPreparedAction = await harness.preparedActionStore.get(preparedActionId);
    if (!originalPreparedAction) throw new Error("Expected prepared action.");
    await harness.preparedActionStore.create({
      ...originalPreparedAction,
      commitCapabilityId: undefined,
      preparedActionId: "prepared_unlinked",
      state: "approved",
      updatedAt: "2026-06-04T00:00:00.000Z"
    });
    await harness.approvalStore.create({
      ...approval,
      approvalId: "approval_unlinked",
      preparedActionId: "prepared_unlinked"
    });
    const unlinkedCommit = await harness.lifecycle.commit({
      approvalId: "approval_unlinked",
      commitCapabilityId: "support.refund.commit_case",
      idempotencyKey: "refund:TCK-100:unlinked",
      preparedActionId: "prepared_unlinked",
      runtimeContext: harness.commitRuntimeContext
    });

    expect(originalPreparedAction.commitCapabilityId).toBe("support.refund.commit_case");
    expect(unrelatedCommit.status).toBe("denied");
    expect(unrelatedCommit.userMessage).toContain("not linked");
    expect(unlinkedCommit.status).toBe("denied");
    expect(unlinkedCommit.userMessage).toContain("not linked");
  });

  it("denies rejected and expired prepared actions", async () => {
    const rejectedHarness = await createRuntimeHarness();
    const rejectedPrepare = await rejectedHarness.executor.execute({
      args: { ...refundPrepareArgs(), requested_amount: 750 },
      builtContext: rejectedHarness.builtContext,
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      runtimeContext: rejectedHarness.runtimeContext,
      source: "host_call"
    });
    const rejectedPreparedActionId = rejectedPrepare.action?.preparedActionId ?? "";
    const rejection = await rejectedHarness.lifecycle.recordApproval({
      approved: false,
      preparedActionId: rejectedPreparedActionId,
      runtimeContext: rejectedHarness.commitRuntimeContext
    });
    const rejectedCommit = await rejectedHarness.lifecycle.commit({
      approvalId: rejection.approvalId,
      commitCapabilityId: "support.refund.commit_case",
      idempotencyKey: "refund:TCK-100:3",
      preparedActionId: rejectedPreparedActionId,
      runtimeContext: rejectedHarness.commitRuntimeContext
    });
    const expiredHarness = await createRuntimeHarness({
      prepareExpiresAt: "2000-01-01T00:00:00.000Z"
    });
    const expiredPrepare = await expiredHarness.executor.execute({
      args: refundPrepareArgs(),
      builtContext: expiredHarness.builtContext,
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      runtimeContext: expiredHarness.runtimeContext,
      source: "host_call"
    });
    await expect(expiredHarness.lifecycle.recordApproval({
      approved: true,
      preparedActionId: expiredPrepare.action?.preparedActionId ?? "",
      runtimeContext: expiredHarness.commitRuntimeContext
    })).rejects.toMatchObject({
      code: "approval_expired"
    });

    expect(rejectedCommit.status).toBe("denied");
    expect(await expiredHarness.preparedActionStore.get(expiredPrepare.action?.preparedActionId ?? "")).toMatchObject({
      state: "expired"
    });
  });

  it("prevents terminal prepared actions from moving back to approved", async () => {
    const harness = await createRuntimeHarness();
    const prepare = await harness.executor.execute({
      args: { ...refundPrepareArgs(), requested_amount: 750 },
      builtContext: harness.builtContext,
      capabilityId: "support.refund.prepare_case",
      operation: "prepare",
      runtimeContext: harness.runtimeContext,
      source: "host_call"
    });
    const preparedActionId = prepare.action?.preparedActionId ?? "";
    const approval = await harness.lifecycle.recordApproval({
      approved: true,
      preparedActionId,
      runtimeContext: harness.commitRuntimeContext
    });
    const commit = await harness.lifecycle.commit({
      approvalId: approval.approvalId,
      commitCapabilityId: "support.refund.commit_case",
      idempotencyKey: "refund:TCK-100:terminal",
      preparedActionId,
      runtimeContext: harness.commitRuntimeContext
    });

    await expect(harness.lifecycle.recordApproval({
      approved: true,
      preparedActionId,
      runtimeContext: harness.commitRuntimeContext
    })).rejects.toMatchObject({
      code: "policy_denied"
    });

    expect(commit.status).toBe("committed");
    expect(await harness.preparedActionStore.get(preparedActionId)).toMatchObject({
      state: "committed"
    });
  });

  it("marks prepared actions failed when commit handler fails, throws, or returns invalid output", async () => {
    for (const [key, options] of [
      ["handler_failed", { commitFailure: true }],
      ["handler_thrown", { throwCommitHandler: true }],
      ["invalid_output", { invalidCommitOutput: true }]
    ] as const) {
      const harness = await createRuntimeHarness(options);
      const prepare = await harness.executor.execute({
        args: { ...refundPrepareArgs(), requested_amount: 750 },
        builtContext: harness.builtContext,
        capabilityId: "support.refund.prepare_case",
        operation: "prepare",
        runtimeContext: harness.runtimeContext,
        source: "host_call"
      });
      const preparedActionId = prepare.action?.preparedActionId ?? "";
      const approval = await harness.lifecycle.recordApproval({
        approved: true,
        preparedActionId,
        runtimeContext: harness.commitRuntimeContext
      });
      const commit = await harness.lifecycle.commit({
        approvalId: approval.approvalId,
        commitCapabilityId: "support.refund.commit_case",
        idempotencyKey: `refund:TCK-100:${key}`,
        preparedActionId,
        runtimeContext: harness.commitRuntimeContext
      });

      expect(commit.status).toBe("failed");
      expect(JSON.stringify(commit)).not.toContain("secret commit token");
      expect(await harness.preparedActionStore.get(preparedActionId)).toMatchObject({
        state: "failed"
      });
    }
  });

  it("does not leak handler secrets into ledger records on failure", async () => {
    const ledger = new DefaultAuditLedger();
    const harness = await createRuntimeHarness({ ledger, throwReadHandler: true });
    const read = await harness.executor.execute({
      args: { ticket_id: "TCK-100" },
      builtContext: harness.builtContext,
      capabilityId: "support.ticket.get",
      operation: "read",
      runtimeContext: harness.runtimeContext,
      source: "model_tool_call"
    });
    const actions = await ledger.actionStore.listActions();

    expect(read.status).toBe("failed");
    expect(JSON.stringify(actions)).not.toContain("secret stack should not leak");
  });

  it("verifies committed actions with safe unavailable, denied, and failed envelopes", async () => {
    const harness = await createRuntimeHarness();
    const success = await harness.lifecycle.verify({
      committedAction: committedAction("support.refund.commit_case"),
      runtimeContext: harness.commitRuntimeContext
    });
    const missingCapability = await harness.lifecycle.verify({
      committedAction: committedAction("missing.capability"),
      runtimeContext: harness.commitRuntimeContext
    });
    const unsupportedLifecycle = await harness.lifecycle.verify({
      committedAction: committedAction("support.ticket.get"),
      runtimeContext: harness.commitRuntimeContext
    });
    const missingHandlerHarness = await createRuntimeHarness({ registerVerifyHandler: false });
    const missingHandler = await missingHandlerHarness.lifecycle.verify({
      committedAction: committedAction("support.refund.commit_case"),
      runtimeContext: missingHandlerHarness.commitRuntimeContext
    });
    const throwingHarness = await createRuntimeHarness({ throwVerifyHandler: true });
    const thrown = await throwingHarness.lifecycle.verify({
      committedAction: committedAction("support.refund.commit_case"),
      runtimeContext: throwingHarness.commitRuntimeContext
    });

    expect(success.status).toBe("verified");
    expect(success.action?.state).toBe("verified");
    expect(success.data).toEqual({ verification_id: "VER-1" });
    expect(missingCapability.status).toBe("unavailable");
    expect(unsupportedLifecycle.status).toBe("denied");
    expect(missingHandler.status).toBe("unavailable");
    expect(thrown.status).toBe("failed");
    expect(JSON.stringify(thrown)).not.toContain("secret verify token");
  });

  it("returns safe envelopes for missing handlers, lifecycle mismatch, invalid input, invalid output, and handler errors", async () => {
    const missingHandlerHarness = await createRuntimeHarness({ registerReadHandler: false });
    const missingHandler = await missingHandlerHarness.executor.execute({
      args: { ticket_id: "TCK-100" },
      builtContext: missingHandlerHarness.builtContext,
      capabilityId: "support.ticket.get",
      operation: "read",
      runtimeContext: missingHandlerHarness.runtimeContext,
      source: "model_tool_call"
    });
    const lifecycleMismatch = await missingHandlerHarness.executor.execute({
      args: refundPrepareArgs(),
      builtContext: missingHandlerHarness.builtContext,
      capabilityId: "support.refund.prepare_case",
      operation: "read",
      runtimeContext: missingHandlerHarness.runtimeContext,
      source: "model_tool_call"
    });
    const invalidInput = await missingHandlerHarness.executor.execute({
      args: { ticket_id: "not-a-ticket" },
      builtContext: missingHandlerHarness.builtContext,
      capabilityId: "support.ticket.get",
      operation: "read",
      runtimeContext: missingHandlerHarness.runtimeContext,
      source: "model_tool_call"
    });
    const invalidOutputHarness = await createRuntimeHarness({ invalidReadOutput: true });
    const invalidOutput = await invalidOutputHarness.executor.execute({
      args: { ticket_id: "TCK-100" },
      builtContext: invalidOutputHarness.builtContext,
      capabilityId: "support.ticket.get",
      operation: "read",
      runtimeContext: invalidOutputHarness.runtimeContext,
      source: "model_tool_call"
    });
    const throwingHarness = await createRuntimeHarness({ throwReadHandler: true });
    const thrown = await throwingHarness.executor.execute({
      args: { ticket_id: "TCK-100" },
      builtContext: throwingHarness.builtContext,
      capabilityId: "support.ticket.get",
      operation: "read",
      runtimeContext: throwingHarness.runtimeContext,
      source: "model_tool_call"
    });

    expect(missingHandler.status).toBe("unavailable");
    expect(lifecycleMismatch.status).toBe("denied");
    expect(invalidInput.status).toBe("validation_error");
    expect(invalidOutput.status).toBe("failed");
    expect(thrown.status).toBe("failed");
    expect(JSON.stringify(toModelSafeToolEnvelope(thrown))).not.toContain("secret stack");
  });

  it("emits audit events and blocks commit through the tool executor", async () => {
    const harness = await createRuntimeHarness();
    const deniedCommit = await harness.executor.execute({
      args: {
        approval_id: "approval_1",
        prepared_action_id: "prepared_1"
      },
      builtContext: harness.builtContext,
      capabilityId: "support.refund.commit_case",
      operation: "commit" as never,
      runtimeContext: harness.commitRuntimeContext,
      source: "model_tool_call"
    });
    await harness.executor.execute({
      args: { ticket_id: "TCK-100" },
      builtContext: harness.builtContext,
      capabilityId: "support.ticket.get",
      operation: "read",
      runtimeContext: harness.runtimeContext,
      source: "model_tool_call"
    });

    expect(deniedCommit.status).toBe("denied");
    expect(harness.auditSink.events.length).toBeGreaterThanOrEqual(3);
    expect(harness.auditSink.events.map((event) => event.type)).toContain("tool_execution");
  });
});

async function loadExampleRegistry(): Promise<ManifestRegistry> {
  const loaded = await loadManifests({ path: "examples" });
  const validation = validateManifests(loaded.manifests);
  expect(loaded.errors).toEqual([]);
  expect(validation.errors).toEqual([]);
  return buildRegistry(loaded.manifests);
}

async function buildSupportContext(
  registry: ManifestRegistry,
  options: Partial<AicfRuntimeContext["autonomy"]> & {
    permissions?: string[];
  } = {}
) {
  const runtimeContext = await buildSupportRuntimeContext(options);
  return new DefaultContextBuilder({
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
    userInput: supportUserInput
  });
}

async function buildSupportRuntimeContext(
  options: Partial<AicfRuntimeContext["autonomy"]> & {
    facts?: Record<string, unknown>;
    permissions?: string[];
  } = {}
): Promise<AicfRuntimeContext> {
  return buildRuntimeContext({
    adapter: new StaticAuthPlatformAdapter({
      account: {
        accountId: "acct_example_support",
        tenantId: "tenant_example_support"
      },
      subject: {
        permissions: options.permissions ?? supportPermissions,
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
    facts: options.facts ?? {},
    workflow: {
      currentEntityId: "TCK-100",
      currentEntityType: "ticket",
      workflowType: "support"
    }
  });
}

function mustCapability(
  registry: ManifestRegistry,
  capabilityId: string
): LoadedCapabilityManifest {
  const capability = registry.capabilityById.get(capabilityId);
  expect(capability).toBeDefined();
  return capability as LoadedCapabilityManifest;
}

function refundPrepareArgs(): Record<string, unknown> {
  return {
    order_id: "ORD-100",
    reason_code: "customer_request",
    requested_amount: 25,
    ticket_id: "TCK-100"
  };
}

function committedAction(capabilityId: string): AicfCommittedAction {
  return {
    accountId: "acct_example_support",
    capabilityId,
    committedActionId: "commit_1",
    committedAt: "2026-06-04T00:00:00.000Z",
    preparedActionId: "prepared_1",
    requestId: "req_test_0001",
    result: {
      committedActionId: "commit_1",
      data: {
        audit_event_id: "AUD-1",
        refund_id: "RF-1",
        status: "committed"
      },
      status: "committed"
    },
    runId: "run_test_0001",
    state: "committed",
    subjectId: "user_example_support_agent",
    tenantId: "tenant_example_support"
  };
}

async function createRuntimeHarness(options: {
  commitFailure?: boolean;
  invalidCommitOutput?: boolean;
  invalidReadOutput?: boolean;
  ledger?: AicfRuntimeLedgerRecorder;
  prepareExpiresAt?: string;
  registerReadHandler?: boolean;
  registerVerifyHandler?: boolean;
  throwCommitHandler?: boolean;
  throwReadHandler?: boolean;
  throwVerifyHandler?: boolean;
} = {}) {
  const registry = await loadExampleRegistry();
  const runtimeContext = await buildSupportRuntimeContext({
    facts: {
      "refund.order_not_refundable": false
    }
  });
  const commitRuntimeContext = await buildSupportRuntimeContext({
    allowMoneyMovement: true,
    allowSideEffects: true,
    autonomyTier: "A0",
    facts: {
      "refund.approval_missing_or_invalid": false
    },
    maxRiskTier: "critical",
    permissions: ["refund.case.commit"]
  });
  const builtContext = await buildSupportContext(registry, {
    facts: {
      "refund.order_not_refundable": false
    }
  });
  const handlers = new AicfHandlerRegistry({ registry });
  const preparedActionStore = new InMemoryPreparedActionStore();
  const approvalStore = new InMemoryApprovalStore();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const auditSink = new InMemoryAuditSink();
  const policyBroker = new DefaultPolicyBroker();
  let commitCount = 0;

  if (options.registerReadHandler !== false) {
    handlers.register({
      capabilityId: "support.ticket.get",
      read: () => {
        if (options.throwReadHandler) {
          throw new Error("secret stack should not leak");
        }

        return options.invalidReadOutput ? { ticket: { ticket_id: "TCK-100" } } : ticketOutput();
      }
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
      expiresAt: options.prepareExpiresAt,
      summary: "Refund case prepared for review.",
      userMessage: "Refund case prepared."
    })
  });

  handlers.register({
    capabilityId: "support.refund.commit_case",
    commit: () => {
      if (options.throwCommitHandler) {
        throw new Error("secret commit token should not leak");
      }

      if (options.commitFailure) {
        return {
          committedActionId: `commit_failed_${commitCount + 1}`,
          status: "failed",
          userMessage: "Commit failed safely."
        };
      }

      commitCount += 1;
      return {
        committedActionId: `commit_${commitCount}`,
        data: options.invalidCommitOutput ? {
          status: "committed"
        } : {
          audit_event_id: `AUD-${commitCount}`,
          refund_id: `RF-${commitCount}`,
          status: "committed"
        },
        status: "committed",
        userMessage: "Refund committed."
      };
    },
    verify: options.registerVerifyHandler === false ? undefined : () => {
      if (options.throwVerifyHandler) {
        throw new Error("secret verify token should not leak");
      }

      return {
        data: {
          verification_id: "VER-1"
        },
        message: "Refund commit verified.",
        status: "verified"
      };
    }
  });

  const lifecycle = new AicfActionLifecycleManager({
    approvalStore,
    auditSink,
    handlers,
    idempotencyStore,
    ledger: options.ledger,
    policyBroker,
    preparedActionStore,
    registry
  });
  const executor = new AicfToolExecutor({
    actionLifecycle: lifecycle,
    auditSink,
    handlers,
    ledger: options.ledger,
    policyBroker,
    registry
  });

  return {
    approvalStore,
    auditSink,
    builtContext,
    commitCount: () => commitCount,
    commitRuntimeContext,
    executor,
    handlers,
    idempotencyStore,
    lifecycle,
    policyBroker,
    preparedActionStore,
    registry,
    runtimeContext
  };
}

function ticketOutput(): Record<string, unknown> {
  return {
    ticket: {
      order_id: "ORD-100",
      status: "open",
      ticket_id: "TCK-100"
    }
  };
}

function registryWithCapabilityStatus(
  registry: ManifestRegistry,
  capabilityId: string,
  status: LoadedCapabilityManifest["manifest"]["status"]
): ManifestRegistry {
  const original = mustCapability(registry, capabilityId);
  const changed: LoadedCapabilityManifest = {
    ...original,
    manifest: {
      ...original.manifest,
      status
    }
  };
  const capabilities = registry.capabilities.map((capability) => capability.manifest.id === capabilityId ? changed : capability);
  return {
    ...registry,
    capabilities,
    capabilityById: new Map(capabilities.map((capability) => [capability.manifest.id, capability]))
  };
}
