import type {
  ActionFilter,
  ActionRecord,
  ActionStore,
  ApprovalFilter,
  ApprovalLedgerStore,
  ApprovalRecord,
  IdempotencyFilter,
  IdempotencyLedgerStore,
  IdempotencyMetadata,
  IdempotencyRecord,
  IdempotencyReservation,
  PolicyDecisionFilter,
  PolicyDecisionRecord,
  PolicyDecisionStore,
  ResultRef
} from "./types.js";
import { createIdempotencyRecord } from "./records.js";
import { hashAuditValue } from "./redaction.js";

export class InMemoryPolicyDecisionStore implements PolicyDecisionStore {
  private records = new Map<string, PolicyDecisionRecord>();

  async getDecision(decisionId: string): Promise<PolicyDecisionRecord | null> {
    const record = this.records.get(decisionId);
    return record ? clone(record) : null;
  }

  async listDecisions(filter: PolicyDecisionFilter = {}): Promise<PolicyDecisionRecord[]> {
    return [...this.records.values()]
      .filter((record) => matchesPolicyDecision(record, filter))
      .map(clone);
  }

  async putDecision(record: PolicyDecisionRecord): Promise<void> {
    if (this.records.has(record.decisionId)) {
      throw new Error("Policy decision record already exists.");
    }
    this.records.set(record.decisionId, clone(record));
  }
}

export class InMemoryActionStore implements ActionStore {
  private records = new Map<string, ActionRecord>();

  async getAction(actionId: string): Promise<ActionRecord | null> {
    const record = this.records.get(actionId);
    return record ? clone(record) : null;
  }

  async listActions(filter: ActionFilter = {}): Promise<ActionRecord[]> {
    return [...this.records.values()]
      .filter((record) => matchesAction(record, filter))
      .map(clone);
  }

  async putAction(record: ActionRecord): Promise<void> {
    if (this.records.has(record.actionId)) {
      throw new Error("Action record already exists.");
    }
    this.records.set(record.actionId, clone(record));
  }

  async updateAction(actionId: string, patch: Partial<ActionRecord>): Promise<ActionRecord> {
    const existing = this.records.get(actionId);
    if (!existing) {
      throw new Error("Action record was not found.");
    }

    const updated = {
      ...existing,
      ...clone(patch),
      actionId,
      schemaVersion: "1.0" as const,
      updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : new Date().toISOString()
    };
    this.records.set(actionId, updated);
    return clone(updated);
  }
}

export class InMemoryApprovalLedgerStore implements ApprovalLedgerStore {
  private records = new Map<string, ApprovalRecord>();

  async getApproval(approvalRecordId: string): Promise<ApprovalRecord | null> {
    const record = this.records.get(approvalRecordId);
    return record ? clone(record) : null;
  }

  async listApprovals(filter: ApprovalFilter = {}): Promise<ApprovalRecord[]> {
    return [...this.records.values()]
      .filter((record) => matchesApproval(record, filter))
      .map(clone);
  }

  async putApproval(record: ApprovalRecord): Promise<void> {
    if (this.records.has(record.approvalRecordId)) {
      throw new Error("Approval record already exists.");
    }
    this.records.set(record.approvalRecordId, clone(record));
  }

  async updateApproval(approvalRecordId: string, patch: Partial<ApprovalRecord>): Promise<ApprovalRecord> {
    const existing = this.records.get(approvalRecordId);
    if (!existing) {
      throw new Error("Approval record was not found.");
    }

    const updated = {
      ...existing,
      ...clone(patch),
      approvalRecordId,
      schemaVersion: "1.0" as const
    };
    this.records.set(approvalRecordId, updated);
    return clone(updated);
  }
}

export class InMemoryIdempotencyLedgerStore implements IdempotencyLedgerStore {
  private records = new Map<string, IdempotencyRecord>();

  async complete(key: string, scope: string, resultRef: ResultRef): Promise<void> {
    const recordKey = scopedKey(key, scope);
    const existing = this.records.get(recordKey);
    if (!existing) {
      throw new Error("Idempotency record was not found.");
    }

    this.records.set(recordKey, {
      ...existing,
      completedAt: new Date().toISOString(),
      resultRef: clone(resultRef),
      status: "completed"
    });
  }

  async get(key: string, scope: string): Promise<IdempotencyRecord | null> {
    const record = this.records.get(scopedKey(key, scope));
    return record ? clone(record) : null;
  }

  async listIdempotencyRecords(filter: IdempotencyFilter = {}): Promise<IdempotencyRecord[]> {
    return [...this.records.values()]
      .filter((record) => matchesIdempotency(record, filter))
      .map(clone);
  }

  async reserve(key: string, metadata: IdempotencyMetadata): Promise<IdempotencyReservation> {
    const recordKey = scopedKey(key, metadata.scope);
    const existing = this.records.get(recordKey);
    if (existing) {
      return {
        record: clone(existing),
        reserved: false
      };
    }

    const record = createIdempotencyRecord({
      expiresAt: metadata.expiresAt,
      key,
      metadata: metadata.metadata,
      scope: metadata.scope,
      status: "reserved"
    });
    this.records.set(recordKey, clone(record));
    return {
      record,
      reserved: true
    };
  }
}

function scopedKey(key: string, scope: string): string {
  return `${hashAuditValue({ scope })}#${hashAuditValue({ key })}`;
}

function matchesPolicyDecision(record: PolicyDecisionRecord, filter: PolicyDecisionFilter): boolean {
  return (!filter.capabilityId || record.capabilityId === filter.capabilityId)
    && (!filter.decision || record.decision === filter.decision)
    && (!filter.runId || record.runId === filter.runId);
}

function matchesAction(record: ActionRecord, filter: ActionFilter): boolean {
  return (!filter.actionState || record.actionState === filter.actionState)
    && (!filter.capabilityId || record.capabilityId === filter.capabilityId)
    && (!filter.preparedActionId || record.preparedActionId === filter.preparedActionId)
    && (!filter.runId || record.runId === filter.runId);
}

function matchesApproval(record: ApprovalRecord, filter: ApprovalFilter): boolean {
  return (!filter.capabilityId || record.capabilityId === filter.capabilityId)
    && (!filter.preparedActionId || record.preparedActionId === filter.preparedActionId)
    && (!filter.status || record.status === filter.status);
}

function matchesIdempotency(record: IdempotencyRecord, filter: IdempotencyFilter): boolean {
  return (!filter.keyHash || record.keyHash === filter.keyHash)
    && (!filter.scopeHash || record.scopeHash === filter.scopeHash)
    && (!filter.status || record.status === filter.status);
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}
