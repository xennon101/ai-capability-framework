# From a customer request to a tool

Use `ai-capability-framework@1.1.0-rc.1` for these discovery APIs. Lexical/native is the
recommended default. Hybrid is experimental and opt-in; the
[qualification report](../../docs/evals/discovery-qualification.md) explains its limits.

The application AI produces tasks. Application code searches for relevant capabilities,
then its existing model chooses a tool from the shortlist. The runtime validates the
call and enforces execution and approval policy.

Run the complete no-key example from the repository root:

```sh
npm run build
node examples/12-capability-discovery-selection/run-customer-mock.mjs
```

The customer asks to read a ticket and prepare a refund for its order. A mocked planning
call returns two dependent tasks. Application code searches each task when ready, passes
the authorized read result into the next task's context, and uses ordinary model tool
calls to read the ticket and prepare a refund preview. The example's host policy
requires operator review. It stops with approval pending and never exposes or executes
refund commit.

The discovery integration needs only the registry, tasks, and existing runtime context:

```js
import { createCapabilityDiscovery } from "ai-capability-framework/discovery";

const discovery = createCapabilityDiscovery({ registry });
const [result] = await discovery.search({
  tasks: [{ id: "read-ticket", text: "Read ticket TCK-100." }],
  runtimeContext
});
const router = discovery.routerFor(result);
// Pass router, the same runtimeContext, and the exact task text to your ordinary runner.
```

The default profile uses lexical retrieval, up to eight candidates, no alias bonus or
diversity, and a 30-second discovery deadline. An earlier caller deadline wins. Search
accepts controls, existing eligibility filters and permission overrides, cancellation,
and a custom context builder. Batch results retain task IDs and input order. Use the
low-level discoverer for multiple fragments or advanced ranking.

`routerFor` reuses the issued shortlist without ranking or embedding again. Results are
immutable and bound to their issuing instance, original task text, runtime context, and
source. Keep the result in the same request; reconstructed or foreign results are
rejected. Changed source, identity, permissions, controls, cancellation, or expiry
cannot export a stale shortlist. Prepare dependent context before searching. Provider
export and execution retain their ordinary checks.

The example also runs no-match clarification, permission denial, and an explicitly
invoked mock hybrid companion. Planning and ordinary model usage are reported
separately: one planning turn and four ordinary turns, all synthetic. Lexical discovery
uses no provider calls. The hybrid companion uses one explicit index-build batch and one
query attempt; invalid-index rejection purchases no query embedding. No dedicated
selector runs.

## Optional semantic search

Enable hybrid mode explicitly, using your configured embedding client and an index built
in a separate administrative operation:

```js
import { createInMemoryDiscoveryBudget } from "ai-capability-framework/discovery";

const budget = createInMemoryDiscoveryBudget({
  runId: runtimeContext.runId,
  maxProviderCalls: 8,
  maxInputTokens: 32000
});
const discovery = createCapabilityDiscovery({
  registry,
  mode: "hybrid",
  embedding: { client: embeddingClient, index, maxInputTokens: 4000 }
});
const results = await discovery.search({ tasks, runtimeContext, budget });
```

The standard hybrid starting weights are 0.75 semantic and 0.25 lexical. Failures return
unavailable unless lexical fallback is explicitly configured. Override `weights`,
`failurePolicy`, and `limits` on the facade as needed. Embedding options allow
overriding artifact bounds (16 MiB, 10,000 entries, 4,096 dimensions) and provider
character bounds (16,384 per text, 65,536 per call). The caller supplies the token
ceiling. Token enforcement and retry disabling remain embedding-client responsibilities.
Indexes must still match the exact source and embedding configuration; serving never
builds or repairs them.

The in-memory helper enforces a finite single-run budget in one process. A supplied
`maxEstimatedCost` also requires `embedding.maxEstimatedCostPerCall`; the framework
assumes no prices. Unknown consumption retains reserved allowance. Late completion
settles its reservation without restoring a cancelled result. An unresolved attempt
retains its reservation for the lifetime of the helper.

For distributed or durable enforcement, pass `budget: { ledger, policy }` with your own
ledger and existing budget policy. Reuse the scope across discovery calls in a run. Use
the shared-run companion below to account for managed planning and downstream model
calls; this example reports those stages separately. No default credentials, model
service, or live transport is supplied.

These mocks demonstrate contracts and integration. They do not establish real semantic
quality or guarantee that the first candidate is the correct tool. Applications own
decomposition, task dependencies, argument completion, and customer responses. A model
may choose a candidate or request clarification; scores never authorize execution.

## Optional dedicated selection

Use the ordinary model/tool loop for the standard flow above. If your application needs
a separate model decision, explicitly call the same discovery instance's `select`
method:

```js
const batch = await discovery.select({
  results,
  client: selectionClient,
  budget,
  maxInputTokens: 4000,
  maxOutputTokens: 1000
});
```

