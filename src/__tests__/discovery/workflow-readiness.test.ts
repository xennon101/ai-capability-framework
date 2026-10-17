import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAicfProviderRun } from "ai-capability-framework/runtime";
import { hashDiscoveryContent } from "../../discovery/index.js";
import { loadSuite, registryFor, MODES } from "../../../examples/12-capability-discovery-selection/evaluation/campaign.mjs";
import { WORKFLOWS } from "../../../examples/12-capability-discovery-selection/evaluation/workflow-cases.mjs";
import { QUALIFICATION_WORKFLOWS } from "../../../examples/12-capability-discovery-selection/evaluation/qualification-workflows.mjs";
import { validateApplicationPlan, checkPlanConsistency, canonicalResponseState, checkResponseWording, renderResponse, taskDisposition } from "../../../examples/12-capability-discovery-selection/evaluation/application.mjs";
import { openCampaignLedger } from "../../../examples/12-capability-discovery-selection/evaluation/durable-budget.mjs";
import { verifyPredecessor, openContinuationLedger } from "../../../examples/12-capability-discovery-selection/evaluation/continuation.mjs";
import { createMockHost } from "../../../examples/12-capability-discovery-selection/evaluation/mock-host.mjs";
import { buildEvaluationIndex, runWorkflowTrial, runTaskTrial } from "../../../examples/12-capability-discovery-selection/evaluation/harness.mjs";
import { preflightCampaign } from "../../../examples/12-capability-discovery-selection/evaluation/preflight.mjs";

const directories: string[] = [], cleanup: Array<() => void> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) close(); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(responseOverride?: any) {
  const directory = await mkdtemp(path.join(tmpdir(), "aicf-readiness-")); directories.push(directory);
  const binding = { test: "phase7a" }, ledger = openCampaignLedger({ directory, binding }); cleanup.push(() => ledger.close());
  const suite = loadSuite(), registry = registryFor(suite), host = createMockHost({ ledger, responseOverride });
  return { directory, binding, ledger, suite, registry, host };
}
const task = (id: string, operation = "read", dependsOn: string[] = []) => ({ id, operation, text: operation === "read" ? "Read ticket TCK-100" : "Prepare a refund for its order", requestedOutcome: operation === "read" ? "Read ticket status" : "Prepare the requested refund preview", dependsOn });
const plan = (tasks: any[], decision = "execute") => ({ decision, requestedOutcome: "Fulfill the original request", tasks });
const response = (value: any) => ({ id: "mock_test", model: "gpt-6-luna", status: "completed", output_text: JSON.stringify(value), output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value) }] }], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
const success = { capabilityId: "support.ticket.get", operation: "read", status: "success", data: { ticket: { ticket_id: "TCK-100", order_id: "ORD-100", status: "open" } }, approvalRequired: false };
const prepared = { capabilityId: "support.refund.prepare_case", operation: "prepare", status: "approval_required", data: { order_id: "ORD-100" }, approvalRequired: true };

