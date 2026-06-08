import type {
  AicfSecurityReason,
  RetentionEvaluationContext,
  RetentionEvaluationResult,
  RetentionPolicy
} from "./types.js";

export function defaultRetentionPolicy(): RetentionPolicy {
  return {
    allowRawContentInEvals: false,
    auditRecordRetentionDays: 365,
    evalDatasetRetentionDays: 365,
    id: "aicf.default_retention",
    rawPromptRetention: "none",
    rawProviderPayloadRetention: "none",
    traceMetadataRetentionDays: 90
  };
}

export function evaluateRetentionPolicy(
  policy: RetentionPolicy = defaultRetentionPolicy(),
  context: RetentionEvaluationContext = {}
): RetentionEvaluationResult {
  const reasons: AicfSecurityReason[] = [];
  const warnings: AicfSecurityReason[] = [];
  let allowed = true;

  if (context.useCase === "prompt" && policy.rawPromptRetention === "none") {
    allowed = false;
    reasons.push(reason("raw_prompt_retention_denied", "Raw prompt retention is disabled by policy."));
  }
  if (context.useCase === "provider_payload" && policy.rawProviderPayloadRetention === "none") {
    allowed = false;
    reasons.push(reason("raw_provider_payload_retention_denied", "Raw provider payload retention is disabled by policy."));
  }
  if (context.useCase === "eval" && !policy.allowRawContentInEvals) {
    allowed = false;
    reasons.push(reason("raw_eval_content_denied", "Raw content in eval datasets is disabled by policy."));
  }
  if (
    context.diagnosticMode === "unsafe_raw_content"
    && (policy.rawPromptRetention !== "none" || policy.rawProviderPayloadRetention !== "none" || policy.allowRawContentInEvals)
  ) {
    warnings.push(reason(
      "unsafe_diagnostic_retention",
      "Unsafe diagnostic raw-content retention was explicitly enabled.",
      "warning"
    ));
  }

  return {
    allowed,
    policy,
    reasons,
    warnings
  };
}

function reason(code: string, message: string, severity: AicfSecurityReason["severity"] = "error"): AicfSecurityReason {
  return { code, message, severity };
}
