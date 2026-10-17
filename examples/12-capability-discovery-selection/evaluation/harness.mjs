import {
  AicfActionLifecycleManager,
  AicfHandlerRegistry,
  AicfToolExecutor,
  DefaultPolicyBroker,
  DefaultContextBuilder,
  InMemoryApprovalStore,
  InMemoryAuditSink,
  InMemoryIdempotencyStore,
  InMemoryPreparedActionStore,
  createAicfProviderRun
} from "ai-capability-framework/runtime";
import { runOpenAIResponses } from "ai-capability-framework/openai";
import {
  buildCapabilitySearchCorpus,
  createCapabilityDiscovery,
  buildCapabilityEmbeddingIndex,
  hashDiscoveryContent,
  validateCapabilityEmbeddingIndex,
  DISCOVERY_STANDARD_PROFILE
} from "ai-capability-framework/discovery";
import { EXECUTION, PROMPTS, projectTask } from "./campaign.mjs";

import Ajv2020 from "ajv/dist/2020.js";

const appAjv = new Ajv2020({ strict: true, allErrors: true });

const operation = (manifest) => (manifest.lifecycle.prepare ? "prepare" : "read");
const normalizeUsage = (raw) => {
  const result = {};
  for (const [key, value] of Object.entries({
    inputTokens: raw?.input_tokens,
    outputTokens: raw?.output_tokens,
    totalTokens: raw?.total_tokens,
    cachedInputTokens: raw?.input_tokens_details?.cached_tokens,
    reasoningTokens: raw?.output_tokens_details?.reasoning_tokens
  })) {
    if (Number.isSafeInteger(value) && value >= 0) result[key] = value;
  }
  return result;
};

export function createSyntheticRuntime(registry) {
  const handlers = new AicfHandlerRegistry({ registry }),
    executed = [];
  for (const { manifest } of registry.capabilities) {
    if (manifest.lifecycle.commit) continue;
    if (manifest.lifecycle.prepare)
      handlers.register({
        capabilityId: manifest.id,
        prepare: ({ args }) => {
          executed.push({
            capabilityId: manifest.id,
            operation: "prepare",
            args: structuredClone(args)
          });
          return {
            data: { ...args },
            riskTier: "medium",
            summary: "Synthetic proposal for review.",
            userMessage: "The preview requires approval."
          };
        }
      });
    else
      handlers.register({
        capabilityId: manifest.id,
        read: ({ args }) => {
          executed.push({
            capabilityId: manifest.id,
            operation: "read",
            args: structuredClone(args)
          });
          if (manifest.id === "support.ticket.activity")
            return {
              ticket_id: args.ticket_id,
              events: [
                {
                  event_id: "EVT-100",
                  kind: "reply",
                  message: "Replacement acknowledged.",
                  occurred_at: "2030-06-10T09:00:00Z"
                }
              ]
            };
          if (manifest.domain === "support")
            return {
              ticket: { ticket_id: args.ticket_id, order_id: "ORD-100", status: "open" }
            };
          if (manifest.id === "inventory.product.get")
            return {
              product: {
                product_id: args.product_id,
                description: "Synthetic packing item",
                dimensions_cm: { width: 20, height: 10, depth: 5 }
              }
            };
          if (manifest.domain === "inventory")
            return {
              stock: {
                product_id: args.product_id,
                warehouse_id: args.warehouse_id,
                quantity: 12
              }
            };
          if (manifest.id === "scheduling.calendar.events")
            return {
              events: [
                {
                  event_id: "EVT-100",
                  participant_id: args.participant_id,
                  starts_at: "2030-06-10T09:00:00Z",
                  ends_at: "2030-06-10T09:30:00Z",
                  topic: "Existing appointment"
                }
              ]
            };
          return {
            slots: [
              { starts_at: "2030-06-10T10:00:00Z", ends_at: "2030-06-10T10:30:00Z" }
            ]
          };
        }
      });
  }
  let taskScope = null;
  const blockedChoices = [];
  const auditSink = new InMemoryAuditSink();
  const policyBroker = new DefaultPolicyBroker({
    hostPolicyHook: (input) => {
      const requestedOperation =
        input.operation === "select" ? "read" : input.operation;
      if (taskScope && requestedOperation === "prepare") {
        const field = { support: "ticket", inventory: "stock", scheduling: "slots" }[
          input.capability.manifest.domain
        ];
        if (!taskScope.readiness?.some((receipt) => receipt.data?.[field]))
          return {
            status: "denied",
            reasons: [
              {
                code: "application_readiness_missing",
                message: "The application requires a verified prerequisite receipt.",
                severity: "error",
                source: "host"
              }
            ],
            requiredApprovals: []
          };
      }
      if (
        taskScope &&
        (requestedOperation !== taskScope.operation ||
          !taskScope.authorization.permissions?.length)
      ) {
        blockedChoices.push({
          capabilityId: input.capability.manifest.id,
          operation: input.operation,
          expectedOperation: taskScope.operation
        });
        return {
          status: "denied",
          reasons: [
            {
              code: "application_task_scope",
              message: "The application task scope denied this operation.",
              severity: "error",
              source: "host"
            }
          ],
          requiredApprovals: []
        };
      }
      return input.operation === "prepare"
        ? {
            status: "approval_required",
            reasons: [],
            requiredApprovals: [
              {
                approvalType: "operator_review",
                reason: "Synthetic preparation requires review."
              }
            ]
          }
        : null;
    }
  });
  const actionLifecycle = new AicfActionLifecycleManager({
    registry,
    handlers,
    auditSink,
    policyBroker,
    approvalStore: new InMemoryApprovalStore(),
    idempotencyStore: new InMemoryIdempotencyStore(),
    preparedActionStore: new InMemoryPreparedActionStore()
  });
  const executor = new AicfToolExecutor({
    registry,
    handlers,
    auditSink,
    policyBroker,
    actionLifecycle
  });
  return {
    executor,
    executed,
    blockedChoices,
    setTaskScope(value) {
      taskScope = value;
    }
  };
}

