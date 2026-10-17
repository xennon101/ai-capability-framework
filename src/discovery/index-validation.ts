import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { CapabilityEmbeddingIndexArtifact } from "../generated/manifest-types.js";
import { ordinalCompare } from "./corpus.js";
import { DiscoveryError } from "./diagnostics.js";
import { resolveEmbeddingConfiguration, resolveIndexLimits } from "./embedding-configuration.js";
import type {
  CapabilityEmbeddingIndex, CapabilityEmbeddingIndexStore, EmbeddingIndexExpected, EmbeddingIndexValidationResult
} from "./embedding-types.js";
import { canonicalizeDiscoveryValue, fingerprintDiscoveryValue, hashDiscoveryContent, type DiscoveryFingerprintPayloads } from "./fingerprint.js";
import { boundedJsonSnapshot, deepFreeze } from "./json-snapshot.js";
import { validVector } from "./vectors.js";
import { ownValue } from "./usage.js";

let schemaValidator: ValidateFunction | undefined;

export function embeddingIndexFingerprint(index: DiscoveryFingerprintPayloads["index"]): string {
  return fingerprintDiscoveryValue("index", {
    schemaVersion: index.schemaVersion, projectionVersion: index.projectionVersion, mock: index.mock,
    registrySourceFingerprint: index.registrySourceFingerprint, corpusFingerprint: index.corpusFingerprint,
    embedding: index.embedding, embeddingConfigurationFingerprint: index.embeddingConfigurationFingerprint,
    vectorDimension: index.vectorDimension,
    entries: [...index.entries].sort((a, b) => ordinalCompare(a.capabilityId, b.capabilityId))
      .map(({ capabilityId, capabilityVersion, documentHash, vectorHash }) => ({ capabilityId, capabilityVersion, documentHash, vectorHash }))
  });
}

export function validateCapabilityEmbeddingIndex(value: unknown, expected: EmbeddingIndexExpected): EmbeddingIndexValidationResult {
  let code: "invalid_index" | "embedding_configuration_mismatch" = "invalid_index";
  try {
    const limits = resolveIndexLimits(expected.limits);
    const configuration = resolveEmbeddingConfiguration(expected.configuration);
    const rawEntries = ownValue(value, "entries");
    const rawDimension = ownValue(value, "vectorDimension");
    if (!Array.isArray(rawEntries) || rawEntries.length > limits.maxEntries
      || typeof rawDimension !== "number" || !Number.isSafeInteger(rawDimension) || rawDimension < 1
      || rawDimension > limits.maxVectorDimension) throw new Error();
    for (const entry of rawEntries) {
      const vector = ownValue(entry, "vector");
      if (!Array.isArray(vector) || vector.length !== rawDimension) throw new Error();
    }
    const snapshot = boundedJsonSnapshot(value, limits.maxArtifactBytes);
    schemaValidator ??= new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(
      fileURLToPath(new URL("../../schemas/discovery/embedding-index.schema.json", import.meta.url)), "utf8"
    )));
    if (!schemaValidator(snapshot)) throw new Error();
    const index = snapshot as CapabilityEmbeddingIndexArtifact;
    if (index.entries.length > limits.maxEntries || index.vectorDimension > limits.maxVectorDimension
      || expected.corpus.documents.length !== index.entries.length
      || new Date(index.builtAt).toISOString() !== index.builtAt
      || index.projectionVersion !== expected.corpus.projectionVersion
      || index.registrySourceFingerprint !== expected.corpus.registrySourceFingerprint
      || index.corpusFingerprint !== expected.corpus.corpusFingerprint) throw new Error();
    const embeddingFingerprint = fingerprintDiscoveryValue("embedding_configuration", configuration);
    if (canonicalizeDiscoveryValue(index.embedding) !== canonicalizeDiscoveryValue(configuration)
      || index.embeddingConfigurationFingerprint !== embeddingFingerprint || index.mock !== expected.mock
      || configuration.dimensions !== undefined && configuration.dimensions !== index.vectorDimension) {
      code = "embedding_configuration_mismatch"; throw new Error();
    }
    const documents = new Map(expected.corpus.documents.map(document => [document.capabilityId, document]));
    if (documents.size !== expected.corpus.documents.length) throw new Error();
    const seen = new Set<string>();
    for (const entry of index.entries) {
      const document = documents.get(entry.capabilityId);
      if (!document || seen.has(entry.capabilityId) || entry.capabilityVersion !== document.capabilityVersion
        || entry.documentHash !== document.documentHash || !validVector(entry.vector, index.vectorDimension)
        || entry.vectorHash !== hashDiscoveryContent(entry.vector)) throw new Error();
      seen.add(entry.capabilityId);
    }
    if (index.indexFingerprint !== embeddingIndexFingerprint(index)) throw new Error();
    index.entries.sort((a, b) => ordinalCompare(a.capabilityId, b.capabilityId));
    return { valid: true, index: deepFreeze(index), diagnostics: [] };
  } catch {
    return { valid: false, diagnostics: [{ code, message: code === "invalid_index"
      ? "The embedding index is invalid, oversized, incomplete, or stale."
      : "The embedding index and caller embedding configuration are incompatible." }] };
  }
}

export function serializeCapabilityEmbeddingIndex(value: unknown, expected: EmbeddingIndexExpected): string {
  const validated = validateCapabilityEmbeddingIndex(value, expected);
  if (!validated.valid) throw new DiscoveryError(validated.diagnostics[0]!);
  return canonicalizeDiscoveryValue(validated.index);
}

export function parseCapabilityEmbeddingIndex(text: string, expected: EmbeddingIndexExpected): EmbeddingIndexValidationResult {
  try {
    const limits = resolveIndexLimits(expected.limits);
    if (typeof text !== "string" || Buffer.byteLength(text) > limits.maxArtifactBytes) throw new Error();
    return validateCapabilityEmbeddingIndex(JSON.parse(text), expected);
  } catch {
    return { valid: false, diagnostics: [{ code: "invalid_index", message: "The serialized embedding index is invalid or oversized." }] };
  }
}

export async function loadCapabilityEmbeddingIndex(
  store: CapabilityEmbeddingIndexStore, key: string, expected: EmbeddingIndexExpected
): Promise<EmbeddingIndexValidationResult> {
  try {
    const value = await store.read(key);
    return parseCapabilityEmbeddingIndex(value as string, expected);
  } catch {
    return { valid: false, diagnostics: [{ code: "invalid_index", message: "The embedding index could not be loaded." }] };
  }
}

export async function publishCapabilityEmbeddingIndex(
  store: CapabilityEmbeddingIndexStore, key: string, value: unknown, expected: EmbeddingIndexExpected
): Promise<{ published: boolean; diagnostics: readonly import("./diagnostics.js").DiscoveryDiagnostic[] }> {
  const result = validateCapabilityEmbeddingIndex(value, expected);
  if (!result.valid) return { published: false, diagnostics: result.diagnostics };
  try {
    await store.replace(key, canonicalizeDiscoveryValue(result.index));
    return { published: true, diagnostics: [] };
  } catch {
    return { published: false, diagnostics: [{ code: "invalid_index", message: "The complete embedding index could not be published." }] };
  }
}
