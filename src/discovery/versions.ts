/** Internal contracts; package-level discovery exports are introduced separately. */
export const DISCOVERY_BINDING_VERSIONS = Object.freeze({
  registry_source: "1.0",
  corpus: "1.0",
  embedding_configuration: "1.0",
  index: "1.0",
  eligibility: "1.0",
  retrieval_policy: "1.0",
  candidate_cards: "1.0",
  selector: "1.2"
} as const);

export const DISCOVERY_SCHEMA_VERSION = "1.0" as const;

export const DISCOVERY_DEFAULT_LIMITS = Object.freeze({
  maxQueries: 8,
  maxFragmentsPerQuery: 16,
  maxQueryCharacters: 4_000,
  maxCandidates: 8,
  aliasDiversitySlots: 0
} as const);

export const DISCOVERY_HARD_LIMITS = Object.freeze({
  maxQueries: 32,
  maxFragmentsPerQuery: 32,
  maxQueryCharacters: 16_000,
  maxCandidates: 20,
  aliasDiversitySlots: 1
} as const);

export const SELECTION_DEFAULT_LIMITS = Object.freeze({
  maxTasks: 8,
  maxInputCharacters: 32_000,
  maxAttempts: 1
} as const);

export const SELECTION_HARD_LIMITS = Object.freeze({
  maxTasks: 32,
  maxInputCharacters: 128_000,
  maxAttempts: 2
} as const);

