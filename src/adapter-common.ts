import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import { decideCapability } from "./decision.js";
import type {
  AdapterExcludedCapability,
  AdapterToolBinding,
  AicfDiagnostic,
  CapabilityManifest,
  CapabilitySlice,
  DecisionOptions,
  DecisionReason,
  DecisionRequest,
  JsonObject,
  JsonValue,
  LoadedCapabilityManifest,
  ManifestRegistry,
  ParsedAdapterToolCall,
  ParseAdapterToolCallResult
} from "./types.js";

const hashLength = 8;
const ajv = new Ajv2020({ allErrors: true, strict: false });
const autonomyRank = {
  A0: 0,
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
  A5: 5
} as const;

export const strictToolSchemaUnsupportedKeywords = [
  "$ref",
  "allOf",
  "anyOf",
  "dependencies",
  "dependentRequired",
  "dependentSchemas",
  "if",
  "not",
  "oneOf",
  "patternProperties",
  "prefixItems",
  "then",
  "unevaluatedProperties"
];

export interface BuildAdapterToolsetOptions<TTool, TBinding extends AdapterToolBinding = AdapterToolBinding> {
  adapterName: string;
  buildTool(input: {
    loadedCapability: LoadedCapabilityManifest;
    normalizedInputSchema: JsonObject;
    restricted: boolean;
    toolName: string;
  }): TTool;
  context: DecisionRequest["context"];
  defaultNamePrefix: string;
  includeRestricted?: boolean;
  includeDeprecated?: boolean;
  includeDisabledForTests?: boolean;
  includeDraft?: boolean;
  includeExperimental?: boolean;
  maxToolNameLength?: number;
  namePrefix?: string;
  toBinding?(binding: AdapterToolBinding, input: {
    loadedCapability: LoadedCapabilityManifest;
    normalizedInputSchema: JsonObject;
    restricted: boolean;
    toolName: string;
  }): TBinding;
  registry: ManifestRegistry | CapabilitySlice;
  unsupportedSchemaKeywords?: string[];
}

export interface BuiltAdapterToolset<TTool, TBinding extends AdapterToolBinding = AdapterToolBinding> {
  bindings: TBinding[];
  diagnostics: AicfDiagnostic[];
  excluded: AdapterExcludedCapability[];
  tools: TTool[];
}

