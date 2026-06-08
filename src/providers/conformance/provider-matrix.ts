import type {
  CanonicalProviderConformanceTarget,
  ProviderConformanceTargetAlias,
  ProviderConformanceTarget,
  ProviderConformanceMatrixFormat,
  ProviderTargetMatrix,
  ProviderTargetMetadata
} from "./types.js";

const providerTargets: ProviderTargetMetadata[] = [
  {
    adapterKind: "descriptor",
    canonicalProvider: "openai",
    label: "OpenAI Responses",
    provider: "openai",
    requiresContext: true,
    requiresServerUrl: false,
    runtimeBoundary: "bounded_loop"
  },
  {
    adapterKind: "descriptor",
    canonicalProvider: "anthropic",
    label: "Anthropic Claude",
    provider: "anthropic",
    requiresContext: true,
    requiresServerUrl: false,
    runtimeBoundary: "bounded_loop"
  },
  {
    adapterKind: "descriptor",
    canonicalProvider: "gemini",
    label: "Google Gemini",
    provider: "gemini",
    requiresContext: true,
    requiresServerUrl: false,
    runtimeBoundary: "bounded_loop"
  },
  {
    adapterKind: "descriptor",
    canonicalProvider: "ai-sdk",
    label: "Vercel AI SDK",
    provider: "ai-sdk",
    requiresContext: true,
    requiresServerUrl: false,
    runtimeBoundary: "host_framework_bridge"
  },
  {
    adapterKind: "descriptor",
    canonicalProvider: "langchain",
    label: "LangChain/LangGraph",
    provider: "langchain",
    requiresContext: true,
    requiresServerUrl: false,
    runtimeBoundary: "host_framework_bridge"
  },
  {
    adapterKind: "descriptor",
    canonicalProvider: "mcp",
    label: "Model Context Protocol",
    provider: "mcp",
    requiresContext: true,
    requiresServerUrl: false,
    runtimeBoundary: "descriptor_only"
  },
  {
    adapterKind: "descriptor",
    canonicalProvider: "semantic-kernel-mcp",
    label: "Semantic Kernel MCP",
    provider: "semantic-kernel-mcp",
    requiresContext: true,
    requiresServerUrl: false,
    runtimeBoundary: "descriptor_only"
  },
  {
    adapterKind: "openapi",
    label: "Semantic Kernel OpenAPI",
    canonicalProvider: "semantic-kernel-openapi",
    provider: "semantic-kernel-openapi",
    requiresContext: true,
    requiresServerUrl: true,
    runtimeBoundary: "openapi_metadata"
  }
];

export function listProviderTargets(): ProviderTargetMetadata[] {
  return providerTargets.map((target) => ({ ...target }));
}

export function providerTargetById(provider: string): ProviderTargetMetadata | undefined {
  const normalized = normalizeProviderConformanceTarget(provider);
  return normalized ? providerTargets.find((target) => target.provider === normalized) : undefined;
}

export function normalizeProviderConformanceTarget(
  value: string
): CanonicalProviderConformanceTarget | undefined {
  switch (value) {
    case "vercel-ai-sdk":
    case "vercel_ai_sdk":
      return "ai-sdk";
    case "semantic-kernel":
      return "semantic-kernel-openapi";
    case "ai-sdk":
    case "anthropic":
    case "gemini":
    case "langchain":
    case "mcp":
    case "openai":
    case "semantic-kernel-mcp":
    case "semantic-kernel-openapi":
      return value;
    default:
      return undefined;
  }
}

export function isProviderConformanceTarget(
  value: string
): value is ProviderConformanceTarget | ProviderConformanceTargetAlias {
  return Boolean(normalizeProviderConformanceTarget(value));
}

export function parseProviderConformanceTargets(
  csv: string | undefined
): {
  errors: string[];
  providers: CanonicalProviderConformanceTarget[];
} {
  if (!csv) {
    return {
      errors: [],
      providers: listProviderTargets().map((target) => target.provider as CanonicalProviderConformanceTarget)
    };
  }

  const providers: CanonicalProviderConformanceTarget[] = [];
  const errors: string[] = [];
  for (const rawValue of csv.split(",")) {
    const value = rawValue.trim();
    if (!value) {
      continue;
    }
    const normalized = normalizeProviderConformanceTarget(value);
    if (!normalized) {
      errors.push(`Unknown provider "${value}".`);
      continue;
    }
    if (!providers.includes(normalized)) {
      providers.push(normalized);
    }
  }

  return {
    errors,
    providers
  };
}

export function buildProviderTargetMatrix(options: {
  generatedAt?: string;
  providers?: Array<ProviderConformanceTarget | ProviderConformanceTargetAlias>;
} = {}): ProviderTargetMatrix {
  const requested = options.providers
    ? new Set(options.providers.map((provider) => normalizeProviderConformanceTarget(provider)).filter(isCanonicalProvider))
    : null;
  return {
    generatedAt: options.generatedAt ?? "1970-01-01T00:00:00.000Z",
    schemaVersion: "1.0",
    targets: listProviderTargets().filter((target) => !requested || requested.has(target.provider as CanonicalProviderConformanceTarget))
  };
}

export function formatProviderTargetMatrix(
  matrix: ProviderTargetMatrix,
  format: ProviderConformanceMatrixFormat = "markdown"
): string {
  if (format === "json") {
    return `${JSON.stringify(matrix, null, 2)}\n`;
  }

  const lines = [
    "| Provider | Label | Adapter kind | Runtime boundary | Server URL required |",
    "| --- | --- | --- | --- | --- |"
  ];
  for (const target of matrix.targets) {
    lines.push([
      target.provider,
      target.label,
      target.adapterKind,
      target.runtimeBoundary,
      target.requiresServerUrl ? "yes" : "no"
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  return `${lines.join("\n")}\n`;
}

function isCanonicalProvider(value: CanonicalProviderConformanceTarget | undefined): value is CanonicalProviderConformanceTarget {
  return Boolean(value);
}
