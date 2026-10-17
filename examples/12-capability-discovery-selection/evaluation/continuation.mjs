import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { hashDiscoveryContent } from "ai-capability-framework/discovery";
import { CAPS } from "./campaign.mjs";
import { openCampaignLedger } from "./durable-budget.mjs";

/** Read-only reconciliation; the caller pins both identity and exact journal bytes. */
export function verifyPredecessor(predecessor) {
  if (
    !predecessor ||
    Object.keys(predecessor).sort().join() !== "directory,fingerprint,journalHash"
  )
    throw new Error("A pinned predecessor is required.");
  const directory = path.resolve(predecessor.directory),
    filename = path.join(directory, "journal.jsonl");
  if (existsSync(path.join(directory, "campaign.lock")))
    throw new Error("Predecessor is still owned.");
  if (statSync(filename).size > 64 * 1024 * 1024)
    throw new Error("Predecessor journal exceeds bound.");
  const bytes = readFileSync(filename);
  const journalHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (journalHash !== predecessor.journalHash || !bytes.toString().endsWith("\n"))
    throw new Error("Predecessor journal hash mismatch.");
  let sequence = 0,
    previous = null,
    head,
    halted = false;
  const reservations = new Map(),
    pendingHttp = new Set(),
    pendingTrials = new Set(),
    settled = new Set();
  const consumed = Object.fromEntries(Object.keys(CAPS).map((key) => [key, 0]));
  for (const line of bytes.toString().trimEnd().split("\n")) {
    if (line.length > 128_000) throw new Error("Oversized predecessor record.");
    const { hash, ...record } = JSON.parse(line),
      d = record.data;
    if (
      record.sequence !== ++sequence ||
      record.previous !== previous ||
      hashDiscoveryContent(record) !== hash
    )
      throw new Error("Predecessor integrity failure.");
    previous = hash;
    if (sequence === 1) {
      if (
        record.type !== "campaign" ||
        d.fingerprint !== predecessor.fingerprint ||
        hashDiscoveryContent({ binding: d.binding, caps: d.caps }) !== d.fingerprint ||
        hashDiscoveryContent(d.caps) !== hashDiscoveryContent(CAPS)
      )
        throw new Error("Predecessor campaign mismatch.");
      head = d;
    }
    if (record.type === "reservation") {
      if (reservations.has(d.id) || settled.has(d.id))
        throw new Error("Duplicate predecessor reservation.");
      reservations.set(d.id, d);
    }
    if (record.type === "settlement") {
      const reservation = reservations.get(d.id);
      if (!reservation || settled.has(d.id))
        throw new Error("Duplicate predecessor settlement.");
      const attempts = Math.max(d.providerAttempts, d.completedResponses);
      if (!Number.isSafeInteger(attempts) || attempts < 0 || attempts > 1)
        throw new Error("Invalid predecessor attempts.");
      for (const key of [
        "providerCalls",
        "inputTokens",
        "outputTokens",
        "estimatedCost"
      ]) {
        const expected =
          key === "providerCalls"
            ? attempts
            : (d.usage[key] ?? (attempts ? reservation.amounts[key] : 0));
        if (!Number.isFinite(expected) || expected < 0 || d.charged[key] !== expected)
          throw new Error("Predecessor charge mismatch.");
        consumed[key] += expected;
      }
      reservations.delete(d.id);
      settled.add(d.id);
    }
    if (record.type === "http.start") {
      if (pendingHttp.has(d.id) || !Number.isFinite(d.fee) || d.fee < 0)
        throw new Error("Invalid predecessor HTTP charge.");
      consumed.httpRequests++;
      consumed.estimatedCost += d.fee;
      pendingHttp.add(d.id);
    }
    if (record.type === "http.end") {
      if (!pendingHttp.delete(d.id))
        throw new Error("Invalid predecessor HTTP completion.");
    }
    if (record.type === "trial.start") pendingTrials.add(d.key);
    if (record.type === "trial.end") {
      if (!pendingTrials.delete(d.key))
        throw new Error("Invalid predecessor trial completion.");
    }
    if (record.type === "halt") halted = true;
  }
  if (!head || halted || reservations.size || pendingHttp.size || pendingTrials.size)
    throw new Error("Predecessor requires reconciliation.");
  const remaining = Object.fromEntries(
    Object.keys(CAPS).map((key) => [
      key,
      key === "estimatedCost"
        ? Math.floor((CAPS[key] - consumed[key]) * 1e12) / 1e12
        : CAPS[key] - consumed[key]
    ])
  );
  if (Object.values(remaining).some((value) => value < 0))
    throw new Error("Predecessor exhausted campaign caps.");
  return {
    fingerprint: predecessor.fingerprint,
    journalHash,
    lastRecordHash: previous,
    directory,
    consumed,
    remaining
  };
}

export function openContinuationLedger({ predecessor, directory, binding, caps }) {
  const prior = verifyPredecessor(predecessor),
    resolvedCaps = { ...prior.remaining, ...caps };
  if (
    Object.entries(resolvedCaps).some(
      ([key, value]) =>
        !(key in CAPS) ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > prior.remaining[key]
    )
  )
    throw new Error("Continuation cannot increase remaining caps.");
  const continuationBinding = {
    ...binding,
    predecessor: {
      fingerprint: prior.fingerprint,
      journalHash: prior.journalHash,
      lastRecordHash: prior.lastRecordHash
    }
  };
  const fingerprint = hashDiscoveryContent({
    binding: continuationBinding,
    caps: resolvedCaps
  });
  const claim = {
    fingerprint,
    directory: path.resolve(directory),
    predecessorJournalHash: prior.journalHash
  };
  const claimPath = path.join(prior.directory, "continuation.json");
  // Permanent exclusive ownership: a crash may resume this identity, never start a sibling.
  try {
    const fd = openSync(claimPath, "wx");
    try {
      writeFileSync(fd, JSON.stringify(claim));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (
      statSync(claimPath).size > 4096 ||
      hashDiscoveryContent(JSON.parse(readFileSync(claimPath, "utf8"))) !==
        hashDiscoveryContent(claim)
    )
      throw new Error("Predecessor already has a different continuation.");
  }
  if (existsSync(path.join(prior.directory, "campaign.lock")))
    throw new Error("Predecessor became active; reconcile ownership before resuming.");
  const ledger = openCampaignLedger({
    directory,
    binding: continuationBinding,
    caps: resolvedCaps
  });
  return Object.freeze({
    ...ledger,
    snapshot() {
      const current = ledger.snapshot();
      const cumulative = Object.fromEntries(
        Object.keys(CAPS).map((key) => [
          key,
          prior.consumed[key] +
            (key === "httpRequests" ? current.httpRequests : current.charged[key])
        ])
      );
      return structuredClone({
        ...current,
        caps: resolvedCaps,
        prior: prior.consumed,
        cumulative,
        predecessor: { fingerprint: prior.fingerprint, journalHash: prior.journalHash }
      });
    }
  });
}
