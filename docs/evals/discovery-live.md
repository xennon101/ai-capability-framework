# Evaluating discovery with real models

For the completed campaign and its separate offline reassessment, see the
[qualification report](discovery-qualification.md). Lexical/native is the recommended
default. Hybrid remains experimental because its incremental-gain gate was not met.

Discovery returns an eligible shortlist. Evaluate whether it contains a useful tool,
whether the model chooses correctly or abstains, and whether the application completes
the request. Keep these measurements separate.

## Start without provider access

```sh
npm run eval:discovery:live
```

This validates the frozen fixture and prints its planned inventory without importing a
host module, loading an SDK, reading credentials, or calling a provider.

The original 240-case suite remains unchanged. Its v2 revision corrects domain schemas
and lifecycle links and replaces held-out families. Revision 2.1 also aligns explicit
held-out amounts and quantity changes with their application facts. Version 3 preserves
all 180 train/calibration requests and labels, supplies verified preparation readiness
facts, and introduces 60 fresh held-out cases in new families. The original twelve
workflows remain development regressions; twelve new workflows form the qualification
schedule. Historical versions and results remain unchanged. All versions load through
ordinary manifest validation. Evaluation-only capabilities do not add manifests to the
framework's normal inventory.

Use explicit subsets without changing the suite binding:

```ts
const report = evaluateCapabilityDiscovery({
  suite,
  registry,
  observations,
  caseIds: calibrationCaseIds
});
```

Reports retain the full suite fingerprint and add an order-independent scope
fingerprint. Duplicate/foreign scope IDs and observations outside that scope are
rejected. Scheduled cases with no observation remain missing; an empty denominator
remains `null`.

## Supply a host explicitly

Live execution requires `--live` and `--config <ignored-host.json>`. The JSON
configuration contains `campaignId`, `hostModule`, `sdkVersion`, `tokenizerIdentity`,
`pricing`, an ignored `evidenceDirectory`, and `predecessor`. Keep credentials outside
it. The predecessor pins the original campaign directory, fingerprint and exact SHA-256
journal hash. A continuation inherits only its verified remaining allowances. One
permanent atomic claim prevents multiple campaigns from spending the same remainder;
matching resume is allowed, sibling continuations are refused.

The host module exports `createHostInputs()`, returning an already configured `sdk`, a
`tokenizer(text)` that counts `cl100k_base` tokens, and the matching `sdkVersion` and
`tokenizerIdentity`. Install tokenizer tooling in the host environment. The framework
package acquires no tokenizer or SDK dependency.

Supply pricing fields `inputPerMillion`, `outputPerMillion`, `embeddingPerMillion`,
`tokenCountPerRequest`, `premiumMultiplier`, and an ISO `checkedAt` within the last 24
hours. Input pricing must conservatively cover cache writes; include applicable regional
premiums and do not assume cache discounts. Rechecking identical rates does not change
the campaign binding. Prices are caller-supplied, never inferred from credentials.

This reference campaign fixes `gpt-6-luna` with reasoning disabled and
`text-embedding-3-small` with 1,536 dimensions. These are evaluation settings, not
framework defaults. The host explicitly uses Responses input counting for the complete
request, including tools and schemas. Continuations replay full history without stored
conversations. Token-count HTTP requests are recorded separately from generation usage.

Before live work, retain matching offline acceptance evidence at
`.aicf/discovery-implementation/phase-7a/offline-acceptance.json`. It binds source,
suite, workflows, and passing build, typecheck, tests, validation, conformance, package,
and mocked-campaign checks. Run `npm run eval:discovery:campaign:mock` for the complete
provider-free campaign. Its synthetic choices and vectors cannot qualify a real model.

## Run and resume stages

```sh
npm run eval:discovery:live -- --config .aicf/host.json --stage all --live
```

Individual stages are `index`, `train`, `baseline`, `freeze`, `qualify`, and
`workflows`. `--stage report --config ...` reads matching evidence without loading the
host or calling providers. The index is an explicit administrative build; serving stages
never rebuild or repair it.

Cases run sequentially with rotating mode order. This rerun fixes the shortlist at eight
candidates and uses a four-mode calibration baseline; there is no K=4 stage. Fixture,
prompt, application-contract, grading and schedule bindings are frozen before live work.
Qualification runs the full suite once and held-out cases three times. Every failed
trial remains in the report.

Resume by using the same configuration and evidence directory. A campaign lock prevents
concurrent owners. Journal records, artifact hashes, and bindings must match. Pending
work after a crash is not automatically purchased again. Reconcile uncertain provider
requests and outstanding reservations before continuing; do not delete evidence to
manufacture a fresh pass. Lock removal requires verifying the previous owner has
stopped.

