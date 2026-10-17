import { performance } from "node:perf_hooks";
import { CAPABILITY_CORPUS_PROJECTION_VERSION, ordinalCompare } from "./corpus.js";
import { hasOnlyKeys, isRecord } from "./configuration.js";
import { DiscoveryError, type DiscoveryDiagnosticCode } from "./diagnostics.js";
import {
  checkEmbeddingTexts, inputLimit, invalidEmbeddingConfiguration, positiveInteger,
  resolveEmbeddingConfiguration, resolveEmbeddingExecution, resolveIndexLimits
} from "./embedding-configuration.js";
import type { CapabilityEmbeddingIndexBuildRequest, CapabilityEmbeddingIndexBuildResult } from "./embedding-types.js";
import { runEmbeddingAttempt, stopReason, validateProviderInvocation } from "./embeddings.js";
import { canonicalizeDiscoveryValue, fingerprintDiscoveryValue, hashDiscoveryContent } from "./fingerprint.js";
import { embeddingIndexFingerprint, validateCapabilityEmbeddingIndex } from "./index-validation.js";
import { boundedJsonSnapshot, deepFreeze } from "./json-snapshot.js";
import { LEXICAL_TOKENIZER_VERSION, tokenizeDiscoveryText } from "./lexical.js";
import type { CapabilitySearchCorpus, DiscoveryStageUsage } from "./types.js";
import { aggregateDiscoveryUsage } from "./usage.js";

export async function buildCapabilityEmbeddingIndex(request: CapabilityEmbeddingIndexBuildRequest): Promise<CapabilityEmbeddingIndexBuildResult> {
  validateProviderInvocation(request);
  const started = performance.now();
  const limits = resolveIndexLimits(request.limits);
  const execution = resolveEmbeddingExecution(request.execution);
  const configuration = resolveEmbeddingConfiguration(request.client.configuration);
  if (typeof request.client.mock !== "boolean" || typeof request.client.embed !== "function"
    || !positiveInteger(request.batchSize) || !positiveInteger(request.maxProviderCalls)) throw invalidEmbeddingConfiguration();
  const corpus = snapshotCorpus(request.corpus, limits.maxEntries, limits.maxArtifactBytes, execution.limits.maxCharactersPerText);
  const stages: DiscoveryStageUsage[] = [];
  const failed = (code: DiscoveryDiagnosticCode, message: string): CapabilityEmbeddingIndexBuildResult => ({
    status: code === "cancelled" || code === "deadline_exceeded" ? "cancelled" : "unavailable",
    index: null, usage: aggregateDiscoveryUsage(stages, performance.now() - started), diagnostics: [{ code, message }]
  });
  if (!corpus.documents.length) return failed("invalid_input", "An empty corpus cannot produce an embedding index.");
  const calls = Math.ceil(corpus.documents.length / request.batchSize);
  if (calls > request.maxProviderCalls || calls > execution.budgetPolicy.maxProviderCallsPerRun!) throw inputLimit();
  if (configuration.dimensions !== undefined && configuration.dimensions > limits.maxVectorDimension) throw inputLimit();
  for (let start = 0; start < corpus.documents.length; start += request.batchSize) {
    checkEmbeddingTexts(corpus.documents.slice(start, start + request.batchSize).map(document => document.text), execution.limits);
  }
  const base = {
    schemaVersion: "1.0" as const, projectionVersion: corpus.projectionVersion,
    registrySourceFingerprint: corpus.registrySourceFingerprint, corpusFingerprint: corpus.corpusFingerprint,
    embedding: configuration, embeddingConfigurationFingerprint: fingerprintDiscoveryValue("embedding_configuration", configuration),
    mock: request.client.mock, vectorDimension: configuration.dimensions ?? limits.maxVectorDimension,
    builtAt: new Date().toISOString(), indexFingerprint: "sha256:" + "0".repeat(64),
    entries: corpus.documents.map(document => ({
      capabilityId: document.capabilityId, capabilityVersion: document.capabilityVersion,
      documentHash: document.documentHash, vector: [] as number[], vectorHash: "sha256:" + "0".repeat(64)
    }))
  };
  // Conservative complete-artifact bound: JSON finite-number spelling takes at most 25 bytes plus a comma.
  if (Buffer.byteLength(canonicalizeDiscoveryValue(base))
    + corpus.documents.length * (base.vectorDimension * 26 + 1) > limits.maxArtifactBytes) throw inputLimit();
  let dimension = configuration.dimensions;
  const entries: typeof base.entries = [];
  for (let start = 0; start < corpus.documents.length; start += request.batchSize) {
    const stopped = stopReason(request);
    if (stopped) return failed(stopped, "The embedding index build was cancelled or its deadline elapsed.");
    const documents = corpus.documents.slice(start, start + request.batchSize);
    const result = await runEmbeddingAttempt({
      ...request, configuration, mock: base.mock, execution, texts: documents.map(document => document.text),
      stage: "embedding_build", maxVectorDimension: limits.maxVectorDimension, expectedDimension: dimension
    });
    stages.push(...result.usage.stages);
    if (result.status !== "completed") return {
      status: result.status, index: null, usage: aggregateDiscoveryUsage(stages, performance.now() - started),
      diagnostics: result.diagnostics
    };
    dimension = result.vectorDimension;
    for (const [offset, document] of documents.entries()) {
      const vector = [...result.vectors[offset]!];
      entries.push({
        capabilityId: document.capabilityId, capabilityVersion: document.capabilityVersion,
        documentHash: document.documentHash, vector, vectorHash: hashDiscoveryContent(vector)
      });
    }
  }
  const stopped = stopReason(request);
  if (stopped) return failed(stopped, "The embedding index build was cancelled or its deadline elapsed.");
  const artifact = { ...base, vectorDimension: dimension!, entries };
  artifact.indexFingerprint = embeddingIndexFingerprint(artifact);
  const validated = validateCapabilityEmbeddingIndex(artifact, { corpus, configuration, mock: base.mock, limits });
  if (!validated.valid) return { status: "unavailable", index: null, diagnostics: validated.diagnostics,
    usage: aggregateDiscoveryUsage(stages, performance.now() - started) };
  return { status: "built", index: validated.index, diagnostics: [], usage: aggregateDiscoveryUsage(stages, performance.now() - started) };
}