export async function buildEvaluationIndex({ registry, host, ledger, context }) {
  const corpus = buildCapabilitySearchCorpus(registry),
    runId = `index.${ledger.fingerprint.slice(7, 39)}`,
    budget = ledger.scope(runId);
  return buildCapabilityEmbeddingIndex({
    corpus,
    client: host.embeddingClient,
    limits: DISCOVERY_STANDARD_PROFILE.indexLimits,
    execution: {
      budgetPolicy: budget.policy,
      estimateCost: host.estimateCost,
      limits: {
        maxInputTokens: 4096,
        maxCharactersPerText: 16_384,
        maxCharactersPerCall: 65_536,
        maxEstimatedCostPerCall: host.maxCost(4096, 0, true)
      }
    },
    batchSize: 8,
    maxProviderCalls: 3,
    runId,
    requestId: "index-build",
    deadlineAt: Date.now() + 30_000,
    budget: budget.ledger,
    runtimeContext: context
  });
}

export function discoveryOptions(registry, mode, k, host, index, contextBuilder) {
  return {
    registry,
    limits: { maxCandidates: k },
    contextBuilder,
    ...(mode.startsWith("hybrid")
      ? {
          mode: "hybrid",
          weights: { semantic: 0.75, lexical: 0.25 },
          failurePolicy: "unavailable",
          embedding: {
            client: host.embeddingClient,
            index,
            maxInputTokens: 4096,
            estimateCost: host.estimateCost,
            maxEstimatedCostPerCall: host.maxCost(4096, 0, true)
          }
        }
      : {})
  };
}

