import type {
  AicfAnthropicMessageResponseLike,
  AicfAnthropicMessagesClient,
  AicfAnthropicToolUseBlock
} from "./types.js";

export class MockAnthropicMessagesClient implements AicfAnthropicMessagesClient {
  readonly requests: Record<string, unknown>[] = [];
  private queuedResponses: Array<AicfAnthropicMessageResponseLike | Error>;

  constructor(responses: Array<AicfAnthropicMessageResponseLike | Error>) {
    this.queuedResponses = [...responses];
  }

  messages = {
    create: async (input: Record<string, unknown>): Promise<AicfAnthropicMessageResponseLike> => {
      this.requests.push(input);
      const next = this.queuedResponses.shift();
      if (!next) {
        throw new Error("No mock Anthropic response was queued.");
      }
      if (next instanceof Error) {
        throw next;
      }
      return next;
    }
  };
}

export function mockAnthropicTextResponse(
  text: string,
  id = "msg_text"
): AicfAnthropicMessageResponseLike {
  return {
    content: [{
      text,
      type: "text"
    }],
    id,
    role: "assistant",
    stop_reason: "end_turn"
  };
}

export function mockAnthropicToolUseResponse(input: {
  id?: string;
  input: Record<string, unknown>;
  name: string;
  responseId?: string;
}): AicfAnthropicMessageResponseLike {
  return {
    content: [mockAnthropicToolUseBlock(input)],
    id: input.responseId ?? "msg_tool",
    role: "assistant",
    stop_reason: "tool_use"
  };
}

export function mockAnthropicToolUseBlock(input: {
  id?: string;
  input: Record<string, unknown>;
  name: string;
}): AicfAnthropicToolUseBlock {
  return {
    id: input.id ?? "toolu_1",
    input: input.input,
    name: input.name,
    type: "tool_use"
  };
}