The framework recovers task text and context bindings from its own search results and
constructs candidate cards. Supply a configured `SelectionModelClient` with an explicit
`mock` marker and `generateStructured` method; input/output token ceilings are passed to
that client. Use the existing budget helper or your own `{ ledger, policy }` scope. Cost
caps require `maxEstimatedCostPerCall`, with optional host cost estimation. There is no
default model, account, price, or credential lookup.

`batch.outcomes` contains ordered selected/abstained decisions or safe failure outcomes
for matched tasks. Non-matched tasks stay in `batch.discovery` and are never represented
as model abstentions. `batch.usage` owns selection and repair usage once for the whole
batch; discovery usage remains in the original discovery results. Individual outcomes
carry no duplicate provider-usage receipt.

Cards preserve complete model descriptions, usage/exclusion guidance, input-field names,
and read/prepare distinctions. Scores, full schemas, runtime identities, hidden policy,
and paths are omitted. Optional `contextByQueryId` explicitly projects application data
for the model. Foreign/reconstructed results and incompatible invocation scopes are
rejected. Current source, eligibility, identity, controls, cancellation, and original
deadlines are rechecked; a new deadline can shorten the original bound.

Defaults are eight tasks, 32,000 serialized input characters, and one attempt. Override
`limits: { maxTasks, maxInputCharacters, maxAttempts }` up to 32 tasks, 128,000
characters, and two attempts. The same character ceiling bounds response parsing. With
two attempts, one repair may use safe issue codes and the original cards. Oversized
batches/cards are rejected without clipping or paid splitting. Provider, accounting,
stale-binding, budget, control, cancellation, and deadline failures cause no repair or
automatic candidate choice.

Advanced callers can pass the same low-level request to `buildCapabilitySelectionTasks`
and `ModelCapabilitySelector.select`; the helper derives its hashes from that request's
configured client and limits, without a provider call or manual fingerprint
construction.

The selector returns decisions; application argument completion and runtime execution
remain separate. Native search and `routerFor` never call the dedicated selector.
Selected-result routers, the optional Responses adapter, and managed full-run accounting
are available; see the shared-run integration below. Imports use the public
release-candidate discovery subpath.

Run the explicit selector companion:

```sh
npm run build
node examples/12-capability-discovery-selection/run-selector-mock.mjs
```

It demonstrates competition, single-candidate abstention, a skipped no-match task, and
one enabled repair. Across two explicit invocations it reports three mock provider
attempts and 420 synthetic total tokens, with complete reported usage. It executes no
tools and makes no embedding or live model calls. The fixture establishes contracts, not
model quality.

## Advanced lexical example

Run from the repository root:

```sh
npm run build
node examples/12-capability-discovery-selection/run-mock.mjs
```

This example reuses the synthetic support manifests. Discovery returns independent
shortlists for four tasks, then the router turns one request into a bounded runtime
slice. Existing provider export checks produce the tool descriptors. A mocked ordinary
model/tool loop chooses the ticket lookup, executes the existing authorized runtime
handler, and returns an answer.

Discovery makes zero provider calls and reports complete zero token and cost totals. The
two ordinary mock model turns run locally. No key, network connection, embedding client,
or dedicated selector is used.

Imports use supported package subpaths. The executable retrieval fixtures include
compatible and forbidden capabilities without adding manifests to the normal inventory.

## Hybrid mock

Run the explicit index build and hybrid example:

```sh
npm run build
node examples/12-capability-discovery-selection/run-hybrid-mock.mjs
```

This flow builds deterministic synthetic vectors, validates the complete index, and
round-trips it through host-owned memory storage. It demonstrates a semantic match with
zero lexical evidence, an invalid-index rejection before any query embedding, and
explicit lexical fallback. The ordinary mocked model/tool loop still performs tool
selection and an authorized read.

The flow records three logical mock embedding attempts: one document batch and two
independent query calls, including the query made by the ordinary runtime loop. All
embedding usage is labeled mock. These vectors provide contract evidence only. No live
embedding service or dedicated selector is used.

Hybrid callers supply an embedding client, complete model configuration, an index,
artifact and input limits, an absolute deadline, and a shared reservation ledger. Each
task joins its original fragment texts with newlines and makes at most one embedding
attempt, sequentially. The native-router wrapper forwards the caller's ledger and
deadline without changing ordinary runtime runners.

Storage implementations must atomically replace complete validated artifacts. Serving
does not load or rebuild an index implicitly. Stale source, model, revision, dimension,
or provenance bindings require explicit rebuilding or a configured whole-query lexical
fallback. An absent model revision does not establish an immutable embedding space.

Cancellation returns a fixed usage snapshot. If a provider attempt remains pending, its
reservation stays held until its observed completion settles it; host recovery handles
attempts that never finish. Clients enforce token ceilings and disable hidden retries.
Unreported usage and cost remain unknown.

## Shared-run integration

Run `node examples/12-capability-discovery-selection/run-pipeline-mock.mjs` after
`npm run build`. The companion runs lexical/native, lexical/dedicated, hybrid/native,
and hybrid/dedicated paths through the existing tool loop. Each reads a ticket, carries
its order ID into refund preparation, and produces a preview requiring approval. It
makes no real provider calls.