export function buildAdapterToolset<TTool, TBinding extends AdapterToolBinding = AdapterToolBinding>(
  options: BuildAdapterToolsetOptions<TTool, TBinding>
): BuiltAdapterToolset<TTool, TBinding> {
  const contextError = validateAdapterContext(options.context, options.adapterName);
  if (contextError) {
    return {
      bindings: [],
      diagnostics: [{
        code: "invalid_context",
        message: contextError,
        path: "options.context"
      }],
      excluded: [],
      tools: []
    };
  }

  const diagnostics: AicfDiagnostic[] = [];
  const excluded: AdapterExcludedCapability[] = [];
  const bindings: TBinding[] = [];
  const tools: TTool[] = [];
  const toolNameOwners = new Map<string, string>();
  const registry = isCapabilitySlice(options.registry) ? options.registry.registry : options.registry;
  const capabilities = isCapabilitySlice(options.registry) ? options.registry.capabilities : options.registry.capabilities;

  if (isCapabilitySlice(options.registry)) {
    diagnostics.push(...options.registry.diagnostics);
    excluded.push(...options.registry.excluded);
  }

  for (const loadedCapability of capabilities) {
    const capability = loadedCapability.manifest;
    const restricted = isRestrictedCapability(capability);
    const statusReason = excludedStatusReason(capability, options);

    if (statusReason) {
      const capabilityDiagnostics = [{
        code: "capability_excluded",
        details: {
          status: capability.status
        },
        id: capability.id,
        kind: "capability",
        message: `Capability "${capability.id}" has status "${capability.status}" and was not exported to ${options.adapterName} tools.`,
        path: loadedCapability.path
      }] satisfies AicfDiagnostic[];
      diagnostics.push(...capabilityDiagnostics);
      excluded.push({
        capabilityId: capability.id,
        diagnostics: capabilityDiagnostics,
        path: loadedCapability.path,
        reason: statusReason
      });
      continue;
    }

    if (restricted && !options.includeRestricted) {
      const capabilityDiagnostics = [{
        code: "capability_excluded",
        details: {
          restricted: true
        },
        id: capability.id,
        kind: "capability",
        message: `Capability "${capability.id}" is restricted and was not exported to ${options.adapterName} tools.`,
        path: loadedCapability.path
      }] satisfies AicfDiagnostic[];
      diagnostics.push(...capabilityDiagnostics);
      excluded.push({
        capabilityId: capability.id,
        diagnostics: capabilityDiagnostics,
        path: loadedCapability.path,
        reason: "restricted"
      });
      continue;
    }

    const selectDecision = decideCapability(registry, {
      capabilityId: capability.id,
      context: selectContextForCapability(capability, options.context),
      operation: "select"
    }, adapterDecisionOptions(options));

    if (selectDecision.status !== "allowed") {
      const capabilityDiagnostics = decisionDiagnostics(
        loadedCapability,
        selectDecision.reasons,
        options.adapterName
      );
      diagnostics.push(...capabilityDiagnostics);
      excluded.push({
        capabilityId: capability.id,
        diagnostics: capabilityDiagnostics,
        path: loadedCapability.path,
        reason: excludedReasonFromDecision(selectDecision.reasons)
      });
      continue;
    }

    const normalizedSchema = normalizeInputSchemaForStrictTool(loadedCapability, {
      unsupportedSchemaKeywords: options.unsupportedSchemaKeywords
    });
    if (!normalizedSchema.ok) {
      diagnostics.push(...normalizedSchema.diagnostics);
      excluded.push({
        capabilityId: capability.id,
        diagnostics: normalizedSchema.diagnostics,
        path: loadedCapability.path,
        reason: "unsupported_schema"
      });
      continue;
    }

    const toolName = toAdapterToolName(capability.id, {
      maxLength: options.maxToolNameLength,
      namePrefix: options.namePrefix ?? options.defaultNamePrefix
    });
    const existingOwner = toolNameOwners.get(toolName);
    if (existingOwner && existingOwner !== capability.id) {
      const collisionDiagnostics = [{
        code: "tool_name_collision",
        details: {
          existingCapabilityId: existingOwner,
          toolName
        },
        id: capability.id,
        kind: "capability",
        message: `${options.adapterName} tool name "${toolName}" collides with capability "${existingOwner}".`,
        path: loadedCapability.path
      }] satisfies AicfDiagnostic[];
      diagnostics.push(...collisionDiagnostics);
      excluded.push({
        capabilityId: capability.id,
        diagnostics: collisionDiagnostics,
        path: loadedCapability.path,
        reason: "tool_name_collision"
      });
      continue;
    }

    toolNameOwners.set(toolName, capability.id);

    const binding = baseBinding(loadedCapability, {
      normalizedInputSchema: normalizedSchema.schema,
      restricted,
      toolName
    });
    const input = {
      loadedCapability,
      normalizedInputSchema: normalizedSchema.schema,
      restricted,
      toolName
    };

    tools.push(options.buildTool(input));
    bindings.push(options.toBinding ? options.toBinding(binding, input) : binding as TBinding);
  }

  return {
    bindings,
    diagnostics,
    excluded,
    tools
  };
}

function isCapabilitySlice(value: ManifestRegistry | CapabilitySlice): value is CapabilitySlice {
  return "registry" in value && Array.isArray(value.capabilities);
}

export function selectContextForCapability(
  capability: CapabilityManifest,
  context: DecisionRequest["context"]
): DecisionRequest["context"] {
  if (autonomyRank[context.autonomyTier] <= autonomyRank[capability.autonomy_tier]) {
    return context;
  }

  return {
    ...context,
    autonomyTier: capability.autonomy_tier
  };
}

