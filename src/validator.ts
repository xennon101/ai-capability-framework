import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type {
  AicfDiagnostic,
  LoadedManifest,
  ManifestKind,
  ValidateManifestsOptions,
  ValidationResult
} from "./types.js";

const schemaDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schemas");
const ajv = new Ajv2020({ allErrors: true, strict: false });

const validators: Record<ManifestKind, ValidateFunction> = {
  capability: compileSchema("capability-manifest.schema.json"),
  entity: compileSchema("entity-manifest.schema.json"),
  eval: compileSchema("eval-case.schema.json")
};

export function validateManifests(
  manifests: LoadedManifest[],
  _options: ValidateManifestsOptions = {}
): ValidationResult {
  const errors: AicfDiagnostic[] = [
    ...validateSchemas(manifests),
    ...validateDuplicateIds(manifests),
    ...validateEvalReferences(manifests)
  ];

  return {
    errors,
    valid: errors.length === 0
  };
}

function compileSchema(fileName: string): ValidateFunction {
  const schemaPath = path.join(schemaDirectory, fileName);
  return ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));
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
    if (loaded.kind !== "capability") {
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

function idFromManifest(manifest: unknown): string | undefined {
  if (typeof manifest !== "object" || manifest === null || !("id" in manifest)) {
    return undefined;
  }

  const value = (manifest as { id?: unknown }).id;
  return typeof value === "string" ? value : undefined;
}
