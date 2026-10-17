import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { boundedJsonSnapshot, deepFreeze } from "../runtime/bounded-json.js";
import type { CapabilityDiscoverySnapshot } from "../generated/manifest-types.js";

export const DISCOVERY_SNAPSHOT_MAX_BYTES = 1024 * 1024;
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(JSON.parse(readFileSync(
  new URL("../../schemas/replay/discovery-snapshot.schema.json", import.meta.url), "utf8"
)));

/** Shape validation only. Discovery owns source/eligibility checks and ranking replay. */
export function validateDiscoverySnapshotStructure(value: unknown):
  { valid: true; snapshot: CapabilityDiscoverySnapshot } | { valid: false } {
  try {
    if (typeof value === "string" && Buffer.byteLength(value) > DISCOVERY_SNAPSHOT_MAX_BYTES) return { valid: false };
    const snapshot = boundedJsonSnapshot(typeof value === "string" ? JSON.parse(value) : value, DISCOVERY_SNAPSHOT_MAX_BYTES);
    return validate(snapshot) ? { valid: true, snapshot: deepFreeze(snapshot as CapabilityDiscoverySnapshot) } : { valid: false };
  } catch { return { valid: false }; }
}
