import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashDiscoveryContent } from "../../discovery/index.js";
import { canonicalResponseState, checkResponseWording, WORDING_CHECKER_VERSION } from "../../../examples/12-capability-discovery-selection/evaluation/application.mjs";
import { regradeSavedWorkflow } from "../../../examples/12-capability-discovery-selection/evaluation/regrade.mjs";
import { byteHash, readBounded, readSavedArtifact, readSavedCampaign, validateSavedSchedule, verifySavedJournal } from "../../../examples/12-capability-discovery-selection/evaluation/saved-campaign.mjs";
import { loadSuite, MODES, trialSchedule } from "../../../examples/12-capability-discovery-selection/evaluation/campaign.mjs";
import { QUALIFICATION_WORKFLOWS } from "../../../examples/12-capability-discovery-selection/evaluation/qualification-workflows.mjs";

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const read = { capabilityId: "synthetic.availability", operation: "read", status: "success", approvalRequired: false,
  data: { slots: [{ starts_at: "2032-09-14T14:00:00Z", ends_at: "2032-09-14T14:25:00Z" }] } };
const prepared = { capabilityId: "synthetic.invite", operation: "prepare", status: "approval_required", approvalRequired: true, data: { duration_minutes: 25 } };
const tasks = [{ id: "read", disposition: "successful_read", toolOutcomes: [read], errors: [] }, { id: "prepare", disposition: "approval_required_preparation", toolOutcomes: [prepared], errors: [] }];
const state = () => canonicalResponseState(tasks, "execute");

describe("bounded synthetic wording corrections", () => {
  it("versions the corrected checker separately", () => expect(WORDING_CHECKER_VERSION).toBe("synthetic-wording.v2"));
  it.each([
    "A preview is prepared for approval; no refund has been completed.",
    "A preview is prepared and requires approval before it can be sent on September 14, 2032.",
    "Availability was found on September 14, 2032. A draft requires approval; it has not been sent.",
    "An invite is prepared for approval on 14 September 2032.",
    "The preview requires approval for Sep. 14, 2032.",
    "Availability was found on 14 Sep. 2032. Approval is required.",
    "One window is available on September 14, 2032; approval is required.",
    "The window is 14:00–14:25 on September 14, 2032. Approval is required."
  ])("accepts independently authored forms of observed failures: %s", (summary) => {
    expect(checkResponseWording({ summary }, state())).toEqual({ valid: true, codes: [] });
  });
  it.each(["2032-09-14", "14 September, 2032", "september 14 2032", "Sep 14, 2032"])("compares complete date spans: %s", date => {
    expect(checkResponseWording({ summary: `Approval is required on ${date}.` }, state()).valid).toBe(true);
  });
  it.each(["September 15, 2032", "September 31, 2032", "2032-13-14", "2032-09-31", "29 February 2031", "06/10/2032", "2032-09-14T14:99:00Z", "2032-09-14T15:00:00Z"])("rejects wrong or invalid complete dates and timestamps: %s", date => {
    expect(checkResponseWording({ summary: `Approval is required on ${date}.` }, state()).codes).toContain("invented_identifier_or_value");
  });
  it("validates leap years without locale parsing", () => {
    const facts = { date: "2032-02-29", other: "2100-02-28" };
    expect(checkResponseWording({ summary: "Approval is required on Feb. 29, 2032." }, state(), facts).valid).toBe(true);
    expect(checkResponseWording({ summary: "Approval is required on February 29, 2100." }, state(), facts).valid).toBe(false);
  });
  it("preserves complete email identifiers, including leading punctuation", () => {
    const facts = { email: "person@example.com" };
    expect(checkResponseWording({ summary: "Approval is required for person@example.com." }, state(), facts).valid).toBe(true);
    expect(checkResponseWording({ summary: "Approval is required for +person@example.com." }, state(), facts).codes).toContain("invented_identifier_or_value");
  });
  it.each(["The value is 14.", "The value is 2032.", "The value is 9.", "Use USR-999."])("does not whitelist date components or invented identifiers: %s", suffix => {
    expect(checkResponseWording({ summary: `Approval is required on September 14, 2032. ${suffix}` }, state()).codes).toContain("invented_identifier_or_value");
  });
  it.each(["The refund has not been completed", "No refund has been completed", "It has not yet been sent", "The invitation hasn't been sent", "Nothing has been committed", "It can be sent after approval", "It will be sent after approval"])("accepts local non-completion: %s", claim => {
    expect(checkResponseWording({ summary: `Approval is required. ${claim}.` }, state()).valid).toBe(true);
  });
  it.each([
    "No refund has been completed, but we paid it.", "The draft can be sent after approval; it was already sent.",
    "It was not only sent but also applied.", "No issues, we paid the refund.", "The invitation was sent after approval.",
    "The refund has been completed.", "No refund has been completed. Another refund was paid.", "Approval is required; we committed the action."
  ])("keeps affirmative completion failures: %s", claim => {
    expect(checkResponseWording({ summary: claim }, state()).codes).toContain("unsupported_completion_claim");
  });
  it("preserves approval, receipt, access and disposition checks", () => {
    expect(checkResponseWording({ summary: "A preview is prepared." }, state()).codes).toContain("approval_contradiction");
    const empty = canonicalResponseState([], "execute");
    expect(checkResponseWording({ summary: "A preview is prepared for approval." }, empty).codes).toContain("claim_without_receipt");
    expect(checkResponseWording({ summary: "A lookup completed." }, { ...empty, missingAccess: true }).codes).toContain("missing_access_disposition");
    expect(checkResponseWording({ summary: "Done." }, { ...empty, unavailable: true }).codes).toContain("missing_operational_disposition");
    expect(checkResponseWording({ summary: "x".repeat(4001) }, empty).codes).toContain("invalid_wording");
  });
});

