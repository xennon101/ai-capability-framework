import type {
  AicfSecurityReason,
  ContextSegment,
  ContextSegmentValidationResult,
  DataClassification,
  RuntimeContextSegmentInput,
  SourceRef,
  SourceType,
  TrustLabel
} from "./types.js";

const instructionTrusts = new Set<TrustLabel>([
  "system_instruction",
  "developer_instruction",
  "app_policy"
]);

export function createContextSegment<T = unknown>(
  input: Omit<ContextSegment<T>, "dataClassifications" | "instructionsAllowed"> & {
    dataClassifications?: DataClassification[];
    instructionsAllowed?: boolean;
  }
): ContextSegment<T> {
  const segment: ContextSegment<T> = {
    ...input,
    dataClassifications: uniqueClassifications(input.dataClassifications ?? ["internal"]),
    instructionsAllowed: input.instructionsAllowed ?? instructionTrusts.has(input.trust)
  };
  const validation = validateContextSegment(segment);
  if (!validation.valid) {
    throw new Error(validation.errors.map((reason) => reason.message).join("; "));
  }
  return segment;
}

export function validateContextSegment(segment: ContextSegment): ContextSegmentValidationResult {
  const errors: AicfSecurityReason[] = [];
  const warnings: AicfSecurityReason[] = [];

  if (!segment.id.trim()) {
    errors.push(reason("segment_id_required", "Context segment id is required."));
  }
  if (!segment.label.trim()) {
    warnings.push(reason("segment_label_empty", "Context segment label is empty.", "warning"));
  }
  if (segment.instructionsAllowed && !instructionTrusts.has(segment.trust)) {
    errors.push(reason(
      "instructions_not_allowed",
      `Context segment trust "${segment.trust}" cannot carry instructions.`
    ));
  }
  if (segment.sourceRef && segment.sourceRef.trust !== segment.trust) {
    warnings.push(reason(
      "source_trust_mismatch",
      "Source trust does not match the context segment trust.",
      "warning"
    ));
  }

  return {
    errors,
    valid: errors.length === 0,
    warnings
  };
}

export function deriveSegmentTrust(sourceType: SourceType): TrustLabel {
  switch (sourceType) {
    case "policy":
      return "app_policy";
    case "app_record":
    case "manual_review":
      return "app_data";
    case "retrieved_document":
      return "retrieved_document";
    case "tool_result":
      return "tool_result";
    case "external_api":
      return "external_api";
    case "model_output":
      return "model_output";
    case "uploaded_file":
    case "user_message":
    default:
      return "user_input";
  }
}

export function contextItemToSegment(input: RuntimeContextSegmentInput): ContextSegment {
  const trust: TrustLabel = input.item.trusted ? "app_data" : "user_input";
  const sourceRef = input.sourceRef;
  return createContextSegment({
    content: input.item.text ?? input.item.data ?? {},
    dataClassifications: normalizeDataClasses(input.item.dataClasses),
    id: input.item.id,
    instructionsAllowed: false,
    label: input.item.title ?? input.item.id,
    sourceRef,
    trust
  });
}

export function instructionsAllowedForTrust(trust: TrustLabel): boolean {
  return instructionTrusts.has(trust);
}

function normalizeDataClasses(values: string[] | undefined): DataClassification[] {
  const known = new Set<DataClassification>([
    "public",
    "internal",
    "customer_pii",
    "employee_pii",
    "payment_metadata",
    "financial",
    "health",
    "legal",
    "security_sensitive",
    "credential_material"
  ]);
  const normalized = (values ?? ["internal"])
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_"))
    .filter((value): value is DataClassification => known.has(value as DataClassification));
  return uniqueClassifications(normalized.length > 0 ? normalized : ["internal"]);
}

function uniqueClassifications(values: DataClassification[]): DataClassification[] {
  return [...new Set(values)].sort();
}

function reason(code: string, message: string, severity: AicfSecurityReason["severity"] = "error"): AicfSecurityReason {
  return { code, message, severity };
}
