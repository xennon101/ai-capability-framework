# Find capabilities for a task

Install with `npm install ai-capability-framework`. The lexical/native workflow is
[stable public from 1.1.0](api/stable-workflow.md) and is the recommended default. For a
complete first app, use the
[installed-package quickstart](getting-started/provider-neutral-quickstart.md).

```ts
import { createCapabilityDiscovery } from "ai-capability-framework/discovery";

const discovery = createCapabilityDiscovery({ registry });

const [result] = await discovery.search({
  tasks: [{ id: "read-ticket", text: "Read ticket TCK-100." }],
  runtimeContext
});

const router = discovery.routerFor(result);
```

Supply the router to your existing model/tool runner. For example, pass `router`,
`registry`, the same `runtimeContext`, and `userInput: { text: "Read ticket TCK-100." }`
to `runOpenAIResponses` alongside your ordinary client, model, and executor. The model
chooses a tool and supplies arguments; the runtime validates and authorizes execution.

The recommended flow is **customer request → application AI produces tasks → discovery
returns a shortlist → ordinary model/tool loop chooses → runtime validates and
executes**. Applications own decomposition, task dependencies, argument completion, and
customer responses. Search each dependent task when its context is ready.

The named lexical/native facade is **stable public**. Advanced discovery APIs retain
their [individual maturity labels](api/stable-workflow.md). Discovery does not change
`DefaultCapabilityRouter`. Results contain eligible candidates, scores, diagnostics,
usage, and version bindings. A useful shortlist is the goal; neither ranking first nor a
high score authorizes execution or guarantees a suitable tool.

The stable npm package includes this subpath; no checkout, framework build or locally
packed tarball is required.

## Defaults and result handling

The standard profile uses lexical retrieval, at most eight candidates, positive-score
admission, no alias bonus or diversity slot, and a 30-second deadline shortened by an
earlier caller deadline. It makes no provider calls. Text is normalized with NFKC and
lowercase and tokenized into Unicode letters and numbers. There are no synonyms or stop
words; shared common words can produce irrelevant candidates.

Search accepts task IDs/text, existing runtime context, controls, eligibility options,
cancellation, deadlines, an optional budget, and an optional provider run. Results keep
input order and task IDs. See [API reference](api.md) for bounded limits and advanced
fragment/custom-ranker interfaces.

Use `matched` results in the ordinary loop. For `no_match`, ask the customer to clarify
or explain the available functionality. Treat `unavailable` and `cancelled` as explicit
operational outcomes. Do not choose the first candidate as a failure fallback.

`routerFor(result)` reuses the issued shortlist without retrieving or embedding again.
Keep the discovery instance and result within the request. Foreign, reconstructed,
expired, or stale results are rejected. Export and dispatch recheck the original task,
invocation, source, permissions, controls, cancellation, and deadline. Prepare dependent
context before searching, rather than changing it after obtaining a result. Commit
operations are never exposed through discovery routers.

## Complete no-key example

Run the packaged example from your project directory after installation:

```sh
node node_modules/ai-capability-framework/examples/12-capability-discovery-selection/run-customer-mock.mjs
```

The synthetic customer asks to read a ticket and prepare its order refund. Mock planning
produces two dependent tasks. The application reads the ticket, carries its order ID
into the second task, and prepares a preview requiring approval. It reports one planning
turn, four ordinary turns, one read, one preparation, and zero commits. No real provider
calls occur. See the
[example guide](../examples/12-capability-discovery-selection/README.md).

## Explicit hybrid retrieval

Hybrid is experimental and opt-in. It passed the tested safety and workflow gates, but
missed the incremental-gain requirement. See the
[qualification results and limits](evals/discovery-qualification.md).

Enable `mode: "hybrid"` with your embedding client, a separately built compatible index,
an input-token ceiling, and a finite budget. The facade's starting weights are 0.75
semantic and 0.25 lexical; quality must be evaluated for your application. Failures
return unavailable unless you explicitly configure `lexical_fallback`.

`buildCapabilityEmbeddingIndex` is an explicit administrative operation. Serving never
builds, repairs, or loads an index implicitly. Index validation binds exact manifests,
projection, model configuration, mock/live provenance, dimensions, and vectors. Host
storage implements atomic complete-artifact replacement. Supply clients with hidden
retries disabled and enforce their token ceilings.