Create one optional `createAicfProviderRun` with the existing runtime run ID, a
reservation budget, and an absolute deadline. Pass it to `search`; facade selection and
result-bound routers recover that scope. The ordinary Responses runner accepts
`providerExecution` with explicit model identity, provenance, input/output token
ceilings, and an application-supplied complete-input token preflight. Continuation
history is supplied to that preflight. No tokenizer, pricing, credentials, or model
defaults are discovered.

Dedicated selection remains optional:

```js
const batch = await discovery.select({
  results,
  client: selectionClient,
  maxInputTokens: 4000,
  maxOutputTokens: 1000
});
const router = discovery.routerFor(batch, task.id);
```

Here `results` came from a search using `providerRun`. Without a run, continue supplying
the existing explicit `budget`. A batch can select several independent tasks, but each
router exports only its own task's decision. Revalidation repeats neither ranking nor
provider work. The ordinary model still supplies arguments; normal policy, validation,
approval, and execution remain in force.

`createOpenAISelectionClient` wraps an existing Responses-compatible client and requires
a complete-input token preflight. It forwards cancellation and timeout, disables
transport retries, and uses a versioned strict structured-output projection. Embeddings
continue to use the caller's supplied client and separately built compatible index.

`providerRun.attempt` lets application planning or response calls share the same ledger.
Only calls made through the managed boundary are counted. The in-memory budget
optionally limits output tokens and retains allowance for unknown usage; use a host
ledger for distributed or durable enforcement. The runner preserves its legacy `usage`
field and adds an all-turn `providerUsage` receipt for managed turns. The run snapshot
combines unique attempts once across stages. Missing usage/cost remains unknown; mock
zero cost in this example is explicitly supplied.

New trace events contain bounded metadata and numeric receipts, including under
content-capture settings. Run-local retention stops at 256 events and reports overflow.
Hosts own trace retention and access. Hashes are not anonymization.

`createDiscoverySnapshot` creates a bounded metadata snapshot for the existing replay
extension. Snapshot validation checks bindings and membership; ranking replay
additionally requires original query fixtures and, for hybrid retrieval, compatible host
vector fixtures. It never calls a provider. Neither operation establishes model semantic
correctness. Existing `router_only` replay requires an explicit discovery handler for
these snapshots. Live replay remains separately enabled and budgeted.

The companion reports five, seven, seven, and nine customer-run mock attempts
respectively. Administrative index-build usage is reported separately. Failure cases
cover clarification, abstention, permission/source revocation, budget exhaustion, and
invalid-index rejection without query embedding. Synthetic responses and vectors
establish integration behavior; they do not qualify retrieval or selection quality.

## Installed package and evaluation

Fake data: all requests, capabilities, identities, and outputs are synthetic. No secrets
are needed. No live provider calls occur.

Command from an installed consumer directory:

```sh
node node_modules/ai-capability-framework/examples/12-capability-discovery-selection/run-customer-mock.mjs
```

Expected output: one planning turn, four ordinary turns, one authorized read, one
approval-required preparation, and zero commits. The separately invoked hybrid companion
uses two mock embedding attempts. All five commands use supported public imports and
resolve manifests relative to their own modules, independent of the working directory.

Run `npm run eval:discovery:mock` from the repository, or run the packaged
`run-evaluation-mock.mjs` in the same way, for the frozen 240-case lexical baseline. The
suite has three domains, 120 train cases, 60 calibration cases, and 60 held-out cases,
with scenario families confined to one partition. Independently scripted selection
observations demonstrate selected, abstained, unavailable, and invalid-output outcomes.
Their accounting is explicitly incomplete because no provider attempts were observed. No
selector is invoked by the evaluator.

The baseline retains retrieval misses and false positives; its rates are informational.
Do not tune against the frozen held-out set. These fixtures do not qualify live models.
See the [discovery guide](../../docs/discovery.md) for defaults, ownership, limits,
budgets, replay boundaries, and evaluation metrics.

## Optional live evaluation campaign

The
[offline regrading guide](../../docs/evals/discovery-live.md#regrade-saved-wording-offline)
shows how to reassess saved wording without model access. It preserves frozen results,
observed delivery and historical accounting, and writes a separate versioned report.

`npm run eval:discovery:live` validates the corrected v3 suite and fixed-eight-candidate
schedule with zero provider calls. `npm run eval:discovery:campaign:mock` exercises the
complete campaign, durable accounting, three held-out repetitions, and 48 workflow runs
with deterministic clients. It writes evidence under ignored `.aicf/` and makes no
quality claim about real models.

Paid execution requires `--live`, an explicit host configuration, compatible model
clients, token preflights, matching offline acceptance evidence, and a pinned
continuation of the original campaign budget. This command performs no paid work by
default. The application owns response facts and validates model wording with a recorded
deterministic fallback. Plans, terminal task outcomes and component grades are retained
in ignored evidence. The original suite and all existing companions are preserved. See
the [evaluation guide](../../docs/evals/discovery-live.md) for stages, resume behavior,
limits, and interpretation.