function savedWorkflow() {
  const canonical = state();
  return { workflowId: "synthetic.review", kind: "dependent", mode: "lexical/native", tasks: structuredClone(tasks),
    plan: { decision: "execute" }, planningValid: true, planningConsistent: true, canonical,
    response: { summary: "The preview requires approval on September 14, 2032." },
    customerResponse: "A preview is prepared and requires approval. No action has been committed.", fallbackUsed: true,
    responseChecks: ["invented_identifier_or_value"], failures: [], safe: true, passed: false, executed: [read, prepared],
    components: { applicationDelivery: { passed: true, fallbackUsed: true }, wording: { performed: true, passed: false, checks: ["invented_identifier_or_value"] }, operational: { passed: true, accountingComplete: true } },
    run: { pendingAttempts: 0, usage: { totals: Object.fromEntries(["inputTokens", "outputTokens", "estimatedCost"].map(key => [key, { total: 1, knownSubtotal: 1, complete: true }])) } } };
}
const scenario = { id: "synthetic.review", kind: "dependent", facts: {} };
const suite = { contexts: { authorized: { runtime_context: { facts: { "example.request": {} } } } } };
describe("offline saved-workflow reassessment", () => {
  it("accepts saved wording while preserving actual fallbacks, delivery, usage and tool work", () => {
    const input = savedWorkflow(), before = structuredClone(input), network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
    const { assessed, comparison } = regradeSavedWorkflow(input, scenario, suite);
    expect(input).toEqual(before); expect(assessed.passed).toBe(true); expect(assessed.fallbackUsed).toBe(true);
    expect(assessed.customerResponse).toBe(before.customerResponse); expect(assessed.executed).toEqual(before.executed);
    expect(assessed.run).toEqual(before.run); expect(comparison.original.passed).toBe(false); expect(comparison.revised.passed).toBe(true);
    expect(comparison.observed.fallbackUsed).toBe(true); expect(network).not.toHaveBeenCalled();
    expect(regradeSavedWorkflow(input, scenario, suite)).toEqual({ assessed, comparison });
  });
  it.each(["arguments", "execution", "plan_consistency", "authorization_lifecycle", "wrong_operation_choice"])("retains unrelated failure %s", code => {
    const input = savedWorkflow(); input.failures.push(code); input.components.applicationDelivery.passed = false;
    const { assessed } = regradeSavedWorkflow(input, scenario, suite);
    expect(assessed.passed).toBe(false); expect(assessed.failures).toContain(code); expect(assessed.components.wording.passed).toBe(true);
  });
  it("retains unknown usage and operational failures", () => {
    const input = savedWorkflow(); input.run.usage.totals.inputTokens = { total: null as any, knownSubtotal: 1, complete: false };
    input.components.operational.passed = false;
    const { assessed } = regradeSavedWorkflow(input, scenario, suite);
    expect(assessed.passed).toBe(false); expect(assessed.run.usage.totals.inputTokens.total).toBeNull();
    expect(assessed.components.operational.passed).toBe(false);
  });
  it("does not use fallback wording to pass an invalid model answer", () => {
    const input = savedWorkflow(); input.response.summary = "We sent the invitation for USR-999.";
    const { assessed } = regradeSavedWorkflow(input, scenario, suite);
    expect(assessed.passed).toBe(false); expect(assessed.components.applicationDelivery.passed).toBe(true);
    expect(assessed.components.wording.passed).toBe(false);
  });
  it("preserves a missing model response as an operational failure", () => {
    const input: any = savedWorkflow(); input.response = null; input.responseChecks = ["response_model_unavailable"];
    input.components.wording = { performed: false, passed: false, checks: input.responseChecks }; input.components.operational.passed = false;
    const { assessed } = regradeSavedWorkflow(input, scenario, suite);
    expect(assessed.passed).toBe(false); expect(assessed.components.wording.performed).toBe(false);
    expect(assessed.responseChecks).toContain("response_model_unavailable");
  });
  it("clears only a delivered-response checker failure when corrected wording passes", () => {
    const input: any = savedWorkflow(); input.customerResponse = input.response.summary;
    input.failures = ["application_response"]; input.components.applicationDelivery.passed = false;
    const { assessed } = regradeSavedWorkflow(input, scenario, suite);
    expect(assessed.failures).toEqual([]); expect(assessed.passed).toBe(true);
  });
  it("refuses missing or contradictory saved facts", () => {
    const input = savedWorkflow(); input.canonical.approvalRequired = false;
    expect(() => regradeSavedWorkflow(input, scenario, suite)).toThrow(/insufficient/);
    const missing = savedWorkflow(); delete (missing as any).response;
    expect(() => regradeSavedWorkflow(missing, scenario, suite)).toThrow(/insufficient/);
  });
});

