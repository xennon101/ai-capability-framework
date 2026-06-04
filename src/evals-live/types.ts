import type { AicfOpenAIResponsesClient, AicfOpenAIRunResult } from "../openai/index.js";
import type {
  AicfCapabilityRouter,
  AicfContextBuilder,
  AicfContextItem,
  AicfRuntimeContext,
  AicfRuntimeUserInput,
  AicfToolExecutor,
  ManifestRegistry
} from "../runtime/index.js";
import type { EvalCandidateResult, EvalCase, EvalScorerResult } from "../types.js";
import type { AicfTraceSink } from "../observability/index.js";

export interface AicfLiveEvalCaseInput {
  evalId: string;
  expected?: EvalCase["expected"];
  fixtureContextItems?: AicfContextItem[];
  runtimeContext: AicfRuntimeContext;
  userInput: AicfRuntimeUserInput;
}

export interface AicfLiveEvalScorer {
  name: string;
  score(input: {
    candidate: EvalCandidateResult;
    runResult: AicfOpenAIRunResult;
    testCase: AicfLiveEvalCaseInput;
  }): EvalScorerResult;
}

export interface AicfLiveEvalOptions {
  cases: AicfLiveEvalCaseInput[];
  contextBuilderFactory: (testCase: AicfLiveEvalCaseInput) => AicfContextBuilder;
  executor: AicfToolExecutor;
  maxConcurrency?: number;
  model: string;
  openAIClient: AicfOpenAIResponsesClient;
  registry: ManifestRegistry;
  router: AicfCapabilityRouter;
  scorers?: AicfLiveEvalScorer[];
  traceSink?: AicfTraceSink;
}

export interface AicfLiveEvalResult {
  candidate?: EvalCandidateResult;
  evalId: string;
  runResult?: AicfOpenAIRunResult;
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
  runResult: AicfOpenAIRunResult;
}
