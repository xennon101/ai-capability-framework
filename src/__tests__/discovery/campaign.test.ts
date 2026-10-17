import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateCapabilityDiscovery, fingerprintDiscoveryEvaluationSuite, hashDiscoveryContent } from "../../discovery/index.js";
import { validatePublicFixtures, validateManifests } from "../../index.js";
import { createAicfProviderRun } from "ai-capability-framework/runtime";
import { createMockHost } from "../../../examples/12-capability-discovery-selection/evaluation/mock-host.mjs";
import { openCampaignLedger } from "../../../examples/12-capability-discovery-selection/evaluation/durable-budget.mjs";
import { campaignBinding, configuration, loadSuite, projectTask, registryFor, trialSchedule, validateDataset } from "../../../examples/12-capability-discovery-selection/evaluation/campaign.mjs";
import { validateOffline, runCampaign } from "../../../examples/12-capability-discovery-selection/evaluation/runner.mjs";
import { WORKFLOWS, validatePlan } from "../../../examples/12-capability-discovery-selection/evaluation/workflow-cases.mjs";
import { runTaskTrial, runWorkflowTrial, buildEvaluationIndex } from "../../../examples/12-capability-discovery-selection/evaluation/harness.mjs";
import { observationsFor, wilson, materiallyRegresses, assess } from "../../../examples/12-capability-discovery-selection/evaluation/report.mjs";
import { decorateRequest, createEvaluationClients } from "../../../examples/12-capability-discovery-selection/evaluation/clients.mjs";

const directories: string[] = [];
const close: Array<() => void> = [];
afterEach(async () => { for (const release of close.splice(0)) release(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); vi.restoreAllMocks(); });
async function ledgerFixture(caps?: Record<string, number>) {
  const directory = await mkdtemp(path.join(tmpdir(), "aicf-campaign-")); directories.push(directory);
  const binding = { test: "campaign.v1" }, ledger = openCampaignLedger({ directory, binding, caps }); close.push(() => ledger.close());
  return { directory, binding, ledger, host: createMockHost({ ledger }) };
}
function reservation(scope: any, runId = "run.test") { return { runId, requestId: "request.test", deadlineAt: Date.now() + 30_000,
  stage: "selection", attempt: 1, configuration: { provider: "test", model: "test", configurationId: "test.v1" }, policy: scope.policy,
  requestedUsage: { providerCalls: 1, inputTokens: 80, outputTokens: 20, estimatedCost: 0.1 } }; }

