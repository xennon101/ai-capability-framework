import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  ActionRecord,
  ApprovalRecord,
  PolicyDecisionRecord
} from "../audit/index.js";
import type { ControlsSnapshot, KillSwitch } from "../controls/index.js";
import type { ReplayTrace } from "../replay/index.js";
import type {
  AicfControlPlaneStore,
  AicfControlPlaneStoreState
} from "./types.js";

export class InMemoryControlPlaneStore implements AicfControlPlaneStore {
  protected state: AicfControlPlaneStoreState;

  constructor(state: Partial<AicfControlPlaneStoreState> = {}) {
    this.state = normalizeState(state);
  }

  deleteKillSwitch(id: string): boolean {
    const before = this.state.controls.killSwitches.length;
    this.state.controls.killSwitches = this.state.controls.killSwitches.filter((killSwitch) => killSwitch.id !== id);
    return this.state.controls.killSwitches.length !== before;
  }

  getReplayTrace(traceId: string): ReplayTrace | undefined {
    const trace = this.state.replayTraces.find((entry) => entry.traceId === traceId);
    return trace ? clone(trace) : undefined;
  }

  listActions(): ActionRecord[] {
    return cloneArray(this.state.actions);
  }

  listApprovals(): ApprovalRecord[] {
    return cloneArray(this.state.approvals);
  }

  listDecisions(): PolicyDecisionRecord[] {
    return cloneArray(this.state.decisions);
  }

  listReplayTraces(): ReplayTrace[] {
    return cloneArray(this.state.replayTraces);
  }

  putKillSwitch(killSwitch: KillSwitch): KillSwitch {
    this.state.controls.killSwitches = [
      ...this.state.controls.killSwitches.filter((entry) => entry.id !== killSwitch.id),
      clone(killSwitch)
    ];
    return clone(killSwitch);
  }

  snapshotControls(): ControlsSnapshot {
    return clone(this.state.controls);
  }

  updateApproval(approvalRecordId: string, patch: Partial<ApprovalRecord>): ApprovalRecord | undefined {
    const existing = this.state.approvals.find((approval) => approval.approvalRecordId === approvalRecordId);
    if (!existing) {
      return undefined;
    }

    const updated: ApprovalRecord = {
      ...existing,
      ...clone(patch),
      approvalRecordId,
      schemaVersion: "1.0"
    };
    this.state.approvals = this.state.approvals.map((approval) => approval.approvalRecordId === approvalRecordId ? updated : approval);

    if (updated.preparedActionId && (updated.status === "approved" || updated.status === "rejected")) {
      const nextState = updated.status;
      this.state.actions = this.state.actions.map((action) => action.preparedActionId === updated.preparedActionId
        ? {
            ...action,
            actionState: nextState,
            approvalRecordId,
            updatedAt: updated.decidedAt ?? new Date().toISOString()
          }
        : action);
    }

    return clone(updated);
  }

  snapshotState(): AicfControlPlaneStoreState {
    return clone(this.state);
  }
}

export class FileControlPlaneStore extends InMemoryControlPlaneStore {
  readonly filePath: string;

  constructor(filePath = ".aicf/control-plane-state.json", seed: Partial<AicfControlPlaneStoreState> = {}) {
    const absolutePath = path.resolve(filePath);
    super(readStateFile(absolutePath, seed));
    this.filePath = absolutePath;
  }

  override deleteKillSwitch(id: string): boolean {
    const deleted = super.deleteKillSwitch(id);
    if (deleted) {
      this.flush();
    }
    return deleted;
  }

  override putKillSwitch(killSwitch: KillSwitch): KillSwitch {
    const stored = super.putKillSwitch(killSwitch);
    this.flush();
    return stored;
  }

  override updateApproval(approvalRecordId: string, patch: Partial<ApprovalRecord>): ApprovalRecord | undefined {
    const updated = super.updateApproval(approvalRecordId, patch);
    if (updated) {
      this.flush();
    }
    return updated;
  }

  flush(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(this.snapshotState(), null, 2)}\n`, "utf8");
  }
}

function readStateFile(
  filePath: string,
  seed: Partial<AicfControlPlaneStoreState>
): Partial<AicfControlPlaneStoreState> {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Partial<AicfControlPlaneStoreState>;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return seed;
    }
    throw error;
  }
}

function normalizeState(state: Partial<AicfControlPlaneStoreState>): AicfControlPlaneStoreState {
  return {
    actions: cloneArray(state.actions),
    approvals: cloneArray(state.approvals),
    controls: {
      budgetPolicies: cloneArray(state.controls?.budgetPolicies),
      circuitBreakerEvents: cloneArray(state.controls?.circuitBreakerEvents),
      circuitBreakerPolicies: cloneArray(state.controls?.circuitBreakerPolicies),
      circuitBreakerStates: cloneArray(state.controls?.circuitBreakerStates),
      killSwitches: cloneArray(state.controls?.killSwitches)
    },
    decisions: cloneArray(state.decisions),
    replayTraces: cloneArray(state.replayTraces),
    schemaVersion: "1.0"
  };
}

function cloneArray<T>(items: T[] | undefined): T[] {
  return items ? items.map((item) => clone(item)) : [];
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}
