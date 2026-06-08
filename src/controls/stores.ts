import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  AicfControlsStore,
  BudgetPolicy,
  CircuitBreakerEvent,
  CircuitBreakerPolicy,
  CircuitBreakerState,
  ControlsSnapshot,
  KillSwitch,
  LocalJsonControlsFile
} from "./types.js";

const emptySnapshot: ControlsSnapshot = {
  budgetPolicies: [],
  circuitBreakerEvents: [],
  circuitBreakerPolicies: [],
  circuitBreakerStates: [],
  killSwitches: []
};

export class InMemoryControlsStore implements AicfControlsStore {
  private snapshot: ControlsSnapshot;

  constructor(snapshot: Partial<ControlsSnapshot> = {}) {
    this.snapshot = normalizeSnapshot(snapshot);
  }

  listBudgetPolicies(): BudgetPolicy[] {
    return cloneArray(this.snapshot.budgetPolicies);
  }

  listCircuitBreakerEvents(): CircuitBreakerEvent[] {
    return cloneArray(this.snapshot.circuitBreakerEvents);
  }

  listCircuitBreakerPolicies(): CircuitBreakerPolicy[] {
    return cloneArray(this.snapshot.circuitBreakerPolicies);
  }

  listCircuitBreakerStates(): CircuitBreakerState[] {
    return cloneArray(this.snapshot.circuitBreakerStates);
  }

  listKillSwitches(): KillSwitch[] {
    return cloneArray(this.snapshot.killSwitches);
  }

  putBudgetPolicy(policy: BudgetPolicy): void {
    this.snapshot.budgetPolicies = upsertById(this.snapshot.budgetPolicies, policy);
  }

  putCircuitBreakerPolicy(policy: CircuitBreakerPolicy): void {
    this.snapshot.circuitBreakerPolicies = upsertById(this.snapshot.circuitBreakerPolicies, policy);
  }

  putCircuitBreakerState(state: CircuitBreakerState): void {
    this.snapshot.circuitBreakerStates = [
      ...this.snapshot.circuitBreakerStates.filter((entry) => entry.policyId !== state.policyId),
      structuredClone(state)
    ];
  }

  putKillSwitch(killSwitch: KillSwitch): void {
    this.snapshot.killSwitches = upsertById(this.snapshot.killSwitches, killSwitch);
  }

  recordCircuitBreakerEvent(event: CircuitBreakerEvent): void {
    this.snapshot.circuitBreakerEvents = [...this.snapshot.circuitBreakerEvents, structuredClone(event)];
  }

  snapshotCopy(): ControlsSnapshot {
    return normalizeSnapshot(this.snapshot);
  }
}

export class LocalJsonControlsStore extends InMemoryControlsStore {
  readonly filePath: string;

  constructor(filePath = ".aicf/controls.json") {
    const absolutePath = path.resolve(filePath);
    super(readLocalFile(absolutePath));
    this.filePath = absolutePath;
  }

  override putBudgetPolicy(policy: BudgetPolicy): void {
    super.putBudgetPolicy(policy);
    this.flush();
  }

  override putCircuitBreakerPolicy(policy: CircuitBreakerPolicy): void {
    super.putCircuitBreakerPolicy(policy);
    this.flush();
  }

  override putCircuitBreakerState(state: CircuitBreakerState): void {
    super.putCircuitBreakerState(state);
    this.flush();
  }

  override putKillSwitch(killSwitch: KillSwitch): void {
    super.putKillSwitch(killSwitch);
    this.flush();
  }

  override recordCircuitBreakerEvent(event: CircuitBreakerEvent): void {
    super.recordCircuitBreakerEvent(event);
    this.flush();
  }

  flush(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: LocalJsonControlsFile = {
      schemaVersion: "1.0",
      ...this.snapshotCopy()
    };
    writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

export function createControlsEvaluatorSnapshot(store: AicfControlsStore): ControlsSnapshot {
  return {
    budgetPolicies: store.listBudgetPolicies(),
    circuitBreakerEvents: store.listCircuitBreakerEvents(),
    circuitBreakerPolicies: store.listCircuitBreakerPolicies(),
    circuitBreakerStates: store.listCircuitBreakerStates(),
    killSwitches: store.listKillSwitches()
  };
}

function readLocalFile(filePath: string): Partial<ControlsSnapshot> {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<LocalJsonControlsFile>;
    return normalizeSnapshot(parsed);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return emptySnapshot;
    }
    throw error;
  }
}

function normalizeSnapshot(snapshot: Partial<ControlsSnapshot> = {}): ControlsSnapshot {
  return {
    budgetPolicies: cloneArray(snapshot.budgetPolicies),
    circuitBreakerEvents: cloneArray(snapshot.circuitBreakerEvents),
    circuitBreakerPolicies: cloneArray(snapshot.circuitBreakerPolicies),
    circuitBreakerStates: cloneArray(snapshot.circuitBreakerStates),
    killSwitches: cloneArray(snapshot.killSwitches)
  };
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const remaining = items.filter((entry) => entry.id !== item.id);
  return [...remaining, structuredClone(item)];
}

function cloneArray<T>(items: T[] | undefined): T[] {
  return items ? items.map((item) => structuredClone(item)) : [];
}
