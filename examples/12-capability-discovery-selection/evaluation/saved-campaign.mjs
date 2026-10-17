import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  buildCapabilitySearchCorpus,
  hashDiscoveryContent,
  fingerprintDiscoveryEvaluationSuite,
  validateCapabilityEmbeddingIndex,
  DISCOVERY_STANDARD_PROFILE
} from "ai-capability-framework/discovery";
import {
  campaignBinding,
  loadSuite,
  registryFor,
  trialSchedule,
  MODES,
  CAPS
} from "./campaign.mjs";
import { QUALIFICATION_WORKFLOWS } from "./qualification-workflows.mjs";
import { FROZEN_V3, FROZEN_QUALIFICATION_WORKFLOWS } from "./freeze.mjs";

export const byteHash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const requireEvidence = (condition) => {
  if (!condition)
    throw new Error("Saved campaign evidence is incomplete or incompatible.");
};
export function readBounded(filename, maximum) {
  requireEvidence(
    fs.statSync(filename).isFile() && fs.statSync(filename).size <= maximum
  );
  const bytes = fs.readFileSync(filename);
  requireEvidence(bytes.length <= maximum);
  return bytes;
}
const parse = (filename, maximum) =>
  JSON.parse(readBounded(filename, maximum).toString("utf8"));
const fingerprint = (value) =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const quantities = ["providerCalls", "inputTokens", "outputTokens", "estimatedCost"];
const same = (left, right) =>
  hashDiscoveryContent(left) === hashDiscoveryContent(right);
const close = (left, right) =>
  typeof right === "number" &&
  Math.abs(left - right) <= Math.max(1e-10, Math.abs(left) * 1e-10);

export function readSavedArtifact(directory, reference) {
  requireEvidence(
    reference &&
      /^[a-zA-Z0-9_.-]+\.json$/.test(reference.name) &&
      fingerprint(reference.hash)
  );
  const filename = path.join(directory, reference.name);
  requireEvidence(
    path.dirname(fs.realpathSync(filename)) === fs.realpathSync(directory)
  );
  const bytes = readBounded(filename, 16 * 1024 * 1024),
    value = JSON.parse(bytes.toString("utf8"));
  requireEvidence(hashDiscoveryContent(value) === reference.hash);
  return { value, bytesHash: byteHash(bytes) };
}

export function validateSavedSchedule(records, trials, suite) {
  const scheduled = [
    "administrative-index",
    ...["train", "baseline", "qualify"].flatMap((stage) =>
      trialSchedule(suite, stage).map((t) => t.key)
    ),
    ...QUALIFICATION_WORKFLOWS.flatMap((w) =>
      MODES.map((mode) => `workflow.${w.id}.${mode.replace("/", ".")}`)
    )
  ];
  requireEvidence(
    same([...trials.keys()], scheduled) && [...trials.values()].every((t) => !t.pending)
  );
  requireEvidence(
    same(
      records.filter((r) => r.type === "stage.complete").map((r) => r.data),
      [
        ...["train", "baseline", "qualify"].map((stage) => ({
          stage,
          hash: hashDiscoveryContent(trialSchedule(suite, stage)),
          count: trialSchedule(suite, stage).length
        })),
        { stage: "workflows", count: 48 }
      ]
    ) &&
      records.filter((r) => r.type === "profile.freeze").length === 1 &&
      records.find((r) => r.type === "profile.freeze").data.k === 8
  );
  return scheduled;
}

