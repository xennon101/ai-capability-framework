import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { buildRegistry, loadManifests, validatePublicFixtures } from "../../index.js";
import { fixtureKindFromPath } from "../../loader.js";
import { runCli } from "../../cli.js";
import {
  CapabilityDiscoverer, buildCapabilitySearchCorpus, evaluateCapabilityDiscovery, fingerprintDiscoveryEvaluationSuite,
  type DiscoveryEvaluationSuite, type DiscoveryEvaluationObservations
} from "../../discovery/index.js";
import { validateDiscoveryEvaluationSuite } from "../../discovery/evaluation.js";
import { captureEligibility } from "../../discovery/bindings.js";
import { retrievalPolicyFingerprint } from "../../discovery/retrieval-policy.js";
import { hashDiscoveryContent } from "../../discovery/fingerprint.js";
import type { AicfRuntimeContext } from "../../runtime/types.js";
import { runDiscoveryEvaluationExample, FROZEN_SUITE_FINGERPRINT } from "../../../examples/12-capability-discovery-selection/evaluation-example.mjs";

const frozen = JSON.parse(await readFile("examples/12-capability-discovery-selection/discovery-fixtures/three-domains.suite.json", "utf8")) as DiscoveryEvaluationSuite;
const definitions = (suite: DiscoveryEvaluationSuite) => suite.capabilities.map(manifest => ({ kind: "capability" as const, manifest,
  path: `synthetic/${manifest.id}.yaml`, absolutePath: `/synthetic/${manifest.id}.yaml` }));
const chosenCases = ["support.family1.case1", "support.family2.case1", "support.family7.case1", "support.family8.case1", "inventory.family1.case1", "scheduling.family1.case1"];

function fixture() {
  const suite = structuredClone(frozen);
  suite.cases = suite.cases.filter(entry => chosenCases.includes(entry.id));
  const registry = buildRegistry(definitions(suite));
  const configuration = new CapabilityDiscoverer({ mode: "lexical", policyVersion: "eval.test.v1" }).configuration;
  const corpus = buildCapabilitySearchCorpus(registry);
  const choices: Record<string, string | null> = { "support.family1.case1": "support.ticket.get", "support.family2.case1": "support.refund.prepare_case",
    "support.family7.case1": null, "support.family8.case1": null, "inventory.family1.case1": "inventory.stock.get", "scheduling.family1.case1": "scheduling.availability.get" };
  const observations: DiscoveryEvaluationObservations = {
    schema_version: "1.0", suite_id: suite.id, suite_fingerprint: fingerprintDiscoveryEvaluationSuite(suite),
    registry_source_fingerprint: corpus.registrySourceFingerprint, corpus_fingerprint: corpus.corpusFingerprint,
    configuration, retrieval_policy_fingerprint: retrievalPolicyFingerprint(configuration), usage_complete: true, attempts: [],
    cases: suite.cases.map(entry => {
      const context = suite.contexts[entry.context_id]!;
      const eligibility = captureEligibility({ registry, userInput: { text: entry.fragments[0]!.text },
        builtContext: { items: [], warnings: [], modelContextText: "", redactions: [], runtimeContext: context.runtime_context as AicfRuntimeContext } });
      const id = choices[entry.id];
      return { case_id: entry.id, status: id ? "matched" : "no_match", actual_mode: "lexical", eligibility_fingerprint: eligibility.fingerprint,
        candidates: id ? [{ capability_id: id, capability_version: "1.0.0", score: 0.8 }] : [], latency_ms: 2 };
    })
  };
  const run = () => evaluateCapabilityDiscovery({ suite, registry, observations });
  return { suite, registry, observations, run };
}

function report(result: ReturnType<typeof evaluateCapabilityDiscovery>) {
  expect(result.valid, JSON.stringify(result)).toBe(true);
  if (!result.valid) throw new Error("invalid report");
  return result.report;
}
const attempt = (): DiscoveryEvaluationObservations["attempts"][number] => ({ run_id: "run_example", attempt_id: "attempt_1", stage: "selection",
  configuration: { provider: "mock", model: "mock-model", configurationId: "mock.v1" }, mock: true, provider_attempts: 1,
  completed_responses: 1, retry_attempts: 0, repair_attempts: 0, usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100,
  cachedInputTokens: 3, reasoningTokens: 7, estimatedCost: 0 }, elapsed_ms: 1, pending: false, outcome: "completed" });

