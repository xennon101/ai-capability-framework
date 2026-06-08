import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadManifests, validatePublicFixtures } from "../../index.js";
import { redactForProvider } from "../../security/index.js";
import {
  evaluateMemoryExposure,
  memoryRecordToContextSegment,
  memoryRecordToRuntimeContextItem,
  selectGovernedMemory,
  validateGovernedMemoryRecord,
  type GovernedMemoryFixture,
  type GovernedMemoryRecord,
  type MemoryExposureContext
} from "../../memory/index.js";

const subjectRef = {
  actorType: "user",
  refHash: "sha256:example-support-user"
};
const baseRecord: GovernedMemoryRecord = {
  allowedUseCases: ["support_refund_preparation"],
  confidence: "high",
  consentBasis: "synthetic-consent",
  contentSummary: "The support user prefers concise refund case summaries.",
  createdAt: "2026-06-01T00:00:00.000Z",
  disallowedUseCases: [],
  id: "support.memory.preference",
  purpose: "Support preference",
  retentionPolicy: { id: "synthetic_memory_90d" },
  scope: "user",
  sensitivity: ["internal"],
  sourceRef: {
    contentHash: "sha256:memory-summary",
    freshness: "fresh",
    retrievedAt: "2026-06-01T00:00:00.000Z",
    sourceId: "support-preference-example",
    sourceType: "manual_review",
    trust: "app_data"
  },
  subjectRef
};
const baseContext: MemoryExposureContext = {
  now: "2026-06-05T00:00:00.000Z",
  subjectRef,
  useCase: "support_refund_preparation"
};

describe("governed memory", () => {
  it("exports built memory subpath APIs", async () => {
    const memory = await import("../../../dist/memory/index.js") as Record<string, unknown>;

    expect(memory.evaluateMemoryExposure).toEqual(expect.any(Function));
    expect(memory.selectGovernedMemory).toEqual(expect.any(Function));
    expect(memory.memoryRecordToContextSegment).toEqual(expect.any(Function));
  });

  it("validates schemas and public memory fixtures", async () => {
    const fixture = JSON.parse(await readFile("examples/support/memory/support.agent.preferences.json", "utf8")) as GovernedMemoryFixture;
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const fixtureSchema = JSON.parse(await readFile("schemas/memory/governed-memory-fixture.schema.json", "utf8")) as Record<string, unknown>;
    const recordSchema = JSON.parse(await readFile("schemas/memory/governed-memory-record.schema.json", "utf8")) as Record<string, unknown>;

    expect(ajv.compile(fixtureSchema)(fixture), ajv.errorsText()).toBe(true);
    expect(ajv.compile(recordSchema)(fixture.records[0]), ajv.errorsText()).toBe(true);
    expect(ajv.compile(recordSchema)({ ...fixture.records[0], contentSummary: "" })).toBe(false);

    const loaded = await loadManifests({ path: "examples" });
    const validation = validatePublicFixtures(loaded.fixtures);
    expect(loaded.fixtures.some((candidate) => candidate.kind === "governed_memory")).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("allows valid memory and selects records deterministically", () => {
    const first = { ...baseRecord, id: "support.memory.b" };
    const second = { ...baseRecord, id: "support.memory.a" };
    const selection = selectGovernedMemory([first, second], baseContext);

    expect(validateGovernedMemoryRecord(baseRecord).valid).toBe(true);
    expect(evaluateMemoryExposure(baseRecord, baseContext).allowed).toBe(true);
    expect(selection.selectedRecords.map((record) => record.id)).toEqual([
      "support.memory.a",
      "support.memory.b"
    ]);
  });

  it("fails closed for expired, missing use case, disallowed use case, and subject mismatch", () => {
    expect(evaluateMemoryExposure({
      ...baseRecord,
      expiresAt: "2026-06-04T00:00:00.000Z"
    }, baseContext).reasons.map((entry) => entry.code)).toContain("memory_expired");
    expect(evaluateMemoryExposure({
      ...baseRecord,
      allowedUseCases: ["support_response_personalization"]
    }, baseContext).reasons.map((entry) => entry.code)).toContain("memory_use_case_not_allowed");
    expect(evaluateMemoryExposure({
      ...baseRecord,
      disallowedUseCases: ["support_refund_preparation"]
    }, baseContext).reasons.map((entry) => entry.code)).toContain("memory_use_case_disallowed");
    expect(evaluateMemoryExposure(baseRecord, {
      ...baseContext,
      subjectRef: { refHash: "sha256:other-user" }
    }).reasons.map((entry) => entry.code)).toContain("memory_subject_scope_mismatch");
  });

  it("requires consent for sensitive memory and denies credential material", () => {
    expect(evaluateMemoryExposure({
      ...baseRecord,
      consentBasis: undefined,
      sensitivity: ["customer_pii"]
    }, baseContext).reasons.map((entry) => entry.code)).toContain("memory_sensitive_consent_required");
    expect(evaluateMemoryExposure({
      ...baseRecord,
      sensitivity: ["credential_material"]
    }, baseContext).reasons.map((entry) => entry.code)).toContain("memory_credential_material_denied");
  });

  it("converts memory to non-instruction context segments and safe runtime items", () => {
    const segment = memoryRecordToContextSegment({
      ...baseRecord,
      sourceRef: {
        ...baseRecord.sourceRef,
        sourceType: "retrieved_document",
        trust: "retrieved_document"
      }
    });
    const item = memoryRecordToRuntimeContextItem(baseRecord);

    expect(segment.instructionsAllowed).toBe(false);
    expect(segment.trust).toBe("app_data");
    expect(segment.taint?.[0]?.reason).toContain("cannot become instructions");
    expect(item.visibleToModel).toBe(true);
    expect(JSON.stringify(item)).not.toContain("sha256:example-support-user");
    expect(JSON.stringify(item)).not.toContain("private_diagnostics");
  });

  it("uses existing provider-boundary redaction for sensitive memory segments", () => {
    const segment = memoryRecordToContextSegment({
      ...baseRecord,
      sensitivity: ["credential_material"]
    });
    const redaction = redactForProvider(segment.content, {
      boundary: "provider",
      segment
    });

    expect(redaction.status).toBe("denied");
    expect(redaction.reasons[0]?.code).toBe("redaction_denied");
  });
});
