import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  loadManifests,
  toOpenAIResponsesToolName,
  validateManifests,
  type ManifestRegistry
} from "../../index.js";
import {
  MockOpenAIResponsesClient,
  mockFunctionCallResponse,
  mockTextResponse
} from "../../openai/index.js";
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
  createEvalCaseFromTrace,
  evaluateGate,
  noRawInternalDetailsScorer,
  runLiveEvalSuite
} from "../../evals-live/index.js";
import { CollectingTraceSink } from "../../observability/index.js";

describe("live eval runner", () => {
  it("runs a mock OpenAI runtime path and scores deterministic expectations", async () => {
    const harness = await createHarness();
    const traceSink = new CollectingTraceSink();
    const client = new MockOpenAIResponsesClient([
      mockFunctionCallResponse({
        args: {
          order_id: "ORD-2002",
          reason_code: "damaged_item",
          requested_amount: null,
          ticket_id: "TCK-1001"
        },
        callId: "call_refund",
        name: toOpenAIResponsesToolName("support.refund.prepare_case")
      }),
      mockTextResponse("Refund case prepared.", "resp_final")
    ]);
    const results = await runLiveEvalSuite({
      cases: [{
        evalId: "support.refund.prepare_case.valid",
        runtimeContext: harness.runtimeContext,
        userInput: {
          text: "Prepare a refund case for ticket TCK-1001 and order ORD-2002 because the item arrived damaged."
        }
      }],
      contextBuilderFactory: () => new DefaultContextBuilder(),
      executor: harness.executor,
      model: "gpt-4.1-mini",
      openAIClient: client,
      registry: harness.registry,
      router: new DefaultCapabilityRouter(),
      scorers: [noRawInternalDetailsScorer()],
      traceSink
    });
    const gate = evaluateGate(results, { requireAllPassed: true });

    expect(results[0]?.status).toBe("passed");
    expect(results[0]?.candidate?.tool_calls?.[0]).toMatchObject({
      capability_id: "support.refund.prepare_case",
      args: {
        order_id: "ORD-2002",
        reason_code: "damaged_item",
        ticket_id: "TCK-1001"
      }
    });
    expect(gate.status).toBe("passed");
    expect(traceSink.events.map((event) => event.type)).toContain("eval.score");
  });

  it("fails gates and creates trace-derived evals without raw model output by default", async () => {
    const harness = await createHarness();
    const client = new MockOpenAIResponsesClient([
      mockTextResponse("private_diagnostics: secret", "resp_bad")
    ]);
    const results = await runLiveEvalSuite({
      cases: [{
        evalId: "support.refund.prepare_case.valid",
        expected: {
          response: {
            must_not_include: ["private_diagnostics"]
          }
        },
        runtimeContext: harness.runtimeContext,
        userInput: {
          text: "Prepare a refund case."
        }
      }],
      contextBuilderFactory: () => new DefaultContextBuilder(),
      executor: harness.executor,
      model: "gpt-4.1-mini",
      openAIClient: client,
      registry: harness.registry,
      router: new DefaultCapabilityRouter(),
      scorers: [noRawInternalDetailsScorer()]
    });
    const gate = evaluateGate(results, { requireAllPassed: true });
    const evalCase = createEvalCaseFromTrace({
      reason: "low_score",
      runResult: results[0]!.runResult!
    });

    expect(results[0]?.status).toBe("failed");
    expect(gate.status).toBe("failed");
    expect(JSON.stringify(evalCase)).not.toContain("private_diagnostics: secret");
    expect(evalCase.expected.response?.must_not_include).toContain("private_diagnostics");
  });

  it("exports built evals-live subpath APIs", async () => {
    const evalsLive = await import("../../../dist/evals-live/index.js") as Record<string, unknown>;

    expect(evalsLive.runLiveEvalSuite).toEqual(expect.any(Function));
    expect(evalsLive.evaluateGate).toEqual(expect.any(Function));
    expect(evalsLive.createEvalCaseFromTrace).toEqual(expect.any(Function));
  });
});

async function createHarness() {
  const registry = await loadExampleRegistry();
  const runtimeContext = await buildSupportRuntimeContext();
  const handlers = new AicfHandlerRegistry({ registry });
  const auditSink = new InMemoryAuditSink();
  const policyBroker = new DefaultPolicyBroker();

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
    approvalStore: new InMemoryApprovalStore(),
    auditSink,
    handlers,
    idempotencyStore: new InMemoryIdempotencyStore(),
    policyBroker,
    preparedActionStore: new InMemoryPreparedActionStore(),
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
      currentEntityId: "TCK-1001",
      currentEntityType: "ticket",
      workflowType: "support"
    }
  });
}