Advanced `CapabilityDiscoverer` configuration remains explicit. The facade supplies
convenience defaults without changing that low-level contract.

## Optional dedicated selection

The default integration needs no dedicated selector client. If a separate model choice
is useful, invoke it explicitly:

```ts
const batch = await discovery.select({
  results,
  client: selectionClient,
  budget,
  maxInputTokens: 4000,
  maxOutputTokens: 1000
});
const selectedRouter = discovery.routerFor(batch, "read-ticket");
```

The framework constructs task-local candidate cards and validates selection or
abstention. Non-matched discovery tasks remain visible without fabricated decisions.
Consume batch decisions one task at a time. The selected router repeats no retrieval,
embedding, or selector call. Arguments, approval, and execution remain separate.

Supply model access and configuration yourself. The optional Responses-compatible
`createOpenAISelectionClient` adapter lives under `ai-capability-framework/openai` and
requires a complete-input token preflight. No credentials, model, endpoint, or pricing
are inferred.

## Budgets, tracing, and replay

`createInMemoryDiscoveryBudget` supplies a finite single-run ledger with call and token
caps, optional output-token/cost caps, and conservative reservations for unknown usage.
Cost caps require per-attempt reservation ceilings. It lasts for one process; use a host
ledger for distributed or durable enforcement.

Optionally create one `createAicfProviderRun` from the runtime subpath. Its `attempt`
method can include application planning and response calls. Pass it to search; selection
and result-bound routers recover the scope. The Responses runner's explicit
`providerExecution` options account for ordinary turns. Run totals count unique attempts
once; adding overlapping stage receipts would double-count consumption. Unmanaged SDK
calls are not observed. Missing usage stays unknown, and pending calls retain
reservations until observed settlement.

Discovery tracing emits bounded metadata, counts, bindings, and usage completeness, with
256 retained run-local events. It does not emit task text, prompts, cards, vectors,
arguments, or provider payloads. Hosts own retention; hashes are not anonymization.

Snapshot replay checks structure, bindings, and membership. Deterministic ranking replay
additionally needs original fragments and compatible ranking/vector fixtures. Missing
fixtures cause explicit refusal. Neither path reproduces model semantic decisions. See
[replay guidance](evals/replay-and-trace-to-golden.md).

## Offline evaluation and quality

Run `npm run eval:discovery:mock` for the frozen 240-case, three-domain lexical baseline
and independently scripted selection observations. The provider-free
`evaluateCapabilityDiscovery({ suite, registry, observations })` accepts compatible-ID
sets and forbidden IDs/operations and reports retrieval and selection separately.

Reports include counts and denominators, incomplete cases, operational outcomes,
latency, provenance, and deduplicated usage. Empty denominators and unknown consumption
remain null. Authoritative schemas are exported under `schemas/discovery/`; recognized
`discovery-fixtures/*.suite.json` and `*.observations.json` files work with
`aicf validate`. Observation validation requires the matching suite in the validation
input.

A valid report means its observations and bindings are consistent. It does not mean the
reported quality or safety metrics pass your application's gates.

The dataset has 120 train, 60 calibration, and 60 held-out cases, split by scenario
family. Public hold-out fixtures provide reproducibility, not blind evaluation. Do not
tune against observed held-out failures and continue calling the set held-out. Record
dataset corrections as a new suite version and fingerprint.

Use optional `caseIds` for partition or cohort reports while retaining the complete
suite fingerprint. Missing scoped cases remain incomplete. Versioned corrected fixtures
and explicit live campaign tooling are described in the
[real-model evaluation guide](evals/discovery-live.md). The live command defaults to
offline validation and requires caller-supplied model access and an explicit budget
before any paid work.

The [versioned qualification report](evals/discovery-qualification.md) records
real-model results for the tested synthetic configuration and the separate offline
wording correction. Both lexical modes qualified; hybrid did not meet its
incremental-gain gate.

Mock integration establishes contracts, not real-model quality. Offline lexical misses
are reported without changing defaults to fit the suite. Real embedding quality, native
model choice, dedicated selection, and complete workflow quality need separate
evaluation with explicit clients, budgets, and application-specific acceptance gates.
