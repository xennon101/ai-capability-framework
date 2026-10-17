import { describe, expect, it, vi } from "vitest";
import { buildRegistry, loadManifests, type CapabilityManifest, type LoadedCapabilityManifest } from "../../index.js";
import {
  DefaultCapabilityRouter, filterEligibleCapabilities,
  type AicfRuntimeContext, type CapabilityRouteRequest
} from "../../runtime/index.js";

const loaded = await loadManifests({ path: "examples/support" });
const original = loaded.manifests.find((entry) => entry.kind === "capability" && entry.manifest.id === "support.ticket.get")!;
const source = original.manifest as CapabilityManifest;

function capability(id: string, patch: Partial<CapabilityManifest> = {}): LoadedCapabilityManifest {
  return {
    kind: "capability", path: "synthetic/capabilities/" + id + ".yaml", absolutePath: "/synthetic/" + id,
    manifest: { ...structuredClone(source), id, name: "Ticket details", summary: "Read ticket details",
      model_description: "Read ticket details", when_to_use: [], tags: [], domain: "support",
      risk_tier: "low", input_schema: { type: "object", properties: {} }, ...patch }
  };
}

function request(
  capabilities: LoadedCapabilityManifest[],
  patch: Partial<CapabilityRouteRequest> = {},
  contextPatch: Partial<AicfRuntimeContext> = {}
): CapabilityRouteRequest {
  const runtimeContext: AicfRuntimeContext = {
    environment: "test", requestId: "request_example", runId: "run_example", startedAt: "2026-01-01T00:00:00.000Z",
    account: { accountId: "account_example", tenantId: "tenant_example" },
    subject: { actorType: "user", userId: "user_example", permissions: ["ticket.read"], roles: [] },
    autonomy: { autonomyTier: "A2", maxRiskTier: "medium", allowSideEffects: false, allowExternalMessages: false,
      allowMoneyMovement: false, allowPermissionChanges: false }, facts: {}, metadata: {}, ...contextPatch
  };
  return {
    registry: buildRegistry(capabilities), userInput: { text: "ticket" },
    builtContext: { runtimeContext, items: [], modelContextText: "", redactions: [], warnings: [] }, ...patch
  };
}

const alpha = capability("support.ticket.alpha");
const beta = capability("support.ticket.beta");
const selected = (id: string, score = 10) => ({
  capabilityId: id, exposedOperations: ["select"], reasons: ["Matched request text."], score
});

