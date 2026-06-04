import type { AicfProviderToolResult } from "../shared/types.js";
import type { AicfGeminiFunctionResponsePart } from "./types.js";

export function buildGeminiFunctionResponseParts(
  results: AicfProviderToolResult[]
): AicfGeminiFunctionResponsePart[] {
  return results.map((result) => ({
    functionResponse: {
      ...(result.callId ? { id: result.callId } : {}),
      name: result.providerToolName,
      response: {
        result: result.envelope
      }
    }
  }));
}
