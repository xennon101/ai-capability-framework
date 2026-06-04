import { fileURLToPath } from "node:url";
import {
  buildRegistry,
  loadManifests,
  validateManifests,
  validatePublicFixtures
} from "../../dist/index.js";
import {
  AicfActionLifecycleManager,
  AicfHandlerRegistry,
  AicfToolExecutor,
  buildRuntimeContext,
  DefaultCapabilityRouter,
  DefaultContextBuilder,
  DefaultPolicyBroker,
  formatCapabilitySliceForModel,
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemoryIdempotencyStore,
  InMemoryPreparedActionStore,
  serializeToolEnvelopeForModel,
  StaticAuthPlatformAdapter
} from "../../dist/runtime/index.js";

const userInput = {
  text: "Read support ticket TCK-100 and prepare a refund case for order ORD-100."
};

export async function runRuntimeSupportBillingMockFlow() {
  const registry = await loadSupportRegistry();
  const runtimeContext = await buildSupportAgentContext();
  const commitRuntimeContext = await buildCommitContext();
  const builtContext = await new DefaultContextBuilder({
    hostItems: [
      {
        data: {
          order_id: "ORD-100",
          refundable: true,
          ticket_id: "TCK-100"
        },
        id: "ticket_TCK_100",
        kind: "entity",
        title: "Synthetic support ticket",
        trusted: true,
        visibleToModel: true
      }
    ]
  }).build({
    baseContext: runtimeContext,
    registry,
    userInput
  });

  const router = new DefaultCapabilityRouter();
  const slice = router.route({
    allowedDomains: ["support"],
    builtContext,
    maxRiskTier: "medium",
    registry,
    userInput
  });
  const modelFacingSlice = formatCapabilitySliceForModel({ registry, slice });
  const harness = createRuntimeHarness(registry);

  const readEnvelope = await harness.executor.execute({
    args: { ticket_id: "TCK-100" },
    builtContext,
    capabilityId: "support.ticket.get",
    operation: "read",
    runtimeContext,
    source: "model_tool_call"
  });

  const prepareEnvelope = await harness.executor.execute({
    args: {
      order_id: "ORD-100",
      reason_code: "customer_request",
      requested_amount: 625,
      ticket_id: "TCK-100"
    },
    builtContext,
    capabilityId: "support.refund.prepare_case",
    operation: "prepare",
    runtimeContext,
    source: "model_tool_call"
  });

  const preparedActionId = prepareEnvelope.action?.preparedActionId;
  if (!preparedActionId) {
    throw new Error("Mock flow expected a prepared action.");
  }

  const approval = await harness.lifecycle.recordApproval({
    approved: true,
    decidedBy: {
      actorId: "operator_example_support",
      actorType: "operator"
    },
    preparedActionId,
    reason: "Synthetic operator approval for the public runtime example.",
    runtimeContext: commitRuntimeContext
  });

  const idempotencyKey = `refund:${preparedActionId}:${approval.approvalId}`;
  const commitEnvelope = await harness.lifecycle.commit({
    approvalId: approval.approvalId,
    builtContext,
    commitCapabilityId: "support.refund.commit_case",
    idempotencyKey,
    preparedActionId,
    runtimeContext: commitRuntimeContext
  });
  const duplicateCommitEnvelope = await harness.lifecycle.commit({
    approvalId: approval.approvalId,
    builtContext,
    commitCapabilityId: "support.refund.commit_case",
    idempotencyKey,
    preparedActionId,
    runtimeContext: commitRuntimeContext
  });
  const modelSafePrepareEnvelope = JSON.parse(serializeToolEnvelopeForModel(prepareEnvelope, {
    environment: runtimeContext.environment
  }));

  return {
    approvalId: approval.approvalId,
    auditEventCount: harness.auditSink.events.length,
    commitStatus: commitEnvelope.status,
    duplicateCommitStatus: duplicateCommitEnvelope.status,
    modelFacingSlice,
    modelSafePrepareEnvelope,
    prepareStatus: prepareEnvelope.status,
    preparedActionId,
    readStatus: readEnvelope.status,
    refundId: commitEnvelope.data?.refund_id,
    routedCapabilityIds: slice.items.map((item) => item.capabilityId),
    ticketOrderId: readEnvelope.data?.ticket?.order_id
  };
}

async function loadSupportRegistry() {
  const supportPath = fileURLToPath(new URL("../support", import.meta.url));
  const loaded = await loadManifests({ path: supportPath });
  const manifestValidation = validateManifests(loaded.manifests);
  const fixtureValidation = validatePublicFixtures(loaded.fixtures);
  const errors = [
    ...loaded.errors,
    ...manifestValidation.errors,
    ...fixtureValidation.errors
  ];

  if (errors.length > 0) {
    throw new Error(`Support runtime example manifests are invalid: ${errors.map((error) => error.message).join("; ")}`);
  }

  return buildRegistry(loaded.manifests);
}

async function buildSupportAgentContext() {
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
      maxRiskTier: "medium"
    },
    environment: "test",
    facts: {
      "refund.order_not_refundable": false
    },
    requestId: "req_runtime_support_billing_1",
    runId: "run_runtime_support_billing_1",
    workflow: {
      currentEntityId: "TCK-100",
      currentEntityType: "ticket",
      workflowType: "support_refund"
    }
  });
}

async function buildCommitContext() {
  return buildRuntimeContext({
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
    },
    requestId: "req_runtime_support_billing_commit_1",
    runId: "run_runtime_support_billing_1",
    workflow: {
      currentEntityId: "TCK-100",
      currentEntityType: "ticket",
      workflowType: "support_refund"
    }
  });
}

function createRuntimeHarness(registry) {
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
        reason_code: args.reason_code,
        requested_amount: args.requested_amount ?? null,
        ticket_id: args.ticket_id
      },
      riskTier: "medium",
      summary: "Synthetic refund case prepared for approval.",
      userMessage: "Refund case prepared and waiting for approval."
    })
  });
  handlers.register({
    capabilityId: "support.refund.commit_case",
    commit: () => ({
      committedActionId: "commit_runtime_support_billing_1",
      data: {
        audit_event_id: "AUD-runtime-support-billing-1",
        refund_id: "RF-runtime-support-billing-1",
        status: "committed"
      },
      status: "committed",
      userMessage: "Synthetic refund committed."
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
    auditSink,
    executor,
    lifecycle
  };
}
