import { AicfProviderError } from "../shared/errors.js";
import { loadOptionalProviderDependency } from "../shared/optional-dependency.js";
import type { AicfDiagnostic, JsonObject } from "../../types.js";
import type {
  AicfLangChainSchemaFactory,
  AicfLangChainToolConfig,
  AicfLangChainToolFactory,
  AicfLangChainToolFunction
} from "./types.js";

export function createLangChainToolFactoryFromSdk(sdk: unknown): AicfLangChainToolFactory {
  if (!isRecord(sdk) || typeof sdk.tool !== "function") {
    throw new AicfProviderError({
      code: "provider_sdk_error",
      provider: "langchain",
      safeMessage: "The LangChain module did not expose a tool factory."
    });
  }

  const typedSdk = sdk as {
    tool: (fn: AicfLangChainToolFunction, config: AicfLangChainToolConfig) => unknown;
  };

  return {
    tool: (fn, config) => typedSdk.tool(fn, config)
  };
}

export async function createDefaultLangChainToolFactory(): Promise<AicfLangChainToolFactory> {
  const sdk = await loadOptionalProviderDependency({
    dependencyName: "@langchain/core/tools",
    provider: "langchain"
  });
  return createLangChainToolFactoryFromSdk(sdk);
}

export function createPlainLangChainToolFactory(): AicfLangChainToolFactory {
  return {
    tool: (fn, config) => ({
      config,
      invoke: fn,
      kind: "aicf_plain_langchain_tool"
    })
  };
}

export function createPlainLangChainSchemaFactory(): AicfLangChainSchemaFactory {
  return {
    createSchema: (schema) => ({
      diagnostics: [],
      schema
    })
  };
}

export function createLangChainZodSchemaFactory(zod: unknown): AicfLangChainSchemaFactory {
  if (!isZodLike(zod)) {
    throw new AicfProviderError({
      code: "provider_sdk_error",
      provider: "langchain",
      safeMessage: "The supplied Zod module did not expose the required schema constructors."
    });
  }

  return {
    createSchema: (schema, options) => convertObjectSchemaToZod(schema, zod, options?.path ?? "input_schema")
  };
}

function convertObjectSchemaToZod(
  schema: JsonObject,
  zod: ZodLike,
  path: string
): { diagnostics: AicfDiagnostic[]; schema?: unknown } {
  const diagnostics: AicfDiagnostic[] = [];
  if (schema.type !== "object") {
    return {
      diagnostics: [diagnostic(path, "LangChain Zod conversion requires an object schema root.")]
    };
  }

  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const shape: Record<string, unknown> = {};
  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    const converted = convertPropertySchemaToZod(propertySchema, zod, `${path}/properties/${propertyName}`);
    diagnostics.push(...converted.diagnostics);
    if (!converted.schema) continue;
    shape[propertyName] = required.has(propertyName) ? converted.schema : optionalZod(converted.schema);
  }

  if (diagnostics.length > 0) {
    return {
      diagnostics
    };
  }

  let objectSchema: unknown = zod.object(shape);
  if (schema.additionalProperties === false && isRecord(objectSchema) && typeof objectSchema.strict === "function") {
    objectSchema = objectSchema.strict();
  }

  return {
    diagnostics,
    schema: objectSchema
  };
}

function convertPropertySchemaToZod(
  schema: unknown,
  zod: ZodLike,
  path: string
): { diagnostics: AicfDiagnostic[]; schema?: unknown } {
  if (!isRecord(schema)) {
    return {
      diagnostics: [diagnostic(path, "LangChain Zod conversion requires property schemas to be objects.")]
    };
  }

  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined;
  if (enumValues && enumValues.every((value) => typeof value === "string") && enumValues.length > 0 && typeof zod.enum === "function") {
    return {
      diagnostics: [],
      schema: zod.enum(enumValues as [string, ...string[]])
    };
  }

  const type = schema.type;
  if (Array.isArray(type)) {
    const nonNullTypes = type.filter((item) => item !== "null");
    if (nonNullTypes.length !== 1) {
      return {
        diagnostics: [diagnostic(path, "LangChain Zod conversion supports nullable single-type schemas only.")]
      };
    }
    const converted = convertPropertySchemaToZod({ ...schema, type: nonNullTypes[0] }, zod, path);
    return {
      diagnostics: converted.diagnostics,
      schema: converted.schema ? nullableZod(converted.schema) : undefined
    };
  }

  switch (type) {
    case "string":
      return { diagnostics: [], schema: zod.string() };
    case "number":
    case "integer":
      return { diagnostics: [], schema: zod.number() };
    case "boolean":
      return { diagnostics: [], schema: zod.boolean() };
    case "object": {
      const nested = convertObjectSchemaToZod(schema as JsonObject, zod, path);
      return {
        diagnostics: nested.diagnostics,
        schema: nested.schema
      };
    }
    case "array": {
      const items = convertPropertySchemaToZod(schema.items, zod, `${path}/items`);
      return {
        diagnostics: items.diagnostics,
        schema: items.schema ? zod.array(items.schema) : undefined
      };
    }
    default:
      return {
        diagnostics: [diagnostic(path, `LangChain Zod conversion does not support property type "${String(type)}".`)]
      };
  }
}

function optionalZod(schema: unknown): unknown {
  return isRecord(schema) && typeof schema.optional === "function" ? schema.optional() : schema;
}

function nullableZod(schema: unknown): unknown {
  return isRecord(schema) && typeof schema.nullable === "function" ? schema.nullable() : schema;
}

function diagnostic(path: string, message: string): AicfDiagnostic {
  return {
    code: "provider_schema_unsupported",
    message,
    path
  };
}

interface ZodLike {
  array(item: unknown): unknown;
  boolean(): unknown;
  enum?(values: [string, ...string[]]): unknown;
  number(): unknown;
  object(shape: Record<string, unknown>): unknown;
  string(): unknown;
}

function isZodLike(value: unknown): value is ZodLike {
  return isRecord(value)
    && typeof value.array === "function"
    && typeof value.boolean === "function"
    && typeof value.number === "function"
    && typeof value.object === "function"
    && typeof value.string === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
