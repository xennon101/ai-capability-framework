import { readFile } from "node:fs/promises";
import { buildRegistry } from "ai-capability-framework";
import {
  buildCapabilitySearchCorpus,
  CapabilityDiscoverer,
  createCapabilityDiscovery,
  DISCOVERY_STANDARD_PROFILE,
  evaluateCapabilityDiscovery,
  fingerprintDiscoveryEvaluationSuite
} from "ai-capability-framework/discovery";

export const FROZEN_SUITE_FINGERPRINT =
  "sha256:01d1ddfeb6c7768bf5108fc00917ce0a4d95283cfaf14dd5910adde2b55969d2";

export async function loadDiscoveryEvaluationExample() {
  const suite = JSON.parse(
    await readFile(
      new URL("./discovery-fixtures/three-domains.suite.json", import.meta.url),
      "utf8"
    )
  );
  if (fingerprintDiscoveryEvaluationSuite(suite) !== FROZEN_SUITE_FINGERPRINT)
    throw new Error("Frozen evaluation suite changed.");
  const registry = buildRegistry(
    suite.capabilities.map((manifest) => ({
      kind: "capability",
      manifest,
      path: `synthetic/${manifest.id}.yaml`,
      absolutePath: `/synthetic/${manifest.id}.yaml`
    }))
  );
  return { suite, registry };
}

export async function runDiscoveryEvaluationExample() {
  const { suite, registry } = await loadDiscoveryEvaluationExample();
  const configuration = new CapabilityDiscoverer({
    mode: "lexical",
    policyVersion: DISCOVERY_STANDARD_PROFILE.policyVersion
  }).configuration;
  const discovery = createCapabilityDiscovery({ registry });
  const corpus = buildCapabilitySearchCorpus(registry);
  const cases = [];
  let policyFingerprint;
  // Only requests and runtime context enter search. Expected labels stay in the evaluator.
  for (const entry of suite.cases) {
    const context = suite.contexts[entry.context_id];
    const [result] = await discovery.search({
      tasks: [
        {
          id: entry.id,
          text: entry.fragments.map((fragment) => fragment.text).join("\n")
        }
      ],
      runtimeContext: {
        ...structuredClone(context.runtime_context),
        runId: `run.${entry.id}`,
        requestId: entry.id
      },
      eligibility: context.eligibility
    });
    if (result.usage.totals.providerAttempts !== 0)
      throw new Error("Lexical evaluation purchased provider work.");
    policyFingerprint ??= result.retrievalPolicyFingerprint;
    cases.push({
      case_id: entry.id,
      status: result.status,
      actual_mode: result.actualMode,
      eligibility_fingerprint: result.eligibilityFingerprint,
      candidates: result.candidates.map((candidate) => ({
        capability_id: candidate.capabilityId,
        capability_version: candidate.capabilityVersion,
        score: candidate.scores.final
      })),
      latency_ms: result.usage.totals.elapsedMs
    });
  }
  const observations = {
    schema_version: "1.0",
    suite_id: suite.id,
    suite_fingerprint: FROZEN_SUITE_FINGERPRINT,
    registry_source_fingerprint: corpus.registrySourceFingerprint,
    corpus_fingerprint: corpus.corpusFingerprint,
    retrieval_policy_fingerprint: policyFingerprint,
    configuration,
    cases,
    attempts: [],
    usage_complete: true
  };
  const lexical = evaluateCapabilityDiscovery({ suite, registry, observations });
  if (
    !lexical.valid ||
    !lexical.report.complete ||
    lexical.report.retrieval.policyViolationCases
  )
    throw new Error("Offline contract evaluation failed.");

  // Independently authored observations exercise model outcomes; no labels choose these IDs.
  const scripted = new Map([
    [
      "support.family1.case1",
      {
        status: "selected",
        capability_id: "support.ticket.get",
        capability_version: "1.0.0",
        operation: "read"
      }
    ],
    [
      "support.family2.case1",
      {
        status: "abstained",
        capability_id: null,
        capability_version: null,
        operation: null
      }
    ],
    [
      "inventory.family1.case1",
      {
        status: "invalid_output",
        capability_id: null,
        capability_version: null,
        operation: null
      }
    ],
    [
      "scheduling.family1.case1",
      {
        status: "unavailable",
        capability_id: null,
        capability_version: null,
        operation: null
      }
    ]
  ]);
  const mockObservations = {
    ...observations,
    usage_complete: false,
    cases: cases
      .filter((entry) => scripted.has(entry.case_id))
      .map((entry) => ({
        ...entry,
        selection: { mode: "dedicated", ...scripted.get(entry.case_id) }
      }))
  };
  const mockSelection = evaluateCapabilityDiscovery({
    suite,
    registry,
    observations: mockObservations
  });
  if (!mockSelection.valid) throw new Error("Mock observation contract failed.");
  return { lexical: lexical.report, mockSelection: mockSelection.report };
}
