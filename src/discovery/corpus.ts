import type { ManifestRegistry } from "../types.js";
import { validateManifests } from "../validator.js";
import { DiscoveryError } from "./diagnostics.js";
import { fingerprintDiscoveryValue, hashDiscoveryContent } from "./fingerprint.js";
import { tokenizeDiscoveryText, LEXICAL_TOKENIZER_VERSION } from "./lexical.js";
import { resolveDiscoveryMetadata } from "./metadata.js";
import type { CapabilitySearchCorpus } from "./types.js";

export const CAPABILITY_CORPUS_PROJECTION_VERSION = "approved-retrieval-fields.v1";

/** Rechecks definitions and map/list consistency without projecting another corpus. */
export function registrySourceFingerprint(registry: ManifestRegistry): string {
  try {
    const ids = new Set<string>();
    for (const entry of registry.capabilities) {
      const id = entry.manifest.id;
      if (entry.kind !== "capability" || ids.has(id) || registry.capabilityById.get(id) !== entry) throw invalidRegistry();
      ids.add(id);
    }
    if (registry.capabilityById.size !== ids.size) throw invalidRegistry();
    const validation = validateManifests([...registry.capabilities, ...registry.entities, ...registry.evals]);
    if (!validation.valid) throw invalidRegistry();
    return fingerprintDiscoveryValue("registry_source", {
      capabilities: registry.capabilities.map(({ manifest }) => ({
        capabilityId: manifest.id, capabilityVersion: manifest.version, sourceContentHash: hashDiscoveryContent(manifest)
      })).sort((left, right) => ordinalCompare(left.capabilityId, right.capabilityId))
    });
  } catch {
    throw invalidRegistry();
  }
}

export function buildCapabilitySearchCorpus(registry: ManifestRegistry): CapabilitySearchCorpus {
  const source = registrySourceFingerprint(registry);
  const documents = registry.capabilities.map(({ manifest }) => {
    const metadata = resolveDiscoveryMetadata(manifest);
    const content = {
      capabilityId: manifest.id, capabilityVersion: manifest.version, riskTier: manifest.risk_tier,
      name: manifest.name, summary: metadata.summary, aliases: [...metadata.aliases]
    };
    const fields = [content.capabilityId, content.name, content.summary, ...content.aliases];
    return Object.freeze({
      ...content, aliases: Object.freeze(content.aliases), text: fields.join("\n"),
      tokens: Object.freeze([...new Set(fields.flatMap(tokenizeDiscoveryText))]),
      documentHash: hashDiscoveryContent(content)
    });
  }).sort((left, right) => ordinalCompare(left.capabilityId, right.capabilityId));
  return Object.freeze({
    schemaVersion: "1.0", projectionVersion: CAPABILITY_CORPUS_PROJECTION_VERSION,
    registrySourceFingerprint: source, documents: Object.freeze(documents),
    corpusFingerprint: fingerprintDiscoveryValue("corpus", {
      registrySourceFingerprint: source, projectionVersion: CAPABILITY_CORPUS_PROJECTION_VERSION,
      projectionConfiguration: { tokenizerVersion: LEXICAL_TOKENIZER_VERSION },
      documents: documents.map(({ capabilityId, capabilityVersion, documentHash }) => ({
        capabilityId, capabilityVersion, documentHash
      }))
    })
  });
}

export function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidRegistry(): DiscoveryError {
  return new DiscoveryError({ code: "invalid_input", message: "Discovery requires a valid, consistent capability registry." });
}
