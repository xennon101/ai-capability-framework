import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { hashDiscoveryContent } from "ai-capability-framework/discovery";
import { CAPS } from "./campaign.mjs";

const quantities = ["providerCalls", "inputTokens", "outputTokens", "estimatedCost"];
const zero = () => Object.fromEntries(quantities.map((key) => [key, 0]));
const nonnegative = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Evaluation-host storage only: one owner, durable reservations, conservative unknown charges. */
export function openCampaignLedger({ directory, binding, caps = CAPS }) {
  if (existsSync(path.join(directory, "continuation.json")))
    throw new Error(
      "Campaign budget belongs to its continuation; predecessor spending is closed."
    );
  const resolvedCaps = { ...CAPS, ...caps };
  for (const [key, maximum] of Object.entries(CAPS))
    if (
      !nonnegative(resolvedCaps[key]) ||
      resolvedCaps[key] > maximum ||
      (key !== "estimatedCost" && !Number.isSafeInteger(resolvedCaps[key]))
    )
      throw new Error("Invalid campaign caps.");
  const fingerprint = hashDiscoveryContent({ binding, caps: resolvedCaps });
  mkdirSync(directory, { recursive: true });
  const lockPath = path.join(directory, "campaign.lock");
  let lock;
  try {
    lock = openSync(lockPath, "wx");
    writeFileSync(lock, String(process.pid));
    fsyncSync(lock);
  } catch {
    throw new Error(
      "Campaign is locked; do not remove a lock until its owner is stopped."
    );
  }
  const journalPath = path.join(directory, "journal.jsonl");
  let descriptor,
    closed = false,
    halted = false,
    sequence = 0,
    previous = null;
  const reservations = new Map(),
    settled = new Set(),
    http = new Map(),
    trials = new Map(),
    records = [];
  const charged = zero();
  let httpCount = 0;
  const apply = (event) => {
    const data = event.data;
    if (event.type === "reservation") reservations.set(data.id, data);
    if (event.type === "settlement") {
      reservations.delete(data.id);
      settled.add(data.id);
      for (const key of quantities) charged[key] += data.charged[key];
    }
    if (event.type === "http.start") {
      http.set(data.id, data);
      httpCount++;
      charged.estimatedCost += data.fee;
    }
    if (event.type === "http.end") http.delete(data.id);
    if (event.type === "trial.start")
      trials.set(data.key, { status: "pending", ...data });
    if (event.type === "trial.end")
      trials.set(data.key, { status: "completed", ...data });
    if (event.type === "halt") halted = true;
    records.push(event);
  };
  try {
    if (existsSync(journalPath)) {
      if (statSync(journalPath).size > 64 * 1024 * 1024)
        throw new Error("Campaign journal exceeds its bound.");
      const raw = readFileSync(journalPath, "utf8");
      if (raw && !raw.endsWith("\n"))
        throw new Error("Incomplete journal tail requires reconciliation.");
      for (const line of raw.split("\n").filter(Boolean)) {
        if (line.length > 128_000) throw new Error("Oversized journal record.");
        const record = JSON.parse(line),
          { hash, ...envelope } = record;
        if (
          envelope.sequence !== ++sequence ||
          envelope.previous !== previous ||
          hashDiscoveryContent(envelope) !== hash
        )
          throw new Error("Campaign journal integrity failure.");
        if (
          sequence === 1 &&
          (envelope.type !== "campaign" || envelope.data.fingerprint !== fingerprint)
        )
          throw new Error("Campaign fingerprint mismatch.");
        previous = hash;
        apply(envelope);
      }
    }
    descriptor = openSync(journalPath, "a");
  } catch (error) {
    closeSync(lock);
    unlinkSync(lockPath);
    throw error;
  }

  const append = (type, data) => {
    if (closed) throw new Error("Campaign is closed.");
    const envelope = { sequence: sequence + 1, previous, type, data };
    const hash = hashDiscoveryContent(envelope),
      serialized = JSON.stringify({ ...envelope, hash }) + "\n";
    if (serialized.length > 128_000) throw new Error("Oversized campaign record.");
    try {
      appendFileSync(descriptor, serialized);
      fsyncSync(descriptor);
    } catch {
      halted = true;
      throw new Error("Campaign journal unavailable; no more paid work permitted.");
    }
    sequence++;
    previous = hash;
    apply(envelope);
  };
  if (sequence === 0) append("campaign", { fingerprint, binding, caps: resolvedCaps });
  const held = () => {
    const value = zero();
    for (const reservation of reservations.values())
      for (const key of quantities) value[key] += reservation.amounts[key];
    return value;
  };
  const halt = (reasonCode) => {
    if (!halted) append("halt", { reasonCode });
    halted = true;
  };
  const available = (amounts) => {
    const outstanding = held();
    return (
      !closed &&
      !halted &&
      quantities.every(
        (key) => charged[key] + outstanding[key] + amounts[key] <= resolvedCaps[key]
      )
    );
  };
  const policy = Object.freeze({
    id: "evaluation.campaign.v1",
    scope: Object.freeze({ type: "global" }),
    mode: "hard",
    maxProviderCallsPerRun: resolvedCaps.providerCalls,
    maxInputTokensPerRun: resolvedCaps.inputTokens,
    maxOutputTokensPerRun: resolvedCaps.outputTokens,
    maxEstimatedCostPerRun: resolvedCaps.estimatedCost
  });

  return Object.freeze({
    fingerprint,
    directory,
    scope(runId) {
      if (typeof runId !== "string" || !/^[a-zA-Z0-9_.-]{1,200}$/.test(runId))
        throw new Error("Invalid campaign run ID.");
      return {
        policy,
        ledger: Object.freeze({
          async reserve(input) {
            const denied = () => ({
              status: "denied",
              diagnostic: {
                code: "budget_denied",
                message: "The campaign budget denied this reservation."
              }
            });
            const usage = input.requestedUsage;
            if (
              input.runId !== runId ||
              hashDiscoveryContent(input.policy) !== hashDiscoveryContent(policy) ||
              input.signal?.aborted ||
              !Number.isFinite(input.deadlineAt) ||
              input.deadlineAt <= Date.now() ||
              !usage ||
              usage.providerCalls !== 1 ||
              !Number.isSafeInteger(usage.inputTokens) ||
              usage.inputTokens < 1 ||
              (usage.outputTokens !== undefined &&
                (!Number.isSafeInteger(usage.outputTokens) ||
                  usage.outputTokens < 0)) ||
              !nonnegative(usage.estimatedCost)
            )
              return denied();
            const amounts = {
              providerCalls: 1,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens ?? 0,
              estimatedCost: usage.estimatedCost
            };
            if (!available(amounts)) return denied();
            const id = `reservation-${sequence + 1}`;
            // Capacity check, durable append and in-memory update happen without yielding.
            append("reservation", {
              id,
              runId,
              requestId: input.requestId,
              stage: input.stage,
              amounts
            });
            return { status: "reserved", reservationId: id };
          },
          async settle(id, result) {
            const reservation = reservations.get(id);
            if (!reservation || reservation.runId !== runId || settled.has(id)) {
              halt("invalid_settlement");
              throw new Error("Invalid or duplicate campaign settlement.");
            }
            const usage = result.usage ?? {};
            if (
              !Number.isSafeInteger(result.providerAttempts) ||
              result.providerAttempts < 0 ||
              !Number.isSafeInteger(result.completedResponses) ||
              result.completedResponses < 0 ||
              !["completed", "failed", "cancelled", "discarded"].includes(
                result.outcome
              ) ||
              Object.values(usage).some((value) => !nonnegative(value))
            ) {
              halt("invalid_settlement");
              throw new Error("Malformed campaign settlement.");
            }
            const attempts = Math.max(
              result.providerAttempts,
              result.completedResponses
            );
            const chargedUsage = {
              providerCalls: attempts,
              inputTokens:
                usage.inputTokens ?? (attempts ? reservation.amounts.inputTokens : 0),
              outputTokens:
                usage.outputTokens ?? (attempts ? reservation.amounts.outputTokens : 0),
              estimatedCost:
                usage.estimatedCost ??
                (attempts ? reservation.amounts.estimatedCost : 0)
            };
            append("settlement", {
              id,
              runId,
              outcome: result.outcome,
              usage,
              providerAttempts: result.providerAttempts,
              completedResponses: result.completedResponses,
              charged: chargedUsage,
              unknown: quantities.filter(
                (key) =>
                  key !== "providerCalls" && usage[key] === undefined && attempts > 0
              )
            });
            if (
              quantities.some((key) => chargedUsage[key] > reservation.amounts[key]) ||
              attempts > 1
            ) {
              halt("reservation_exceeded");
              throw new Error("Provider consumption exceeded its reserved allowance.");
            }
          }
        })
      };
    },
    async transport(kind, invoke, options = {}) {
      const { signal, deadlineAt = Date.now() + 30_000, fee = 0 } = options;
      if (signal?.aborted || deadlineAt <= Date.now())
        throw Object.assign(new Error("Transport cancelled before dispatch."), {
          providerAttempts: 0,
          completedResponses: 0,
          usage: {}
        });
      if (
        !["generation", "embedding", "token_count"].includes(kind) ||
        !nonnegative(fee) ||
        httpCount >= resolvedCaps.httpRequests ||
        !available({ ...zero(), estimatedCost: fee })
      )
        throw Object.assign(new Error("Campaign transport budget unavailable."), {
          providerAttempts: 0,
          completedResponses: 0,
          usage: {}
        });
      const id = `http-${sequence + 1}`;
      append("http.start", { id, kind, fee });
      try {
        const value = await invoke();
        append("http.end", {
          id,
          status: "completed",
          model: typeof value?.model === "string" ? value.model.slice(0, 100) : null,
          responseId: typeof value?.id === "string" ? value.id.slice(0, 200) : null
        });
        return value;
      } catch (error) {
        append("http.end", { id, status: "failed", model: null, responseId: null });
        const raw = error?.usage ?? {};
        const usage = Object.fromEntries(
          Object.entries({
            inputTokens: raw.inputTokens ?? raw.input_tokens ?? raw.prompt_tokens,
            outputTokens: raw.outputTokens ?? raw.output_tokens,
            totalTokens: raw.totalTokens ?? raw.total_tokens,
            cachedInputTokens:
              raw.cachedInputTokens ?? raw.input_tokens_details?.cached_tokens,
            reasoningTokens:
              raw.reasoningTokens ?? raw.output_tokens_details?.reasoning_tokens,
            estimatedCost: raw.estimatedCost
          }).filter(([, value]) => nonnegative(value))
        );
        throw Object.assign(new Error("Evaluation transport unavailable."), {
          usage,
          providerAttempts: Number.isSafeInteger(error?.providerAttempts)
            ? error.providerAttempts
            : 1,
          completedResponses: Number.isSafeInteger(error?.completedResponses)
            ? error.completedResponses
            : 0
        });
      }
    },
    beginTrial(key, trialBinding) {
      const prior = trials.get(key);
      if (prior && prior.binding !== hashDiscoveryContent(trialBinding))
        throw new Error("Trial fingerprint mismatch.");
      if (prior?.status === "completed")
        return { completed: true, artifact: prior.artifact };
      if (prior)
        throw new Error(
          "Uncertain prior trial requires reconciliation; it will not be reissued."
        );
      if (halted) throw new Error("Campaign accounting is halted.");
      append("trial.start", { key, binding: hashDiscoveryContent(trialBinding) });
      return { completed: false };
    },
    finishTrial(key, value) {
      const prior = trials.get(key);
      if (!prior || prior.status !== "pending")
        throw new Error("Trial was not pending.");
      const artifact = this.writeArtifact(
        `trial-${hashDiscoveryContent(key).slice(7)}.json`,
        value
      );
      append("trial.end", { key, binding: prior.binding, artifact });
    },
    writeArtifact(name, value) {
      if (!/^[a-zA-Z0-9_.-]+\.json$/.test(name))
        throw new Error("Invalid artifact name.");
      const serialized = JSON.stringify(value, null, 2) + "\n";
      if (Buffer.byteLength(serialized) > 16 * 1024 * 1024)
        throw new Error("Artifact exceeds its bound.");
      const target = path.join(directory, name),
        temporary = target + ".pending";
      if (existsSync(target)) {
        if (readFileSync(target, "utf8") !== serialized)
          throw new Error(
            "Immutable campaign artifact already exists with different content."
          );
      } else {
        const fd = openSync(temporary, "wx");
        try {
          writeFileSync(fd, serialized);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        renameSync(temporary, target);
      }
      return { name, hash: hashDiscoveryContent(value) };
    },
    readArtifact(artifact) {
      if (!artifact || !/^[a-zA-Z0-9_.-]+\.json$/.test(artifact.name))
        throw new Error("Invalid artifact reference.");
      const target = path.join(directory, artifact.name);
      if (statSync(target).size > 16 * 1024 * 1024)
        throw new Error("Artifact exceeds its bound.");
      const value = JSON.parse(readFileSync(target, "utf8"));
      if (hashDiscoveryContent(value) !== artifact.hash)
        throw new Error("Campaign artifact integrity failure.");
      return value;
    },
    record(type, data) {
      append(type, data);
    },
    records() {
      return structuredClone(records);
    },
    snapshot() {
      return structuredClone({
        fingerprint,
        charged,
        held: held(),
        pendingReservations: reservations.size,
        pendingHttp: http.size,
        httpRequests: httpCount,
        halted,
        completedTrials: [...trials.values()].filter((x) => x.status === "completed")
          .length,
        pendingTrials: [...trials.values()].filter((x) => x.status === "pending").length
      });
    },
    close() {
      if (!closed) {
        closed = true;
        closeSync(descriptor);
        closeSync(lock);
        unlinkSync(lockPath);
      }
    }
  });
}