export function isRestrictedCapability(capability: CapabilityManifest): boolean {
  return capability.lifecycle.commit
    || capability.capability_type === "write_commit"
    || capability.capability_type === "external_message_send"
    || capability.capability_type === "workflow_start"
    || capability.side_effects.charges_money
    || capability.side_effects.refunds_money
    || capability.side_effects.changes_permissions
    || capability.side_effects.deletes_records
    || capability.side_effects.triggers_external_workflow
    || capability.side_effects.irreversible
    || capability.side_effects.sends_external_messages;
}

export function adapterToolDescription(capability: CapabilityManifest): string {
  const lifecycle = Object.entries(capability.lifecycle)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(", ") || "none";
  const whenToUse = (capability.when_to_use ?? []).join(" ");
  const whenNotToUse = (capability.when_not_to_use ?? []).join(" ");

  return [
    capability.model_description.trim(),
    `Capability ID: ${capability.id}.`,
    `Type: ${capability.capability_type}. Risk: ${capability.risk_tier}. Autonomy: ${capability.autonomy_tier}. Lifecycle: ${lifecycle}.`,
    whenToUse ? `Use when: ${whenToUse}` : "",
    whenNotToUse ? `Do not use when: ${whenNotToUse}` : ""
  ].filter(Boolean).join(" ");
}

export function toAdapterToolName(
  capabilityId: string,
  options: {
    maxLength?: number;
    namePrefix: string;
  }
): string {
  const maxLength = options.maxLength ?? 64;
  const sanitizedPrefix = sanitizeToolNamePart(options.namePrefix);
  const sanitizedId = sanitizeToolNamePart(capabilityId);
  const baseName = `${sanitizedPrefix}${sanitizedId}`;

  if (baseName.length <= maxLength) {
    return baseName;
  }

  const hash = createHash("sha256").update(capabilityId).digest("hex").slice(0, hashLength);
  const prefixLength = maxLength - hash.length - 1;
  return `${baseName.slice(0, prefixLength)}_${hash}`;
}

export function normalizeInputSchemaForStrictTool(
  loadedCapability: LoadedCapabilityManifest,
  options: {
    unsupportedSchemaKeywords?: string[];
  } = {}
): {
  diagnostics: AicfDiagnostic[];
  ok: false;
} | {
  diagnostics: AicfDiagnostic[];
  ok: true;
  schema: JsonObject;
} {
  const schema = loadedCapability.manifest.input_schema;
  if (!isRecord(schema)) {
    return unsupportedSchema(loadedCapability, "/", "Input schema must be a JSON object.");
  }

  const normalized = normalizeSchemaObject(loadedCapability, schema, "/", false, options);
  if (!normalized.ok) {
    return normalized;
  }

  const types = schemaTypes(normalized.schema.type);
  if (!types.includes("object")) {
    return unsupportedSchema(loadedCapability, "/", "Tool parameters must be an object schema.");
  }

  return normalized;
}

