import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  loadManifests,
  validateManifests,
  validatePublicFixtures,
  type ManifestRegistry
} from "../../index.js";
import type { AicfControlPlaneStoreState } from "../../control-plane/index.js";
import {
  buildControlPlaneSnapshot,
  createControlPlaneService,
  exportControlPlaneEvidence,
  FileControlPlaneStore,
  InMemoryControlPlaneStore,
  routeControlPlaneRequest
} from "../../control-plane/index.js";

const now = "2026-06-05T00:00:00.000Z";

describe("AICF control plane", () => {
  it("exports control-plane APIs from the built package subpath", async () => {
    const controlPlane = await import("../../../dist/control-plane/index.js") as Record<string, unknown>;

    expect(controlPlane.createControlPlaneService).toEqual(expect.any(Function));
    expect(controlPlane.routeControlPlaneRequest).toEqual(expect.any(Function));
    expect(controlPlane.InMemoryControlPlaneStore).toEqual(expect.any(Function));
    expect(controlPlane.FileControlPlaneStore).toEqual(expect.any(Function));
    expect(controlPlane.buildControlPlaneSnapshot).toEqual(expect.any(Function));
    expect(controlPlane.exportControlPlaneEvidence).toEqual(expect.any(Function));
  });

  it("validates the public control-plane seed fixture", async () => {
    const loaded = await loadManifests({ path: "examples" });
    const fixtureValidation = validatePublicFixtures(loaded.fixtures);

    expect(loaded.fixtures.some((fixture) => fixture.kind === "control_plane_state")).toBe(true);
    expect(fixtureValidation.errors).toEqual([]);
  });

  it("lists catalogue details and summaries from synthetic fixtures", async () => {
    const service = await createService();
    const capabilities = await service.listCapabilities();
    const detail = await service.getCapability("support.refund.prepare_case");
    const snapshot = await buildControlPlaneSnapshot({ service });

    expect(capabilities.map((capability) => capability.id)).toContain("support.ticket.get");
    expect(detail.id).toBe("support.refund.prepare_case");
    expect(detail.relatedEvalIds).toContain("support.refund.prepare_case.valid");
    expect(detail.risk.passed).toBe(true);
    expect(snapshot.approvals[0]?.approvalRecordId).toBe("approval_record_example_1");
  });

  it("routes every stable control-plane API path with safe response shapes", async () => {
    const service = await createService();
    const routes = [
      await request(service, "GET", "/api/aicf/capabilities"),
      await request(service, "GET", "/api/aicf/capabilities/support.refund.prepare_case"),
      await request(service, "GET", "/api/aicf/capabilities/support.refund.prepare_case/impact"),
      await request(service, "POST", "/api/aicf/capabilities/support.refund.prepare_case/lifecycle/evaluate", {
        reason: "Local review",
        to: "approved"
      }),
      await request(service, "GET", "/api/aicf/decisions"),
      await request(service, "GET", "/api/aicf/actions"),
      await request(service, "GET", "/api/aicf/approvals"),
      await request(service, "POST", "/api/aicf/approvals/approval_record_example_1/approve", {
        reason: "Synthetic approval."
      }),
      await request(service, "POST", "/api/aicf/approvals/approval_record_example_1/reject", {
        reason: "Synthetic rejection."
      }),
      await request(service, "GET", "/api/aicf/controls/kill-switches"),
      await request(service, "POST", "/api/aicf/controls/kill-switches", {
        createdAt: now,
        mode: "read_only",
        reason: "Synthetic read-only pause.",
        scope: { type: "global" }
      }),
      await request(service, "DELETE", "/api/aicf/controls/kill-switches/ks_read_only_4f44325dc0"),
      await request(service, "GET", "/api/aicf/evals/status"),
      await request(service, "GET", "/api/aicf/conformance/status"),
      await request(service, "POST", "/api/aicf/evidence/export", {
        includeConformance: true,
        includeReplayIndex: true
      })
    ];

    for (const response of routes) {
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(300);
      expect(JSON.stringify(response.body)).not.toMatch(/"rawProviderPayload"\s*:|tenant_example|user_example|sk-example-secret|stack_trace_value/i);
    }

    const missing = await request(service, "GET", "/api/aicf/capabilities/missing.capability");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: {
        code: "control_plane_not_found",
        message: 'Capability "missing.capability" was not found.'
      }
    });
  });

  it("approval mutations update approval and action state", async () => {
    const service = await createService();
    const approved = await service.approveApproval("approval_record_example_1", {
      decidedAt: now,
      reason: "Approved in test."
    });
    const actionsAfterApprove = await service.listActions();
    const rejected = await service.rejectApproval("approval_record_example_1", {
      decidedAt: now,
      reason: "Rejected in test."
    });
    const actionsAfterReject = await service.listActions();

    expect(approved.status).toBe("approved");
    expect(actionsAfterApprove[0]?.actionState).toBe("approved");
    expect(rejected.status).toBe("rejected");
    expect(actionsAfterReject[0]?.actionState).toBe("rejected");
  });

  it("kill switch changes affect capability control status", async () => {
    const service = await createService();
    const created = await service.createKillSwitch({
      createdAt: now,
      mode: "read_only",
      reason: "Synthetic read-only pause.",
      scope: { type: "global" }
    });
    const detail = await service.getCapability("support.refund.prepare_case");
    const deleted = await service.deleteKillSwitch(created.id);

    expect(detail.controls.status).toBe("denied");
    expect(deleted.deleted).toBe(true);
  });

  it("evidence export contains only redacted refs, hashes, and summaries", async () => {
    const service = await createService({
      decisions: [{
        ...(await seedState()).decisions[0]!,
        rawProviderPayload: {
          secret: "sk-example"
        },
        tenantId: "tenant_should_not_escape"
      } as unknown as AicfControlPlaneStoreState["decisions"][number]]
    });
    const evidence = await exportControlPlaneEvidence({
      service,
      input: {
        includeConformance: true,
        includeReplayIndex: true
      }
    });
    const serialized = JSON.stringify(evidence);

    expect(evidence.redaction.content).toBe("redacted_refs_and_hashes_only");
    expect(serialized).not.toMatch(/"rawProviderPayload"\s*:/);
    expect(serialized).not.toContain("sk-example");
    expect(serialized).not.toContain("tenant_should_not_escape");
  });

  it("file-backed store writes local mutable state under ignored .aicf paths", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aicf-control-plane-"));
    const statePath = path.join(directory, ".aicf", "control-plane-state.json");
    try {
      const store = new FileControlPlaneStore(statePath, await seedState());
      const service = await createService({}, store);

      await service.createKillSwitch({
        createdAt: now,
        mode: "deny",
        reason: "Local test.",
        scope: { capabilityId: "support.ticket.get", type: "capability" }
      });

      expect(statePath.replaceAll("\\", "/")).toContain("/.aicf/control-plane-state.json");
      expect(existsSync(statePath)).toBe(true);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("reference UI contains required views and no raw payload markers", async () => {
    const html = await readFile("examples/control-plane/public/index.html", "utf8");
    const js = await readFile("examples/control-plane/public/app.js", "utf8");
    const readme = await readFile("examples/control-plane/README.md", "utf8");

    for (const label of ["Catalogue", "Status", "Ledger", "Approvals", "Controls", "Replay", "Evidence"]) {
      expect(html).toContain(label);
    }
    expect(readme).toContain("Production deployments must enforce real authentication");
    expect(`${html}\n${js}`).not.toMatch(/raw provider payload|rawProviderPayload|credential/i);
  });
});

