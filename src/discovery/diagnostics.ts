export type DiscoveryDiagnosticCode =
  | "invalid_configuration"
  | "invalid_metadata"
  | "invalid_input"
  | "input_limit_exceeded"
  | "empty_query"
  | "no_eligible_capabilities"
  | "no_matching_candidates"
  | "invalid_ranker_output"
  | "invalid_index"
  | "embedding_configuration_mismatch"
  | "invalid_embedding"
  | "provider_unavailable"
  | "invalid_selection_output"
  | "invalid_selection_input"
  | "selection_configuration_mismatch"
  | "stale_binding"
  | "budget_denied"
  | "control_denied"
  | "accounting_unavailable"
  | "deadline_exceeded"
  | "cancelled"
  | "lexical_fallback"
  | "invalid_fingerprint_payload"
  | "replay_inputs_unavailable";

export interface DiscoveryDiagnostic {
  code: DiscoveryDiagnosticCode;
  message: string;
  queryId?: string;
  capabilityId?: string;
  path?: string;
}

/** Configuration/contract errors only; operational outcomes use result statuses. */
export class DiscoveryError extends Error {
  readonly code: DiscoveryDiagnosticCode;
  readonly diagnostic: Readonly<DiscoveryDiagnostic>;

  constructor(diagnostic: DiscoveryDiagnostic) {
    super(diagnostic.message);
    this.name = "DiscoveryError";
    this.code = diagnostic.code;
    this.diagnostic = Object.freeze({ ...diagnostic });
  }
}

