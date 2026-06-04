import type {
  AicfGeminiClient,
  AicfGeminiFunctionCallLike,
  AicfGeminiGenerateContentResponseLike
} from "./types.js";

export class MockGeminiClient implements AicfGeminiClient {
  readonly requests: Record<string, unknown>[] = [];
  private queuedResponses: Array<AicfGeminiGenerateContentResponseLike | Error>;

  constructor(responses: Array<AicfGeminiGenerateContentResponseLike | Error>) {
    this.queuedResponses = [...responses];
  }

  models = {
    generateContent: async (input: Record<string, unknown>): Promise<AicfGeminiGenerateContentResponseLike> => {
      this.requests.push(input);
      const next = this.queuedResponses.shift();
      if (!next) {
        throw new Error("No mock Gemini response was queued.");
      }
      if (next instanceof Error) {
        throw next;
      }
      return next;
    }
  };
}

export function mockGeminiTextResponse(
  text: string,
  id = "gemini_text"
): AicfGeminiGenerateContentResponseLike {
  return {
    candidates: [{
      content: {
        parts: [{ text }],
        role: "model"
      }
    }],
    id,
    text
  };
}

export function mockGeminiFunctionCallResponse(input: {
  args: Record<string, unknown>;
  id?: string;
  name: string;
  responseId?: string;
}): AicfGeminiGenerateContentResponseLike {
  return {
    functionCalls: [mockGeminiFunctionCall(input)],
    id: input.responseId ?? "gemini_function"
  };
}

export function mockGeminiCandidateFunctionCallResponse(input: {
  args: Record<string, unknown>;
  id?: string;
  name: string;
  responseId?: string;
}): AicfGeminiGenerateContentResponseLike {
  return {
    candidates: [{
      content: {
        parts: [
          { text: "Checking the tool." },
          { functionCall: mockGeminiFunctionCall(input) },
          { text: "Waiting for result." }
        ],
        role: "model"
      }
    }],
    id: input.responseId ?? "gemini_candidate_function"
  };
}

export function mockGeminiFunctionCall(input: {
  args: Record<string, unknown>;
  id?: string;
  name: string;
}): AicfGeminiFunctionCallLike {
  return {
    args: input.args,
    id: input.id ?? "func_1",
    name: input.name
  };
}
