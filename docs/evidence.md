# Evidence Export

The evidence subpath creates public-safe review packs from AICF manifests and
supplied runtime/eval reports. Evidence packs are summaries for human review;
they are not certification, audit opinions, legal opinions, security
guarantees, or compliance attestations.

Evidence export does not call models, run providers, execute handlers, store
records, or inspect raw traces. It only summarizes the registry and optional
reports that the host supplies.

## CLI

Build the package, then export a JSON pack:

```bash
npm run build
node dist/cli.js evidence export examples --out evidence-pack.json
```

Export Markdown for review notes:

```bash
node dist/cli.js evidence export examples --format markdown --out evidence-pack.md
```

Optional inputs can enrich the pack:

```bash
node dist/cli.js evidence export examples \
  --out evidence-pack.json \
  --project-id support-demo \
  --project-name "Support Demo" \
  --environment production \
  --eval-results examples/eval-results/public.results.passing.json \
  --gate-report gate-report.json \
  --conformance-report conformance-report.json \
  --security-report security-report.json
```

If optional reports are missing, the pack records that as a coverage gap instead
of implying evidence exists.

## TypeScript

```ts
import {
  createEvidencePack,
  formatEvidencePackMarkdown,
  validateEvidencePack
} from "ai-capability-framework/evidence";

const pack = createEvidencePack({
  project: {
    id: "support-demo",
    name: "Support Demo",
    environment: "production"
  },
  registry
});

const validation = validateEvidencePack(pack);
const markdown = formatEvidencePackMarkdown(pack);
```

## What The Pack Contains

An evidence pack includes:

- capability, risk, provider, and policy inventories;
- eval, security-pack, provider-conformance, approval, retention, and human
  review summaries;
- optional incident and model-upgrade summaries supplied by the host;
- explicit coverage gaps;
- required disclaimers;
- redaction metadata describing what was omitted.

The pack includes hashes, redacted refs, statuses, counts, reasons, and
coverage metadata only. It must not include raw prompts, raw provider payloads,
raw transcripts, secrets, stack traces, unredacted tenant/account/user IDs, or
sensitive tool output.

For customer-facing generated documents or media, use
`ai-capability-framework/provenance` to create a separate sidecar record that
links content to provider, model, capability, source, approval, and trace refs.
Evidence packs summarize review posture; provenance records describe a specific
generated content artifact.

## Control Plane

The control-plane evidence endpoint remains available:

```http
POST /api/aicf/evidence/export
```

It preserves its existing response shape and also exposes a canonical F13
evidence pack under `canonicalEvidence`.

## Host Responsibilities

Your app owns production evidence collection, approval identity, retention,
legal/compliance review, external audit workflow, and any regulated reporting.
AICF only creates a structured, public-safe summary from the data you provide.
