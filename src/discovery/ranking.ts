import { semanticSimilarity } from "./vectors.js";
import type { RiskTier } from "../types.js";
import { hasOnlyKeys, isRecord, unitScore } from "./configuration.js";
import { ordinalCompare } from "./corpus.js";
import { DiscoveryError } from "./diagnostics.js";
import { matchingAliases } from "./lexical.js";
import type {
  CapabilityRetrievalDocument, DiscoveryQuery, RankedCapabilityCandidate, ResolvedLexicalDiscoveryConfiguration
} from "./types.js";

const riskRank: Record<RiskTier, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

export function shortlistCandidates(
  output: unknown, query: DiscoveryQuery, documents: readonly CapabilityRetrievalDocument[],
  configuration: ResolvedLexicalDiscoveryConfiguration
): RankedCapabilityCandidate[] {
  return selectRankedCandidates(validateLexicalCandidates(output, query, documents), documents, configuration);
}

export function validateLexicalCandidates(
  output: unknown, query: DiscoveryQuery, documents: readonly CapabilityRetrievalDocument[], requireEqual = false
): RankedCapabilityCandidate[] {
  const invalid = () => new DiscoveryError({
    code: "invalid_ranker_output", message: "The lexical ranker did not return valid eligible scores."
  });
  const byId = new Map(documents.map((document) => [document.capabilityId, document]));
  if (!Array.isArray(output) || output.length > documents.length) {
    // An invalid async implementation must not leave a rejected Promise unobserved.
    if (output instanceof Promise) void output.catch(() => undefined);
    throw invalid();
  }
  const ids = new Set<string>();
  const admitted: RankedCapabilityCandidate[] = [];
  for (const entry of output) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["capabilityId", "scores"])
      || typeof entry.capabilityId !== "string" || ids.has(entry.capabilityId)) throw invalid();
    const document = byId.get(entry.capabilityId);
    const scores = entry.scores;
    if (!document || !isRecord(scores) || !hasOnlyKeys(scores, ["lexical", "aliasPhrase", "semantic", "final"])
      || !unitScore(scores.lexical) || !unitScore(scores.final) || scores.semantic !== null
      || (scores.aliasPhrase !== 0 && scores.aliasPhrase !== 1)) throw invalid();
    const aliases = matchingAliases(query, document);
    if (scores.aliasPhrase !== (aliases.length ? 1 : 0) || requireEqual && scores.final !== scores.lexical) throw invalid();
    ids.add(entry.capabilityId);
    admitted.push({
        capabilityId: document.capabilityId, capabilityVersion: document.capabilityVersion, rank: 0,
        scores: { lexical: scores.lexical, aliasPhrase: scores.aliasPhrase, semantic: null, final: scores.final },
        matchedAliases: aliases, inclusionReason: "aggregate_ranking"
    });
  }
  return admitted;
}

export function selectRankedCandidates(
  candidates: readonly RankedCapabilityCandidate[], documents: readonly CapabilityRetrievalDocument[],
  configuration: Pick<ResolvedLexicalDiscoveryConfiguration, "limits" | "minRetrievalScore">
): RankedCapabilityCandidate[] {
  const byId = new Map(documents.map(document => [document.capabilityId, document]));
  const admitted = candidates.filter(candidate => candidate.scores.final > 0 && candidate.scores.final >= configuration.minRetrievalScore);
  admitted.sort((left, right) => right.scores.final - left.scores.final
    || riskRank[byId.get(left.capabilityId)!.riskTier] - riskRank[byId.get(right.capabilityId)!.riskTier]
    || ordinalCompare(left.capabilityId, right.capabilityId));
  const limit = configuration.limits.maxCandidates;
  const selected = admitted.slice(0, limit);
  if (configuration.limits.aliasDiversitySlots === 1 && selected.length === limit) {
    const alternative = admitted.slice(limit).find((candidate) => candidate.matchedAliases.length > 0);
    if (alternative) selected.splice(selected.length - 1, 1, { ...alternative, inclusionReason: "alias_diversity" });
  }
  return selected.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/** Pure semantic channel shared by serving and authorized offline ranking replay. */
export function rankHybridCandidates(
  candidates: readonly RankedCapabilityCandidate[], queryVector: readonly number[],
  vectors: ReadonlyMap<string, readonly number[]>, documents: readonly CapabilityRetrievalDocument[],
  configuration: import("./types.js").ResolvedHybridDiscoveryConfiguration
): RankedCapabilityCandidate[] {
  const scored = candidates.map(candidate => {
    const semantic = semanticSimilarity(queryVector, vectors.get(candidate.capabilityId)!);
    const final = Math.max(0, Math.min(1, configuration.weights.semantic * semantic + configuration.weights.lexical * candidate.scores.lexical));
    return { ...candidate, scores: { ...candidate.scores, semantic, final } };
  });
  return selectRankedCandidates(scored, documents, configuration);
}
