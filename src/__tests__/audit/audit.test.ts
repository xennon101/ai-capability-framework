import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildRegistry, loadManifests } from "../../index.js";
import { buildRuntimeContext, StaticAuthPlatformAdapter } from "../../runtime/index.js";
import {
  createActionRecord,
  createApprovalRecord,
  createIdempotencyRecord,
  createPolicyDecisionRecord,
  DefaultAuditLedger,
  hashAuditValue,
  InMemoryActionStore,
  InMemoryApprovalLedgerStore,
  InMemoryIdempotencyLedgerStore,
  InMemoryPolicyDecisionStore,
  redactAccountRef,
  redactSubjectRef,
  redactTenantRef,
  resultRefFromValue
} from "../../audit/index.js";
import type { AicfPolicyDecision, AicfRuntimeContext } from "../../runtime/index.js";

const timestamp = "2026-06-04T00:00:00.000Z";

describe("audit ledger contracts", () => {
  it("exports audit APIs from the built package subpath", async () => {
    const audit = await import("../../../dist/audit/index.js") as Record<string, unknown>;

    expect(audit.DefaultAuditLedger).toEqual(expect.any(Function));
    expect(audit.createPolicyDecisionRecord).toEqual(expect.any(Function));
    expect(audit.hashAuditValue).toEqual(expect.any(Function));
  });

  it("creates schema-valid canonical audit records", async () => {
    const { capability, runtimeContext } = await auditFixture();
    const policyDecision: AicfPolicyDecision = {
      reasons: [{
        code: "allowed",
        message: "Allowed for test.",
        severity: "info",
        source: "aicf"
      }],
      requiredApprovals: [],
      status: "allowed"
    };
    const policy = createPolicyDecisionRecord({
      args: { ticket_id: "TCK-100" },
      capability,
      createdAt: timestamp,
      operation: "read",
      policyDecision,
      runtimeContext
    });
    const action = createActionRecord({
      actionState: "proposed",
      args: { ticket_id: "TCK-100" },
      capability,
      createdAt: timestamp,
      runId: runtimeContext.runId
    });
    const approval = createApprovalRecord({
      capabilityId: capability.id,
      createdAt: timestamp,
      preparedActionId: "prepared_audit_1",
      requestedBy: runtimeContext.subject,
      status: "pending"
    });
    const idempotency = createIdempotencyRecord({
      createdAt: timestamp,
      key: "idem-1",
      scope: "tenant:tenant_example|prepared:prepared_audit_1",
      status: "reserved"
    });

    await expectValidSchema("policy-decision-record", policy);
    await expectValidSchema("action-record", action);
    await expectValidSchema("approval-record", approval);
    await expectValidSchema("idempotency-record", idempotency);
    expect(JSON.stringify(policy)).not.toContain("user_raw_audit");
    expect(JSON.stringify(policy)).not.toContain("acct_raw_audit");
    expect(JSON.stringify(policy)).not.toContain("tenant_raw_audit");
  });

  it("hashes deterministically and redacts subject/account/tenant refs by default", () => {
    const left = hashAuditValue({ b: 2, a: ["x", "y"] });
    const right = hashAuditValue({ a: ["x", "y"], b: 2 });

    expect(left).toBe(right);
    expect(redactSubjectRef({ actorType: "user", userId: "user_raw" })).toEqual(expect.objectContaining({
      actorType: "user",
      refHash: expect.stringMatching(/^sha256:/)
    }));
    expect(redactAccountRef("acct_raw")?.refHash).toMatch(/^sha256:/);
    expect(redactTenantRef("tenant_raw")?.refHash).toMatch(/^sha256:/);
  });

  it("supports cloned in-memory store CRUD and duplicate protection", async () => {
    const { capability, runtimeContext } = await auditFixture();
    const policyDecision: AicfPolicyDecision = {
      reasons: [],
      requiredApprovals: [],
      status: "allowed"
    };
    const policyStore = new InMemoryPolicyDecisionStore();
    const actionStore = new InMemoryActionStore();
    const approvalStore = new InMemoryApprovalLedgerStore();
    const policy = createPolicyDecisionRecord({
      capability,
      operation: "read",
      policyDecision,
      runtimeContext
    });
    const action = createActionRecord({
      actionState: "proposed",
      capability,
      runId: runtimeContext.runId
    });
    const approval = createApprovalRecord({
      capabilityId: capability.id,
      preparedActionId: "prepared_audit_2",
      requestedBy: runtimeContext.subject
    });

    await policyStore.putDecision(policy);
    await expect(policyStore.putDecision(policy)).rejects.toThrow("already exists");
    await actionStore.putAction(action);
    const updatedAction = await actionStore.updateAction(action.actionId, { actionState: "failed" });
    await approvalStore.putApproval(approval);
    const updatedApproval = await approvalStore.updateApproval(approval.approvalRecordId, { status: "approved" });

    expect((await policyStore.listDecisions({ capabilityId: capability.id }))).toHaveLength(1);
    expect(updatedAction.actionState).toBe("failed");
    expect(updatedApproval.status).toBe("approved");

    const clone = await actionStore.getAction(action.actionId);
    if (!clone) throw new Error("Expected action clone.");
    clone.actionState = "committed";
    expect((await actionStore.getAction(action.actionId))?.actionState).toBe("failed");
  });

  it("scopes idempotency ledger reservations and completions deterministically", async () => {
    const store = new InMemoryIdempotencyLedgerStore();
    const first = await store.reserve("same-key", { scope: "scope-a" });
    const duplicate = await store.reserve("same-key", { scope: "scope-a" });
    const otherScope = await store.reserve("same-key", { scope: "scope-b" });
    const resultRef = resultRefFromValue({ committedActionId: "commit_1" }, "commit_result");

    await store.complete("same-key", "scope-a", resultRef);
    const completed = await store.get("same-key", "scope-a");

    expect(first.reserved).toBe(true);
    expect(duplicate.reserved).toBe(false);
    expect(otherScope.reserved).toBe(true);
    expect(completed).toEqual(expect.objectContaining({
      resultRef,
      status: "completed"
    }));
  });

  it("rejects malformed records and raw-looking payload fields by schema", async () => {
    const invalid = {
      rawPrompt: "do not store this",
      schemaVersion: "1.0"
    };

    await expectInvalidSchema("policy-decision-record", invalid);
  });

  it("composes stores through DefaultAuditLedger", async () => {
    const { capability, runtimeContext } = await auditFixture();
    const ledger = new DefaultAuditLedger();
    const policy = await ledger.recordPolicyDecision({
      args: { ticket_id: "TCK-100" },
      capability,
      operation: "read",
      policyDecision: {
        reasons: [],
        requiredApprovals: [],
        status: "allowed"
      },
      runtimeContext
    });
    const action = await ledger.recordAction({
      actionState: "proposed",
      args: { ticket_id: "TCK-100" },
      capability,
      policyDecisionId: policy.decisionId,
      runId: runtimeContext.runId
    });

    expect(await ledger.policyDecisionStore.getDecision(policy.decisionId)).toMatchObject({
      capabilityId: capability.id
    });
    expect(await ledger.actionStore.getAction(action.actionId)).toMatchObject({
      policyDecisionId: policy.decisionId
    });
  });
});

