import { DiscoveryError } from "./diagnostics.js";
import { boundedJsonSnapshot as snapshot } from "../runtime/bounded-json.js";
export { deepFreeze } from "../runtime/bounded-json.js";
export function boundedJsonSnapshot(value: unknown, maxBytes: number): unknown {
  try { return snapshot(value, maxBytes); }
  catch { throw new DiscoveryError({ code: "invalid_index", message: "Embedding artifacts require bounded, finite JSON data." }); }
}