export function parseAdapterToolCall(input: {
  argumentsPath: string;
  bindings: AdapterToolBinding[];
  callId?: string;
  id?: string;
  rawArguments: unknown;
  rawArgumentsAreJsonString?: boolean;
  toolName: string;
  toolNamePath: string;
}): ParseAdapterToolCallResult {
  const binding = input.bindings.find((candidate) => candidate.toolName === input.toolName);
  if (!binding) {
    return {
      diagnostics: [{
        code: "invalid_tool_call",
        details: {
          toolName: input.toolName
        },
        message: `Unknown tool name "${input.toolName}".`,
        path: input.toolNamePath
      }],
      valid: false
    };
  }

  let args: unknown = input.rawArguments;
  if (input.rawArgumentsAreJsonString) {
    if (typeof input.rawArguments !== "string") {
      return invalidToolCall(binding, input.argumentsPath, "Tool call arguments must be a JSON string.");
    }

    try {
      args = JSON.parse(input.rawArguments);
    } catch (error) {
      return {
        diagnostics: [{
          code: "invalid_tool_call",
          details: error instanceof Error ? error.message : undefined,
          id: binding.capabilityId,
          message: `Tool call arguments for "${input.toolName}" are not valid JSON.`,
          path: input.argumentsPath
        }],
        valid: false
      };
    }
  }

  if (!isRecord(args)) {
    return invalidToolCall(binding, input.argumentsPath, `Tool call arguments for "${input.toolName}" must be a JSON object.`);
  }

  const validate = ajv.compile(binding.normalizedInputSchema);
  const valid = validate(args);
  if (!valid) {
    return {
      diagnostics: (validate.errors ?? []).map((error) => ({
        code: "schema",
        details: error,
        id: binding.capabilityId,
        message: `${error.instancePath || "/"}: ${error.message ?? "schema validation failed"}`,
        path: input.argumentsPath
      })),
      valid: false
    };
  }

  return {
    diagnostics: [],
    parsed: {
      args: denormalizeToolArgs(binding.inputSchema, args),
      callId: input.callId,
      capabilityId: binding.capabilityId,
      id: input.id,
      toolName: binding.toolName
    } satisfies ParsedAdapterToolCall,
    valid: true
  };
}

function adapterDecisionOptions(options: {
  includeDeprecated?: boolean;
  includeDisabledForTests?: boolean;
  includeDraft?: boolean;
  includeExperimental?: boolean;
}): DecisionOptions {
  return {
    includeDeprecated: options.includeDeprecated,
    includeDisabledForTests: options.includeDisabledForTests,
    includeDraft: options.includeDraft,
    includeExperimental: options.includeExperimental
  };
}

function excludedStatusReason(
  capability: CapabilityManifest,
  options: {
    includeDeprecated?: boolean;
    includeDisabledForTests?: boolean;
    includeDraft?: boolean;
    includeExperimental?: boolean;
  }
): AdapterExcludedCapability["reason"] | null {
  switch (capability.status) {
    case "active":
      return null;
    case "disabled":
      return options.includeDisabledForTests ? null : "status_disabled";
    case "deprecated":
      return options.includeDeprecated ? null : "status_deprecated";
    case "draft":
      return options.includeDraft ? null : "status_draft";
    case "experimental":
      return options.includeExperimental ? null : "status_experimental";
  }
}

function excludedReasonFromDecision(reasons: DecisionReason[]): AdapterExcludedCapability["reason"] {
  const statusReason = reasons.find((reason) => reason.code.startsWith("status_"));
  if (statusReason?.code === "status_disabled") return "status_disabled";
  if (statusReason?.code === "status_deprecated") return "status_deprecated";
  if (statusReason?.code === "status_draft") return "status_draft";
  if (statusReason?.code === "status_experimental") return "status_experimental";
  if (reasons.some((reason) => reason.code === "risk_tier_exceeded")) return "risk_tier_exceeded";
  if (reasons.some((reason) => reason.code === "risk_tier_not_allowed")) return "risk_tier_not_allowed";
  return "decision_denied";
}

function denormalizeToolArgs(originalSchema: JsonObject, args: Record<string, unknown>): Record<string, unknown> {
  return denormalizeValue(originalSchema, args, false) as Record<string, unknown>;
}

function denormalizeValue(originalSchema: JsonObject, value: unknown, optional: boolean): unknown {
  if (value === null) {
    return optional && !schemaAllowsNull(originalSchema) ? undefined : null;
  }

  const types = schemaTypes(originalSchema.type);
  if (types.includes("object") && isRecord(value)) {
    const properties = isRecord(originalSchema.properties) ? originalSchema.properties : {};
    const required = Array.isArray(originalSchema.required)
      ? new Set(originalSchema.required.filter((entry): entry is string => typeof entry === "string"))
      : new Set<string>();
    const denormalized: Record<string, unknown> = {};

    for (const [key, propertyValue] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (!isRecord(propertySchema)) {
        denormalized[key] = propertyValue;
        continue;
      }

      const nextValue = denormalizeValue(
        propertySchema as JsonObject,
        propertyValue,
        !required.has(key)
      );
      if (nextValue !== undefined) {
        denormalized[key] = nextValue;
      }
    }

    return denormalized;
  }

  if (types.includes("array") && Array.isArray(value) && isRecord(originalSchema.items)) {
    return value.map((item) => denormalizeValue(originalSchema.items as JsonObject, item, false));
  }

  return value;
}

