import type { AicfProviderToolResult } from "../shared/types.js";
import type {
  AicfAnthropicToolResultBlock,
  BuildAnthropicToolResultMessageOptions
} from "./types.js";

export function buildAnthropicToolResultMessage(
  results: AicfProviderToolResult[],
  _options: BuildAnthropicToolResultMessageOptions = {}
): { content: AicfAnthropicToolResultBlock[]; role: "user" } {
  return {
    content: results.map(buildAnthropicToolResultBlock),
    role: "user"
  };
}

export function buildAnthropicToolResultBlock(result: AicfProviderToolResult): AicfAnthropicToolResultBlock {
  if (!result.callId) {
    throw new Error("Anthropic tool_result requires a tool_use_id.");
  }

  return {
    content: result.output,
    ...(result.isError ? { is_error: true as const } : {}),
    tool_use_id: result.callId,
    type: "tool_result"
  };
}
