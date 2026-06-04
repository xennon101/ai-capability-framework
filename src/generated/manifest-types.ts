/*
 * Generated from schemas/*.schema.json.
 * Do not edit by hand. Run `npm run generate:types`.
 */
export interface AdapterContextFixture {
  autonomyTier: "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
  permissions: string[];
  tenantId?: string;
  userId?: string;
  riskCeiling?: "none" | "low" | "medium" | "high" | "critical";
  /**
   * @minItems 1
   */
  allowedRiskTiers?: [
    "none" | "low" | "medium" | "high" | "critical",
    ...("none" | "low" | "medium" | "high" | "critical")[]
  ];
}

export interface CapabilityManifest {
  schema_version: "1.0";
  id: string;
  version: string;
  status: "draft" | "experimental" | "active" | "deprecated" | "disabled";
  name: string;
  summary: string;
  model_description: string;
  domain?: string;
  owner?: {
    team?: string;
    contact?: string;
  };
  capability_type:
    | "read_data"
    | "retrieve_documents"
    | "compute"
    | "write_prepare_only"
    | "write_commit"
    | "external_message_prepare"
    | "external_message_send"
    | "workflow_start"
    | "workflow_step"
    | "human_handoff";
  autonomy_tier: "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
  risk_tier: "none" | "low" | "medium" | "high" | "critical";
  when_to_use?: string[];
  when_not_to_use?: string[];
  tags?: string[];
  input_schema: JsonSchemaObject;
  output_schema: JsonSchemaObject;
  side_effects: {
    reads_data: boolean;
    writes_data: boolean;
    creates_records: boolean;
    updates_records: boolean;
    deletes_records: boolean;
    sends_external_messages: boolean;
    charges_money: boolean;
    refunds_money: boolean;
    changes_permissions: boolean;
    triggers_external_workflow: boolean;
    irreversible: boolean;
  };
  authorization: {
    /**
     * @minItems 1
     */
    permissions: [string, ...string[]];
    tenant_scoped: boolean;
    requires_user_context: boolean;
    data_scope?: string[];
  };
  policy: {
    approval_required?: boolean;
    approval_required_if?: PolicyRule[];
    deny_if?: PolicyRule[];
    max_autonomy_tier?: "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
  };
  lifecycle: {
    prepare: boolean;
    preview: boolean;
    approve: boolean;
    commit: boolean;
    verify: boolean;
    audit: boolean;
  };
  idempotency?: {
    required: boolean;
    key_fields?: string[];
  };
  observability: {
    log_inputs: "none" | "summary" | "redacted";
    log_outputs: "none" | "summary" | "redacted";
    trace_attributes?: {
      [k: string]: string | number | boolean | null;
    };
  };
  evals?: {
    golden?: string[];
    red_team?: string[];
  };
  extensions?: {};
}
/**
 * This interface was referenced by `CapabilityManifest`'s JSON-Schema
 * via the `definition` "json_schema_object".
 */