async function createService(
  stateOverrides: Partial<AicfControlPlaneStoreState> = {},
  store?: InMemoryControlPlaneStore | FileControlPlaneStore
) {
  const registry = await loadRegistry();
  return createControlPlaneService({
    conformanceProviders: ["openai", "mcp"],
    manifestRoot: "examples",
    now,
    registry,
    serverUrl: "https://aicf.example.com",
    store: store ?? new InMemoryControlPlaneStore({
      ...await seedState(),
      ...stateOverrides
    })
  });
}

async function request(
  service: Awaited<ReturnType<typeof createService>>,
  method: string,
  pathValue: string,
  body?: unknown
) {
  return routeControlPlaneRequest({
    request: {
      body,
      method,
      path: pathValue
    },
    service
  });
}

async function loadRegistry(): Promise<ManifestRegistry> {
  const loaded = await loadManifests({ path: "examples" });
  const validation = validateManifests(loaded.manifests);
  const fixtureValidation = validatePublicFixtures(loaded.fixtures);
  expect(loaded.errors).toEqual([]);
  expect(validation.errors).toEqual([]);
  expect(fixtureValidation.errors).toEqual([]);
  return buildRegistry(loaded.manifests);
}

async function seedState(): Promise<AicfControlPlaneStoreState> {
  return JSON.parse(await readFile("examples/control-plane/fixtures/control-plane.seed.json", "utf8")) as AicfControlPlaneStoreState;
}