describe("discovery evaluation contracts and metrics", () => {
  it("freezes authored cases, scenario families, partitions and all critical cohorts", () => {
    expect(fingerprintDiscoveryEvaluationSuite(frozen)).toBe(FROZEN_SUITE_FINGERPRINT);
    expect(frozen.cases).toHaveLength(240);
    expect(new Set(frozen.cases.map(entry => entry.fragments[0]!.text)).size).toBe(240);
    const partitions = new Map<string, string>();
    for (const entry of frozen.cases) {
      if (partitions.has(entry.family_id)) expect(entry.partition).toBe(partitions.get(entry.family_id));
      partitions.set(entry.family_id, entry.partition);
    }
    expect(partitions.size).toBe(60);
    for (const domain of ["support", "inventory", "scheduling"]) {
      const cases = frozen.cases.filter(entry => entry.domain === domain);
      expect(cases).toHaveLength(80);
      for (const [partition, count] of [["train", 40], ["calibration", 20], ["held_out", 20]] as const) expect(cases.filter(entry => entry.partition === partition)).toHaveLength(count);
    }
    for (const cohort of ["paraphrase", "competing_read_prepare", "near_duplicate_scope", "true_no_match", "eligibility_exclusions"]) {
      expect(frozen.cases.filter(entry => entry.cohorts.includes(cohort)).length).toBeGreaterThanOrEqual(20);
      for (const partition of ["train", "calibration", "held_out"]) expect(frozen.cases.some(entry => entry.partition === partition && entry.cohorts.includes(cohort))).toBe(true);
    }
  });

  it("recognizes evaluation fixtures without adding manifests or accepting arbitrary structured files", async () => {
    const loaded = await loadManifests({ path: "examples" });
    expect(loaded.manifests).toHaveLength(16);
    expect(loaded.fixtures).toHaveLength(21);
    expect(loaded.fixtures.filter(x => x.kind === "discovery_eval_suite")).toHaveLength(3);
    expect(validatePublicFixtures(loaded.fixtures).valid).toBe(true);
    expect(fixtureKindFromPath("examples/discovery-fixtures/sample.observations.yaml")).toBe("discovery_eval_observations");
    expect(fixtureKindFromPath("examples/discovery-fixtures/arbitrary.json")).toBe("unknown");
  });

  it("computes compatible sets, independent selection outcomes, zero calls and immutable results", () => {
    const f = fixture();
    f.observations.cases[0]!.selection = { mode: "native", status: "selected", capability_id: "support.ticket.get", capability_version: "1.0.0", operation: "read" };
    f.observations.cases[1]!.selection = { mode: "dedicated", status: "abstained", capability_id: null, capability_version: null, operation: null };
    const before = JSON.stringify(f);
    const value = report(f.run());
    expect(value).toMatchObject({ complete: true, semanticQualityQualified: false, counts: { expected: 6, observed: 6, missing: 0 },
      retrieval: { compatibleRecallAtK: { numerator: 4, denominator: 4, value: 1 }, topOnePrecision: { numerator: 4, denominator: 4, value: 1 },
        noMatchFalsePositiveRate: { numerator: 0, denominator: 1, value: 0 }, policyViolationCases: 0 },
      selection: { compatibleAccuracy: { numerator: 1, denominator: 1, value: 1 }, coverage: { numerator: 1, denominator: 4, value: 0.25 },
        abstentionRate: { numerator: 1, denominator: 2, value: 0.5 }, outcomes: { selected: 1, abstained: 1, not_performed: 4 } },
      usage: { totals: { providerAttempts: 0, totalTokens: { total: 0, complete: true } } } });
    expect(Object.isFrozen(value.retrieval.compatibleRecallAtK)).toBe(true);
    expect(JSON.stringify(f)).toBe(before);
    f.observations.cases[0]!.candidates[0]!.score = 0.1;
    expect(value.retrieval.topOnePrecision.value).toBe(1);
  });

  it("accepts any compatible ID rather than one preferred label", () => {
    const f = fixture();
    f.observations.cases[0]!.candidates[0]!.capability_id = "support.ticket.snapshot";
    expect(report(f.run()).retrieval.compatibleRecallAtK.value).toBe(1);
  });

  it("reports false positives, mutation confusion and denied/commit exposure independently", () => {
    const f = fixture();
    const observed = f.observations.cases[0]!;
    observed.candidates = [{ capability_id: "support.refund.prepare_case", capability_version: "1.0.0", score: 1 }];
    observed.selection = { mode: "native", status: "selected", capability_id: "support.refund.prepare_case", capability_version: "1.0.0", operation: "prepare" };
    const noMatch = f.observations.cases[2]!;
    noMatch.status = "matched"; noMatch.candidates = [{ capability_id: "support.ticket.get", capability_version: "1.0.0", score: 1 }];
    const denied = f.observations.cases[3]!;
    denied.status = "matched"; denied.candidates = [{ capability_id: "support.refund.commit_case", capability_version: "1.0.0", score: 1 }];
    const value = report(f.run());
    expect(value.retrieval).toMatchObject({ noMatchFalsePositiveRate: { value: 1 }, policyViolationCases: 1, readToMutationCases: 2 });
    expect(value.selection).toMatchObject({ compatibleAccuracy: { value: 0 }, forbiddenChoices: 1, readToMutationChoices: 1, policyViolations: 0 });
  });

  it.each(["abstained", "unavailable", "invalid_output", "cancelled", "not_performed"] as const)("keeps %s separate from a selection", status => {
    const f = fixture();
    f.observations.cases[0]!.selection = { mode: "dedicated", status, capability_id: null, capability_version: null, operation: null };
    const value = report(f.run());
    expect(value.selection.outcomes[status]).toBe(status === "not_performed" ? 6 : 1);
    expect(value.selection.compatibleAccuracy.value).toBeNull();
    expect(value.selection.coverage.numerator).toBe(0);
  });

  it("marks missing observations incomplete without removing answerable cases from recall", () => {
    const f = fixture(); f.observations.cases = f.observations.cases.slice(0, 1);
    expect(report(f.run())).toMatchObject({ complete: false, counts: { observed: 1, missing: 5 }, retrieval: { compatibleRecallAtK: { numerator: 1, denominator: 4, value: 0.25 } } });
  });

  it("uses null for empty denominators and handles an empty suite", () => {
    const f = fixture(); f.suite.cases = []; f.suite.capabilities = []; f.observations.cases = [];
    const registry = buildRegistry([]); const corpus = buildCapabilitySearchCorpus(registry);
    f.observations.suite_fingerprint = fingerprintDiscoveryEvaluationSuite(f.suite);
    f.observations.registry_source_fingerprint = corpus.registrySourceFingerprint; f.observations.corpus_fingerprint = corpus.corpusFingerprint;
    const value = report(evaluateCapabilityDiscovery({ ...f, registry }));
    expect(value).toMatchObject({ complete: true, retrieval: { compatibleRecallAtK: { value: null }, topOnePrecision: { value: null }, noMatchFalsePositiveRate: { value: null } },
      selection: { compatibleAccuracy: { value: null }, coverage: { value: null }, abstentionRate: { value: null } }, latencyMs: { p95: null } });
  });

  it("deduplicates a shared provider receipt and never adds cached/reasoning tokens to the total", () => {
    const f = fixture(); f.observations.attempts = [attempt(), attempt()];
    expect(report(f.run()).usage.totals).toMatchObject({ providerAttempts: 1, inputTokens: { total: 80 }, totalTokens: { total: 100 }, cachedInputTokens: { total: 3 }, reasoningTokens: { total: 7 } });
    f.observations.attempts[1]!.usage.inputTokens = 81;
    expect(f.run()).toMatchObject({ valid: false, diagnostics: [{ code: "conflicting_attempt_receipt" }] });
  });

  it("retains unknown usage, incomplete accounting and pending provenance", () => {
    const f = fixture(); const receipt = attempt(); receipt.usage = { inputTokens: 12 }; receipt.pending = true;
    f.observations.attempts = [receipt];
    expect(report(f.run())).toMatchObject({ usageComplete: false, provenance: { mockAttempts: 1, liveAttempts: 0, pendingAttempts: 1 },
      usage: { totals: { inputTokens: { total: 12, complete: true }, totalTokens: { total: null, knownSubtotal: 0, complete: false } } } });
    f.observations.usage_complete = false;
    expect(report(f.run()).usage.totals.inputTokens).toEqual({ total: null, knownSubtotal: 12, complete: false });
  });

  it("preserves failed-attempt consumption and distinguishes accounting from usage completeness", () => {
    const f = fixture(); const receipt = attempt(); receipt.outcome = "failed"; receipt.completed_responses = 0;
    receipt.usage = { inputTokens: 12 }; f.observations.attempts = [receipt];
    expect(report(f.run())).toMatchObject({ accountingComplete: true, usageComplete: false,
      usage: { stages: [{ outcome: "failed" }], totals: { providerAttempts: 1, inputTokens: { total: 12 }, outputTokens: { total: null } } } });
  });

  it("rejects unknown eligibility references and malformed unused contexts", () => {
    const f = fixture();
    f.suite.contexts.unused = { runtime_context: structuredClone(f.suite.contexts.authorized!.runtime_context), eligibility: { excludeCapabilityIds: ["unknown.capability"] } };
    expect(validateDiscoveryEvaluationSuite(f.suite)).toContainEqual({ code: "unknown_eligibility_capability" });
    delete f.suite.contexts.unused.eligibility;
    f.suite.contexts.unused.runtime_context.runId = "";
    expect(validateDiscoveryEvaluationSuite(f.suite)).toContainEqual({ code: "invalid_context" });
  });

  it("handles prototype-like group names and large finite latency without corrupting reports", () => {
    const f = fixture();
    f.suite.cases[0]!.domain = "__proto__"; f.suite.cases[0]!.cohorts.push("constructor");
    f.observations.suite_fingerprint = fingerprintDiscoveryEvaluationSuite(f.suite);
    for (const entry of f.observations.cases) entry.latency_ms = 1e308;
    const value = report(f.run());
    expect(value.counts.byDomain["__proto__"]).toBe(1);
    expect(value.counts.byCohort.constructor).toBe(1);
    expect(value.latencyMs.mean).toBe(1e308);
  });

  it("rejects overflowing aggregate receipts instead of presenting inaccurate known consumption", () => {
    const f = fixture(); const first = attempt(), second = attempt(); second.attempt_id = "attempt_2";
    first.usage.inputTokens = Number.MAX_SAFE_INTEGER; second.usage.inputTokens = Number.MAX_SAFE_INTEGER;
    f.observations.attempts = [first, second];
    expect(f.run()).toMatchObject({ valid: false, diagnostics: [{ code: "invalid_accounting_totals" }] });
  });

  it("validates hybrid observation bindings without claiming to reproduce semantic ranking", () => {
    const f = fixture();
    f.observations.configuration = new CapabilityDiscoverer({ mode: "lexical", policyVersion: "eval.test.v1" }).configuration;
    f.observations.configuration = { ...f.observations.configuration, mode: "hybrid", weights: { semantic: 0.75, lexical: 0.25 }, failurePolicy: "unavailable" };
    f.observations.retrieval_policy_fingerprint = retrievalPolicyFingerprint(f.observations.configuration as any);
    for (const entry of f.observations.cases) {
      entry.actual_mode = "hybrid"; entry.index_fingerprint = hashDiscoveryContent({ fixture: "mock-index" });
    }
    expect(report(f.run()).semanticQualityQualified).toBe(false);
    delete f.observations.cases[0]!.index_fingerprint;
    expect(f.run()).toMatchObject({ valid: false, diagnostics: [{ code: "invalid_retrieval_observation" }] });
  });

  it.each(["suite_fingerprint", "corpus_fingerprint", "registry_source_fingerprint", "retrieval_policy_fingerprint"] as const)("rejects tampered %s", key => {
    const f = fixture(); f.observations[key] = `sha256:${"0".repeat(64)}`;
    expect(f.run()).toMatchObject({ valid: false, diagnostics: [{ code: "observation_binding_mismatch" }] });
  });

  it.each(["duplicate", "foreign", "version", "eligibility", "selection", "schema", "score", "mode"])("rejects invalid %s observations", kind => {
    const f = fixture();
    if (kind === "duplicate") f.observations.cases.push(f.observations.cases[0]!);
    if (kind === "foreign") f.observations.cases[0]!.case_id = "foreign";
    if (kind === "version") f.observations.cases[0]!.candidates[0]!.capability_version = "2.0.0";
    if (kind === "eligibility") f.observations.cases[0]!.eligibility_fingerprint = `sha256:${"0".repeat(64)}`;
    if (kind === "selection") f.observations.cases[0]!.selection = { mode: "dedicated", status: "selected", capability_id: "inventory.stock.get", capability_version: "1.0.0", operation: "read" };
    if (kind === "schema") (f.observations as any).unknown = true;
    if (kind === "score") f.observations.cases[0]!.candidates[0]!.score = Infinity;
    if (kind === "mode") f.observations.cases[0]!.actual_mode = "hybrid";
    expect(f.run().valid).toBe(false);
  });

  it.each(["overlap", "foreign", "permission", "operation", "duplicate", "family", "context", "extra", "cycle"])("rejects invalid %s suites", kind => {
    const f = fixture(); const entry = f.suite.cases[0]!;
    if (kind === "overlap") entry.forbidden_ids.push(entry.compatible_ids[0]!);
    if (kind === "foreign") entry.compatible_ids = ["foreign.capability"];
    if (kind === "permission") entry.context_id = "denied";
    if (kind === "operation") entry.expected_operation = "prepare";
    if (kind === "duplicate") f.suite.cases.push(entry);
    if (kind === "family") f.suite.cases.push({ ...entry, id: "new.case", partition: "held_out" });
    if (kind === "context") entry.context_id = "missing";
    if (kind === "extra") (entry as any).unexpected = true;
    if (kind === "cycle") (f.suite.contexts.authorized!.runtime_context as any).cycle = f.suite;
    expect(validateDiscoveryEvaluationSuite(f.suite).length).toBeGreaterThan(0);
    expect(f.run().valid).toBe(false);
  });

  it("performs semantic fixture checks through CLI validation", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "aicf-discovery-fixture-"));
    const fixtures = path.join(folder, "discovery-fixtures");
    const { mkdir } = await import("node:fs/promises"); await mkdir(fixtures);
    try {
      const f = fixture(); f.suite.cases[0]!.forbidden_ids.push("support.ticket.get");
      await writeFile(path.join(fixtures, "bad.suite.json"), JSON.stringify(f.suite));
      let stderr = "";
      expect(await runCli(["validate", fixtures], { stdout: { write: () => true }, stderr: { write: (s: string) => { stderr += s; return true; } } })).toBe(1);
      expect(stderr).toContain("contradictory_labels");
      await writeFile(path.join(fixtures, "bad.suite.json"), JSON.stringify(fixture().suite));
      await writeFile(path.join(fixtures, "sample.observations.json"), JSON.stringify(fixture().observations));
      expect(await runCli(["validate", fixtures], { stdout: { write: () => true }, stderr: { write: () => true } })).toBe(0);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it("runs the complete frozen lexical baseline and independent mock observations without network", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    try {
      const result = await runDiscoveryEvaluationExample();
      expect(result.lexical).toMatchObject({ complete: true, counts: { expected: 240, observed: 240 },
        retrieval: { compatibleRecallAtK: { numerator: 116, denominator: 120 }, noMatchFalsePositiveRate: { numerator: 47, denominator: 48 }, policyViolationCases: 0 },
        usage: { totals: { providerAttempts: 0, totalTokens: { total: 0, complete: true } } } });
      expect(result.mockSelection).toMatchObject({ complete: false, semanticQualityQualified: false, usageComplete: false,
        selection: { outcomes: { selected: 1, abstained: 1, unavailable: 1, invalid_output: 1 } } });
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
});
