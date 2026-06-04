import type {
  ProviderConformanceTarget,
  ProviderTargetMetadata
} from "./types.js";

const providerTargets: ProviderTargetMetadata[] = [
  {
    adapterKind: "descriptor",
    label: "OpenAI Responses",
    provider: "openai",
    requiresContext: true,
    requiresServerUrl: false
  },
  {
    adapterKind: "descriptor",
    label: "Anthropic Claude",
    provider: "anthropic",
    requiresContext: true,
    requiresServerUrl: false
  },
  {
    adapterKind: "descriptor",
    label: "Google Gemini",
    provider: "gemini",
    requiresContext: true,
    requiresServerUrl: false
  },
  {
    adapterKind: "descriptor",
    label: "Vercel AI SDK",
    provider: "ai-sdk",
    requiresContext: true,
    requiresServerUrl: false
  },
  {
    adapterKind: "descriptor",
    label: "LangChain/LangGraph",
    provider: "langchain",
    requiresContext: true,
    requiresServerUrl: false
  },
  {
    adapterKind: "descriptor",
    label: "Model Context Protocol",
    provider: "mcp",
    requiresContext: true,
    requiresServerUrl: false
  },
  {
    adapterKind: "openapi",
    label: "Semantic Kernel OpenAPI",
    provider: "semantic-kernel",
    requiresContext: true,
    requiresServerUrl: true
  }
];

export function listProviderTargets(): ProviderTargetMetadata[] {
  return providerTargets.map((target) => ({ ...target }));
}

export function providerTargetById(provider: string): ProviderTargetMetadata | undefined {
  return providerTargets.find((target) => target.provider === provider);
}

export function isProviderConformanceTarget(value: string): value is ProviderConformanceTarget {
  return Boolean(providerTargetById(value));
}
