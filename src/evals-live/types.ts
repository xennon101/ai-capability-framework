import type { AicfOpenAIResponsesClient } from "../openai/index.js";
import type {
  AicfCapabilityRouter,
  AicfContextBuilder,
  AicfContextItem,
  AicfRuntimeContext,
  AicfRuntimeToolResultEnvelope,
  AicfRuntimeUserInput,
  AicfToolExecutor,
  CapabilitySlice,
  ManifestRegistry
} from "../runtime/index.js";
import type { EvalCandidateResult, EvalCase, EvalScorerResult, LoadedEvalCase } from "../types.js";
import type { AicfRuntimeTraceEvent, AicfTraceSink } from "../observability/index.js";

export type AicfLiveEvalProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "ai-sdk"
  | "langchain"
  | "langgraph"
  | "mcp"
  | "semantic-kernel-compatible"
  | string;

export interface AicfLiveEvalCaseInput {
  evalId: string;
  expected?: EvalCase["expected"];
  fixtureContextItems?: AicfContextItem[];
  runtimeContext: AicfRuntimeContext;
  userInput: AicfRuntimeUserInput;
}

export interface AicfNormalizedLiveEvalRunResult {
  errors: Array<{ code: string; message: string }>;
  finalText: string;
  providerId: AicfLiveEvalProviderId;
  responseId?: string;
  runId: string;
  runtimeName: string;
  selectedCapabilities: CapabilitySlice;
  status: string;
  toolCalls: Array<{
    args: Record<string, unknown>;
    callId?: string;
    capabilityId: string;
    toolName?: string;
  }>;
  toolResults: AicfRuntimeToolResultEnvelope[];
  traceEvents: AicfRuntimeTraceEvent[];
  usage?: unknown;
}

export interface AicfLiveEvalCaseRunInput<TProviderConfig = unknown> {
  abortSignal?: AbortSignal;
  caseId: string;
  contextBuilder: AicfContextBuilder;
  executor: AicfToolExecutor;
  loadedEval: LoadedEvalCase;
  providerConfig?: TProviderConfig;
  registry: ManifestRegistry;
  router: AicfCapabilityRouter;
  runtimeContext: AicfRuntimeContext;
  suiteId: string;
  testCase: AicfLiveEvalCaseInput;
  traceSink?: AicfTraceSink;
  userInput: AicfRuntimeUserInput;
}

export interface AicfLiveEvalCaseRunResult {
  providerId: AicfLiveEvalProviderId;
  runResult: AicfNormalizedLiveEvalRunResult;
  runtimeName: string;
}

export interface AicfLiveEvalRunner<TProviderConfig = unknown> {
  readonly providerId: AicfLiveEvalProviderId;
  readonly runtimeName: string;
  runCase(input: AicfLiveEvalCaseRunInput<TProviderConfig>): Promise<AicfLiveEvalCaseRunResult>;
}

export interface AicfLiveEvalScorer {
  name: string;
  score(input: {
    candidate: EvalCandidateResult;
    runResult: AicfNormalizedLiveEvalRunResult;
    testCase: AicfLiveEvalCaseInput;
  }): EvalScorerResult;
}

export interface AicfLiveEvalOptions {
  cases: AicfLiveEvalCaseInput[];
  contextBuilderFactory: (testCase: AicfLiveEvalCaseInput) => AicfContextBuilder;
  executor: AicfToolExecutor;
  maxConcurrency?: number;
  model?: string;
  openAIClient?: AicfOpenAIResponsesClient;
  providerConfig?: unknown;
  registry: ManifestRegistry;
  runner?: AicfLiveEvalRunner;
  router: AicfCapabilityRouter;
  scorers?: AicfLiveEvalScorer[];
  suiteId?: string;
  traceSink?: AicfTraceSink;
}

export interface AicfLiveEvalResult {
  candidate?: EvalCandidateResult;
  evalId: string;
  providerId?: AicfLiveEvalProviderId;
  runResult?: AicfNormalizedLiveEvalRunResult;
  runtimeName?: string;
  scores: Array<{
    message?: string;
    passed: boolean;
    score: number;
    scorer: string;
  }>;
  status: "passed" | "failed" | "errored";
}

export interface AicfEvalGate {
  forbiddenFailedScorers?: string[];
  minAverageScore?: number;
  requireAllPassed?: boolean;
}

export interface AicfEvalGateResult {
  averageScore: number;
  diagnostics: string[];
  passed: boolean;
  status: "passed" | "failed";
}

export interface CreateEvalCaseFromTraceInput {
  includeModelOutput?: boolean;
  reason: "user_feedback" | "policy_denial" | "approval_rejection" | "low_score" | "manual";
  runResult: AicfNormalizedLiveEvalRunResult;
}
