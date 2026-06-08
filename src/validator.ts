import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { CapabilityManifest } from "./generated/manifest-types.js";
import type {
  AicfDiagnostic,
  LoadedCapabilityManifest,
  LoadedFixture,
  LoadedManifest,
  ManifestKind,
  ValidateManifestsOptions,
  ValidationResult
} from "./types.js";

const schemaDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schemas");
const ajv = new Ajv2020({ allErrors: true, strict: false });
const embeddedSchemaAjv = new Ajv2020({ allErrors: true, strict: false });
const fixtureAjv = new Ajv2020({ allErrors: true, strict: false });

const adapterContextSchema = readSchema("adapter-context.schema.json");

const validators: Record<ManifestKind, ValidateFunction> = {
  capability: compileSchema("capability-manifest.schema.json"),
  entity: compileSchema("entity-manifest.schema.json"),
  eval: compileSchema("eval-case.schema.json")
};

const fixtureValidators: Record<Exclude<LoadedFixture["kind"], "unknown">, ValidateFunction> = {
  adapter_context: fixtureAjv.compile(adapterContextSchema),
  control_plane_state: fixtureAjv.compile(readSchema("control-plane/state.schema.json")),
  decision_request: fixtureAjv.compile(readSchema("decision-request.schema.json")),
  eval_result: fixtureAjv.compile(readSchema("eval-result.schema.json")),
  generated_content_provenance: fixtureAjv.compile(readSchema("provenance/generated-content-provenance.schema.json")),
  governance_gate_config: fixtureAjv.compile(readSchema("governance/gate-config.schema.json")),
  governed_memory: fixtureAjv.compile(readSchema("memory/governed-memory-fixture.schema.json")),
  replay_trace: fixtureAjv.compile(readSchema("replay/replay-trace.schema.json"))
};

const riskRank = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
} as const;

export function validateManifests(
  manifests: LoadedManifest[],
  _options: ValidateManifestsOptions = {}
): ValidationResult {
  const invariants = validateCapabilityInvariants(manifests);
  const errors: AicfDiagnostic[] = [
    ...validateSchemas(manifests),
    ...validateDuplicateIds(manifests),
    ...validateEvalReferences(manifests),
    ...validateEmbeddedCapabilitySchemas(manifests),
    ...invariants.errors
  ];

  return {
    errors,
    valid: errors.length === 0,
    warnings: invariants.warnings
  };
}

export function validatePublicFixtures(fixtures: LoadedFixture[]): ValidationResult {
  const errors: AicfDiagnostic[] = [];

  for (const fixture of fixtures) {
    if (fixture.kind === "unknown") {
      errors.push({
        code: "invalid_fixture",
        message: "Structured public fixture is not under a recognized fixture directory.",
        path: fixture.path
      });
      continue;
    }

    const validate = fixtureValidators[fixture.kind];
    const valid = validate(fixture.fixture);
    if (valid) {
      continue;
    }

    for (const error of validate.errors ?? []) {
      errors.push({
        code: "schema",
        details: error,
        message: `${error.instancePath || "/"}: ${error.message ?? "schema validation failed"}`,
        path: fixture.path
      });
    }
  }

  return {
    errors,
    valid: errors.length === 0,
    warnings: []
  };
}

