import { hashAuditValue } from "../audit/index.js";
import { deriveSegmentTrust } from "./trust.js";
import type { SourceRef, SourceType } from "./types.js";

export function createSourceRef(input: {
  content?: unknown;
  freshness?: SourceRef["freshness"];
  retrievedAt?: string;
  sourceId: string;
  sourceType: SourceType;
  trust?: SourceRef["trust"];
  uri?: string;
}): SourceRef {
  return {
    contentHash: input.content === undefined ? undefined : hashAuditValue(input.content),
    freshness: input.freshness,
    retrievedAt: input.retrievedAt,
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    trust: input.trust ?? deriveSegmentTrust(input.sourceType),
    uri: input.uri
  };
}
