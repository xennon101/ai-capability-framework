import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import { decideCapability } from "./decision.js";
import type {
  AicfDiagnostic,
  BuildOpenAIResponsesToolsOptions,
  CapabilityManifest,
  DecisionReason,
  DecisionRequest,
  JsonObject,
  JsonValue,
  LoadedCapabilityManifest,
  ManifestRegistry,
  OpenAIResponsesExcludedCapability,
  OpenAIResponsesFunctionCall,
  OpenAIResponsesFunctionTool,
  OpenAIResponsesToolBinding,
  OpenAIResponsesToolNameOptions,
  OpenAIResponsesToolset,
  ParseOpenAIResponsesToolCallResult
} from "./types.js";

const defaultNamePrefix = "aicf_";
const maxOpenAIToolNameLength = 64;
const hashLength = 8;
const unsupportedSchemaKeywords = [
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

const ajv = new Ajv2020({ allErrors: true, strict: false });
const autonomyRank = {
  A0: 0,
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
  A5: 5
} as const;

export function buildOpenAIResponsesTools(
  registry: ManifestRegistry,
  options: BuildOpenAIResponsesToolsOptions
): OpenAIResponsesToolset {
  const contextError = validateDecisionContext(options.context);
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
  const excluded: OpenAIResponsesExcludedCapability[] = [];
  const bindings: OpenAIResponsesToolBinding[] = [];
  const tools: OpenAIResponsesFunctionTool[] = [];
  const toolNameOwners = new Map<string, string>();

  for (const loadedCapability of registry.capabilities) {
    const capability = loadedCapability.manifest;

    const restricted = isRestrictedCapability(capability);
    if (restricted && !options.includeRestricted) {
      const capabilityDiagnostics = [{
        code: "capability_excluded",
        details: {
          restricted: true
        },
        id: capability.id,
        kind: "capability",
        message: `Capability "${capability.id}" is restricted and was not exported to OpenAI tools.`,
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
    });

    if (selectDecision.status !== "allowed") {
      const capabilityDiagnostics = decisionDiagnostics(loadedCapability, selectDecision.reasons);
      diagnostics.push(...capabilityDiagnostics);
      excluded.push({
        capabilityId: capability.id,
        diagnostics: capabilityDiagnostics,
        path: loadedCapability.path,
        reason: "decision_denied"
      });
      continue;
    }

    const normalizedSchema = normalizeInputSchemaForOpenAI(loadedCapability);
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

    const toolName = toOpenAIResponsesToolName(capability.id, {
      namePrefix: options.namePrefix
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
        message: `OpenAI tool name "${toolName}" collides with capability "${existingOwner}".`,
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
    tools.push({
      description: openAIToolDescription(capability),
      name: toolName,
      parameters: normalizedSchema.schema,
      strict: true,
      type: "function"
    });
    bindings.push({
      autonomyTier: capability.autonomy_tier,
      capabilityId: capability.id,
      capabilityType: capability.capability_type,
      inputSchema: toJsonObject(capability.input_schema),
      path: loadedCapability.path,
      restricted,
      riskTier: capability.risk_tier,
      toolName
    });
  }

  return {
    bindings,
    diagnostics,
    excluded,
    tools
  };
}

function selectContextForCapability(
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

export function parseOpenAIResponsesToolCall(
  toolset: OpenAIResponsesToolset,
  call: OpenAIResponsesFunctionCall
): ParseOpenAIResponsesToolCallResult {
  const callShapeError = validateToolCallShape(call);
  if (callShapeError) {
    return {
      diagnostics: [{
        code: "invalid_tool_call",
        message: callShapeError,
        path: "tool_call"
      }],
      valid: false
    };
  }

  const binding = toolset.bindings.find((candidate) => candidate.toolName === call.name);
  if (!binding) {
    return {
      diagnostics: [{
        code: "invalid_tool_call",
        details: {
          toolName: call.name
        },
        message: `Unknown OpenAI tool name "${call.name}".`,
        path: "tool_call.name"
      }],
      valid: false
    };
  }

  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch (error) {
    return {
      diagnostics: [{
        code: "invalid_tool_call",
        details: error instanceof Error ? error.message : undefined,
        id: binding.capabilityId,
        message: `Tool call arguments for "${call.name}" are not valid JSON.`,
        path: "tool_call.arguments"
      }],
      valid: false
    };
  }

  if (!isRecord(args)) {
    return {
      diagnostics: [{
        code: "invalid_tool_call",
        id: binding.capabilityId,
        message: `Tool call arguments for "${call.name}" must be a JSON object.`,
        path: "tool_call.arguments"
      }],
      valid: false
    };
  }

  const validate = ajv.compile(binding.inputSchema);
  const valid = validate(args);
  if (!valid) {
    return {
      diagnostics: (validate.errors ?? []).map((error) => ({
        code: "schema",
        details: error,
        id: binding.capabilityId,
        message: `${error.instancePath || "/"}: ${error.message ?? "schema validation failed"}`,
        path: "tool_call.arguments"
      })),
      valid: false
    };
  }

  return {
    diagnostics: [],
    parsed: {
      args,
      callId: call.call_id,
      capabilityId: binding.capabilityId,
      id: call.id,
      toolName: binding.toolName
    },
    valid: true
  };
}

export function toOpenAIResponsesToolName(
  capabilityId: string,
  options: OpenAIResponsesToolNameOptions = {}
): string {
  const prefix = options.namePrefix ?? defaultNamePrefix;
  const sanitizedPrefix = sanitizeToolNamePart(prefix);
  const sanitizedId = sanitizeToolNamePart(capabilityId);
  const baseName = `${sanitizedPrefix}${sanitizedId}`;

  if (baseName.length <= maxOpenAIToolNameLength) {
    return baseName;
  }

  const hash = createHash("sha256").update(capabilityId).digest("hex").slice(0, hashLength);
  const prefixLength = maxOpenAIToolNameLength - hash.length - 1;
  return `${baseName.slice(0, prefixLength)}_${hash}`;
}

function isRestrictedCapability(capability: CapabilityManifest): boolean {
  return capability.lifecycle.commit
    || capability.capability_type === "write_commit"
    || capability.capability_type === "external_message_send"
    || capability.capability_type === "workflow_start"
    || capability.side_effects.charges_money
    || capability.side_effects.refunds_money
    || capability.side_effects.changes_permissions
    || capability.side_effects.triggers_external_workflow
    || capability.side_effects.irreversible
    || capability.side_effects.sends_external_messages;
}

function openAIToolDescription(capability: CapabilityManifest): string {
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

function decisionDiagnostics(
  loadedCapability: LoadedCapabilityManifest,
  reasons: DecisionReason[]
): AicfDiagnostic[] {
  if (reasons.length === 0) {
    return [{
      code: "capability_excluded",
      id: loadedCapability.manifest.id,
      kind: "capability",
      message: `Capability "${loadedCapability.manifest.id}" was not selectable and was not exported to OpenAI tools.`,
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

function normalizeInputSchemaForOpenAI(loadedCapability: LoadedCapabilityManifest): {
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

  const normalized = normalizeSchemaObject(loadedCapability, schema, "/", false);
  if (!normalized.ok) {
    return normalized;
  }

  const types = schemaTypes(normalized.schema.type);
  if (!types.includes("object")) {
    return unsupportedSchema(loadedCapability, "/", "OpenAI function parameters must be an object schema.");
  }

  return normalized;
}

function normalizeSchemaObject(
  loadedCapability: LoadedCapabilityManifest,
  schema: Record<string, unknown>,
  pointer: string,
  optional: boolean
): {
  diagnostics: AicfDiagnostic[];
  ok: false;
} | {
  diagnostics: AicfDiagnostic[];
  ok: true;
  schema: JsonObject;
} {
  for (const keyword of unsupportedSchemaKeywords) {
    if (keyword in schema) {
      return unsupportedSchema(
        loadedCapability,
        pointer,
        `Input schema uses unsupported keyword "${keyword}" for OpenAI strict tool export.`
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
        !requiredFields.has(propertyName)
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

      const itemResult = normalizeSchemaObject(loadedCapability, items, `${pointer}/items`, false);
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
        "Optional schema could not be represented as nullable for OpenAI strict tool export."
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

function validateDecisionContext(context: DecisionRequest["context"]): string | null {
  if (!isRecord(context)) {
    return "OpenAI tool export requires a context object.";
  }

  if (!Array.isArray(context.permissions) || context.permissions.some((permission) => typeof permission !== "string")) {
    return "OpenAI tool export context.permissions must be an array of strings.";
  }

  if (!["A0", "A1", "A2", "A3", "A4", "A5"].includes(context.autonomyTier)) {
    return "OpenAI tool export context.autonomyTier must be A0, A1, A2, A3, A4, or A5.";
  }

  if (context.userId !== undefined && typeof context.userId !== "string") {
    return "OpenAI tool export context.userId must be a string when present.";
  }

  if (context.tenantId !== undefined && typeof context.tenantId !== "string") {
    return "OpenAI tool export context.tenantId must be a string when present.";
  }

  return null;
}

function validateToolCallShape(call: OpenAIResponsesFunctionCall): string | null {
  if (!isRecord(call)) {
    return "OpenAI tool call must be an object.";
  }

  if (call.type !== "function_call") {
    return "OpenAI tool call type must be function_call.";
  }

  if (typeof call.name !== "string" || call.name.length === 0) {
    return "OpenAI tool call name is required.";
  }

  if (typeof call.arguments !== "string") {
    return "OpenAI tool call arguments must be a JSON string.";
  }

  return null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
