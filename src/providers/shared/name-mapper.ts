import { createHash } from "node:crypto";
import { isRestrictedCapability } from "../../adapter-common.js";
import type { AicfDiagnostic, JsonObject, LoadedCapabilityManifest } from "../../types.js";
import type {
  AicfProviderId,
  AicfProviderMetadata,
  AicfProviderToolNameBinding,
  AicfProviderToolNameMap,
  CreateProviderToolNameMapOptions
} from "./types.js";

const hashLength = 8;

export const aicfProviderMetadata: Record<AicfProviderId, AicfProviderMetadata> = {
  anthropic: {
    defaultNamePrefix: "aicf_",
    id: "anthropic",
    label: "Anthropic Claude",
    maxToolNameLength: 64,
    toolNamePattern: /^[a-zA-Z0-9_-]{1,64}$/,
    toolNamePatternDescription: "letters, numbers, underscores, and hyphens, max 64 characters"
  },
  gemini: {
    defaultNamePrefix: "aicf_",
    id: "gemini",
    label: "Google Gemini",
    maxToolNameLength: 64,
    toolNamePattern: /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/,
    toolNamePatternDescription: "letter or underscore followed by letters, numbers, or underscores, max 64 characters"
  },
  langchain: {
    defaultNamePrefix: "aicf_",
    id: "langchain",
    label: "LangChain/LangGraph",
    maxToolNameLength: 64,
    toolNamePattern: /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/,
    toolNamePatternDescription: "letter or underscore followed by letters, numbers, or underscores, max 64 characters"
  },
  mcp: {
    defaultNamePrefix: "aicf_",
    id: "mcp",
    label: "Model Context Protocol",
    maxToolNameLength: 128,
    toolNamePattern: /^[a-zA-Z0-9_.-]{1,128}$/,
    toolNamePatternDescription: "letters, numbers, underscores, dots, and hyphens, max 128 characters"
  },
  openai: {
    defaultNamePrefix: "aicf_",
    id: "openai",
    label: "OpenAI",
    maxToolNameLength: 64,
    toolNamePattern: /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/,
    toolNamePatternDescription: "letter or underscore followed by letters, numbers, or underscores, max 64 characters"
  },
  "semantic-kernel": {
    defaultNamePrefix: "aicf_",
    id: "semantic-kernel",
    label: "Semantic Kernel",
    maxToolNameLength: 64,
    toolNamePattern: /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/,
    toolNamePatternDescription: "letter or underscore followed by letters, numbers, or underscores, max 64 characters"
  },
  "vercel-ai-sdk": {
    defaultNamePrefix: "aicf_",
    id: "vercel-ai-sdk",
    label: "Vercel AI SDK",
    maxToolNameLength: 64,
    toolNamePattern: /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/,
    toolNamePatternDescription: "letter or underscore followed by letters, numbers, or underscores, max 64 characters"
  }
};

export const aicfProviderIds = Object.freeze(Object.keys(aicfProviderMetadata) as AicfProviderId[]);