describe("frozen real-model evaluation foundation", () => {
  it("validates corrected contracts, preserves legacy requests and separates fresh held-out families", async () => {
    const { suite, registry, inventory } = validateOffline();
    expect(inventory).toEqual({ cases: 240, families: 60, capabilities: 18, workflows: 12 });
    expect(validateManifests(registry.capabilities)).toMatchObject({ valid: true, warnings: [] });
    expect(validatePublicFixtures([{ kind: "discovery_eval_suite", fixture: suite, path: "synthetic/v2.suite.json", absolutePath: "/synthetic/v2.suite.json" }]).valid).toBe(true);
    const legacy = JSON.parse(await readFile("examples/12-capability-discovery-selection/discovery-fixtures/three-domains.suite.json", "utf8"));
    expect(fingerprintDiscoveryEvaluationSuite(legacy)).toBe("sha256:01d1ddfeb6c7768bf5108fc00917ce0a4d95283cfaf14dd5910adde2b55969d2");
    expect(suite.cases.filter((entry: any) => entry.partition !== "held_out")).toEqual(legacy.cases.filter((entry: any) => entry.partition !== "held_out"));
    const oldIds = new Set(legacy.cases.map((entry: any) => entry.family_id));
    expect(suite.cases.filter((entry: any) => entry.partition === "held_out").every((entry: any) => !oldIds.has(entry.family_id))).toBe(true);
    const stock = suite.capabilities.find((capability: any) => capability.id === "inventory.stock.get");
    expect(stock.input_schema.required).toEqual(["product_id", "warehouse_id"]);
    expect(suite.capabilities.find((c: any) => c.id === "inventory.adjustment.prepare").lifecycle.commit_capability_id).toBe("inventory.adjustment.commit");
  });

  it("binds dataset, model, prompts, host and caps without sending labels to clients", () => {
    const suite = loadSuite(), task = projectTask(suite, suite.cases[0], "run.test");
    expect(Object.keys(task).sort()).toEqual(["eligibility", "id", "runtimeContext", "text"]);
    expect(JSON.stringify(task)).not.toMatch(/compatible_ids|forbidden_ids|expected_operation|partition|cohorts/);
    const binding = campaignBinding(suite, WORKFLOWS, "source", { model: "gpt-6-luna" });
    expect(hashDiscoveryContent(binding)).not.toBe(hashDiscoveryContent({ ...binding, hostIdentity: { model: "other" } }));
    const changed = structuredClone(suite); changed.cases[0].compatible_ids = [];
    expect(fingerprintDiscoveryEvaluationSuite(changed)).not.toBe(fingerprintDiscoveryEvaluationSuite(suite));
    changed.cases[1].family_id = changed.cases.find((x: any) => x.partition === "held_out").family_id;
    expect(() => validateDataset(changed, WORKFLOWS)).toThrow(/leakage/);
  });

  it("freezes bounded schedules, fresh per-trial identities and three held-out repetitions", () => {
    const suite = loadSuite();
    expect(trialSchedule(suite, "train")).toHaveLength(240);
    expect(trialSchedule(suite, "baseline")).toHaveLength(240);
    expect(trialSchedule(suite, "qualify", 8)).toHaveLength(1440);
    expect(() => trialSchedule(suite, "qualify", 4)).toThrow(/eight/);
    const schedule = trialSchedule(suite, "qualify", 8);
    expect(schedule).toHaveLength(1440);
    expect(new Set(schedule.map((trial: any) => trial.key)).size).toBe(schedule.length);
    expect(schedule.filter((trial: any) => trial.repeat === 2)).toHaveLength(240);
    expect(configuration("hybrid").weights).toEqual({ semantic: 0.75, lexical: 0.25 });
  });

  it("defaults to no network and does not load a supplied host module", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    const result = await runCampaign({ configFile: "does-not-exist.json" });
    expect(result).toMatchObject({ status: "validated_offline", providerCalls: 0 });
    expect(network).not.toHaveBeenCalled();
  });

  it("reports uncertainty without pretending repeated paraphrases are independent evidence", () => {
    expect(wilson({ numerator: 0, denominator: 0 })).toBeNull();
    const interval = wilson({ numerator: 0, denominator: 12 });
    expect(interval.upper).toBeGreaterThan(0.01);
    expect(interval.method).toContain("not independent");
    const group = (value: number) => ({ cohorts: { competing_read_prepare: { recall: { value } } } });
    expect(materiallyRegresses(group(0.95), group(1))).toBe(false);
    expect(materiallyRegresses(group(0.94), group(1))).toBe(true);
    expect(assess({ complete: false }, [])).toMatchObject({ qualified: false, complete: false });
  });

  it("rejects invalid dependency graphs without executing tasks", () => {
    expect(() => validatePlan({ tasks: [{ id: "read", text: "Read", dependsOn: ["later"] }] })).toThrow();
    expect(() => validatePlan({ tasks: [{ id: "read", text: "Read", dependsOn: [], tool: "hidden" }] })).toThrow();
  });
});

