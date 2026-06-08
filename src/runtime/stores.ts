import { AicfRuntimeError } from "./errors.js";
import type {
  AicfApprovalDecision,
  AicfApprovalStore,
  AicfIdempotencyStore,
  AicfPreparedAction,
  AicfPreparedActionStore,
  AicfPreparedActionUpdateStateInput
} from "./types.js";

export class InMemoryPreparedActionStore implements AicfPreparedActionStore {
  private actions = new Map<string, AicfPreparedAction>();

  async create(action: AicfPreparedAction): Promise<void> {
    if (this.actions.has(action.preparedActionId)) {
      throw new AicfRuntimeError({
        code: "idempotency_conflict",
        safeMessage: "Prepared action already exists."
      });
    }

    this.actions.set(action.preparedActionId, clone(action));
  }

  async get(preparedActionId: string): Promise<AicfPreparedAction | undefined> {
    const action = this.actions.get(preparedActionId);
    return action ? clone(action) : undefined;
  }

  async updateState(input: AicfPreparedActionUpdateStateInput): Promise<void> {
    const action = this.actions.get(input.preparedActionId);
    if (!action) {
      throw new AicfRuntimeError({
        code: "capability_not_found",
        safeMessage: "Prepared action was not found."
      });
    }

    if (input.expectedState && action.state !== input.expectedState) {
      throw new AicfRuntimeError({
        code: "policy_denied",
        details: {
          actualState: action.state,
          expectedState: input.expectedState
        },
        safeMessage: "Prepared action is not in the expected state."
      });
    }

    action.state = input.nextState;
    action.updatedAt = input.updatedAt;
    if (input.committedActionId !== undefined) {
      action.committedActionId = input.committedActionId;
    }
    if (input.committedAt !== undefined) {
      action.committedAt = input.committedAt;
    }
    if (input.commitResultHash !== undefined) {
      action.commitResultHash = input.commitResultHash;
    }
    if (input.verification !== undefined) {
      action.verification = clone(input.verification);
    }
    this.actions.set(input.preparedActionId, clone(action));
  }
}

export class InMemoryApprovalStore implements AicfApprovalStore {
  private approvals = new Map<string, AicfApprovalDecision>();

  async create(decision: AicfApprovalDecision): Promise<void> {
    if (this.approvals.has(decision.approvalId)) {
      throw new AicfRuntimeError({
        code: "idempotency_conflict",
        safeMessage: "Approval decision already exists."
      });
    }

    this.approvals.set(decision.approvalId, clone(decision));
  }

  async get(approvalId: string): Promise<AicfApprovalDecision | undefined> {
    const decision = this.approvals.get(approvalId);
    return decision ? clone(decision) : undefined;
  }

  async getForPreparedAction(preparedActionId: string): Promise<AicfApprovalDecision[]> {
    return [...this.approvals.values()]
      .filter((decision) => decision.preparedActionId === preparedActionId)
      .map(clone);
  }
}

export class InMemoryIdempotencyStore implements AicfIdempotencyStore {
  private reservations = new Map<string, {
    expiresAt: string;
    metadata?: Record<string, unknown>;
    result?: Record<string, unknown>;
    scope: string;
  }>();

  async reserve(input: {
    expiresAt: string;
    key: string;
    metadata?: Record<string, unknown>;
    scope: string;
  }): Promise<{ reserved: true } | { existing?: Record<string, unknown>; reserved: false }> {
    const mapKey = scopedIdempotencyKey(input.scope, input.key);
    const existing = this.reservations.get(mapKey);
    if (existing) {
      return {
        existing: existing.result ? clone(existing.result) : undefined,
        reserved: false
      };
    }

    this.reservations.set(mapKey, {
      expiresAt: input.expiresAt,
      metadata: input.metadata,
      scope: input.scope
    });

    return { reserved: true };
  }

  async complete(input: {
    key: string;
    result: Record<string, unknown>;
    scope: string;
  }): Promise<void> {
    const mapKey = scopedIdempotencyKey(input.scope, input.key);
    const existing = this.reservations.get(mapKey);
    this.reservations.set(mapKey, {
      expiresAt: existing?.expiresAt ?? new Date(Date.now() + 3600000).toISOString(),
      metadata: existing?.metadata,
      result: clone(input.result),
      scope: input.scope
    });
  }
}

function scopedIdempotencyKey(scope: string, key: string): string {
  return `${scope}#${key}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
