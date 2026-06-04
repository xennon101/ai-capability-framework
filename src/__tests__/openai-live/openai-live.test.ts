import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  loadManifests,
  validateManifests
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
  StaticAuthPlatformAdapter
} from "../../runtime/index.js";
import {
  createDefaultOpenAIResponsesClient,
  runOpenAIResponses
} from "../../openai/index.js";

const runLive = process.env.RUN_REAL_OPENAI === "1"
  && Boolean(process.env.OPENAI_API_KEY)
  && Boolean(process.env.AICF_OPENAI_MODEL);

describe("OpenAI Responses runtime live smoke", () => {
  (runLive ? it : it.skip)("runs a harmless synthetic read-only request", async () => {
    const loaded = await loadManifests({ path: "examples" });
    const validation = validateManifests(loaded.manifests);
    expect(loaded.errors).toEqual([]);
    expect(validation.errors).toEqual([]);
    const registry = buildRegistry(loaded.manifests);
    const runtimeContext = await buildRuntimeContext({
      adapter: new StaticAuthPlatformAdapter({
        account: {
          accountId: "acct_example_support",
          tenantId: "tenant_example_support"
        },
        subject: {
          permissions: ["ticket.read"],
          roles: ["support_agent"],
          userId: "user_example_support_agent"
        }
      }),
      autonomy: {
        allowExternalMessages: false,
        allowMoneyMovement: false,
        allowPermissionChanges: false,
        allowSideEffects: false,
        autonomyTier: "A1",
        maxRiskTier: "low"
      },
      environment: "test",
      workflow: {
        currentEntityId: "TCK-100",
        currentEntityType: "ticket",
        workflowType: "support"
      }
    });
    const contextBuilder = new DefaultContextBuilder();
    const handlers = new AicfHandlerRegistry({ registry });
    const auditSink = new InMemoryAuditSink();
    const policyBroker = new DefaultPolicyBroker();
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

    const result = await runOpenAIResponses({
      client: await createDefaultOpenAIResponsesClient(),
      contextBuilder,
      executor,
      maxToolCalls: 2,
      maxTurns: 3,
      model: process.env.AICF_OPENAI_MODEL ?? "gpt-4.1-mini",
      registry,
      router: new DefaultCapabilityRouter(),
      runtimeContext,
      userInput: {
        text: "Read ticket TCK-100 and summarize its status."
      }
    });

    expect(["completed", "turn_limit_exceeded"]).toContain(result.status);
  });
});