function snapshotCorpus(value: CapabilitySearchCorpus, maxEntries: number, maxBytes: number, maxText: number): CapabilitySearchCorpus {
  try {
    if (!isRecord(value) || !Array.isArray(value.documents) || value.documents.length > maxEntries) throw inputLimit();
    const corpus = boundedJsonSnapshot(value, Math.min(Number.MAX_SAFE_INTEGER, maxBytes + maxEntries * maxText * 16)) as CapabilitySearchCorpus;
    if (corpus.schemaVersion !== "1.0" || corpus.projectionVersion !== CAPABILITY_CORPUS_PROJECTION_VERSION
      || !/^sha256:[a-f0-9]{64}$/.test(corpus.registrySourceFingerprint)) throw new Error();
    const seen = new Set<string>();
    for (const document of corpus.documents) {
      if (!isRecord(document) || !hasOnlyKeys(document, ["capabilityId", "capabilityVersion", "riskTier", "name", "summary", "aliases", "text", "tokens", "documentHash"])
        || typeof document.capabilityId !== "string" || seen.has(document.capabilityId)
        || typeof document.name !== "string" || typeof document.summary !== "string"
        || !Array.isArray(document.aliases) || !document.aliases.every(alias => typeof alias === "string")
        || !["none", "low", "medium", "high", "critical"].includes(document.riskTier)) throw new Error();
      seen.add(document.capabilityId);
      const { capabilityId, capabilityVersion, riskTier, name, summary, aliases } = document;
      const fields = [capabilityId, name, summary, ...aliases];
      if (document.text.length > maxText) throw inputLimit();
      if (document.text !== fields.join("\n")
        || document.documentHash !== hashDiscoveryContent({ capabilityId, capabilityVersion, riskTier, name, summary, aliases })
        || canonicalizeDiscoveryValue(document.tokens) !== canonicalizeDiscoveryValue([...new Set(fields.flatMap(tokenizeDiscoveryText))])) throw new Error();
    }
    const documents = [...corpus.documents].sort((a, b) => ordinalCompare(a.capabilityId, b.capabilityId));
    if (corpus.corpusFingerprint !== fingerprintDiscoveryValue("corpus", {
      registrySourceFingerprint: corpus.registrySourceFingerprint, projectionVersion: corpus.projectionVersion,
      projectionConfiguration: { tokenizerVersion: LEXICAL_TOKENIZER_VERSION },
      documents: documents.map(({ capabilityId, capabilityVersion, documentHash }) => ({ capabilityId, capabilityVersion, documentHash }))
    })) throw new Error();
    return deepFreeze({ ...corpus, documents });
  } catch (error) {
    if (error instanceof DiscoveryError && error.code === "input_limit_exceeded") throw error;
    throw new DiscoveryError({ code: "invalid_input", message: "An index build requires a current approved-field corpus snapshot." });
  }
}
