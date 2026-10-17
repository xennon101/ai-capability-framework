import type {
  CapabilityRetrievalDocument, DiscoveryQuery, LexicalRankerCandidate, ResolvedLexicalDiscoveryConfiguration
} from "./types.js";

/** NFKC plus ECMAScript lowercase, not linguistic case folding or word segmentation. */
export const LEXICAL_TOKENIZER_VERSION = "nfkc-lower-unicode-letter-number.v1";
export const LEXICAL_RANKER_VERSION = "coverage-alias.v1";

export function tokenizeDiscoveryText(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function matchingAliases(query: DiscoveryQuery, document: CapabilityRetrievalDocument): string[] {
  const fragments = query.fragments.map((fragment) => tokenizeDiscoveryText(fragment.text));
  return document.aliases.filter((alias) => {
    const phrase = tokenizeDiscoveryText(alias);
    return phrase.length >= 2 && fragments.some((fragment) => fragment.some((_, start) =>
      phrase.every((token, offset) => fragment[start + offset] === token)));
  });
}

export function rankLexically(input: {
  query: DiscoveryQuery;
  documents: readonly CapabilityRetrievalDocument[];
  configuration: ResolvedLexicalDiscoveryConfiguration;
}): LexicalRankerCandidate[] {
  const queryTokens = [...new Set(input.query.fragments.flatMap((fragment) => tokenizeDiscoveryText(fragment.text)))];
  return input.documents.map((document) => {
    const tokens = new Set(document.tokens);
    const coverage = queryTokens.length ? queryTokens.filter((token) => tokens.has(token)).length / queryTokens.length : 0;
    const phrase = matchingAliases(input.query, document).length ? 1 : 0;
    const lexical = coverage + (1 - coverage) * input.configuration.aliasWeight * phrase;
    return {
      capabilityId: document.capabilityId,
      scores: { lexical, aliasPhrase: phrase, semantic: null, final: lexical }
    };
  });
}