export function createProviderToolNameMap(options: CreateProviderToolNameMapOptions): AicfProviderToolNameMap {
  const metadata = aicfProviderMetadata[options.provider];
  const capabilities = Array.isArray(options.capabilities) ? options.capabilities : options.capabilities.capabilities;
  const maxLength = options.maxToolNameLength ?? metadata.maxToolNameLength;
  const namePrefix = options.namePrefix ?? metadata.defaultNamePrefix;
  const diagnostics: AicfDiagnostic[] = [];
  const bindings: AicfProviderToolNameBinding[] = [];
  const bindingByCapabilityId = new Map<string, AicfProviderToolNameBinding>();
  const bindingByProviderToolName = new Map<string, AicfProviderToolNameBinding>();

  for (const loadedCapability of capabilities) {
    const providerToolName = toProviderToolName(loadedCapability.manifest.id, {
      maxLength,
      namePrefix,
      provider: options.provider
    });
    if (!metadata.toolNamePattern.test(providerToolName)) {
      diagnostics.push(providerDiagnostic({
        code: "provider_tool_name_invalid",
        loadedCapability,
        message: `${metadata.label} tool name "${providerToolName}" does not match ${metadata.toolNamePatternDescription}.`,
        provider: options.provider
      }));
      continue;
    }

    const existing = bindingByProviderToolName.get(providerToolName);
    if (existing && existing.capabilityId !== loadedCapability.manifest.id) {
      diagnostics.push(providerDiagnostic({
        code: "provider_tool_name_collision",
        loadedCapability,
        message: `${metadata.label} tool name "${providerToolName}" collides with capability "${existing.capabilityId}".`,
        provider: options.provider
      }));
      continue;
    }

    const binding: AicfProviderToolNameBinding = {
      capabilityId: loadedCapability.manifest.id,
      capabilityVersion: loadedCapability.manifest.version,
      operation: operationForCapability(loadedCapability),
      originalInputSchema: cloneJsonObject(loadedCapability.manifest.input_schema),
      provider: options.provider,
      providerToolName,
      restricted: isRestrictedCapability(loadedCapability.manifest)
    };
    bindings.push(binding);
    bindingByCapabilityId.set(binding.capabilityId, binding);
    bindingByProviderToolName.set(binding.providerToolName, binding);
  }

  return {
    bindingByCapabilityId,
    bindingByProviderToolName,
    bindings,
    diagnostics,
    provider: options.provider,
    providerNameToCapabilityId(providerToolName) {
      return bindingByProviderToolName.get(providerToolName)?.capabilityId;
    },
    toProviderToolName(capabilityId) {
      return bindingByCapabilityId.get(capabilityId)?.providerToolName;
    }
  };
}

export function toProviderToolName(capabilityId: string, options: {
  maxLength?: number;
  namePrefix?: string;
  provider: AicfProviderId;
}): string {
  const metadata = aicfProviderMetadata[options.provider];
  const maxLength = options.maxLength ?? metadata.maxToolNameLength;
  const prefix = sanitizeNamePart(options.namePrefix ?? metadata.defaultNamePrefix, options.provider, false);
  const sanitizedId = sanitizeNamePart(capabilityId, options.provider);
  const base = ensureAllowedStart(`${prefix}${sanitizedId}`, options.provider);

  if (base.length <= maxLength) {
    return base;
  }

  const hash = createHash("sha256").update(base).digest("hex").slice(0, hashLength);
  const headLength = Math.max(1, maxLength - hashLength - 1);
  return `${base.slice(0, headLength).replace(/_+$/g, "")}_${hash}`;
}

function sanitizeNamePart(value: string, provider: AicfProviderId, trim = true): string {
  const pattern = provider === "mcp" ? /[^a-zA-Z0-9_.-]+/g : provider === "anthropic" ? /[^a-zA-Z0-9_-]+/g : /[^a-zA-Z0-9_]+/g;
  const sanitized = value
    .replace(pattern, "_")
    .replace(/_+/g, "_");
  return trim ? sanitized.replace(/^_+|_+$/g, "") : sanitized;
}

function ensureAllowedStart(value: string, provider: AicfProviderId): string {
  if (provider === "anthropic" || provider === "mcp") {
    return value.length > 0 ? value : "aicf_tool";
  }
  return /^[a-zA-Z_]/.test(value) ? value : `aicf_${value}`;
}

function operationForCapability(loadedCapability: LoadedCapabilityManifest): AicfProviderToolNameBinding["operation"] {
  const capability = loadedCapability.manifest;
  if (capability.lifecycle.commit || capability.capability_type === "write_commit") {
    return "commit";
  }
  return capability.lifecycle.prepare ? "prepare" : "read";
}

function providerDiagnostic(input: {
  code: "provider_tool_name_collision" | "provider_tool_name_invalid";
  loadedCapability: LoadedCapabilityManifest;
  message: string;
  provider: AicfProviderId;
}): AicfDiagnostic {
  return {
    code: input.code,
    details: { provider: input.provider },
    id: input.loadedCapability.manifest.id,
    kind: "capability",
    message: input.message,
    path: input.loadedCapability.path
  };
}

function cloneJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