describe("application-owned response facts", () => {
  // The 21+3+1 historical mismatch categories are covered independently, without regrading old trials.
  it.each(Array.from({ length: 21 }, (_, i) => i))("rejects erroneous approval flag %i without changing application facts", () => {
    const state = canonicalResponseState([{ disposition: "clarification", toolOutcomes: [] }], "clarify");
    expect(checkResponseWording({ summary: "Please clarify this request.", approval_required: true }, state).codes).toContain("approval_required");
    expect(state.approvalRequired).toBe(false);
    expect(checkResponseWording({ summary: renderResponse(state) }, state).valid).toBe(true);
  });
  it.each([0, 1, 2])("rejects unnecessary clarification after preparation %i", () => {
    const state = canonicalResponseState([{ disposition: "approval_required_preparation", toolOutcomes: [success, prepared] }], "execute");
    expect(checkResponseWording({ summary: "Preview prepared; approval is required. Please clarify the amount.", clarification_required: true }, state).valid).toBe(false);
    expect(state.clarificationRequired).toBe(false);
  });
  it("deduplicates summary IDs while retaining repeated execution receipts", () => {
    const state = canonicalResponseState([{ disposition: "successful_read", toolOutcomes: [success, success] }], "execute");
    expect(state.readIds).toEqual([success.capabilityId]); expect(state.history).toHaveLength(2);
    expect(checkResponseWording({ summary: "Authorized lookup complete.", read_ids: [success.capabilityId] }, state).valid).toBe(true);
  });
  it.each(["We paid the refund.", "No issues, we paid the refund.", "Ticket TCK-999 has been checked.", "The order value is 99999.", "The order value is 1.", "The refund preview is prepared."])("rejects unsupported wording: %s", summary => {
    const state = canonicalResponseState([{ disposition: "successful_read", toolOutcomes: [success] }], "execute");
    expect(checkResponseWording({ summary }, state).valid).toBe(false);
  });
  it("keeps clarification, access, cancellation and unavailable dispositions distinct", () => {
    for (const disposition of ["clarification", "authorization_block", "cancelled", "unavailable"]) {
      const state = canonicalResponseState([{ disposition, toolOutcomes: [] }], "execute");
      expect(state.clarificationRequired).toBe(disposition === "clarification");
      expect(checkResponseWording({ summary: renderResponse(state) }, state).valid).toBe(true);
    }
  });
});

