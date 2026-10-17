import { isDeepStrictEqual } from "node:util";
import { isRestrictedCapability } from "../adapter-common.js";
import type { CapabilityRouteRequest } from "../runtime/types.js";
import { captureEligibility } from "./bindings.js";
import { hasOnlyKeys, isRecord, nonblank } from "./configuration.js";
import { buildCapabilitySearchCorpus, ordinalCompare } from "./corpus.js";
import { fingerprintDiscoveryValue, hashDiscoveryContent } from "./fingerprint.js";
import { deepFreeze } from "./json-snapshot.js";
import { CANDIDATE_CARD_PROJECTION_VERSION, resolveSelectionExecution, selectionError, selectionJson } from "./selection-configuration.js";
import type { CapabilityCandidateCard, CapabilitySelectionInputTask, CapabilitySelectionRequest, SelectionTask } from "./types.js";
import { DISCOVERY_HARD_LIMITS, SELECTION_DEFAULT_LIMITS, SELECTION_HARD_LIMITS } from "./versions.js";

export interface BuildCapabilitySelectionTasksRequest {
  tasks: readonly CapabilitySelectionInputTask[];
  routeRequest: CapabilityRouteRequest;
  selectorFingerprint: string;
  maxInputCharacters?: number;
}

/** Host text/context are authoritative inputs here; facade callers recover them from issued bindings. */
export function buildCapabilitySelectionTasks(request: CapabilitySelectionRequest): readonly SelectionTask[];
export function buildCapabilitySelectionTasks(request: BuildCapabilitySelectionTasksRequest): readonly SelectionTask[];
export function buildCapabilitySelectionTasks(request: BuildCapabilitySelectionTasksRequest | CapabilitySelectionRequest): readonly SelectionTask[] {
  const resolved = "client" in request ? resolveSelectionExecution(request) : undefined;
  const selectorFingerprint = resolved?.fingerprint ?? (request as BuildCapabilitySelectionTasksRequest).selectorFingerprint;
  const maximum = resolved?.limits.maxInputCharacters ?? (request as BuildCapabilitySelectionTasksRequest).maxInputCharacters ?? SELECTION_DEFAULT_LIMITS.maxInputCharacters;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > SELECTION_HARD_LIMITS.maxInputCharacters
    || !Array.isArray(request.tasks) || request.tasks.length > SELECTION_HARD_LIMITS.maxTasks
    || !/^sha256:[a-f0-9]{64}$/u.test(selectorFingerprint)) throw selectionError("invalid_input");
  const ids = new Set<string>();
  const corpus = buildCapabilitySearchCorpus(request.routeRequest.registry);
  const eligibility = captureEligibility(request.routeRequest);
  const eligible = new Set(eligibility.eligible.map(entry => entry.manifest.id));
  return Object.freeze(request.tasks.map(input => {
    const task = input as CapabilitySelectionInputTask & Partial<Pick<SelectionTask, "cards" | "inputBindingHash">>;
    if (!isRecord(task as unknown) || !hasOnlyKeys(task as unknown as Record<string, unknown>, ["queryId", "requestText", "context", "discovery", "cards", "inputBindingHash"])
      || !nonblank(task.queryId) || ids.has(task.queryId) || typeof task.requestText !== "string"
      || !isRecord(task.discovery as unknown) || task.queryId !== task.discovery.queryId
      || !["matched", "no_match", "unavailable", "cancelled"].includes(task.discovery.status)
      || !Array.isArray(task.discovery.candidates) || task.discovery.candidates.length > DISCOVERY_HARD_LIMITS.maxCandidates
      || task.context !== undefined && !isRecord(task.context as unknown)) throw selectionError("invalid_input");
    ids.add(task.queryId);
    if (task.queryId.length + task.requestText.length > maximum) throw selectionError("input_limit_exceeded");
    const context = task.context === undefined ? undefined : selectionJson(task.context, maximum);
    const cards: CapabilityCandidateCard[] = [];
    const candidates = new Set<string>();
    if (task.discovery.status === "matched") {
      if (!task.discovery.candidates.length) throw selectionError("invalid_selection_input");
      if (task.discovery.corpusFingerprint !== corpus.corpusFingerprint || task.discovery.eligibilityFingerprint !== eligibility.fingerprint) {
        throw selectionError("stale_binding");
      }
      for (const candidate of task.discovery.candidates) {
        const manifest = request.routeRequest.registry.capabilityById.get(candidate.capabilityId)?.manifest;
        if (!manifest || !eligible.has(candidate.capabilityId) || manifest.version !== candidate.capabilityVersion) throw selectionError("stale_binding");
        if (candidates.has(candidate.capabilityId) || isRestrictedCapability(manifest)) throw selectionError("invalid_selection_input");
        candidates.add(candidate.capabilityId);
        cards.push(selectionJson({ capabilityId: manifest.id, capabilityVersion: manifest.version,
          name: manifest.name, modelDescription: manifest.model_description,
          whenToUse: [...(manifest.when_to_use ?? [])], whenNotToUse: [...(manifest.when_not_to_use ?? [])], capabilityType: manifest.capability_type,
          exposedOperations: manifest.lifecycle.prepare ? ["select", "prepare"] : ["select"],
          proposedOperation: manifest.lifecycle.prepare ? "prepare" : "read",
          inputFields: Object.keys(manifest.input_schema.properties ?? {}).sort(ordinalCompare)
        }, maximum) as CapabilityCandidateCard);
      }
    }
    selectionJson({ queryId: task.queryId, requestText: task.requestText, context: context ?? null, cards }, maximum);
    const cardsFingerprint = fingerprintDiscoveryValue("candidate_cards", {
      projectionVersion: CANDIDATE_CARD_PROJECTION_VERSION,
      cards: cards.map(card => ({ capabilityId: card.capabilityId, capabilityVersion: card.capabilityVersion, cardHash: hashDiscoveryContent(card) }))
    });
    const inputBindingHash = hashDiscoveryContent({ kind: "selection_input", version: "1.0", queryId: task.queryId,
      requestText: task.requestText, context: context ?? null, selectorFingerprint, cardsFingerprint,
      source: corpus.registrySourceFingerprint, corpus: task.discovery.corpusFingerprint,
      retrieval: task.discovery.retrievalPolicyFingerprint, eligibility: task.discovery.eligibilityFingerprint,
      index: task.discovery.indexFingerprint ?? null,
      candidates: task.discovery.candidates.map(candidate => ({ capabilityId: candidate.capabilityId, capabilityVersion: candidate.capabilityVersion, rank: candidate.rank }))
    });
    if (Object.hasOwn(task, "cards") || Object.hasOwn(task, "inputBindingHash")) {
      if (!isDeepStrictEqual(task.cards, cards) || task.inputBindingHash !== inputBindingHash) throw selectionError("stale_binding");
    }
    return deepFreeze({ queryId: task.queryId, requestText: task.requestText,
      ...(context === undefined ? {} : { context }),
      discovery: selectionJson(task.discovery, SELECTION_HARD_LIMITS.maxInputCharacters * 4), cards, inputBindingHash });
  }));
}