function schemaAllowsNull(schema: JsonObject): boolean {
  return schemaTypes(schema.type).includes("null")
    || (Array.isArray(schema.enum) && schema.enum.includes(null));
}

export function validateAdapterContext(context: DecisionRequest["context"], adapterName: string): string | null {
  if (!isRecord(context)) {
    return `${adapterName} tool export requires a context object.`;
  }

  if (!Array.isArray(context.permissions) || context.permissions.some((permission) => typeof permission !== "string")) {
    return `${adapterName} tool export context.permissions must be an array of strings.`;
  }

  if (!["A0", "A1", "A2", "A3", "A4", "A5"].includes(context.autonomyTier)) {
    return `${adapterName} tool export context.autonomyTier must be A0, A1, A2, A3, A4, or A5.`;
  }

  if (context.userId !== undefined && typeof context.userId !== "string") {
    return `${adapterName} tool export context.userId must be a string when present.`;
  }

  if (context.tenantId !== undefined && typeof context.tenantId !== "string") {
    return `${adapterName} tool export context.tenantId must be a string when present.`;
  }

  if (context.riskCeiling !== undefined && !["none", "low", "medium", "high", "critical"].includes(context.riskCeiling)) {
    return `${adapterName} tool export context.riskCeiling must be none, low, medium, high, or critical when present.`;
  }

  if (
    context.allowedRiskTiers !== undefined
    && (!Array.isArray(context.allowedRiskTiers)
      || context.allowedRiskTiers.some((riskTier) => !["none", "low", "medium", "high", "critical"].includes(riskTier)))
  ) {
    return `${adapterName} tool export context.allowedRiskTiers must be an array of risk tiers when present.`;
  }

  return null;
}

export function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function baseBinding(
  loadedCapability: LoadedCapabilityManifest,
  input: {
    normalizedInputSchema: JsonObject;
    restricted: boolean;
    toolName: string;
  }
): AdapterToolBinding {
  const capability = loadedCapability.manifest;

  return {
    autonomyTier: capability.autonomy_tier,
    capabilityId: capability.id,
    capabilityType: capability.capability_type,
    inputSchema: toJsonObject(capability.input_schema),
    normalizedInputSchema: input.normalizedInputSchema,
    path: loadedCapability.path,
    restricted: input.restricted,
    riskTier: capability.risk_tier,
    toolName: input.toolName
  };
}

function decisionDiagnostics(
  loadedCapability: LoadedCapabilityManifest,
  reasons: DecisionReason[],
  adapterName: string
): AicfDiagnostic[] {
  if (reasons.length === 0) {
    return [{
      code: "capability_excluded",
      id: loadedCapability.manifest.id,
      kind: "capability",
      message: `Capability "${loadedCapability.manifest.id}" was not selectable and was not exported to ${adapterName} tools.`,
      path: loadedCapability.path
    }];
  }

  return reasons.map((reason) => ({
    code: "capability_excluded",
    details: reason,
    id: loadedCapability.manifest.id,
    kind: "capability",
    message: `Capability "${loadedCapability.manifest.id}" was not exported: ${reason.message}`,
    path: loadedCapability.path
  }));
}