export function validateCapabilityInvariants(manifests: LoadedManifest[]): {
  errors: AicfDiagnostic[];
  warnings: AicfDiagnostic[];
} {
  const errors: AicfDiagnostic[] = [];
  const warnings: AicfDiagnostic[] = [];
  const capabilityById = new Map<string, LoadedManifest & { manifest: CapabilityManifest }>();

  for (const loaded of manifests) {
    if (loaded.kind === "capability" && isCapabilityManifestLike(loaded.manifest)) {
      capabilityById.set(loaded.manifest.id, loaded as LoadedManifest & { manifest: CapabilityManifest });
    }
  }

  for (const loaded of manifests) {
    if (loaded.kind !== "capability" || !isCapabilityManifestLike(loaded.manifest)) {
      continue;
    }

    const capability = loaded.manifest;
    const sideEffects = capability.side_effects;
    const hasWrites = sideEffects.writes_data
      || sideEffects.creates_records
      || sideEffects.updates_records
      || sideEffects.deletes_records
      || sideEffects.sends_external_messages
      || sideEffects.charges_money
      || sideEffects.refunds_money
      || sideEffects.changes_permissions
      || sideEffects.triggers_external_workflow
      || sideEffects.irreversible;
    const highImpact = sideEffects.deletes_records
      || sideEffects.sends_external_messages
      || sideEffects.charges_money
      || sideEffects.refunds_money
      || sideEffects.changes_permissions
      || sideEffects.triggers_external_workflow
      || sideEffects.irreversible;

    if (capability.capability_type === "read_data" && hasWrites) {
      errors.push(diagnostic(loaded, "invalid_read_side_effects", "read_data capabilities must not declare write, money, message, permission, workflow, delete, or irreversible side effects."));
    }

    if (capability.capability_type === "write_prepare_only" && (!capability.lifecycle.prepare || capability.lifecycle.commit)) {
      errors.push(diagnostic(loaded, "invalid_capability_lifecycle", "write_prepare_only capabilities must support prepare and must not support commit."));
    }

    if (capability.capability_type === "write_commit" && !capability.lifecycle.commit) {
      errors.push(diagnostic(loaded, "invalid_capability_lifecycle", "write_commit capabilities must support commit."));
    }

    const commitCapabilityId = capability.lifecycle.commit_capability_id;
    if (commitCapabilityId) {
      if (!capability.lifecycle.prepare) {
        errors.push(diagnostic(loaded, "invalid_capability_lifecycle", "commit_capability_id is valid only on capabilities that support prepare."));
      }

      const commitCapability = capabilityById.get(commitCapabilityId);
      if (!commitCapability) {
        errors.push(diagnostic(loaded, "invalid_commit_capability_reference", `commit_capability_id "${commitCapabilityId}" does not reference a known capability.`));
      } else if (
        commitCapability.manifest.capability_type !== "write_commit"
        || commitCapability.manifest.lifecycle.commit !== true
      ) {
        errors.push(diagnostic(loaded, "invalid_commit_capability_reference", `commit_capability_id "${commitCapabilityId}" must reference a write_commit capability with lifecycle.commit: true.`));
      }
    }

    if (capability.capability_type === "write_prepare_only" && capability.lifecycle.approve && !commitCapabilityId) {
      warnings.push(diagnostic(loaded, "missing_commit_capability_reference", "write_prepare_only capabilities that require approval should declare lifecycle.commit_capability_id when they can later be committed by the host."));
    }

    if (capability.capability_type === "external_message_send" && !sideEffects.sends_external_messages) {
      errors.push(diagnostic(loaded, "invalid_capability_lifecycle", "external_message_send capabilities must declare sends_external_messages."));
    }

    if (capability.capability_type === "workflow_start" && !sideEffects.triggers_external_workflow) {
      errors.push(diagnostic(loaded, "invalid_capability_lifecycle", "workflow_start capabilities must declare triggers_external_workflow."));
    }

    if (highImpact && riskRank[capability.risk_tier] <= riskRank.low) {
      errors.push(diagnostic(loaded, "invalid_risk_tier", "High-impact side-effecting capabilities must not be none or low risk."));
    }

    if (hasWrites && !capability.lifecycle.audit) {
      errors.push(diagnostic(loaded, "missing_required_audit", "Side-effecting capabilities must support audit in the lifecycle."));
    }

    if ((capability.lifecycle.commit || highImpact) && capability.idempotency?.required !== true) {
      errors.push(diagnostic(loaded, "missing_required_idempotency", "Commit, destructive, money, permission, message, and workflow capabilities must require idempotency."));
    }

    if (riskRank[capability.risk_tier] >= riskRank.high && capability.policy.approval_required !== true) {
      warnings.push(diagnostic(loaded, "missing_required_approval_policy", "High and critical capabilities should require approval or document an explicit waiver."));
    }
  }

  return {
    errors,
    warnings
  };
}

function compileSchema(fileName: string): ValidateFunction {
  return ajv.compile(readSchema(fileName));
}

function readSchema(fileName: string): Record<string, unknown> {
  const schemaPath = path.join(schemaDirectory, fileName);
  return JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
}

function validateSchemas(manifests: LoadedManifest[]): AicfDiagnostic[] {
  const errors: AicfDiagnostic[] = [];

  for (const loaded of manifests) {
    const validate = validators[loaded.kind];
    const valid = validate(loaded.manifest);
    if (valid) {
      continue;
    }

    for (const error of validate.errors ?? []) {
      const location = error.instancePath || "/";
      errors.push({
        code: "schema",
        details: error,
        id: idFromManifest(loaded.manifest),
        kind: loaded.kind,
        message: `${location}: ${error.message ?? "schema validation failed"}`,
        path: loaded.path
      });
    }
  }

  return errors;
}

