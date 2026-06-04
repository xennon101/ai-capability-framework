import type {
  AicfOpenAIResponsesClient,
  AicfOpenAIResponseLike
} from "./types.js";

export class MockOpenAIResponsesClient implements AicfOpenAIResponsesClient {
  readonly requests: Record<string, unknown>[] = [];
  private queuedResponses: Array<AicfOpenAIResponseLike | Error>;

  constructor(responses: Array<AicfOpenAIResponseLike | Error>) {
    this.queuedResponses = [...responses];
  }

  responsesApi = {
    create: async (input: Record<string, unknown>): Promise<AicfOpenAIResponseLike> => {
      this.requests.push(input);
      const next = this.queuedResponses.shift();
      if (!next) {
        throw new Error("No mock OpenAI response was queued.");
      }

      if (next instanceof Error) {
        throw next;
      }

      return next;
    }
  };

  responses = this.responsesApi;
}

export function mockTextResponse(text: string, id = "resp_text"): AicfOpenAIResponseLike {
  return {
    id,
    output: [{
      content: [{
        text,
        type: "output_text"
      }],
      role: "assistant",
      type: "message"
    }],
    output_text: text
  };
}

export function mockFunctionCallResponse(input: {
  args: Record<string, unknown> | string;
  callId?: string;
  id?: string;
  name: string;
  responseId?: string;
}): AicfOpenAIResponseLike {
  return {
    id: input.responseId ?? "resp_tool",
    output: [{
      arguments: typeof input.args === "string" ? input.args : JSON.stringify(input.args),
      call_id: input.callId ?? "call_1",
      id: input.id ?? "fc_1",
      name: input.name,
      type: "function_call"
    }]
  };
}