describe("planning and terminal task branches", () => {
  it("distinguishes valid structure from semantic intent mismatch", () => {
    const repeated = validateApplicationPlan(plan([task("read"), task("again", "read", ["read"])]));
    expect(checkPlanConsistency(repeated, "Read ticket TCK-100 then prepare a refund for its order").codes).toContain("missing_requested_preparation");
    expect(checkPlanConsistency(validateApplicationPlan(plan([task("prepare", "prepare")])), "Read the ticket only").codes).toContain("read_goal_preparation");
    expect(checkPlanConsistency(validateApplicationPlan(plan([task("read")])), "Reassign ticket TCK-100").codes).toContain("unsupported_intent");
    expect(() => validateApplicationPlan(plan([task("read")], "clarify"))).toThrow();
    expect(() => validateApplicationPlan(plan([task("read", "read", ["future"])]))).toThrow();
    expect(validateApplicationPlan(plan([], "clarify")).tasks).toEqual([]);
  });
  it.each(["clarification", "authorization_block", "unavailable", "cancelled"])("records %s without generic dependency failure", disposition => {
    const result: any = { toolOutcomes: [], missingAccess: disposition === "authorization_block", result: { status: disposition === "clarification" ? "no_match" : disposition === "cancelled" ? "cancelled" : "matched" }, loop: { status: disposition === "cancelled" ? "cancelled" : "completed", errors: disposition === "unavailable" ? [{ code: "provider_error" }] : [] }, observation: { selection: { status: "not_performed" } } };
    expect(taskDisposition(result)).toBe(disposition);
  });
  it("blocks unsupported auxiliary work and repeated-read plans before retrieval", async () => {
    for (const scenario of [WORKFLOWS[0], WORKFLOWS[2]]) {
      const f = await fixture((body: any) => body.text?.format?.name === "application_plan_v2" ? response(plan([task("read"), task("again", "read", ["read"])])) : undefined);
      const value = await runWorkflowTrial({ ...f, scenario, mode: "lexical/native", k: 8 });
      expect(value.planningValid).toBe(true); expect(value.planningConsistent).toBe(false);
      expect(value.executed).toEqual([]); expect(value.tasks).toEqual([]);
      expect(f.host.requests.filter((r: any) => r.kind === "generation")).toHaveLength(2);
    }
  });
  it("revocation persists into independent tasks and blocks descendants without extra paid work", async () => {
    const f = await fixture((body: any) => body.text?.format?.name === "application_plan_v2" ? response(plan([task("first"), task("second"), task("child", "read", ["first"])])) : undefined);
    const value = await runWorkflowTrial({ ...f, scenario: WORKFLOWS[3], mode: "lexical/dedicated", k: 8 });
    expect(value.tasks.map((t: any) => t.disposition)).toEqual(["authorization_block", "authorization_block", "dependency_blocked"]);
    expect(value.executed).toEqual([]); expect(value.failures).not.toContain("dependency");
    expect(value.run.usage.totals.providerAttempts).toBe(2);
    expect(value.components.applicationDelivery.passed).toBe(true);
  });
  it("skips a dependent branch after genuine no-match without selector, embeddings or ordinary turns", async () => {
    const f = await fixture((body: any) => body.text?.format?.name === "application_plan_v2" ? response(plan([{...task("first"),text:"zzzzzz",requestedOutcome:"zzzzzz"},task("child","read",["first"])])) : undefined);
    const value = await runWorkflowTrial({ ...f, scenario: WORKFLOWS[1], mode: "lexical/dedicated", k: 8 });
    expect(value.tasks.map((t: any) => t.disposition)).toEqual(["clarification", "dependency_blocked"]);
    expect(value.run.usage.totals.providerAttempts).toBe(2);
  });
  it("cancellation after retrieval stops selection, ordinary calls and dependent tasks", async () => {
    const f = await fixture(), controller = new AbortController();
    const value = await runWorkflowTrial({ ...f, scenario: WORKFLOWS[0], mode: "lexical/dedicated", k: 8, signal: controller.signal, afterSearch: () => controller.abort() });
    expect(value.tasks.map((t: any) => t.disposition)).toEqual(["cancelled", "dependency_blocked"]);
    expect(value.executed).toEqual([]); expect(value.run.usage.totals.providerAttempts).toBe(1);
  });
  it("cancellation after a successful read preserves its receipt and skips all later branches", async () => {
    const controller=new AbortController();
    const f=await fixture((body: any)=>{if(!body.text?.format && body.input.some((i: any)=>i.type==="function_call_output"))controller.abort();});
    const value=await runWorkflowTrial({...f,scenario:WORKFLOWS[0],mode:"lexical/native",k:8,signal:controller.signal});
    expect(value.executed.map((x: any)=>x.operation)).toEqual(["read"]);
    expect(value.tasks[0].disposition).toBe("successful_read");
    expect(value.tasks[1]).toMatchObject({disposition:"dependency_blocked",observation:null});
    expect(value.canonical.cancelled).toBe(true);
    expect(f.host.requests.filter((r: any)=>r.kind==="generation")).toHaveLength(3);
  });
  it("requires actual readiness receipts for preparation, rather than a model's assertion", async () => {
    const f=await fixture((body: any)=>body.text?.format?.name === "application_plan_v2" ? response(plan([{...task("prepare","prepare"),text:"Prepare a Review invitation",requestedOutcome:"Prepare a Review invitation"}])):undefined);
    const scenario={...WORKFLOWS[8],text:"Prepare a Review invitation for USR-100 using the supplied facts"};
    const value=await runWorkflowTrial({...f,scenario,mode:"lexical/native",k:8});
    expect(value.executed).toEqual([]);
    expect(value.tasks[0].toolOutcomes[0].reasonCodes).toContain("application_readiness_missing");
    expect(value.tasks[0].disposition).toBe("clarification");
    expect(f.suite.contexts.authorized.runtime_context.facts["example.readiness"].availability.data.slots).toHaveLength(1);
  });
  it("preflights the complete schedule against every remaining allowance without provider work", async()=>{
    const f=await fixture();
    const value=await preflightCampaign({...f,workflows:QUALIFICATION_WORKFLOWS,caps:{providerCalls:1}});
    expect(value.feasible).toBe(false);expect(value.maximumExceeded).toContain("providerCalls");
    expect(f.host.requests).toEqual([]);
  });
});

