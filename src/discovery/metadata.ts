import type { DiscoveryMetadata } from "../generated/manifest-types.js";
import type { CapabilityManifest } from "../types.js";
import { validateDiscoveryMetadata } from "../validator.js";
import { DiscoveryError } from "./diagnostics.js";
import type { ResolvedDiscoveryMetadata } from "./types.js";

export function resolveDiscoveryMetadata(manifest: CapabilityManifest): ResolvedDiscoveryMetadata {
  const extensions = manifest.extensions;
  if (!extensions || !Object.prototype.hasOwnProperty.call(extensions, "discovery")) {
    return { schemaVersion: "1.0", summary: manifest.summary, aliases: [] };
  }

  const value: unknown = (extensions as Record<string, unknown>).discovery;
  const errors = validateDiscoveryMetadata(value);
  if (errors.length > 0) {
    throw new DiscoveryError({
      code: "invalid_metadata",
      message: "Capability discovery metadata is invalid.",
      capabilityId: manifest.id,
      path: errors[0]?.instancePath ?? "/extensions/discovery"
    });
  }

  const metadata = value as DiscoveryMetadata;
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const alias of metadata.aliases ?? []) {
    const key = alias.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");
    if (!seen.has(key)) {
      seen.add(key);
      aliases.push(alias);
    }
  }

  return {
    schemaVersion: metadata.schema_version,
    summary: metadata.summary ?? manifest.summary,
    aliases
  };
}