export async function runReadyTask({
  task,
  registry,
  mode,
  k,
  host,
  index,
  providerRun,
  runtime,
  deadlineAt,
  contextBuilder,
  controls,
  afterSearch
}) {
  const discovery = createCapabilityDiscovery(
    discoveryOptions(registry, mode, k, host, index, contextBuilder)
  );
  const started = performance.now();
  const [result] = await discovery.search({
    tasks: [{ id: task.id, text: task.text }],
    runtimeContext: task.runtimeContext,
    eligibility: task.eligibility,
    providerRun,
    deadlineAt,
    controls
  });
  await afterSearch?.({ result, task, discovery });
  let batch, router;
  if (result.status === "matched" && mode.endsWith("dedicated")) {
    batch = await discovery.select({
      results: [result],
      client: host.selectionClient,
      providerRun,
      maxInputTokens: 8000,
      maxOutputTokens: 1000,
      limits: { maxAttempts: 1 },
      deadlineAt,
      contextByQueryId: {
        [task.id]: {
          ...(task.applicationInput ?? {}),
          verifiedReadiness: task.runtimeContext.facts["example.readiness"] ?? null,
          applicationFacts: task.runtimeContext.facts["example.request"] ?? {}
        }
      },
      maxEstimatedCostPerCall: host.maxCost(),
      estimateCost: host.estimateCost
    });
    router = discovery.routerFor(batch, task.id);
  } else router = discovery.routerFor(result);
  const missingAccess = !task.runtimeContext.subject.permissions?.length;
  const actionable =
    result.status === "matched" &&
    !missingAccess &&
    (!batch || batch.outcomes.some((x) => x.status === "selected"));
  const loop = actionable
    ? await runOpenAIResponses({
        registry,
        executor: runtime.executor,
        runtimeContext: task.runtimeContext,
        userInput: { text: task.text },
        contextBuilder,
        router,
        providerRun,
        deadlineAt,
        controls,
        model: EXECUTION.model,
        client: host.client,
        systemInstructions: PROMPTS.ordinary,
        maxTurns: 3,
        maxToolCalls: 1,
        providerExecution: {
          configuration: host.configuration,
          mock: host.mock,
          maxInputTokens: 8000,
          maxOutputTokens: 1000,
          inputTokenPreflight: host.inputTokenPreflight,
          estimateCost: host.estimateCost,
          maxEstimatedCostPerCall: host.maxCost()
        }
      })
    : {
        status: result.status === "cancelled" ? "cancelled" : "completed",
        toolCalls: [],
        toolResults: [],
        selectedCapabilities: { items: [] },
        errors: []
      };
  const selected = batch?.outcomes[0];
  const call = loop.toolCalls[0];
  const status =
    result.status !== "matched"
      ? "not_performed"
      : (selected?.status ??
        (call
          ? "selected"
          : loop.status === "completed"
            ? "abstained"
            : loop.status === "cancelled"
              ? "cancelled"
              : "unavailable"));
  const selectedId =
    status === "selected" ? (selected?.capabilityId ?? call?.capabilityId) : null;
  const selectedManifest = selectedId
    ? registry.capabilityById.get(selectedId)?.manifest
    : null;
  const observation = {
    case_id: task.id,
    status: result.status,
    actual_mode: result.actualMode,
    eligibility_fingerprint: result.eligibilityFingerprint,
    ...(result.indexFingerprint ? { index_fingerprint: result.indexFingerprint } : {}),
    candidates: result.candidates.map((candidate) => ({
      capability_id: candidate.capabilityId,
      capability_version: candidate.capabilityVersion,
      score: candidate.scores.final
    })),
    latency_ms: performance.now() - started,
    selection: {
      mode: mode.endsWith("dedicated") ? "dedicated" : "native",
      status,
      capability_id: selectedId,
      capability_version: selectedManifest?.version ?? null,
      operation: selectedManifest ? operation(selectedManifest) : null
    }
  };
  return {
    observation,
    missingAccess,
    result,
    selection: batch ?? null,
    loop,
    router,
    toolOutcomes: loop.toolResults.map((outcome) => ({
      capabilityId: outcome.capabilityId,
      status: outcome.status,
      operation: outcome.operation,
      data: outcome.data ?? null,
      approvalRequired: outcome.action?.approvalRequired ?? false,
      reasonCodes: outcome.policy?.reasons?.map((reason) => reason.code) ?? []
    })),
    exported: loop.selectedCapabilities.items.map((item) => ({
      capabilityId: item.capabilityId,
      operations: item.exposedOperations
    })),
    deadlineExceeded:
      observation.latency_ms > 30_000 ||
      loop.errors.some((error) => error.code === "deadline_exceeded")
  };
}

