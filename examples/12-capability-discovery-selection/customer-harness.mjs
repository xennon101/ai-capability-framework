import {
  AicfActionLifecycleManager,
  AicfHandlerRegistry,
  AicfToolExecutor,
  DefaultPolicyBroker,
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemoryIdempotencyStore,
  InMemoryPreparedActionStore
} from "ai-capability-framework/runtime";
import { createDiscoveryExample } from "./discovery-example.mjs";

// Existing application runtime setup is separate from the discovery integration.
export async function createCustomerHarness() {
  const { registry, runtimeContext } = await createDiscoveryExample();
  runtimeContext.facts = { "refund.order_not_refundable": false };
  const handlers = new AicfHandlerRegistry({ registry });
  const readCalls = [],
    prepareCalls = [];
  handlers.register({
    capabilityId: "support.ticket.get",
    read: ({ args }) => {
      readCalls.push(args);
      return {
        ticket: { ticket_id: args.ticket_id, order_id: "ORD-100", status: "open" }
      };
    }
  });
  handlers.register({
    capabilityId: "support.refund.prepare_case",
    prepare: ({ args }) => {
      prepareCalls.push(args);
      return {
        data: {
          ticket_id: args.ticket_id,
          order_id: args.order_id,
          reason_code: args.reason_code
        },
        riskTier: "medium",
        summary: "Refund case prepared for review.",
        userMessage: "The refund case is ready for approval."
      };
    }
  });
  const auditSink = new InMemoryAuditSink();
  const policyBroker = new DefaultPolicyBroker({
    hostPolicyHook: (input) =>
      input.operation === "prepare"
        ? {
            status: "approval_required",
            reasons: [],
            requiredApprovals: [
              {
                approvalType: "operator_review",
                reason: "Application policy requires refund review."
              }
            ]
          }
        : null
  });
  const actionLifecycle = new AicfActionLifecycleManager({
    registry,
    handlers,
    auditSink,
    policyBroker,
    approvalStore: new InMemoryApprovalStore(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    preparedActionStore: new InMemoryPreparedActionStore()
  });
  const executor = new AicfToolExecutor({
    registry,
    handlers,
    auditSink,
    policyBroker,
    actionLifecycle
  });
  const executedOperations = [];
  const execute = executor.execute.bind(executor);
  executor.execute = async (input) => {
    executedOperations.push(input.operation);
    return execute(input);
  };
  return {
    registry,
    runtimeContext,
    executor,
    readCalls,
    prepareCalls,
    executedOperations
  };
}
