import { createHash } from "node:crypto";
import type { JsonObject } from "../types.js";
import type {
  CapabilityCandidateCard,
  DiscoveryConfiguration,
  EmbeddingConfiguration,
  ProviderModelConfiguration,
  SelectionLimits
} from "./types.js";
import { DiscoveryError } from "./diagnostics.js";
import { DISCOVERY_BINDING_VERSIONS } from "./versions.js";

export interface CapabilityVersionBinding {
  capabilityId: string;
  capabilityVersion: string;
}

export interface DiscoveryFingerprintPayloads {
  registry_source: {
    capabilities: readonly (CapabilityVersionBinding & { sourceContentHash: string })[];
  };
  corpus: {
    registrySourceFingerprint: string;
    projectionVersion: string;
    projectionConfiguration: JsonObject;
    documents: readonly (CapabilityVersionBinding & { documentHash: string })[];
  };
  embedding_configuration: EmbeddingConfiguration;
  index: {
    schemaVersion: "1.0";
    projectionVersion: string;
    mock: boolean;
    registrySourceFingerprint: string;
    corpusFingerprint: string;
    embedding: EmbeddingConfiguration;
    embeddingConfigurationFingerprint: string;
    vectorDimension: number;
    entries: readonly (CapabilityVersionBinding & { documentHash: string; vectorHash: string })[];
  };
  eligibility: {
    capabilities: readonly (CapabilityVersionBinding & { exposedOperations: readonly ("select" | "prepare")[] })[];
    /** Only explicit, nonsecret routing policy belongs in this projection. */
    policy: JsonObject;
  };
  retrieval_policy: {
    tokenizerVersion: string;
    rankerVersion: string;
    configuration: DiscoveryConfiguration;
  };
  candidate_cards: {
    projectionVersion: string;
    cards: readonly (Pick<CapabilityCandidateCard, "capabilityId" | "capabilityVersion"> & { cardHash: string })[];
  };
  selector: {
    transportVersion?: string;
    promptVersion: string;
    cardProjectionVersion: string;
    outputSchemaVersion: string;
    model: ProviderModelConfiguration;
    mock: boolean;
    limits: SelectionLimits;
    maxEstimatedCostPerCall?: number;
  };
}

export type DiscoveryFingerprintKind = keyof DiscoveryFingerprintPayloads;

/** Strict JSON serialization with ordinal object-key order and unchanged arrays. */
export function canonicalizeDiscoveryValue(value: unknown): string {
  return serialize(value, new Set<object>());
}

/** Content digest for a source manifest or an explicitly projected retrieval document. */
export function hashDiscoveryContent(value: unknown): string {
  return "sha256:" + createHash("sha256").update(canonicalizeDiscoveryValue(value)).digest("hex");
}

export function fingerprintDiscoveryValue<K extends DiscoveryFingerprintKind>(
  kind: K,
  payload: DiscoveryFingerprintPayloads[K]
): string {
  if (!Object.prototype.hasOwnProperty.call(DISCOVERY_BINDING_VERSIONS, kind)) {
    throw invalidPayload();
  }
  const envelope = { kind, version: DISCOVERY_BINDING_VERSIONS[kind], payload };
  return "sha256:" + createHash("sha256").update(canonicalizeDiscoveryValue(envelope)).digest("hex");
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || value === null || ancestors.has(value)) {
    throw invalidPayload();
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if ((!array && prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length) {
    throw invalidPayload();
  }
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (array) {
      const elements: string[] = [];
      if (Object.keys(descriptors).length !== value.length + 1) throw invalidPayload();
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw invalidPayload();
        elements.push(serialize(descriptor.value, ancestors));
      }
      return "[" + elements.join(",") + "]";
    }

    const entries: string[] = [];
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor) || !descriptor.enumerable) throw invalidPayload();
      entries.push(JSON.stringify(key) + ":" + serialize(descriptor.value, ancestors));
    }
    return "{" + entries.join(",") + "}";
  } finally {
    ancestors.delete(value);
  }
}

function invalidPayload(): DiscoveryError {
  return new DiscoveryError({
    code: "invalid_fingerprint_payload",
    message: "Discovery fingerprints require finite JSON data without accessors or cycles."
  });
}