/** Reads immutable evidence only. Never opens a campaign ledger or host configuration. */
export function readSavedCampaign(inputPath) {
  const manifest = parse(inputPath, 64_000);
  requireEvidence(
    Object.keys(manifest).sort().join() ===
      "campaignDirectory,campaignFingerprint,journalHash,reportHash,reportPath,schemaVersion"
  );
  requireEvidence(
    manifest.schemaVersion === "1.0" &&
      [manifest.campaignFingerprint, manifest.journalHash, manifest.reportHash].every(
        fingerprint
      ) &&
      [manifest.campaignDirectory, manifest.reportPath].every(
        (p) => typeof p === "string" && p.trim()
      )
  );
  const directory = fs.realpathSync(
    path.resolve(path.dirname(inputPath), manifest.campaignDirectory)
  );
  const reportPath = fs.realpathSync(
    path.resolve(path.dirname(inputPath), manifest.reportPath)
  );
  requireEvidence(!fs.existsSync(path.join(directory, "campaign.lock")));
  const journal = readBounded(path.join(directory, "journal.jsonl"), 64 * 1024 * 1024);
  const reportBytes = readBounded(reportPath, 16 * 1024 * 1024);
  requireEvidence(
    byteHash(journal) === manifest.journalHash &&
      byteHash(reportBytes) === manifest.reportHash &&
      journal.at(-1) === 10
  );
  const original = JSON.parse(reportBytes.toString("utf8"));
  requireEvidence(
    original.status === "evaluation_completed" &&
      original.report?.complete &&
      original.campaignFingerprint === manifest.campaignFingerprint
  );
  const suite = loadSuite(),
    registry = registryFor(suite),
    corpus = buildCapabilitySearchCorpus(registry);
  requireEvidence(
    fingerprintDiscoveryEvaluationSuite(suite) === FROZEN_V3 &&
      hashDiscoveryContent(QUALIFICATION_WORKFLOWS) === FROZEN_QUALIFICATION_WORKFLOWS
  );
  const records = journal
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => {
      requireEvidence(line.length <= 128_000);
      return JSON.parse(line);
    });
  const head = records[0]?.data;
  requireEvidence(
    records[0]?.type === "campaign" &&
      head?.fingerprint === manifest.campaignFingerprint &&
      hashDiscoveryContent({ binding: head.binding, caps: head.caps }) ===
        head.fingerprint
  );
  const { predecessor, ...binding } = head.binding;
  requireEvidence(
    same(
      binding,
      campaignBinding(
        suite,
        QUALIFICATION_WORKFLOWS,
        binding.sourceFingerprint,
        binding.hostIdentity
      )
    ) &&
      fingerprint(binding.sourceFingerprint) &&
      binding.hostIdentity.mock === false &&
      predecessor &&
      Object.keys(CAPS).every(
        (key) =>
          Number.isFinite(head.caps[key]) &&
          head.caps[key] >= 0 &&
          head.caps[key] <= CAPS[key]
      )
  );
  const artifacts = [];
  const readArtifact = (reference) => {
    const { value, bytesHash } = readSavedArtifact(directory, reference);
    artifacts.push({
      name: reference.name,
      hash: reference.hash,
      bytesHash
    });
    return value;
  };
  const { values, trials, charged, httpRequests, index } = verifySavedJournal(
    records,
    readArtifact
  );
  const scheduled = validateSavedSchedule(records, trials, suite);
  const ledger = original.report.ledger;
  requireEvidence(
    !ledger.halted &&
      ledger.pendingReservations === 0 &&
      ledger.pendingHttp === 0 &&
      ledger.pendingTrials === 0 &&
      ledger.completedTrials === scheduled.length &&
      ledger.httpRequests === httpRequests &&
      ledger.fingerprint === head.fingerprint &&
      same(ledger.caps, head.caps) &&
      quantities.every(
        (key) =>
          close(charged[key], ledger.charged[key]) && charged[key] <= head.caps[key]
      ) &&
      httpRequests <= head.caps.httpRequests
  );
  const identity = hashDiscoveryContent({
    execution: binding.execution,
    tokenizerIdentity: binding.hostIdentity.tokenizerIdentity,
    pricing: binding.hostIdentity.pricing,
    mock: false
  });
  requireEvidence(
    index &&
      index.indexFingerprint === original.indexFingerprint &&
      validateCapabilityEmbeddingIndex(index, {
        corpus,
        configuration: {
          provider: "openai",
          model: binding.execution.embeddingModel,
          dimensions: 1536,
          configurationId: `evaluation.embedding.${identity.slice(7, 23)}`
        },
        mock: false,
        limits: DISCOVERY_STANDARD_PROFILE.indexLimits
      }).valid
  );
  const expectedTrials = ["train", "baseline", "qualify"].flatMap((stage) =>
    trialSchedule(suite, stage)
  );
  const taskValues = values.filter((v) => v.observation),
    workflows = values.filter((v) => v.workflowId);
  requireEvidence(
    same(
      taskValues.map((v) => v.trial),
      expectedTrials
    ) &&
      workflows.length === 48 &&
      values.length === scheduled.length
  );
  for (const value of taskValues)
    requireEvidence(
      trials.get(value.trial.key).binding ===
        hashDiscoveryContent({
          trial: value.trial,
          campaign: head.fingerprint,
          index: value.trial.mode.startsWith("hybrid") ? index.indexFingerprint : null
        })
    );
  for (const scenario of QUALIFICATION_WORKFLOWS)
    for (const mode of MODES) {
      const matching = workflows.filter(
        (w) => w.workflowId === scenario.id && w.mode === mode
      );
      requireEvidence(
        matching.length === 1 &&
          matching[0].kind === scenario.kind &&
          trials.get(`workflow.${scenario.id}.${mode.replace("/", ".")}`).binding ===
            hashDiscoveryContent({
              workflow: hashDiscoveryContent(scenario),
              mode,
              k: 8,
              campaign: head.fingerprint
            })
      );
    }
  return {
    manifest,
    original,
    suite,
    registry,
    taskValues,
    workflows,
    ledger,
    artifacts,
    directory,
    reportPath,
    binding,
    trialArtifacts: Object.fromEntries(
      [...trials].map(([key, value]) => [key, value.artifact])
    ),
    journalRecords: records.length
  };
}

