import type { CapabilityRouteRequest } from "../runtime/types.js";
import { captureEligibility } from "./bindings.js";
import { registrySourceFingerprint } from "./corpus.js";
import { discoveryStopReason } from "./discoverer.js";
import { DiscoveryError } from "./diagnostics.js";
import type { CapabilityDiscoveryResult, CapabilitySelectionBatchResult, DiscoveryRouteResult } from "./types.js";

export function validateRouterLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 20)) {
    throw new DiscoveryError({ code: "invalid_input", message: "maxCapabilities must be an integer from 1 through 20." });
  }
}

/** A task-local selector decision narrows an already validated shortlist. */
export function exportSelectedResult(
  request: CapabilityRouteRequest & { signal?: AbortSignal; deadlineAt?: number },
  original: CapabilityDiscoveryResult, batch: CapabilitySelectionBatchResult, source: string, current = true
): DiscoveryRouteResult {
  const exported = exportDiscoveryResult(request, original, source, current);
  const outcome = batch.outcomes.find(item => item.queryId === original.queryId);
  const selected = outcome?.status === "selected" && exported.discovery[0]?.status === "matched"
    && request.registry.capabilityById.get(outcome.capabilityId)?.manifest.version === outcome.capabilityVersion
    ? outcome.capabilityId : undefined;
  const items = exported.slice.items.filter(item => item.capabilityId === selected).map(item => ({ ...item,
    reasons: ["Selected for this task by the explicitly configured selector; execution authorization remains required."] }));
  return { ...exported, selection: batch.outcomes, selectionBatch: batch, slice: {
    items, excluded: [...exported.slice.excluded, ...exported.slice.items.filter(item => item.capabilityId !== selected)
      .map(item => ({ capabilityId: item.capabilityId, reason: "Capability was not selected for this task." }))],
    warnings: items.length ? exported.slice.warnings : [...exported.slice.warnings, {
      code: "selection_" + (outcome?.status ?? "not_submitted"), message: "Selection did not provide a current actionable capability for this task."
    }]
  } };
}

/** Shared final gate for fresh retrieval and request-bound shortlist reuse. */
export function exportDiscoveryResult(
  request: CapabilityRouteRequest & { signal?: AbortSignal; deadlineAt?: number },
  original: CapabilityDiscoveryResult,
  sourceFingerprint: string,
  bindingCurrent = true
): DiscoveryRouteResult {
  let result = original;
  let eligibility: ReturnType<typeof captureEligibility> | undefined;
  let current = false;
  try {
    eligibility = captureEligibility(request);
    current = bindingCurrent && eligibility.fingerprint === result.eligibilityFingerprint
      && registrySourceFingerprint(request.registry) === sourceFingerprint;
  } catch { /* Invalidated live registries cannot yield a tool slice. */ }
  const stop = discoveryStopReason(request);
  if (stop || (!current && result.status === "matched")) {
    const code = stop ?? "stale_binding";
    result = {
      ...result, status: stop ? "cancelled" : "unavailable", actualMode: null, candidates: [],
      diagnostics: [{ code, queryId: result.queryId, message: stop
        ? "Discovery was cancelled or its deadline elapsed." : "Discovery bindings changed before tool export." }]
    };
    delete result.indexFingerprint;
  }
  const candidates = result.status === "matched" ? result.candidates.slice(0, request.maxCapabilities ?? result.candidates.length) : [];
  const selected = new Set(candidates.map(candidate => candidate.capabilityId));
  const excluded = [...(eligibility?.excluded ?? [])];
  for (const entry of eligibility?.eligible ?? []) {
    if (!selected.has(entry.manifest.id)) excluded.push({
      capabilityId: entry.manifest.id, reason: "Capability was not included in the retrieval shortlist."
    });
  }
  const warnings = result.status === "matched" ? [] : [{
    code: "discovery_" + result.status,
    message: result.status === "no_match" ? "Discovery found no eligible candidates meeting the retrieval policy."
      : result.status === "cancelled" ? "Discovery was cancelled or its deadline elapsed."
        : "Discovery is unavailable; no tools were shortlisted."
  }];
  if (result.actualMode === "lexical" && result.degradedReason) warnings.push({
    code: "discovery_lexical_fallback", message: "Discovery used the configured whole-query lexical fallback policy."
  });
  return {
    discovery: [result],
    slice: {
      items: candidates.map(candidate => {
        const manifest = request.registry.capabilityById.get(candidate.capabilityId)!.manifest;
        return {
          capabilityId: candidate.capabilityId, score: candidate.scores.final,
          exposedOperations: manifest.lifecycle.prepare ? ["select", "prepare"] : ["select"],
          reasons: ["Included by the retrieval policy; ordinary tool selection is required."]
        };
      }),
      excluded, warnings
    }
  };
}
