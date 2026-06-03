/*
 * Generated from schemas/*.schema.json.
 * Do not edit by hand. Run `npm run generate:types`.
 */
export interface CapabilityManifest {
  schema_version: "0.1";
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
  operator?: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "exists";
  value?: unknown;
}

export interface EntityManifest {
  schema_version: "0.1";
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
  schema_version: "0.1";
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
  }[];
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