export async function runTaskTrial({
  suite,
  registry,
  trial,
  host,
  ledger,
  index,
  afterSearch
}) {
  const runId = `case.${hashDiscoveryContent([ledger.fingerprint, trial.key]).slice(7, 39)}`,
    task = projectTask(
      suite,
      suite.cases.find((entry) => entry.id === trial.caseId),
      runId
    );
  const deadlineAt = Date.now() + 30_000,
    providerRun = createAicfProviderRun({
      runId,
      budget: ledger.scope(runId),
      deadlineAt
    });
  const contextBuilder = new DefaultContextBuilder({
    maxCharacters: 16_000,
    hostItems: [
      {
        id: "application-facts",
        kind: "entity",
        title: "Explicit synthetic request facts",
        data: {
          "example.request": task.runtimeContext.facts["example.request"],
          verifiedReadiness: task.runtimeContext.facts["example.readiness"],
          originalCustomerRequest: task.text
        },
        trusted: true,
        visibleToModel: true
      }
    ]
  });
  const original = hashDiscoveryContent(task.runtimeContext),
    source = buildCapabilitySearchCorpus(registry).registrySourceFingerprint;
  const scopedHost = host.forScope({
    runtimeContext: task.runtimeContext,
    registry,
    deadlineAt,
    guard: () =>
      original !== hashDiscoveryContent(task.runtimeContext) ||
      source !== buildCapabilitySearchCorpus(registry).registrySourceFingerprint
  });
  const runtime = createSyntheticRuntime(registry);
  if (trial.stage === "train") {
    const discovery = createCapabilityDiscovery(
      discoveryOptions(registry, trial.mode, trial.k, scopedHost, index, contextBuilder)
    );
    const [result] = await discovery.search({
      tasks: [{ id: task.id, text: task.text }],
      runtimeContext: task.runtimeContext,
      eligibility: task.eligibility,
      providerRun,
      deadlineAt
    });
    return {
      trial,
      result,
      observation: {
        case_id: task.id,
        status: result.status,
        actual_mode: result.actualMode,
        eligibility_fingerprint: result.eligibilityFingerprint,
        ...(result.indexFingerprint
          ? { index_fingerprint: result.indexFingerprint }
          : {}),
        candidates: result.candidates.map((candidate) => ({
          capability_id: candidate.capabilityId,
          capability_version: candidate.capabilityVersion,
          score: candidate.scores.final
        })),
        latency_ms: result.usage.totals.elapsedMs
      },
      run: providerRun.snapshot(),
      executed: [],
      exported: [],
      toolOutcomes: [],
      errors: result.diagnostics.map((item) => item.code)
    };
  }
  const output = await runReadyTask({
    task,
    registry,
    mode: trial.mode,
    k: trial.k,
    host: scopedHost,
    index,
    providerRun,
    runtime,
    deadlineAt,
    contextBuilder,
    afterSearch
  });
  return {
    trial,
    observation: output.observation,
    result: output.result,
    selection: output.selection,
    loopStatus: output.loop.status,
    errors: [
      ...output.loop.errors.map((x) => x.code),
      ...output.result.diagnostics.map((x) => x.code),
      ...(output.selection?.diagnostics.map((x) => x.code) ?? [])
    ],
    exported: output.exported,
    toolOutcomes: output.toolOutcomes,
    executed: runtime.executed,
    deadlineExceeded: output.deadlineExceeded,
    run: providerRun.snapshot()
  };
}

export async function modelJson({
  providerRun,
  host,
  runtimeContext,
  requestId,
  stage,
  instructions,
  input,
  schema,
  outputLimit
}) {
  const validate = appAjv.compile(schema);
  const request = {
    model: EXECUTION.model,
    input,
    instructions,
    text: {
      format: {
        type: "json_schema",
        name: stage === "planning" ? "application_plan_v2" : "application_response_v2",
        strict: true,
        schema
      }
    },
    max_output_tokens: outputLimit,
    truncation: "disabled"
  };
  const result = await providerRun.attempt({
    stage,
    requestId,
    configuration: host.configuration,
    mock: host.mock,
    deadlineAt: Math.min(providerRun.deadlineAt, Date.now() + 30_000),
    runtimeContext,
    maxInputTokens: 8000,
    maxOutputTokens: outputLimit,
    estimateCost: host.estimateCost,
    maxEstimatedCostPerCall: host.maxCost(8000, outputLimit),
    invoke: async (context) => {
      context.beforeProviderCall();
      await host.inputTokenPreflight({
        request,
        history: [],
        maxInputTokens: 8000,
        configuration: host.configuration,
        ...context
      });
      context.beforeProviderCall();
      const value = await host.client.responses.create(request, {
        signal: context.signal,
        timeout: Math.max(1, context.deadlineAt - Date.now()),
        maxRetries: 0
      });
      return { value, providerAttempts: 1, usage: normalizeUsage(value.usage) };
    },
    validate: (envelope) =>
      envelope.value?.status === "completed" &&
      typeof envelope.value.output_text === "string" &&
      envelope.value.output_text.length <= 32_000
        ? { value: envelope.value.output_text }
        : { code: "invalid_output" }
  });
  if (result.code) throw new Error("Application model stage unavailable.");
  let parsed;
  try {
    parsed = JSON.parse(result.value);
  } catch {
    throw Object.assign(new Error("Application model JSON is invalid."), {
      applicationOutput: result.value.slice(0, 4000)
    });
  }
  if (!validate(parsed))
    throw Object.assign(new Error("Application model JSON is invalid."), {
      applicationOutput: result.value.slice(0, 4000)
    });
  return parsed;
}

export { runWorkflowTrial } from "./workflow-application.mjs";

export function validateIndex(index, registry, host) {
  return validateCapabilityEmbeddingIndex(index, {
    corpus: buildCapabilitySearchCorpus(registry),
    configuration: host.embeddingConfiguration,
    mock: host.mock,
    limits: DISCOVERY_STANDARD_PROFILE.indexLimits
  });
}
