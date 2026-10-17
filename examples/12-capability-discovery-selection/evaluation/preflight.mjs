import {
  DefaultContextBuilder,
  filterEligibleCapabilities
} from "ai-capability-framework/runtime";
import {
  createCapabilityDiscovery,
  hashDiscoveryContent
} from "ai-capability-framework/discovery";
import { CAPS, EXECUTION, MODES, projectTask, trialSchedule } from "./campaign.mjs";

/** Capacity estimate uses current eligibility/ranking, never expected labels or successful outcomes. */
export async function preflightCampaign({
  suite,
  registry,
  workflows,
  caps = CAPS,
  pricing
}) {
  caps = { ...CAPS, ...caps };
  const builder = new DefaultContextBuilder(),
    discovery = createCapabilityDiscovery({ registry });
  const readiness = new Map();
  for (const entry of suite.cases) {
    const task = projectTask(suite, entry, "preflight"),
      userInput = { text: task.text };
    const builtContext = await builder.build({
      registry,
      baseContext: task.runtimeContext,
      userInput
    });
    const eligible =
      filterEligibleCapabilities({
        registry,
        builtContext,
        userInput,
        ...task.eligibility
      }).eligible.length > 0;
    const [result] = await discovery.search({
      tasks: [{ id: task.id, text: task.text }],
      runtimeContext: task.runtimeContext,
      eligibility: task.eligibility
    });
    readiness.set(entry.id, { hybrid: eligible, lexical: result.status === "matched" });
  }
  let embeddings = 3,
    minimumGeneration = workflows.length * MODES.length * 2,
    normalGeneration = minimumGeneration,
    maximumGeneration = minimumGeneration;
  for (const stage of ["train", "baseline", "qualify"])
    for (const trial of trialSchedule(suite, stage)) {
      const hybrid = trial.mode.startsWith("hybrid"),
        ready = readiness.get(trial.caseId)[hybrid ? "hybrid" : "lexical"];
      if (!ready) continue;
      if (hybrid) embeddings++;
      if (stage !== "train") {
        const selector = trial.mode.endsWith("dedicated") ? 1 : 0;
        minimumGeneration += selector + 1;
        normalGeneration += selector + 2;
        maximumGeneration += selector + EXECUTION.maxTurns;
      }
    }
  // Every workflow graph is bounded at four tasks; the minimum does not assume successful planning.
  let workflowMaximumEmbeddings = 0,
    workflowMaximumGeneration = 0;
  for (const mode of MODES) {
    if (mode.startsWith("hybrid")) workflowMaximumEmbeddings += workflows.length * 4;
    workflowMaximumGeneration +=
      workflows.length *
      4 *
      (EXECUTION.maxTurns + (mode.endsWith("dedicated") ? 1 : 0));
  }
  const envelope = (generation, embedding) => {
    const value = {
      providerCalls: generation + embedding,
      httpRequests: 2 * generation + embedding,
      inputTokens: generation * 8000 + embedding * 4096,
      outputTokens: generation * 1000 + workflows.length * MODES.length * 1000
    };
    value.estimatedCost = pricing
      ? ((value.inputTokens * pricing.inputPerMillion +
          value.outputTokens * pricing.outputPerMillion) /
          1e6 +
          (embedding * 4096 * pricing.embeddingPerMillion) / 1e6 +
          generation * pricing.tokenCountPerRequest) *
        pricing.premiumMultiplier
      : null;
    return value;
  };
  const minimum = envelope(minimumGeneration, embeddings),
    normal = envelope(normalGeneration, embeddings),
    maximum = envelope(
      maximumGeneration + workflowMaximumGeneration,
      embeddings + workflowMaximumEmbeddings
    );
  const exceeds = (value) =>
    Object.keys(CAPS).filter((key) => value[key] !== null && value[key] > caps[key]);
  return {
    version: "campaign-capacity.v1",
    scheduleFingerprint: hashDiscoveryContent({
      stages: ["train", "baseline", "qualify"].map((stage) =>
        trialSchedule(suite, stage)
      ),
      workflows
    }),
    feasible: !exceeds(maximum).length,
    minimum,
    normalBeforeWorkflowTasks: normal,
    maximum,
    minimumExceeded: exceeds(minimum),
    maximumExceeded: exceeds(maximum),
    caps,
    limitation:
      "A capacity forecast is not a reservation or a promise of completion. Every attempt remains hard-capped; extra ordinary turns or workflow branches may exhaust remaining allowance and leave the campaign incomplete."
  };
}
