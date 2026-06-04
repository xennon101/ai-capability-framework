import { AicfProviderError } from "../shared/errors.js";
import { buildLangChainTools } from "./tools.js";
import type { BuildLangGraphToolNodeRequest } from "./types.js";

export function buildLangGraphToolNode(request: BuildLangGraphToolNodeRequest): unknown {
  if (typeof request.ToolNode !== "function") {
    throw new AicfProviderError({
      code: "provider_sdk_error",
      provider: "langchain",
      safeMessage: "A host-supplied LangGraph ToolNode constructor is required."
    });
  }

  const toolset = buildLangChainTools(request);
  return new request.ToolNode(toolset.tools, {
    ...(request.toolNodeOptions ?? {}),
    aicf: {
      diagnostics: toolset.diagnostics,
      provider: "langchain"
    }
  });
}