describe("existing framework contracts exercised by the app", () => {
  it("blocks a model's second read in a preparation task with the existing host policy hook", async () => {
    let ordinary = 0;
    const f = await fixture((body: any) => {
      if (!body.text?.format && !body.input.some((i: any) => i.type === "function_call_output") && ++ordinary === 2) {
        const chosen = body.tools.find((t: any) => t.name.includes("support_ticket_snapshot"));
        return { ...response({}), output_text: "", output: [{ type: "function_call", name: chosen.name, call_id: "wrong_read", arguments: JSON.stringify({ ticket_id: "TCK-100" }) }] };
      }
    });
    const value = await runWorkflowTrial({ ...f, scenario: WORKFLOWS[0], mode: "lexical/native", k: 8 });
    expect(value.executed.map((x: any) => x.operation)).toEqual(["read"]);
    expect(value.blockedChoices).toHaveLength(1);
    expect(value.failures).toContain("wrong_operation_choice");
    expect(value.safe).toBe(true); expect(value.components.intentSafety.passed).toBe(false);
  });
  it("retains preparation after a narration 503, preserves unknown usage, and never re-executes", async () => {
    let narration = 0;
    const f = await fixture((body: any) => {
      if (!body.text?.format && body.input.some((i: any) => i.type === "function_call_output") && ++narration === 2) throw Object.assign(new Error("Synthetic 503"), { status: 503 });
    });
    const value = await runWorkflowTrial({ ...f, scenario: WORKFLOWS[0], mode: "lexical/native", k: 8 });
    expect(value.executed.map((x: any) => x.operation)).toEqual(["read", "prepare"]);
    expect(value.canonical.approvalRequired).toBe(true); expect(value.canonical.degraded).toBe(true);
    expect(value.components.applicationDelivery.passed).toBe(true);
    expect(value.components.operational).toMatchObject({ passed: false, accountingComplete: false });
    expect(value.run.usage.totals.inputTokens.total).toBeNull();
    expect(value.run.usage.totals.inputTokens.knownSubtotal).toBeGreaterThan(0);
    expect(value.tasks[1].errors).toContain("provider_unavailable");
    expect(f.ledger.snapshot().pendingReservations).toBe(0);
  });
  it("uses deterministic fallback without turning rejected model wording into success", async () => {
    const f = await fixture((body: any) => body.text?.format?.name === "application_response_v2" ? response({ summary: "We paid the refund for ORD-999." }) : undefined);
    const value = await runWorkflowTrial({ ...f, scenario: WORKFLOWS[0], mode: "lexical/native", k: 8 });
    expect(value.fallbackUsed).toBe(true); expect(value.response.summary).toContain("ORD-999");
    expect(value.components.applicationDelivery.passed).toBe(true); expect(value.components.wording.passed).toBe(false);
    expect(value.customerResponse).toContain("requires approval"); expect(value.passed).toBe(false);
  });
  it("exports complete guidance, purchases each task only once and keeps labels out of all model inputs", async () => {
    const f = await fixture(); const built = await buildEvaluationIndex(f);
    const value = await runWorkflowTrial({ ...f, scenario: QUALIFICATION_WORKFLOWS[0], mode: "hybrid/dedicated", k: 8, index: built.index });
    expect(value.passed).toBe(true); expect(value.run.usage.totals.providerAttempts).toBe(10);
    expect(f.host.requests.filter((r: any) => r.kind === "embedding")).toHaveLength(5);
    const inputs = JSON.stringify(f.host.requests.map((r: any) => r.body));
    expect(inputs).not.toMatch(/expectedRead|expectedPrepare|compatible_ids|forbidden_ids|expected_operation|cohorts/);
    expect(inputs).toContain("originalCustomerRequest"); expect(inputs).toContain("authorizedDependencyResults");
    expect(inputs).toContain("The user asks about a specific support ticket.");
  });
  it("retains current revalidation and one-tool limits after a successful result", async () => {
    const f = await fixture(); let generation = 0;
    const host = createMockHost({ ledger: f.ledger, responseOverride(body: any) {
      if (!body.text?.format && ++generation === 2) return { ...response({}), output_text:"",output:[{ type:"function_call",name:body.tools[0].name,call_id:"extra",arguments:JSON.stringify({ticket_id:"TCK-100"}) }] };
    } });
    const value = await runTaskTrial({ ...f, host, trial: {key:"limit",caseId:"support.family1.case1",mode:"lexical/native",k:8,stage:"baseline"} });
    expect(value.executed).toHaveLength(1); expect(value.toolOutcomes.some((x: any) => x.status === "success")).toBe(true);
    expect(value.errors).toContain("tool_limit_exceeded");
  });
});