describe("durable host campaign ledger", () => {
  it("enforces atomic concurrent capacity and run scope", async () => {
    const { ledger } = await ledgerFixture({ providerCalls: 1 });
    const scope = ledger.scope("run.test");
    expect((await scope.ledger.reserve(reservation(scope, "foreign"))).status).toBe("denied");
    const results = await Promise.all([scope.ledger.reserve(reservation(scope)), scope.ledger.reserve(reservation(scope))]);
    expect(results.map(x => x.status).sort()).toEqual(["denied", "reserved"]);
    expect(ledger.snapshot()).toMatchObject({ pendingReservations: 1, held: { providerCalls: 1 } });
  });

  it("conservatively retains unknown usage and settles exactly once", async () => {
    const { ledger } = await ledgerFixture(), scope = ledger.scope("run.test");
    const reserved = await scope.ledger.reserve(reservation(scope));
    const settlement = { outcome: "failed", providerAttempts: 1, completedResponses: 0, usage: { inputTokens: 9 }, elapsedMs: 1 };
    await scope.ledger.settle(reserved.reservationId, settlement);
    expect(ledger.snapshot()).toMatchObject({ pendingReservations: 0, charged: { providerCalls: 1, inputTokens: 9, outputTokens: 20, estimatedCost: 0.1 } });
    expect(ledger.records().find((entry: any) => entry.type === "settlement").data.usage).toEqual({ inputTokens: 9 });
    await expect(scope.ledger.settle(reserved.reservationId, settlement)).rejects.toThrow(/duplicate/);
    expect((await scope.ledger.reserve(reservation(scope))).status).toBe("denied");
  });

  it("retains consumption and halts when hidden retries exceed the reservation", async () => {
    const { ledger } = await ledgerFixture(), scope = ledger.scope("run.test");
    const reserved = await scope.ledger.reserve(reservation(scope));
    await expect(scope.ledger.settle(reserved.reservationId, { outcome: "discarded", providerAttempts: 2, completedResponses: 2, usage: { inputTokens: 20 }, elapsedMs: 1 })).rejects.toThrow(/exceeded/);
    expect(ledger.snapshot()).toMatchObject({ halted: true, charged: { providerCalls: 2, inputTokens: 20 } });
  });

  it("reopens matching evidence, refuses uncertain work and rejects fingerprint drift", async () => {
    const { ledger, directory, binding } = await ledgerFixture();
    const scope = ledger.scope("run.test"); await scope.ledger.reserve(reservation(scope));
    ledger.beginTrial("pending", { task: "a" });
    ledger.beginTrial("done", { task: "b" }); ledger.finishTrial("done", { result: "retained" });
    expect(() => openCampaignLedger({ directory, binding })).toThrow(/locked/);
    ledger.close();
    expect(() => openCampaignLedger({ directory, binding: { test: "other" } })).toThrow(/fingerprint/);
    const resumed = openCampaignLedger({ directory, binding }); close.push(() => resumed.close());
    expect(resumed.snapshot().pendingReservations).toBe(1);
    expect(() => resumed.beginTrial("pending", { task: "a" })).toThrow(/not be reissued/);
    const prior = resumed.beginTrial("done", { task: "b" });
    expect(resumed.readArtifact(prior.artifact)).toEqual({ result: "retained" });
    expect(() => resumed.beginTrial("done", { task: "changed" })).toThrow(/fingerprint/);
  });

  it("detects journal and artifact tampering and incomplete writes", async () => {
    const { ledger, directory, binding } = await ledgerFixture();
    const artifact = ledger.writeArtifact("receipt.json", { test: true });
    await writeFile(path.join(directory, artifact.name), '{"test":false}');
    expect(() => ledger.readArtifact(artifact)).toThrow(/integrity/);
    ledger.close();
    const journal = await readFile(path.join(directory, "journal.jsonl"), "utf8");
    await writeFile(path.join(directory, "journal.jsonl"), journal.replace('"test":"campaign.v1"', '"test":"changed"'));
    expect(() => openCampaignLedger({ directory, binding })).toThrow(/integrity/);
    await writeFile(path.join(directory, "journal.jsonl"), journal.trimEnd());
    expect(() => openCampaignLedger({ directory, binding })).toThrow(/tail/);
  });

  it("bounds auxiliary HTTP work and includes its explicit fee", async () => {
    const { ledger } = await ledgerFixture({ httpRequests: 1 });
    await ledger.transport("token_count", async () => ({ input_tokens: 10 }), { fee: 0.01 });
    await expect(ledger.transport("generation", async () => ({}))).rejects.toThrow(/budget/);
    expect(ledger.snapshot()).toMatchObject({ httpRequests: 1, charged: { estimatedCost: 0.01 } });
  });

  it("retains reservations through prompt cancellation and settles late without restoring output", async () => {
    const { ledger } = await ledgerFixture(), controller = new AbortController();
    let complete!: (value: unknown) => void;
    const late = new Promise(resolve => { complete = resolve; });
    const run = createAicfProviderRun({ runId: "run.test", deadlineAt: Date.now() + 30_000, signal: controller.signal, budget: ledger.scope("run.test") });
    const result = run.attempt({ stage: "planning", requestId: "request", configuration: { provider: "test", model: "test", configurationId: "test" }, mock: true,
      maxInputTokens: 80, maxOutputTokens: 20, maxEstimatedCostPerCall: 0.1, invoke: () => late, validate: () => ({ value: "discarded" }) });
    await new Promise(resolve => setTimeout(resolve, 10)); controller.abort();
    expect((await result).value).toBeUndefined();
    const before = run.snapshot(); expect(ledger.snapshot().pendingReservations).toBe(1);
    complete({ providerAttempts: 1, usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6, estimatedCost: 0.01 } });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(ledger.snapshot().pendingReservations).toBe(0);
    expect(run.snapshot().usage.totals.inputTokens.total).toBe(4);
    expect(before.pendingAttempts).toBe(1);
  });
});