The reference caps are 10,000 generation/embedding attempts, 20,000 total HTTP requests,
80 million input tokens, 10 million output tokens, and USD 25. All stages share those
caps, including predecessor work. Capacity preflight checks the entire schedule against
the remainder before loading live clients. Prior, current and cumulative charges are
reported separately. Unknown usage retains reserved allowance and stays unknown in
reports. Accounting failure stops paid work. This journal is a single-owner evaluation
host, not a distributed production budget service.

## Interpret qualification

### Regrade saved wording offline

The example-local regrader corrects bounded wording checks for equivalent dates,
explicit negation and prospective actions. It assesses every saved workflow without
rerunning planning, discovery, selection, tools or customer-response generation.

Create an ignored input JSON file with these fields:

- `schemaVersion`: `"1.0"`.
- `campaignDirectory` and `reportPath`: paths to the completed campaign
  journal/artifacts directory and original campaign-result JSON, relative to the input
  file.
- `campaignFingerprint`, `journalHash` and `reportHash`: pinned SHA-256 bindings. The
  journal and report hashes cover their exact bytes and use the `sha256:` prefix.

From the repository root, run:

```sh
node examples/12-capability-discovery-selection/run-evaluation-regrade.mjs \
  --input .aicf/regrade-input.json --output .aicf/regrade-output
```

The output must be a separate ignored directory. Existing output is accepted only when
it matches exactly. The command validates immutable artifact hashes, the complete
version-3 schedule and fixtures, original report reproduction and settled accounting. It
does not load host configuration, credentials, SDKs or provider clients, and never opens
a campaign ledger. Missing or incompatible evidence is refused.

`regrade.json` records original and revised decisions, each workflow's changed checks,
checker/source versions and fingerprints. Historical provider usage remains historical;
regrading usage is separately zero. Actual customer responses, tool receipts and
fallback use remain unchanged. A corrected assessment can accept saved model wording
even when the original application delivered a fallback. It cannot erase operational
failures, unknown usage or unrelated grading failures.

This is an offline reassessment of existing evidence, not another live qualification
trial. Preserve the original report and report revisions separately. Retrieval,
selection, latency, cohort and hybrid-promotion gates remain unchanged.

### Qualification gates

Each mode receives full-suite, held-out, cohort, latency, usage, and workflow results.
Retrieval false positives differ from false model selections. An eligible competing
candidate is not itself an authorization violation. Scores never authorize execution.

The reference gates require zero safety violations, at least 95% compatible recall and
selection accuracy, at least 90% selection coverage, at most 1% no-match false
selection, and p95 ready-task latency at most 15 seconds. Every ready task has a
30-second deadline. A critical-cohort decline greater than five percentage points fails
comparison against that mode's declared calibration baseline, on the full pass and every
held-out repetition. Each repetition must pass; pooled averages cannot hide one failed
repetition.

Hybrid also needs a measured gain over lexical retrieval at the same shortlist size and
selection mechanism. Workflow grading checks authorized reads, dependencies, arguments,
approval-required previews, and customer claims with deterministic handlers and checks.
No real business action or commit occurs. Planning returns explicit read/prepare tasks
or terminal clarification with no tasks. The original customer request, ready-task
objective and authorized prerequisite receipts remain available as untrusted model
input. Host policy checks each task's operation and verified preparation prerequisites.
Revocation persists across the complete application run; blocked parent branches stop
without purchasing dependent work.

The application owns response facts: approval comes from prepared-action requirements,
and missing access, clarification and unavailability remain distinct. It deduplicates
summary IDs while retaining execution history. A bounded checker validates model wording
against the synthetic facts; rejected wording is recorded and replaced by a
deterministic response. A valid fallback can satisfy application delivery while model
wording still fails. A post-tool provider error retains successful receipts, records
degraded completion and unknown consumption, and never repeats the action.

Reports separate retrieval, selection, planning/dependencies, authorization/lifecycle,
application delivery, wording and operational reliability. An irrelevant authorized read
remains an intent failure even when framework authorization worked correctly. All
components contribute to the overall qualification conjunction. Workflow calls must meet
the same usage-completeness requirements as standalone trials.

Validated plans, task text, dependency associations, dispositions and response-check
failures are bounded application evidence under the ignored campaign directory.
Framework trace events remain metadata-only. The wording checker is specific to these
synthetic fixtures, not a framework prose-verification API.

Reports include counts, family coverage, and descriptive confidence intervals. Public
synthetic families are reproducible, not an independent blind benchmark. Missing cases,
unresolved accounting, and operational failures remain visible. A complete campaign may
conclude that a mode is unqualified. No package default or production setting changes
automatically.