describe("original campaign budget continuation", () => {
  async function predecessor() {
    const f = await fixture(), scope = f.ledger.scope("old.run");
    const run = createAicfProviderRun({ runId:"old.run", budget:scope, deadlineAt:Date.now()+30000 });
    await run.attempt({ stage:"planning", requestId:"old", configuration:{provider:"test",model:"test",configurationId:"test"}, mock:true,
      maxInputTokens:80,maxOutputTokens:20,maxEstimatedCostPerCall:0.1,
      invoke:async()=>{throw Object.assign(new Error("Unknown usage"),{providerAttempts:1,completedResponses:0,usage:{inputTokens:9}});}, validate:()=>({value:true}) });
    await f.ledger.transport("token_count",async()=>({}),{fee:0.01}); f.ledger.close();
    const bytes=await readFile(path.join(f.directory,"journal.jsonl"));
    return { ...f, predecessor:{directory:f.directory,fingerprint:f.ledger.fingerprint,journalHash:`sha256:${createHash("sha256").update(bytes).digest("hex")}`} };
  }
  async function childDirectory(){const dir=await mkdtemp(path.join(tmpdir(),"aicf-continuation-"));directories.push(dir);return dir;}
  it("derives unknown conservative charges and forbids increased allowances", async()=>{
    const f=await predecessor(), checked=verifyPredecessor(f.predecessor);
    expect(checked.consumed).toMatchObject({providerCalls:1,inputTokens:9,outputTokens:20,httpRequests:1});
    expect(checked.remaining.estimatedCost).toBeCloseTo(24.89,10);
    expect(()=>openContinuationLedger({predecessor:f.predecessor,directory:f.directory+'-unused',binding:{test:'child'},caps:{providerCalls:10000}})).toThrow(/increase/);
  });
  it("has one atomic continuation, matching-only resume and separate cumulative totals",async()=>{
    const f=await predecessor(), directory=await childDirectory(), binding={test:"child"};
    const args={predecessor:f.predecessor,directory,binding};
    const ledger=openContinuationLedger(args);cleanup.push(()=>ledger.close());
    expect(()=>openContinuationLedger(args)).toThrow(/locked/);
    expect(()=>openContinuationLedger({...args,directory:directory+'-other'})).toThrow(/different continuation/);
    expect(()=>openCampaignLedger({directory:f.directory,binding:f.binding})).toThrow(/continuation/);
    expect(ledger.snapshot()).toMatchObject({prior:{providerCalls:1},charged:{providerCalls:0},cumulative:{providerCalls:1}});
    ledger.beginTrial("uncertain",{id:"same"});ledger.close();
    const resumed=openContinuationLedger(args);cleanup.push(()=>resumed.close());
    expect(()=>resumed.beginTrial("uncertain",{id:"same"})).toThrow(/not be reissued/);
    expect(()=>openContinuationLedger({...args,binding:{changed:true}})).toThrow(/different continuation/);
  });
  it("rejects parent hash tampering before a continuation claim",async()=>{
    const f=await predecessor(), directory=await childDirectory();
    await writeFile(path.join(f.directory,"journal.jsonl"),(await readFile(path.join(f.directory,"journal.jsonl"),"utf8")).replace('"inputTokens":9','"inputTokens":0'));
    expect(()=>openContinuationLedger({predecessor:f.predecessor,directory,binding:{}})).toThrow(/hash mismatch/);
  });
});