export interface JsonSchemaObject {
  type: string | unknown[];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `CapabilityManifest`'s JSON-Schema
 * via the `definition` "policy_rule".
 */
export interface PolicyRule {
  rule: string;
  reason: string;
  field?: string;
  missing_behavior?: "deny" | "approval_required" | "ignore";
  operator?: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "exists";
  value?: unknown;
}

export interface DecisionRequestFixture {
  capabilityId: string;
  operation: "select" | "prepare" | "commit";
  args?: {};
  context: AdapterContext;
  facts?: {
    [k: string]:
      | boolean
      | {
          value: boolean;
          reason?: string;
        };
  };
  approval?: {
    approved: boolean;
    approvalId?: string;
  };
  idempotencyKey?: string;
}
/**
 * This interface was referenced by `DecisionRequestFixture`'s JSON-Schema
 * via the `definition` "adapter_context".
 */
export interface AdapterContext {
  autonomyTier: "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
  permissions: string[];
  tenantId?: string;
  userId?: string;
  riskCeiling?: "none" | "low" | "medium" | "high" | "critical";
  /**
   * @minItems 1
   */
  allowedRiskTiers?: [
    "none" | "low" | "medium" | "high" | "critical",
    ...("none" | "low" | "medium" | "high" | "critical")[]
  ];
}

export interface EntityManifest {
  schema_version: "1.0";
  id: string;
  version: string;
  name: string;
  summary: string;
  canonical_id: {
    field: string;
    pattern?: string;
  };
  data_classification: {
    default: string;
    fields?: {
      [k: string]: string;
    };
  };
  relationships?: {
    name: string;
    target_entity: string;
    cardinality: "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";
    lookup_capability?: string;
  }[];
  lookup: {
    primary_capability: string;
  };
  /**
   * @minItems 1
   */
  allowed_actions: [string, ...string[]];
  model_guidance: string;
  extensions?: {};
}

export interface EvalCase {
  schema_version: "1.0";
  id: string;
  name?: string;
  capability_under_test?: string;
  tags?: string[];
  input: {
    user_message: string;
    conversation?: {
      role: "user" | "assistant" | "system" | "tool";
      content: string;
    }[];
  };
  context?: {};
  expected: ExpectedBehavior;
  /**
   * @minItems 1
   */
  scorers: [
    {
      type: string;
      [k: string]: unknown;
    },
    ...{
      type: string;
      [k: string]: unknown;
    }[]
  ];
  extensions?: {};
}
/**
 * This interface was referenced by `EvalCase`'s JSON-Schema
 * via the `definition` "expected_behavior".
 */
export interface ExpectedBehavior {
  selected_capabilities?: {
    includes?: string[];
    excludes?: string[];
  };
  tool_calls?: {
    capability_id: string;
    args_match?: {};
    args_exact?: {};
    allowed_fields?: string[];
  }[];
  forbidden_tool_calls?: {
    capability_id: string;
  }[];
  tool_call_sequence?: string[];
  policy_decision?: "allowed" | "approval_required" | "denied";
  action_state?: "none" | "prepared" | "approval_required" | "committed" | "denied" | "refused";
  no_commit?: boolean;
  refusal?: {
    required: boolean;
    reason_contains?: string[];
  };
  response?: {
    must_include?: string[];
    must_not_include?: string[];
  };
}

export interface EvalResultFixture {
  schema_version: "1.0";
  results: EvalCandidateResult[];
  extensions?: {};
}
/**
 * This interface was referenced by `EvalResultFixture`'s JSON-Schema
 * via the `definition` "eval_candidate_result".
 */
export interface EvalCandidateResult {
  eval_id: string;
  selected_capabilities?: string[];
  tool_calls?: {
    capability_id: string;
    args?: {};
  }[];
  policy_decision?: "allowed" | "approval_required" | "denied";
  action_state?: "none" | "prepared" | "approval_required" | "committed" | "denied" | "refused";
  committed_capabilities?: string[];
  refusal?: {
    present?: boolean;
    reason?: string;
  };
  response?: {
    text?: string;
  };
  extensions?: {};
}

export interface ToolResultEnvelopeFixture {
  schema_version: "1.0";
  capability_id: string;
  capability_version: string;
  status: "ok" | "unavailable" | "denied" | "approval_required" | "error";
  data?: unknown;
  evidence?: EvidenceRef[];
  policy?: PolicyDecisionSummary;
  action?: PreparedActionSummary;
  user_message?: string;
  private_diagnostics?: unknown;
}
/**
 * This interface was referenced by `ToolResultEnvelopeFixture`'s JSON-Schema
 * via the `definition` "evidence_ref".
 */
export interface EvidenceRef {
  source_id: string;
  source_type?: string;
  span_id?: string;
  quote?: string;
  confidence?: "low" | "medium" | "high";
}
/**
 * This interface was referenced by `ToolResultEnvelopeFixture`'s JSON-Schema
 * via the `definition` "policy_decision_summary".
 */
export interface PolicyDecisionSummary {
  status: "allowed" | "approval_required" | "denied";
  reasons?: {
    code: string;
    message: string;
    rule?: string;
  }[];
}
/**
 * This interface was referenced by `ToolResultEnvelopeFixture`'s JSON-Schema
 * via the `definition` "prepared_action_summary".
 */
export interface PreparedActionSummary {
  prepared_action_id?: string;
  action_state: "none" | "prepared" | "approval_required" | "committed" | "denied" | "refused";
  preview?: unknown;
  approval_required?: boolean;
}
