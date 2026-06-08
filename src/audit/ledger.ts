import {
  actionCapability,
  actionIdForPreparedAction,
  createActionRecord,
  createApprovalRecord,
  createIdempotencyRecord,
  createPolicyDecisionRecord,
  resultRefFromValue
} from "./records.js";
import {
  InMemoryActionStore,
  InMemoryApprovalLedgerStore,
  InMemoryIdempotencyLedgerStore,
  InMemoryPolicyDecisionStore
} from "./in-memory.js";
import type {
  ActionRecord,
  ActionStore,
  ApprovalLedgerStore,
  ApprovalRecord,
  AicfRuntimeLedgerRecorder,
  AuditDiagnosticMode,
  IdempotencyLedgerStore,
  IdempotencyRecord,
  PolicyDecisionRecord,
  PolicyDecisionStore,
  RuntimeActionLedgerInput,
  RuntimeApprovalLedgerInput,
  RuntimeIdempotencyLedgerInput,
  RuntimePolicyDecisionLedgerInput
} from "./types.js";

export interface DefaultAuditLedgerOptions {
  actionStore?: ActionStore;
  approvalStore?: ApprovalLedgerStore;
  diagnosticMode?: AuditDiagnosticMode;
  idempotencyStore?: IdempotencyLedgerStore;
  policyDecisionStore?: PolicyDecisionStore;
}

export class DefaultAuditLedger implements AicfRuntimeLedgerRecorder {
  readonly actionStore: ActionStore;
  readonly approvalStore: ApprovalLedgerStore;
  readonly diagnosticMode: AuditDiagnosticMode;
  readonly idempotencyStore: IdempotencyLedgerStore;
  readonly policyDecisionStore: PolicyDecisionStore;

  constructor(options: DefaultAuditLedgerOptions = {}) {
    this.actionStore = options.actionStore ?? new InMemoryActionStore();
    this.approvalStore = options.approvalStore ?? new InMemoryApprovalLedgerStore();
    this.diagnosticMode = options.diagnosticMode ?? "redacted";
    this.idempotencyStore = options.idempotencyStore ?? new InMemoryIdempotencyLedgerStore();
    this.policyDecisionStore = options.policyDecisionStore ?? new InMemoryPolicyDecisionStore();
  }

  async recordPolicyDecision(input: RuntimePolicyDecisionLedgerInput): Promise<PolicyDecisionRecord> {
    const record = createPolicyDecisionRecord({
      args: input.args,
      capability: input.capability,
      diagnosticMode: this.diagnosticMode,
      operation: input.operation,
      policyDecision: input.policyDecision,
      runtimeContext: input.runtimeContext,
      selectedCapabilitySliceHash: input.selectedCapabilitySliceHash,
      traceRef: input.traceRef
    });
    await this.policyDecisionStore.putDecision(record);
    return record;
  }

  async recordAction(input: RuntimeActionLedgerInput): Promise<ActionRecord> {
    const preparedActionId = input.preparedAction?.preparedActionId ?? input.preparedActionId;
    const actionId = input.actionId ?? (preparedActionId ? actionIdForPreparedAction(preparedActionId) : undefined);
    const existing = actionId ? await this.actionStore.getAction(actionId) : null;
    const capability = input.capability ?? actionCapability({
      capabilityId: input.preparedAction?.capabilityId ?? "unknown",
      capabilityVersion: input.preparedAction?.capabilityVersion
    });
    const record = createActionRecord({
      actionId,
      actionState: input.actionState,
      args: input.args ?? input.preparedAction?.argsRedacted,
      auditRefs: input.auditRefs,
      capability,
      expiresAt: input.expiresAt ?? input.preparedAction?.expiresAt,
      idempotencyKey: input.idempotencyKey ?? input.preparedAction?.idempotencyKey,
      policyDecisionId: input.policyDecisionId,
      preparedActionId,
      preview: input.preview ?? input.preparedAction?.preview,
      result: input.result,
      runId: input.runId ?? input.preparedAction?.runId ?? "unknown",
      traceRef: input.traceRef
    });

    if (existing) {
      return this.actionStore.updateAction(record.actionId, {
        ...record,
        createdAt: existing.createdAt
      });
    }

    await this.actionStore.putAction(record);
    return record;
  }

  async updateAction(actionId: string, patch: Partial<ActionRecord>): Promise<ActionRecord> {
    return this.actionStore.updateAction(actionId, patch);
  }

  async recordApproval(input: RuntimeApprovalLedgerInput): Promise<ApprovalRecord> {
    const approvalRecordId = input.approval?.approvalId;
    const existing = approvalRecordId ? await this.approvalStore.getApproval(approvalRecordId) : null;
    const record = createApprovalRecord({
      approval: input.approval,
      approvalRecordId,
      capabilityId: input.capabilityId,
      diagnosticMode: this.diagnosticMode,
      preparedActionId: input.preparedAction.preparedActionId,
      requestedBy: input.runtimeContext.subject,
      requiredReasonCodes: input.requiredReasonCodes,
      runtimeContext: input.runtimeContext,
      status: input.status,
      traceRef: input.traceRef
    });

    if (existing) {
      return this.approvalStore.updateApproval(record.approvalRecordId, {
        ...record,
        createdAt: existing.createdAt
      });
    }

    await this.approvalStore.putApproval(record);
    return record;
  }

  async recordIdempotency(input: RuntimeIdempotencyLedgerInput): Promise<IdempotencyRecord> {
    if (input.status === "completed") {
      const existing = await this.idempotencyStore.get(input.key, input.scope);
      const resultRef = input.resultRef ?? resultRefFromValue({ status: "completed" }, "idempotency_result");
      if (!existing) {
        const created = createIdempotencyRecord({
          expiresAt: input.expiresAt,
          key: input.key,
          metadata: input.metadata,
          resultRef,
          scope: input.scope,
          status: "completed"
        });
        await this.idempotencyStore.reserve(input.key, {
          expiresAt: input.expiresAt,
          metadata: input.metadata,
          scope: input.scope
        });
        await this.idempotencyStore.complete(input.key, input.scope, resultRef);
        return created;
      }

      await this.idempotencyStore.complete(input.key, input.scope, resultRef);
      const completed = await this.idempotencyStore.get(input.key, input.scope);
      if (!completed) {
        throw new Error("Idempotency record was not found.");
      }
      return completed;
    }

    const reservation = await this.idempotencyStore.reserve(input.key, {
      expiresAt: input.expiresAt,
      metadata: input.metadata,
      scope: input.scope
    });
    return reservation.record;
  }
}
