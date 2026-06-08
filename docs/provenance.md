# Content Provenance Hooks

The provenance subpath creates public-safe metadata for generated content that may
become customer-facing text, documents, images, audio, video, or other media.

It does not sign content, implement C2PA, process files, call providers, store records,
or claim authenticity. Host applications own real signing, document embedding, CMS/media
pipelines, approval identity, retention, and legal review.

## TypeScript

```ts
import {
  createGeneratedContentProvenance,
  runProvenanceAdapterHook,
  validateGeneratedContentProvenance
} from "ai-capability-framework/provenance";

const provenance = createGeneratedContentProvenance({
  contentId: "support.refund.summary.123",
  contentType: "document",
  generatedBy: "human_approved_model",
  providerRefs: [{ providerId: "openai", runId: "run_123" }],
  modelRefs: ["example-support-model"],
  capabilityRefs: [
    { capabilityId: "support.ticket.get", operation: "read" },
    { capabilityId: "support.refund.prepare_case", operation: "prepare" }
  ],
  sourceRefs: [
    {
      contentHash:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      sourceId: "support.ticket.synthetic.ref",
      sourceType: "app_record",
      trust: "app_data"
    }
  ],
  approvalRefs: ["approval.support.refund.synthetic"],
  createdAt: new Date().toISOString()
});

const validation = validateGeneratedContentProvenance(provenance);
```

## Metadata Shape

`GeneratedContentProvenance` records:

- content ID, content type, creation time, and whether content was model, model-assisted
  human, or human-approved model output;
- provider, model, capability, approval, and trace references;
- source references with hashes or public-safe IDs.

The record is intentionally a sidecar contract. It contains refs, hashes, statuses, and
metadata only. It must not include report body text, raw prompts, provider
request/response payloads, transcripts, secrets, stack traces, unredacted
tenant/account/user IDs, or sensitive source content.

## Adapter Hooks

`runProvenanceAdapterHook()` lets a host pass validated metadata to a signing, CMS,
document, or media pipeline adapter:

```ts
const result = await runProvenanceAdapterHook(provenance, async (record) => ({
  schemaVersion: "1.0",
  adapterId: "example-sidecar-writer",
  status: "attached",
  labels: {
    "aicf.content_id": record.contentId,
    "aicf.provenance": "refs_and_hashes_only"
  }
}));
```

The hook receives only validated, public-safe provenance metadata. If a hook throws or
returns unsafe metadata, AICF returns a safe failed result without stack traces or raw
error text.

## Validation

Validation is fail-closed. It rejects missing required references, invalid timestamps,
unknown content types, unsafe raw-content-looking fields, provider payload markers,
credential-looking keys, and source refs that should include a hash but do not.

The public example at
`examples/support/provenance/support.refund.summary.provenance.json` shows a synthetic
support/refund document sidecar with hashes and refs only.

## Relationship To Other AICF Surfaces

- `ai-capability-framework/security` owns `SourceRef` and trust labels.
- `ai-capability-framework/audit` owns `TraceRef` and canonical ledger records.
- `ai-capability-framework/evidence` summarizes review evidence and gaps.
- `ai-capability-framework/provenance` describes generated content sidecars for
  host-owned publishing or signing systems.