/** Pure journal reconciliation, also used by synthetic integrity regressions. */
export function verifySavedJournal(records, readArtifact) {
  requireEvidence(records[0]?.type === "campaign");
  const values = [],
    trials = new Map(),
    reservations = new Map(),
    settled = new Set(),
    http = new Set(),
    httpSeen = new Set();
  const charged = Object.fromEntries(quantities.map((key) => [key, 0]));
  let previous = null,
    httpRequests = 0,
    index = null;
  for (const [offset, { hash, ...record }] of records.entries()) {
    const d = record.data;
    requireEvidence(
      record.sequence === offset + 1 &&
        record.previous === previous &&
        hashDiscoveryContent(record) === hash
    );
    previous = hash;
    requireEvidence(
      [
        "campaign",
        "capacity.preflight",
        "reservation",
        "settlement",
        "http.start",
        "http.end",
        "trial.start",
        "trial.end",
        "index.ready",
        "schedule",
        "stage.complete",
        "profile.freeze",
        "halt"
      ].includes(record.type)
    );
    if (record.type === "campaign") requireEvidence(offset === 0);
    if (record.type === "halt") requireEvidence(false);
    if (record.type === "reservation") {
      requireEvidence(!reservations.has(d.id) && !settled.has(d.id));
      reservations.set(d.id, d);
    }
    if (record.type === "settlement") {
      const reservation = reservations.get(d.id),
        attempts = Math.max(d.providerAttempts, d.completedResponses);
      requireEvidence(
        reservation &&
          reservation.runId === d.runId &&
          [d.providerAttempts, d.completedResponses].every(
            (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1
          ) &&
          Object.values(d.usage).every((n) => Number.isFinite(n) && n >= 0)
      );
      for (const key of quantities) {
        const amount =
          key === "providerCalls"
            ? attempts
            : (d.usage[key] ?? (attempts ? reservation.amounts[key] : 0));
        requireEvidence(
          Number.isFinite(amount) &&
            amount >= 0 &&
            d.charged[key] === amount &&
            amount <= reservation.amounts[key]
        );
        charged[key] += amount;
      }
      reservations.delete(d.id);
      settled.add(d.id);
    }
    if (record.type === "http.start") {
      requireEvidence(!httpSeen.has(d.id) && Number.isFinite(d.fee) && d.fee >= 0);
      httpSeen.add(d.id);
      http.add(d.id);
      httpRequests++;
      charged.estimatedCost += d.fee;
    }
    if (record.type === "http.end") requireEvidence(http.delete(d.id));
    if (record.type === "trial.start") {
      requireEvidence(!trials.has(d.key));
      trials.set(d.key, { binding: d.binding, pending: true });
    }
    if (record.type === "trial.end") {
      const trial = trials.get(d.key);
      requireEvidence(trial?.pending && trial.binding === d.binding);
      trial.pending = false;
      trial.artifact = d.artifact;
      const value = readArtifact(d.artifact);
      values.push(value);
      if (d.key === "administrative-index") {
        requireEvidence(value.status === "built");
        index = value.index;
      }
    }
    if (record.type === "index.ready")
      requireEvidence(same(readArtifact(d.artifact).index, index));
  }
  requireEvidence(
    !reservations.size && !http.size && [...trials.values()].every((t) => !t.pending)
  );
  return { values, trials, charged, httpRequests, index };
}