async function auditFixture(): Promise<{
  capability: Awaited<ReturnType<typeof loadManifests>>["manifests"][number]["manifest"];
  runtimeContext: AicfRuntimeContext;
}> {
  const loaded = await loadManifests({ path: "examples" });
  const registry = buildRegistry(loaded.manifests);
  const capability = registry.capabilityById.get("support.ticket.get")?.manifest;
  if (!capability) {
    throw new Error("Expected support.ticket.get capability.");
  }
  const runtimeContext = await buildRuntimeContext({
    account: {
      accountId: "acct_raw_audit",
      tenantId: "tenant_raw_audit"
    },
    adapter: new StaticAuthPlatformAdapter({
      account: {
        accountId: "acct_raw_audit",
        tenantId: "tenant_raw_audit"
      },
      subject: {
        permissions: ["ticket.read"],
        userId: "user_raw_audit"
      }
    }),
    environment: "test",
    requestId: "req_audit",
    runId: "run_audit",
    subject: {
      userId: "user_raw_audit"
    }
  });
  return { capability, runtimeContext };
}

async function expectValidSchema(name: string, value: unknown): Promise<void> {
  const validate = await schemaValidator(name);
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
}

async function expectInvalidSchema(name: string, value: unknown): Promise<void> {
  const validate = await schemaValidator(name);
  expect(validate(value)).toBe(false);
}

async function schemaValidator(name: string) {
  const schema = JSON.parse(await readFile(`schemas/audit/${name}.schema.json`, "utf8")) as Record<string, unknown>;
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema);
}
