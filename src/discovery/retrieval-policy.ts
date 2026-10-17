import { fingerprintDiscoveryValue } from "./fingerprint.js";
import { LEXICAL_RANKER_VERSION, LEXICAL_TOKENIZER_VERSION } from "./lexical.js";
import type { ResolvedDiscoveryConfiguration } from "./types.js";
export const HYBRID_RANKER_VERSION = "weighted-cosine-lexical.v1";
export const QUERY_EMBEDDING_PROJECTION_VERSION = "original-fragments-newline.v1";
export function retrievalPolicyFingerprint(configuration: ResolvedDiscoveryConfiguration, customRankerVersion?: string): string {
  const rankerVersion = customRankerVersion ? "custom:" + customRankerVersion : LEXICAL_RANKER_VERSION;
  return fingerprintDiscoveryValue("retrieval_policy", { tokenizerVersion: LEXICAL_TOKENIZER_VERSION,
    rankerVersion: configuration.mode === "hybrid" ? HYBRID_RANKER_VERSION + "/" + QUERY_EMBEDDING_PROJECTION_VERSION + "/" + rankerVersion : rankerVersion,
    configuration });
}