describe("public runtime campaign integration", () => {
  it("refuses oversized complete model input before generation", async () => {
    const { ledger } = await ledgerFixture();
    const generate = vi.fn();
    const host = createEvaluationClients({ ledger, mock: true, tokenizer: () => 1, tokenizerIdentity: "test",
      pricing: { inputPerMillion: 0, outputPerMillion: 0, embeddingPerMillion: 0, tokenCountPerRequest: 0, premiumMultiplier: 1 },
      sdk: { responses: { create: generate, inputTokens: { count: async () => ({ input_tokens: 8001 }) } }, embeddings: { create: vi.fn() } } });
    const request = { model: "gpt-6-luna", input: "bounded" };
    await expect(host.inputTokenPreflight({ request, history: [], maxInputTokens: 8000, deadlineAt: Date.now() + 1000 })).rejects.toThrow(/ceiling/);
    await expect(host.client.responses.create(request)).rejects.toThrow(/preflight/);
    expect(generate).not.toHaveBeenCalled();
    expect(ledger.snapshot().httpRequests).toBe(1);
  });

  it("keeps known refused and incompatible model consumption", async () => {
    const { ledger } = await ledgerFixture();
    let responseOutput: unknown[] = [];
    let responseStatus = "incomplete";
    const sdk = { responses: { inputTokens: { count: async () => ({ input_tokens: 1 }) }, create: async () => ({
      model: "gpt-6-luna", status: responseStatus, usage: { input_tokens: 9, output_tokens: 2, total_tokens: 11 }, output: responseOutput
    }) }, embeddings: { create: vi.fn() } };
    const host = createEvaluationClients({ sdk, ledger, mock: true, tokenizer: () => 1, tokenizerIdentity: "test",
      pricing: { inputPerMillion: 0, outputPerMillion: 0, embeddingPerMillion: 0, tokenCountPerRequest: 0, premiumMultiplier: 1 } });
    const request = { model: "gpt-6-luna", input: "bounded" };
    for (const output of [[], [{ type: "message", content: "malformed" }], [{ type: "message", content: [{ type: "refusal", refusal: "Denied" }] }]]) {
      responseOutput = output;
      await host.inputTokenPreflight({ request, history: [], maxInputTokens: 8000, deadlineAt: Date.now() + 1000 });
      await expect(host.client.responses.create(request)).rejects.toMatchObject({ usage: { inputTokens: 9, outputTokens: 2 }, providerAttempts: 1, completedResponses: 1 });
      responseStatus = "completed";
    }
  });

  it("rechecks scope after preflight and preserves unknown fields", async () => {
    const { ledger } = await ledgerFixture(); let revoked = false;
    const generate = vi.fn();
    const sdk = { responses: { inputTokens: { count: async () => { revoked = true; return { input_tokens: 1 }; } }, create: generate }, embeddings: { create: vi.fn() } };
    const host = createEvaluationClients({ sdk, ledger, mock: true, tokenizer: () => 1, tokenizerIdentity: "test", scope: { guard: () => revoked },
      pricing: { inputPerMillion: 0, outputPerMillion: 0, embeddingPerMillion: 0, tokenCountPerRequest: 0, premiumMultiplier: 1 } });
    await expect(host.inputTokenPreflight({ request: { model: "gpt-6-luna" }, history: [], maxInputTokens: 8000, deadlineAt: Date.now() + 1000 })).rejects.toThrow(/stale/);
    expect(generate).not.toHaveBeenCalled();
    expect(host.estimateCost({}, host.configuration)).toBeUndefined();
  });

  it("rejects incompatible indexes without purchasing a query embedding", async () => {
    const { ledger, host } = await ledgerFixture(), suite = loadSuite(), registry = registryFor(suite);
    const value = await runTaskTrial({ suite, registry, trial: { key: "bad-index", caseId: "support.family1.case1", mode: "hybrid/native", k: 8, stage: "baseline" }, host, ledger, index: {} });
    expect(value.observation.status).toBe("unavailable"); expect(value.executed).toHaveLength(0);
    expect(host.requests).toHaveLength(0);
  });

  it("enforces revocation and source mutation before reuse without another provider call", async () => {
    const { ledger, host } = await ledgerFixture(), suite = loadSuite(), registry = registryFor(suite);
    const value = await runTaskTrial({ suite, registry, trial: { key: "stale-source", caseId: "support.family1.case1", mode: "lexical/native", k: 8, stage: "baseline" }, host, ledger,
      afterSearch: () => { registry.capabilityById.get("support.ticket.get").manifest.summary += " Changed."; } });
    expect(value.executed).toHaveLength(0); expect(value.exported).toHaveLength(0); expect(host.requests).toHaveLength(0);
  });
  it("uses exact scoped denominators, order-independent scopes and incomplete coverage", async () => {
    const { ledger, host } = await ledgerFixture(), suite = loadSuite(), registry = registryFor(suite);
    const trial = { key: "scope", caseId: "support.family1.case1", mode: "lexical/native", k: 8, stage: "baseline" };
    const value = await runTaskTrial({ suite, registry, trial, host, ledger });
    const ids = [trial.caseId, "support.family2.case1"], observations = observationsFor(suite, registry, [value], trial.mode, 8, ids);
    const evaluate = (caseIds: string[]) => evaluateCapabilityDiscovery({ suite, registry, observations, caseIds });
    const result = evaluate(ids); expect(result.valid).toBe(true); if (!result.valid) throw new Error("invalid");
    expect(result.report).toMatchObject({ complete: false, counts: { expected: 2, observed: 1, missing: 1 }, retrieval: { compatibleRecallAtK: { denominator: 2 } } });
    expect(evaluate([...ids].reverse())).toMatchObject({ report: { scopeFingerprint: result.report.scopeFingerprint } });
    expect(evaluate([ids[0], ids[0]])).toMatchObject({ valid: false, diagnostics: [{ code: "invalid_evaluation_scope" }] });
    expect(evaluate(["foreign"])).toMatchObject({ valid: false, diagnostics: [{ code: "invalid_evaluation_scope" }] });
    expect(evaluate([ids[1]])).toMatchObject({ valid: false, diagnostics: [{ code: "observation_outside_scope" }] });
    const empty = evaluateCapabilityDiscovery({ suite, registry, observations: { ...observations, cases: [], attempts: [] }, caseIds: [] });
    expect(empty).toMatchObject({ valid: true, report: { complete: true, retrieval: { compatibleRecallAtK: { value: null } } } });
  });

  it("forwards full continuation context, schema and retry/cancellation options", async () => {
    const { ledger, host } = await ledgerFixture(), suite = loadSuite(), registry = registryFor(suite);
    const value = await runTaskTrial({ suite, registry, trial: { key: "request", caseId: "support.family1.case1", mode: "lexical/native", k: 8, stage: "baseline" }, host, ledger });
    expect(value.executed).toHaveLength(1);
    expect(host.requests.filter((request: any) => request.kind === "generation")).toHaveLength(2);
    for (const request of host.requests.filter((request: any) => request.kind === "generation")) {
      expect(request.body).toMatchObject({ reasoning: { effort: "none" }, parallel_tool_calls: false, truncation: "disabled", store: false, max_output_tokens: 1000 });
      expect(request.options).toMatchObject({ maxRetries: 0 });
      expect(request.options.signal).toBeInstanceOf(AbortSignal);
    }
    const count = host.requests.filter((request: any) => request.kind === "token_count").at(-1);
    expect(count.body.input.some((item: any) => item.type === "function_call_output")).toBe(true);
    expect(count.body.tools.length).toBeGreaterThan(0);
    expect(count.body.previous_response_id).toBeUndefined();
    expect(value.run.usage.totals.providerAttempts).toBe(2);
    expect(ledger.snapshot().httpRequests).toBe(4);
    expect(() => decorateRequest({ previous_response_id: "foreign" }, [])).toThrow(/Missing/);
  });

  it("preserves task-bound selection and blocks revocation before any ordinary model call", async () => {
    const { ledger, host } = await ledgerFixture(), suite = loadSuite(), registry = registryFor(suite);
    const value = await runTaskTrial({ suite, registry, trial: { key: "revoked", caseId: "support.family1.case1", mode: "lexical/dedicated", k: 8, stage: "baseline" }, host, ledger,
      afterSearch: ({ task }: any) => { task.runtimeContext.subject.permissions = []; } });
    expect(value.executed).toHaveLength(0); expect(value.exported).toHaveLength(0);
    expect(host.requests).toHaveLength(0);
  });

  it("builds once and runs real facade/runtime contracts for hybrid dependent work", async () => {
    const { ledger, host } = await ledgerFixture(), suite = loadSuite(), registry = registryFor(suite);
    const index = await buildEvaluationIndex({ registry, host, ledger }); expect(index.status).toBe("built");
    const before = host.requests.filter((request: any) => request.kind === "embedding").length;
    expect(before).toBe(3);
    const value = await runWorkflowTrial({ suite, registry, scenario: WORKFLOWS[0], mode: "hybrid/dedicated", k: 8, host, ledger, index: index.index });
    expect(value).toMatchObject({ passed: true, safe: true, planningValid: true, canonical: { approvalRequired: true } });
    expect(value.executed.map((item: any) => item.operation)).toEqual(["read", "prepare"]);
    expect(host.requests.filter((request: any) => request.kind === "embedding").length - before).toBe(2);
    expect(value.run.usage.totals.providerAttempts).toBe(10);
    expect(value.executed[1].args.order_id).toBe("ORD-100");
  });
});