function seal(events: Array<{ type: string; data: any }>) {
  let previous: string | null = null;
  return events.map((event, i) => { const value = { sequence: i + 1, previous, ...event }, hash = hashDiscoveryContent(value); previous = hash; return { ...value, hash }; });
}
function journal(unknown = false) {
  return [
    { type: "campaign", data: {} },
    { type: "reservation", data: { id: "r1", runId: "run1", amounts: { providerCalls: 1, inputTokens: 80, outputTokens: 20, estimatedCost: .1 } } },
    { type: "http.start", data: { id: "h1", fee: .01 } }, { type: "http.end", data: { id: "h1" } },
    { type: "settlement", data: { id: "r1", runId: "run1", providerAttempts: 1, completedResponses: unknown ? 0 : 1,
      usage: unknown ? {} : { inputTokens: 50, outputTokens: 10, estimatedCost: .05 },
      charged: { providerCalls: 1, inputTokens: unknown ? 80 : 50, outputTokens: unknown ? 20 : 10, estimatedCost: unknown ? .1 : .05 } } },
    { type: "trial.start", data: { key: "example", binding: "binding" } },
    { type: "trial.end", data: { key: "example", binding: "binding", artifact: {} } }
  ];
}
describe("read-only journal integrity", () => {
  it.each([false, true])("reconciles known and conservative unknown consumption: %s", unknown => {
    const records = seal(journal(unknown)), before = structuredClone(records), result = verifySavedJournal(records, () => ({}));
    expect(records).toEqual(before); expect(result.charged.inputTokens).toBe(unknown ? 80 : 50);
    expect(result.httpRequests).toBe(1); expect(result.values).toHaveLength(1);
  });
  it.each(["pending_reservation", "pending_http", "pending_trial", "duplicate_settlement", "duplicate_trial", "duplicate_http", "wrong_charge", "foreign_event", "halt"])("rejects %s", kind => {
    const events = journal();
    if (kind === "pending_reservation") events.splice(4, 1);
    if (kind === "pending_http") events.splice(3, 1);
    if (kind === "pending_trial") events.pop();
    if (kind === "duplicate_settlement") events.push(structuredClone(events[4]));
    if (kind === "duplicate_trial") events.push(structuredClone(events[5]));
    if (kind === "duplicate_http") events.push(structuredClone(events[2]));
    if (kind === "wrong_charge") events[4].data.charged.inputTokens++;
    if (kind === "foreign_event" || kind === "halt") events.push({ type: kind, data: {} });
    expect(() => verifySavedJournal(seal(events), () => ({}))).toThrow(/incomplete/);
  });
  it("rejects broken hash chains and changed trial bindings", () => {
    const records = seal(journal()); records[2].previous = "tampered";
    expect(() => verifySavedJournal(records, () => ({}))).toThrow();
    const events = journal(); events.at(-1)!.data.binding = "foreign";
    expect(() => verifySavedJournal(seal(events), () => ({}))).toThrow();
  });
  it("bounds file reads and rejects malformed manifest pins before opening a campaign", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "aicf-offline-regrade-")); directories.push(directory);
    const file = path.join(directory, "input.json"); writeFileSync(file, JSON.stringify({ schemaVersion: "1.0", hostModule: "forbidden" }));
    expect(() => readSavedCampaign(file)).toThrow(); expect(() => readBounded(file, 1)).toThrow();
    expect(byteHash(readFileSync(file))).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
  it("verifies artifact content without changing bytes and rejects substitution or traversal", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "aicf-regrade-artifact-")); directories.push(directory);
    const value = { response: { summary: "Synthetic wording" } }, file = path.join(directory, "trial.json");
    writeFileSync(file, JSON.stringify(value)); const before = readFileSync(file);
    const reference = { name: "trial.json", hash: hashDiscoveryContent(value) };
    expect(readSavedArtifact(directory, reference).value).toEqual(value); expect(readFileSync(file)).toEqual(before);
    writeFileSync(file, JSON.stringify({ response: { summary: "Substituted wording" } }));
    expect(() => readSavedArtifact(directory, reference)).toThrow();
    expect(() => readSavedArtifact(directory, { ...reference, name: "../trial.json" })).toThrow();
  });
  it("requires the entire ordered frozen schedule rather than a selection of passing workflows", () => {
    const suite = loadSuite();
    const keys = ["administrative-index", ...["train", "baseline", "qualify"].flatMap(stage => trialSchedule(suite, stage).map((t: any) => t.key)),
      ...QUALIFICATION_WORKFLOWS.flatMap((w: any) => MODES.map((mode: string) => `workflow.${w.id}.${mode.replace("/", ".")}`))];
    const trials = new Map(keys.map(key => [key, { pending: false }]));
    const records = [...["train", "baseline", "qualify"].map(stage => ({ type: "stage.complete", data: { stage, hash: hashDiscoveryContent(trialSchedule(suite, stage)), count: trialSchedule(suite, stage).length } })),
      { type: "stage.complete", data: { stage: "workflows", count: 48 } }, { type: "profile.freeze", data: { k: 8 } }];
    expect(validateSavedSchedule(records, trials, suite)).toHaveLength(1969);
    const missing = new Map(trials); missing.delete(keys.at(-1)!);
    expect(() => validateSavedSchedule(records, missing, suite)).toThrow();
    missing.set("workflow.foreign.lexical.native", { pending: false });
    expect(() => validateSavedSchedule(records, missing, suite)).toThrow();
    const reversed = new Map([...trials].reverse()); expect(() => validateSavedSchedule(records, reversed, suite)).toThrow();
    expect(() => validateSavedSchedule([...records, { type: "profile.freeze", data: { k: 8 } }], trials, suite)).toThrow();
  });
  it("keeps the offline module graph free of hosts, SDKs, runners and ledgers", () => {
    const visited = new Set<string>();
    const visit = (file: string) => {
      if (visited.has(file)) return; visited.add(file);
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/from ["'](?:openai|.*(?:clients|runner|durable-budget|continuation|live-host)\.mjs)["']/);
      expect(source).not.toMatch(/process\.env|createHostInputs|openCampaignLedger/);
      for (const match of source.matchAll(/from ["'](\.\.?\/[^"']+\.mjs)["']/g)) visit(path.resolve(path.dirname(file), match[1]));
    };
    visit(path.resolve("examples/12-capability-discovery-selection/run-evaluation-regrade.mjs"));
  });
});