describe("shared runtime eligibility and default router compatibility", () => {
  it("preserves complete baseline results, sorting, overflow, operations, and cap warnings", () => {
    const router = new DefaultCapabilityRouter();
    expect(router.route(request([beta, alpha]))).toEqual({
      items: [selected(alpha.manifest.id), selected(beta.manifest.id)], excluded: [], warnings: []
    });
    expect(router.route(request([beta, alpha], { maxCapabilities: 1 }))).toEqual({
      items: [selected(alpha.manifest.id)],
      excluded: [{ capabilityId: beta.manifest.id, reason: "Excluded by maxCapabilities 1." }], warnings: []
    });
    expect(router.route(request([alpha], { maxCapabilities: 21 }))).toEqual({
      items: [selected(alpha.manifest.id)], excluded: [],
      warnings: [{ code: "max_capabilities_capped", message: "maxCapabilities was capped at 20." }]
    });
    expect(router.route(request([alpha], {}, { workflow: { currentEntityType: "ticket", workflowType: "support" } }))).toEqual({
      items: [{ ...selected(alpha.manifest.id, 38), reasons: [
        "Matches current workflow entity.", "Matches current workflow domain.", "Matched request text."
      ] }], excluded: [], warnings: []
    });
  });

  it("enumerates the full registry in original order without scoring, capping, or mutation", () => {
    const entries = Array.from({ length: 25 }, (_, n) => capability("support.ticket.item_" + n));
    const input = request(entries, { maxCapabilities: 1 });
    const before = structuredClone(input);
    const result = filterEligibleCapabilities(input);
    expect(result.eligible).toEqual(entries);
    expect(result.eligible[24]).toBe(entries[24]);
    expect(result.excluded).toEqual([]);
    expect(input).toEqual(before);
    expect(new DefaultCapabilityRouter().route(input).items).toHaveLength(1);
    expect(filterEligibleCapabilities(request([]))).toEqual({ eligible: [], excluded: [] });
  });

  it.each([
    [{ includeCapabilityIds: [] }, {}, "Capability was not explicitly included."],
    [{ excludeCapabilityIds: [alpha.manifest.id] }, {}, "Capability was explicitly excluded."],
    [{ allowedDomains: ["inventory"] }, {}, "Capability domain was not allowed."],
    [{ allowedCapabilityTypes: ["compute"] }, {}, "Capability type was not allowed."],
    [{ capabilityPermissions: { [alpha.manifest.id]: { allowed: false, permissions: [], reason: "Host denied." } } }, {}, "Host denied."],
    [{ capabilityPermissions: { [alpha.manifest.id]: { allowed: false, permissions: [] } } }, {}, "Capability permission adapter denied access."],
    [{}, { account: { accountId: "account_example", tenantId: "" } }, "Capability requires tenant context."],
    [{}, { account: { accountId: "", tenantId: "tenant_example" } }, "Runtime account context is required."],
    [{}, { subject: { actorType: "user", userId: "", permissions: ["ticket.read"], roles: [] } }, "Capability requires user context."],
    [{}, { subject: { actorType: "user", userId: "user_example", permissions: [], roles: [] } }, "Missing permission ticket.read."]
  ])("preserves filter reasons and returns a fully excluded registry", (patch, contextPatch, reason) => {
    const input = request([alpha], patch as Partial<CapabilityRouteRequest>, contextPatch as Partial<AicfRuntimeContext>);
    expect(filterEligibleCapabilities(input)).toEqual({
      eligible: [], excluded: [{ capabilityId: alpha.manifest.id, reason }]
    });
    expect(new DefaultCapabilityRouter().route(input)).toEqual({
      items: [], excluded: [{ capabilityId: alpha.manifest.id, reason }], warnings: []
    });
  });

  it("honors an explicitly granted permission without changing the subject", () => {
    const input = request([alpha], {
      capabilityPermissions: { [alpha.manifest.id]: { allowed: true, permissions: ["ticket.read"] } }
    }, { subject: { actorType: "user", userId: "user_example", permissions: [], roles: [] } });
    expect(filterEligibleCapabilities(input).eligible).toEqual([alpha]);
    expect(input.builtContext.runtimeContext.subject.permissions).toEqual([]);
  });

  it("uses the context risk ceiling unless explicitly overridden", () => {
    const high = capability("support.ticket.high", { risk_tier: "high" });
    expect(filterEligibleCapabilities(request([high])).excluded).toEqual([
      { capabilityId: high.manifest.id, reason: "Capability risk tier high exceeds medium." }
    ]);
    expect(filterEligibleCapabilities(request([high], { maxRiskTier: "critical" })).eligible).toEqual([high]);
  });

  it.each([
    ["disabled", "includeDisabledForTests", "Disabled capability was excluded."],
    ["deprecated", "includeDeprecated", "Deprecated capability was excluded."],
    ["draft", "includeDraft", "Draft capability was excluded."],
    ["experimental", "includeExperimental", "Experimental capability was excluded."]
  ] as const)("preserves status policy for %s", (status, flag, reason) => {
    const entry = capability("support.ticket.status", { status });
    expect(filterEligibleCapabilities(request([entry]))).toEqual({
      eligible: [], excluded: [{ capabilityId: entry.manifest.id, reason }]
    });
    expect(new DefaultCapabilityRouter().route(request([entry], { [flag]: true }))).toEqual({
      items: [selected(entry.manifest.id)], excluded: [], warnings: []
    });
  });

  it("retains exclusion precedence and registry ordering", () => {
    const high = capability("support.ticket.high", { status: "disabled", risk_tier: "high" });
    const input = request([beta, high, alpha], {
      includeCapabilityIds: [high.manifest.id, alpha.manifest.id], excludeCapabilityIds: [high.manifest.id], allowedDomains: []
    });
    expect(filterEligibleCapabilities(input).excluded).toEqual([
      { capabilityId: beta.manifest.id, reason: "Capability was not explicitly included." },
      { capabilityId: high.manifest.id, reason: "Capability was explicitly excluded." },
      { capabilityId: alpha.manifest.id, reason: "Capability domain was not allowed." }
    ]);
  });

  it("keeps risk ordering, zero-match scoring, and fallback reasons unchanged", () => {
    const none = capability("support.ticket.none", { risk_tier: "none" });
    expect(new DefaultCapabilityRouter().route(request([alpha, none])).items.map(x => x.capabilityId))
      .toEqual([none.manifest.id, alpha.manifest.id]);
    expect(new DefaultCapabilityRouter().route(request([alpha], { userInput: { text: "unrelated" } }))).toEqual({
      items: [{ ...selected(alpha.manifest.id, 0), reasons: ["Available after deterministic filters."] }],
      excluded: [], warnings: []
    });
  });

  it("preserves prepare/select operations and restricted opt-in without exposing commit operations", () => {
    const prepare = capability("support.ticket.prepare", {
      lifecycle: { prepare: true }, capability_type: "write_prepare_only",
      side_effects: { ...source.side_effects, writes_data: true }
    });
    const commit = capability("support.ticket.commit", { lifecycle: { commit: true }, capability_type: "write_commit" });
    expect(new DefaultCapabilityRouter().route(request([commit, prepare, alpha]))).toEqual({
      items: [selected(alpha.manifest.id), { ...selected(prepare.manifest.id), exposedOperations: ["select", "prepare"] }],
      excluded: [{ capabilityId: commit.manifest.id, reason: "Restricted side-effect capability was excluded." }], warnings: []
    });
    const included = new DefaultCapabilityRouter().route(request([commit], { includeRestricted: true }));
    expect(included).toEqual({ items: [selected(commit.manifest.id)], excluded: [], warnings: [] });
    expect(included.items.flatMap(x => x.exposedOperations)).not.toContain("commit");
  });

  it.each(["denied", "read_only"] as const)("applies %s controls once per capability with existing export context", (status) => {
    const prepare = capability("support.ticket.prepare", { lifecycle: { prepare: true }, capability_type: "write_prepare_only" });
    const evaluate = vi.fn(() => ({ status, matchedCircuitBreakers: [], matchedKillSwitches: [], reasons: [], warnings: [] }));
    const input = request([prepare, alpha], { controls: { evaluate } });
    const result = filterEligibleCapabilities(input);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      capabilityId: prepare.manifest.id, operation: "export", registry: input.registry,
      runtimeContext: input.builtContext.runtimeContext
    }));
    expect(result.eligible).toEqual(status === "denied" ? [] : [alpha]);
    expect(result.excluded[0]?.reason).toBe(status === "denied"
      ? "Capability was denied by runtime controls." : "Read-only controls exclude this capability.");
  });

  it("preserves custom control denial messages and control exceptions", () => {
    const controls = { evaluate: vi.fn(() => ({ status: "denied" as const, matchedCircuitBreakers: [], matchedKillSwitches: [],
      reasons: [{ code: "example", message: "Paused by host.", source: "kill_switch" as const, severity: "error" as const }], warnings: [] })) };
    expect(filterEligibleCapabilities(request([alpha], { controls })).excluded[0]?.reason).toBe("Paused by host.");
    const error = new Error("Host control failure");
    expect(() => filterEligibleCapabilities(request([alpha], { controls: { evaluate() { throw error; } } }))).toThrow(error);
  });
});

