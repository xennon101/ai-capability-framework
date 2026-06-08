import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadManifests, validatePublicFixtures } from "../../index.js";
import {
  createGeneratedContentProvenance,
  formatGeneratedContentProvenance,
  hashProvenanceValue,
  redactGeneratedContentProvenance,
  runProvenanceAdapterHook,
  validateGeneratedContentProvenance,
  type GeneratedContentProvenance
} from "../../provenance/index.js";

const sourceHash = hashProvenanceValue({ ticket: "synthetic" });
const baseRecord: GeneratedContentProvenance = createGeneratedContentProvenance({
  approvalRefs: ["approval.support.refund.synthetic"],
  capabilityRefs: [
    { capabilityId: "support.refund.prepare_case", operation: "prepare", version: "0.1.0" },
    { capabilityId: "support.ticket.get", operation: "read", version: "0.1.0" }
  ],
  contentId: "support.refund.summary.test",
  contentType: "document",
  createdAt: "2026-06-05T00:00:00.000Z",
  generatedBy: "human_approved_model",
  modelRefs: ["example-support-model"],
  providerRefs: [{
    providerId: "openai",
    requestId: "req_support_refund_test",
    responseId: "resp_support_refund_test",
    runId: "run_support_refund_test",
    traceId: "trace_support_refund_test"
  }],
  sourceRefs: [{
    contentHash: sourceHash,
    freshness: "fresh",
    retrievedAt: "2026-06-05T00:00:00.000Z",
    sourceId: "support.ticket.synthetic.ref",
    sourceType: "tool_result",
    trust: "tool_result"
  }],
  traceRef: {
    provider: "openai",
    traceId: "trace_support_refund_test"
  }
});

describe("content provenance", () => {
  it("exports built provenance subpath APIs", async () => {
    const provenance = await import("../../../dist/provenance/index.js") as Record<string, unknown>;

    expect(provenance.createGeneratedContentProvenance).toEqual(expect.any(Function));
    expect(provenance.validateGeneratedContentProvenance).toEqual(expect.any(Function));
    expect(provenance.runProvenanceAdapterHook).toEqual(expect.any(Function));
  });

  it("validates schemas and public provenance fixtures", async () => {
    const fixture = JSON.parse(await readFile("examples/support/provenance/support.refund.summary.provenance.json", "utf8")) as GeneratedContentProvenance;
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = JSON.parse(await readFile("schemas/provenance/generated-content-provenance.schema.json", "utf8")) as Record<string, unknown>;
    const validate = ajv.compile(schema);

    expect(validate(fixture), ajv.errorsText(validate.errors)).toBe(true);
    expect(validateGeneratedContentProvenance(fixture)).toEqual({ errors: [], valid: true, warnings: [] });

    const loaded = await loadManifests({ path: "examples" });
    const validation = validatePublicFixtures(loaded.fixtures);
    expect(loaded.fixtures.some((candidate) => candidate.kind === "generated_content_provenance")).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("creates deterministic public-safe provenance metadata", () => {
    const validation = validateGeneratedContentProvenance(baseRecord);
    const serialized = JSON.stringify(baseRecord);

    expect(validation.valid).toBe(true);
    expect(baseRecord.schemaVersion).toBe("1.0");
    expect(baseRecord.sourceRefs[0]?.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hashProvenanceValue({ b: 2, a: 1 })).toBe(hashProvenanceValue({ a: 1, b: 2 }));
    expect(formatGeneratedContentProvenance(baseRecord, "markdown")).toContain("Raw prompts");
    expect(serialized).not.toMatch(/rawProviderPayload|raw prompt|BEGIN PRIVATE KEY|sk-[A-Za-z0-9]{8,}|tenant_should_not_escape/i);
  });

  it("fails closed for missing source hashes and raw-content-looking fields", () => {
    const missingHash = validateGeneratedContentProvenance({
      ...baseRecord,
      sourceRefs: [{
        sourceId: "support.ticket.raw.ref",
        sourceType: "tool_result",
        trust: "tool_result"
      }]
    });
    const unsafe = validateGeneratedContentProvenance({
      ...baseRecord,
      rawPrompt: "raw prompt with sk-unsafe0000"
    });

    expect(missingHash.errors.map((error) => error.code)).toContain("provenance_source_hash_required");
    expect(unsafe.errors.map((error) => error.code)).toContain("provenance_unsafe_field");
    expect(unsafe.errors.map((error) => error.code)).toContain("provenance_unsafe_value");
  });

  it("redacts provider request refs and trace refs while preserving source hashes", () => {
    const redacted = redactGeneratedContentProvenance(baseRecord, {
      omitProviderRequestRefs: true,
      omitTraceRef: true
    });

    expect(redacted.providerRefs[0]?.requestId).toBeUndefined();
    expect(redacted.providerRefs[0]?.responseId).toBeUndefined();
    expect(redacted.traceRef).toBeUndefined();
    expect(redacted.sourceRefs[0]?.contentHash).toBe(sourceHash);
  });

  it("runs dependency-free adapter hooks with validated safe metadata", async () => {
    const result = await runProvenanceAdapterHook(baseRecord, async (record) => ({
      adapterId: "example-sidecar-writer",
      labels: {
        "aicf.content_id": record.contentId,
        "aicf.provenance": "refs_and_hashes_only"
      },
      schemaVersion: "1.0",
      sidecar: {
        capabilityCount: record.capabilityRefs.length,
        sourceHashes: record.sourceRefs.map((source) => source.contentHash ?? "none")
      },
      status: "attached"
    }));

    expect(result.status).toBe("attached");
    expect(result.labels?.["aicf.content_id"]).toBe(baseRecord.contentId);
    expect(JSON.stringify(result)).not.toMatch(/rawProviderPayload|BEGIN PRIVATE KEY|sk-[A-Za-z0-9]{8,}/i);
  });

  it("returns safe failures for thrown or unsafe adapter hooks", async () => {
    const thrown = await runProvenanceAdapterHook(baseRecord, () => {
      throw new Error("secret sk-unsafe0000 stack_trace_value");
    }, { adapterId: "throwing-adapter" });
    const unsafe = await runProvenanceAdapterHook(baseRecord, () => ({
      adapterId: "unsafe-adapter",
      schemaVersion: "1.0",
      sidecar: {
        rawProviderPayload: "secret sk-unsafe0000"
      },
      status: "attached"
    }));

    expect(thrown).toMatchObject({
      adapterId: "throwing-adapter",
      status: "failed"
    });
    expect(JSON.stringify(thrown)).not.toMatch(/sk-unsafe0000|stack_trace_value/);
    expect(unsafe.status).toBe("failed");
    expect(unsafe.diagnostics?.[0]?.code).toBe("provenance_adapter_result_invalid");
  });
});