function validateDuplicateIds(manifests: LoadedManifest[]): AicfDiagnostic[] {
  const errors: AicfDiagnostic[] = [];
  const seen = new Map<string, LoadedManifest>();

  for (const loaded of manifests) {
    const id = idFromManifest(loaded.manifest);
    if (!id) {
      continue;
    }

    const key = `${loaded.kind}:${id}`;
    const existing = seen.get(key);
    if (existing) {
      errors.push({
        code: "duplicate_id",
        id,
        kind: loaded.kind,
        message: `Duplicate ${loaded.kind} id "${id}" also appears in ${existing.path}.`,
        path: loaded.path
      });
      continue;
    }

    seen.set(key, loaded);
  }

  return errors;
}

function validateEvalReferences(manifests: LoadedManifest[]): AicfDiagnostic[] {
  const errors: AicfDiagnostic[] = [];
  const loadedPaths = new Set(manifests.map((manifest) => path.normalize(manifest.absolutePath)));

  for (const loaded of manifests) {
    if (loaded.kind !== "capability" || !isCapabilityManifestLike(loaded.manifest)) {
      continue;
    }

    const evalRefs = [
      ...(loaded.manifest.evals?.golden ?? []),
      ...(loaded.manifest.evals?.red_team ?? [])
    ];

    for (const evalRef of evalRefs) {
      const resolved = path.normalize(path.resolve(path.dirname(loaded.absolutePath), evalRef));
      if (!loadedPaths.has(resolved)) {
        errors.push({
          code: "missing_reference",
          id: loaded.manifest.id,
          kind: "capability",
          message: `Missing eval reference "${evalRef}".`,
          path: loaded.path
        });
      }
    }
  }

  return errors;
}

function validateEmbeddedCapabilitySchemas(manifests: LoadedManifest[]): AicfDiagnostic[] {
  const errors: AicfDiagnostic[] = [];

  for (const loaded of manifests) {
    if (loaded.kind !== "capability" || !isCapabilityManifestLike(loaded.manifest)) {
      continue;
    }

    const capability = loaded.manifest;
    errors.push(...compileEmbeddedSchema(loaded, capability.input_schema, "input"));
    errors.push(...compileEmbeddedSchema(loaded, capability.output_schema, "output"));

    if (!schemaIncludesType(capability.input_schema, "object")) {
      errors.push({
        code: "unsupported",
        id: capability.id,
        kind: "capability",
        message: "Capability input_schema must be object-shaped for callable tool use.",
        path: loaded.path
      });
    }
  }

  return errors;
}

function compileEmbeddedSchema(
  loaded: LoadedCapabilityManifest,
  schema: CapabilityManifest["input_schema"],
  name: "input" | "output"
): AicfDiagnostic[] {
  try {
    embeddedSchemaAjv.compile(schema);
    return [];
  } catch (error) {
    return [{
      code: name === "input" ? "invalid_input_schema" : "invalid_output_schema",
      details: error instanceof Error ? error.message : error,
      id: loaded.manifest.id,
      kind: "capability",
      message: `Capability ${name}_schema is not a valid JSON Schema.`,
      path: loaded.path
    }];
  }
}

function diagnostic(
  loaded: LoadedCapabilityManifest,
  code: AicfDiagnostic["code"],
  message: string
): AicfDiagnostic {
  return {
    code,
    id: loaded.manifest.id,
    kind: "capability",
    message,
    path: loaded.path
  };
}

function idFromManifest(manifest: unknown): string | undefined {
  if (typeof manifest !== "object" || manifest === null || !("id" in manifest)) {
    return undefined;
  }

  const value = (manifest as { id?: unknown }).id;
  return typeof value === "string" ? value : undefined;
}

function isCapabilityManifestLike(manifest: unknown): manifest is CapabilityManifest {
  return typeof manifest === "object"
    && manifest !== null
    && typeof (manifest as { id?: unknown }).id === "string"
    && typeof (manifest as { side_effects?: unknown }).side_effects === "object"
    && (manifest as { side_effects?: unknown }).side_effects !== null
    && typeof (manifest as { lifecycle?: unknown }).lifecycle === "object"
    && (manifest as { lifecycle?: unknown }).lifecycle !== null
    && typeof (manifest as { policy?: unknown }).policy === "object"
    && (manifest as { policy?: unknown }).policy !== null
    && typeof (manifest as { input_schema?: unknown }).input_schema === "object"
    && (manifest as { input_schema?: unknown }).input_schema !== null
    && typeof (manifest as { output_schema?: unknown }).output_schema === "object"
    && (manifest as { output_schema?: unknown }).output_schema !== null;
}

function schemaIncludesType(schema: Record<string, unknown>, expected: string): boolean {
  const type = schema.type;
  return type === expected || (Array.isArray(type) && type.includes(expected));
}