function normalizeSchemaObject(
  loadedCapability: LoadedCapabilityManifest,
  schema: Record<string, unknown>,
  pointer: string,
  optional: boolean,
  options: {
    unsupportedSchemaKeywords?: string[];
  }
): {
  diagnostics: AicfDiagnostic[];
  ok: false;
} | {
  diagnostics: AicfDiagnostic[];
  ok: true;
  schema: JsonObject;
} {
  const unsupportedKeywords = options.unsupportedSchemaKeywords ?? strictToolSchemaUnsupportedKeywords;
  for (const keyword of unsupportedKeywords) {
    if (keyword in schema) {
      return unsupportedSchema(
        loadedCapability,
        pointer,
        `Input schema uses unsupported keyword "${keyword}" for strict tool export.`
      );
    }
  }

  const normalized = toJsonObject(schema);
  const types = schemaTypes(schema.type);

  if (types.includes("object")) {
    const properties = schema.properties;
    const required = schema.required;

    if (properties !== undefined && !isRecord(properties)) {
      return unsupportedSchema(loadedCapability, `${pointer}/properties`, "Schema properties must be an object.");
    }

    if (required !== undefined && !isStringArray(required)) {
      return unsupportedSchema(loadedCapability, `${pointer}/required`, "Schema required fields must be a string array.");
    }

    const propertySchemas = properties ?? {};
    const requiredFields = new Set(required ?? []);
    const normalizedProperties: JsonObject = {};

    for (const [propertyName, propertySchema] of Object.entries(propertySchemas)) {
      if (!isRecord(propertySchema)) {
        return unsupportedSchema(
          loadedCapability,
          `${pointer}/properties/${propertyName}`,
          `Property "${propertyName}" must be a schema object.`
        );
      }

      const propertyResult = normalizeSchemaObject(
        loadedCapability,
        propertySchema,
        `${pointer}/properties/${propertyName}`,
        !requiredFields.has(propertyName),
        options
      );
      if (!propertyResult.ok) {
        return propertyResult;
      }

      normalizedProperties[propertyName] = propertyResult.schema;
    }

    normalized.properties = normalizedProperties;
    normalized.required = Object.keys(normalizedProperties);
    normalized.additionalProperties = false;
  }

  if (types.includes("array")) {
    const items = schema.items;
    if (items !== undefined) {
      if (!isRecord(items)) {
        return unsupportedSchema(loadedCapability, `${pointer}/items`, "Array items must be a single schema object.");
      }

      const itemResult = normalizeSchemaObject(loadedCapability, items, `${pointer}/items`, false, options);
      if (!itemResult.ok) {
        return itemResult;
      }

      normalized.items = itemResult.schema;
    }
  }

  if (optional) {
    const nullable = makeNullable(normalized);
    if (!nullable.ok) {
      return unsupportedSchema(
        loadedCapability,
        pointer,
        "Optional schema could not be represented as nullable for strict tool export."
      );
    }
  }

  return {
    diagnostics: [],
    ok: true,
    schema: normalized
  };
}

function makeNullable(schema: JsonObject): { ok: true } | { ok: false } {
  const type = schema.type;

  if (typeof type === "string") {
    schema.type = type === "null" ? "null" : [type, "null"];
  } else if (Array.isArray(type) && type.every((entry) => typeof entry === "string")) {
    if (!type.includes("null")) {
      schema.type = [...type, "null"];
    }
  } else if (!("enum" in schema)) {
    return { ok: false };
  }

  const enumValue = schema.enum;
  if (Array.isArray(enumValue) && !enumValue.includes(null)) {
    schema.enum = [...enumValue, null] as JsonValue;
  }

  return { ok: true };
}

function unsupportedSchema(
  loadedCapability: LoadedCapabilityManifest,
  pointer: string,
  message: string
): {
  diagnostics: AicfDiagnostic[];
  ok: false;
} {
  return {
    diagnostics: [{
      code: "unsupported",
      details: {
        pointer
      },
      id: loadedCapability.manifest.id,
      kind: "capability",
      message,
      path: loadedCapability.path
    }],
    ok: false
  };
}

function invalidToolCall(
  binding: AdapterToolBinding,
  path: string,
  message: string
): ParseAdapterToolCallResult {
  return {
    diagnostics: [{
      code: "invalid_tool_call",
      id: binding.capabilityId,
      message,
      path
    }],
    valid: false
  };
}

function sanitizeToolNamePart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_");
  return sanitized.length > 0 ? sanitized : "_";
}

function schemaTypes(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value;
  }

  return [];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
