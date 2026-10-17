import { describe, expect, it, vi } from "vitest";
import { CapabilityDiscoverer, RetrievalCapabilityRouter } from "../../discovery/index.js";
import type { CapabilityRouteRequest } from "../../runtime/types.js";
import { buildRuntimeOpenAIToolset } from "../../openai/tool-loop.js";
import { toOpenAIResponsesToolName, type CapabilityManifest } from "../../index.js";
import { createDiscoveryExample, runDiscoveryExample } from "../../../examples/12-capability-discovery-selection/discovery-example.mjs";

const configuration = { mode: "lexical", policyVersion: "test.v1", limits: { maxCandidates: 2 } } as const;
function router() {
  return new RetrievalCapabilityRouter({ mode: "native_tool_selection", discovery: configuration });
}
async function fixture() {
  const harness = await createDiscoveryExample();
  const request: CapabilityRouteRequest = {
    registry: harness.registry, builtContext: harness.builtContext, userInput: harness.userInput
  };
  return { harness, request };
}

describe("native retrieval router", () => {
  it("uses just user text, derives query IDs from runtime, and returns the existing slice shape", async () => {
    const { request } = await fixture();
    request.builtContext.runtimeContext.workflow = { currentEntityType: "ticket", currentEntityId: "ticket", workflowType: "support" };
    request.builtContext.runtimeContext.facts = { ticket: "ticket" };
    request.userInput = { text: "quasar" };
    const none = await router().routeWithDiagnostics(request);
    expect(none.discovery).toHaveLength(1);
    expect(none.discovery[0]?.queryId).toBe(request.builtContext.runtimeContext.requestId);
    expect(none.slice.items).toEqual([]);
    expect(none.slice.warnings).toEqual([{
      code: "discovery_no_match", message: "Discovery found no eligible candidates meeting the retrieval policy."
    }]);
    request.userInput = { text: "ticket refund" };
    const result = await router().routeWithDiagnostics(request);
    expect(result.slice.items.map((item) => item.capabilityId)).toEqual(["support.ticket.get", "support.refund.prepare_case"]);
    expect(result.slice.items[0]?.exposedOperations).toEqual(["select"]);
    expect(result.slice.items[1]?.exposedOperations).toEqual(["select", "prepare"]);
    expect(result.slice.warnings).toEqual([]);
    expect(await router().route(request)).toEqual(result.slice);
    expect(result.selection).toBeUndefined();
  });

  it("lowers the configured limit and never lets a request expand it", async () => {
    const { request } = await fixture(); request.userInput.text = "ticket refund";
    const limited = await router().routeWithDiagnostics({ ...request, maxCapabilities: 1 });
    const expanded = await router().routeWithDiagnostics({ ...request, maxCapabilities: 20 });
    expect(limited.slice.items).toHaveLength(1);
    expect(expanded.slice.items).toHaveLength(2);
    expect(limited.discovery[0]?.retrievalPolicyFingerprint).not.toBe(expanded.discovery[0]?.retrievalPolicyFingerprint);
    const diverse = new RetrievalCapabilityRouter({
      mode: "native_tool_selection", discovery: { ...configuration, limits: { maxCandidates: 2, aliasDiversitySlots: 1 } }
    });
    expect((await diverse.route({ ...request, maxCapabilities: 1 })).items).toHaveLength(1);
  });

  it.each([0, -1, 1.1, NaN, Infinity, 21, "1"])("rejects malformed request counts %s", async (value) => {
    const { request } = await fixture();
    await expect(router().route({ ...request, maxCapabilities: value as number })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects other selection modes", () => {
    expect(() => new RetrievalCapabilityRouter({ mode: "dedicated_selector", discovery: configuration } as never))
      .toThrow("native_tool_selection");
  });

  it("returns safe cancelled and unavailable warnings without fallback tools", async () => {
    const { request } = await fixture();
    const controller = new AbortController(); controller.abort();
    for (const bounds of [{ signal: controller.signal }, { deadlineAt: Date.now() - 1 }]) {
      const result = await router().routeWithDiagnostics({ ...request, ...bounds });
      expect(result.slice.items).toEqual([]);
      expect(result.slice.warnings[0]?.code).toBe("discovery_cancelled");
    }
    const failing = new RetrievalCapabilityRouter({
      mode: "native_tool_selection", discovery: configuration,
      ranker: { version: "test.v1", rank: () => { throw new Error("private exception"); } }
    });
    const unavailable = await failing.routeWithDiagnostics(request);
    expect(unavailable.slice.items).toEqual([]);
    expect(unavailable.slice.warnings[0]?.code).toBe("discovery_unavailable");
    expect(JSON.stringify(unavailable)).not.toContain("private exception");
  });

  it.each(["permissions", "source", "registry", "cancel", "deadline"])("revalidates %s across the await boundary before returning a slice", async (change) => {
    const { request } = await fixture();
    const controller = new AbortController();
    const bounds = { signal: controller.signal, deadlineAt: Date.now() + 60_000 };
    const original = CapabilityDiscoverer.prototype.discover;
    const spy = vi.spyOn(CapabilityDiscoverer.prototype, "discover").mockImplementation(async function (input) {
      const result = await original.call(this, input);
      if (change === "permissions") request.builtContext.runtimeContext.subject.permissions = [];
      if (change === "source") request.registry.capabilityById.get("support.ticket.get")!.manifest.model_description = "Changed guidance.";
      if (change === "registry") request.registry.capabilities.length = 0;
      if (change === "cancel") controller.abort();
      if (change === "deadline") bounds.deadlineAt = Date.now() - 1;
      return result;
    });
    try {
      // The deadline is a live request field, not a constructor-wide timeout.
      const input = { ...request, ...bounds };
      if (change === "deadline") Object.defineProperty(input, "deadlineAt", { get: () => bounds.deadlineAt });
      const result = await router().routeWithDiagnostics(input);
      expect(result.slice.items).toEqual([]);
      expect(result.discovery[0]?.candidates).toEqual([]);
      expect(result.discovery[0]?.diagnostics[0]?.code).toBe(
        change === "cancel" ? "cancelled" : change === "deadline" ? "deadline_exceeded" : "stale_binding"
      );
    } finally { spy.mockRestore(); }
  });

  it("cannot reintroduce a denied capability from a custom ranker", async () => {
    const { request } = await fixture();
    request.capabilityPermissions = { "support.ticket.get": { allowed: false, permissions: [] } };
    request.userInput.text = "refund";
    const denied = new RetrievalCapabilityRouter({
      mode: "native_tool_selection", discovery: configuration, ranker: { version: "test.v1", rank: () => [{
        capabilityId: "support.ticket.get", scores: { lexical: 1, aliasPhrase: 0, semantic: null, final: 1 }
      }] }
    });
    const result = await denied.routeWithDiagnostics(request);
    expect(result.slice.items).toEqual([]);
    expect(result.discovery[0]?.status).toBe("unavailable");
  });
});

describe("existing provider and execution boundaries", () => {
  it("runs the no-key fixture batch, provider export and ordinary mocked tool loop", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    try {
      const result = await runDiscoveryExample();
      expect(result.fixtureResults).toEqual([
        { queryId: "ticket_lookup", status: "matched", capabilityIds: ["support.ticket.get"] },
        { queryId: "refund_review", status: "matched", capabilityIds: ["support.refund.prepare_case"] },
        { queryId: "ticket_lookup_again", status: "matched", capabilityIds: ["support.ticket.get"] },
        { queryId: "no_matching_terms", status: "no_match", capabilityIds: [] }
      ]);
      expect(result.exportedToolNames).toEqual([toOpenAIResponsesToolName("support.ticket.get")]);
      expect(result.discoveryUsage.totals.providerAttempts).toBe(0);
      expect(result.ordinaryMockModelTurns).toBe(2);
      expect(result.toolStatus).toBe("success");
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it("retains normal provider authorization and execution denial after permissions are revoked", async () => {
    const { request, harness } = await fixture();
    const slice = await router().route(request);
    expect(slice.items).toHaveLength(1);
    harness.runtimeContext.subject.permissions = [];
    const exported = buildRuntimeOpenAIToolset({
      registry: request.registry, builtContext: request.builtContext, runtimeContext: harness.runtimeContext, runtimeSlice: slice
    });
    expect(exported.tools).toEqual([]);
    const result = await harness.executor.execute({
      capabilityId: "support.ticket.get", operation: "read", args: { ticket_id: "TCK-100" },
      runtimeContext: harness.runtimeContext, builtContext: harness.builtContext, source: "model_tool_call"
    });
    expect(result.status).toBe("denied");
    expect(harness.readCalls).toEqual([]);
  });

  it("does not expose commits through the existing provider even if host routing explicitly includes restricted metadata", async () => {
    const { request, harness } = await fixture();
    request.includeRestricted = true; request.maxRiskTier = "critical"; request.userInput.text = "refund";
    harness.runtimeContext.subject.permissions.push("refund.case.commit");
    harness.runtimeContext.autonomy.maxRiskTier = "critical";
    harness.runtimeContext.autonomy.autonomyTier = "A0";
    const slice = await router().route(request);
    expect(slice.items.flatMap((item) => item.exposedOperations)).not.toContain("commit");
    const exported = buildRuntimeOpenAIToolset({
      registry: request.registry, builtContext: request.builtContext, runtimeContext: harness.runtimeContext, runtimeSlice: slice
    });
    expect(exported.tools.map((tool) => tool.name)).not.toContain(toOpenAIResponsesToolName("support.refund.commit_case"));
  });
});
