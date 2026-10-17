# Provider-Neutral Quickstart

Start in an empty project with Node.js 20, 22 or 24 and npm. This walkthrough uses
synthetic data and a deterministic mock model: no API key, provider SDK, source checkout
or framework build is required.

## 1. Install

```sh
mkdir aicf-example
cd aicf-example
npm init -y
npm install ai-capability-framework
```

The stable package includes discovery. Your ordinary model/tool loop chooses among
eligible tools; lexical discovery makes no model or embedding calls.

## 2. Describe your capability

Create a `capabilities` directory. Save this as `capabilities/ticket.json`:

```json
{
  "schema_version": "1.0",
  "id": "support.ticket.get",
  "version": "1.0.0",
  "status": "active",
  "name": "Read support ticket",
  "summary": "Read a support ticket by ticket ID.",
  "model_description": "Read a synthetic ticket the current user is allowed to view. Does not change data.",
  "capability_type": "read_data",
  "autonomy_tier": "A1",
  "risk_tier": "low",
  "input_schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["ticket_id"],
    "properties": { "ticket_id": { "type": "string", "pattern": "^TCK-[0-9]+$" } }
  },
  "output_schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["ticket_id", "status"],
    "properties": { "ticket_id": { "type": "string" }, "status": { "type": "string" } }
  },
  "side_effects": {
    "reads_data": true,
    "writes_data": false,
    "creates_records": false,
    "updates_records": false,
    "deletes_records": false,
    "sends_external_messages": false,
    "charges_money": false,
    "refunds_money": false,
    "changes_permissions": false,
    "triggers_external_workflow": false,
    "irreversible": false
  },
  "authorization": {
    "permissions": ["ticket.read"],
    "tenant_scoped": true,
    "requires_user_context": true
  },
  "policy": { "approval_required": false, "max_autonomy_tier": "A1" },
  "lifecycle": {
    "prepare": false,
    "preview": false,
    "approve": false,
    "commit": false,
    "verify": false,
    "audit": true
  },
  "observability": { "log_inputs": "redacted", "log_outputs": "summary" }
}
```

The manifest describes the contract; your handler supplies the implementation.
Production identity and permissions must come from trusted host authentication. Handlers
must enforce access to the requested resource within that tenant.

## 3. Load, discover and execute

Save this as `app.mjs`:

```js
import {
  buildRegistry,
  loadManifests,
  validateManifests,
  toOpenAIResponsesToolName
} from "ai-capability-framework";
import { createCapabilityDiscovery } from "ai-capability-framework/discovery";
import {
  AicfHandlerRegistry,
  AicfToolExecutor,
  AicfActionLifecycleManager,
  DefaultContextBuilder,
  DefaultPolicyBroker,
  InMemoryApprovalStore,
  InMemoryIdempotencyStore,
  InMemoryPreparedActionStore
} from "ai-capability-framework/runtime";
import {
  MockOpenAIResponsesClient,
  mockFunctionCallResponse,
  mockTextResponse,
  runOpenAIResponses
} from "ai-capability-framework/openai";

const loaded = await loadManifests({ path: "capabilities" });
if (loaded.errors.length || !validateManifests(loaded.manifests).valid) {
  throw new Error("Invalid capability manifests.");
}
const registry = buildRegistry(loaded.manifests);
// Synthetic identity for this mock only. Production identity comes from your host.
const runtimeContext = {
  environment: "test",
  runId: "run_example",
  requestId: "request_example",
  startedAt: new Date().toISOString(),
  account: { accountId: "account_example", tenantId: "tenant_example" },
  subject: {
    actorType: "user",
    userId: "user_example",
    roles: [],
    permissions: ["ticket.read"]
  },
  autonomy: {
    autonomyTier: "A1",
    maxRiskTier: "low",
    allowSideEffects: false,
    allowExternalMessages: false,
    allowMoneyMovement: false,
    allowPermissionChanges: false
  },
  facts: {},
  metadata: {}
};

// Set up the existing runtime once. These example stores live in one process.
const handlers = new AicfHandlerRegistry({ registry });
let reads = 0;
handlers.register({
  capabilityId: "support.ticket.get",
  read: ({ args }) => {
    reads += 1;
    return { ticket_id: args.ticket_id, status: "open" };
  }
});
const policyBroker = new DefaultPolicyBroker();
const actionLifecycle = new AicfActionLifecycleManager({
  registry,
  handlers,
  policyBroker,
  approvalStore: new InMemoryApprovalStore(),
  idempotencyStore: new InMemoryIdempotencyStore(),
  preparedActionStore: new InMemoryPreparedActionStore()
});
const executor = new AicfToolExecutor({
  registry,
  handlers,
  policyBroker,
  actionLifecycle
});

const task = { id: "read-ticket", text: "Read ticket TCK-100." };
const discovery = createCapabilityDiscovery({ registry });
const [result] = await discovery.search({ tasks: [task], runtimeContext });
if (result.status !== "matched")
  throw new Error("No actionable shortlist; clarify or handle the failure.");
const client = new MockOpenAIResponsesClient([
  mockFunctionCallResponse({
    name: toOpenAIResponsesToolName("support.ticket.get"),
    callId: "read_example",
    args: { ticket_id: "TCK-100" }
  }),
  mockTextResponse("Ticket TCK-100 is open.")
]);
const loop = await runOpenAIResponses({
  registry,
  executor,
  client,
  model: "mock-model",
  runtimeContext,
  contextBuilder: new DefaultContextBuilder(),
  userInput: { text: task.text },
  router: discovery.routerFor(result),
  maxToolCalls: 1,
  maxTurns: 2
});
if (
  loop.status !== "completed" ||
  reads !== 1 ||
  loop.toolResults[0]?.status !== "success"
) {
  throw new Error("The mock read did not complete.");
}
console.log(
  JSON.stringify(
    {
      queryId: result.queryId,
      capabilityId: loop.toolCalls[0].capabilityId,
      toolStatus: loop.toolResults[0].status,
      data: loop.toolResults[0].data,
      reads,
      ordinaryModelTurns: client.requests.length,
      discoveryProviderCalls: result.usage.totals.providerAttempts
    },
    null,
    2
  )
);
```

Run the installed CLI and app:

```sh
npx aicf validate capabilities
node app.mjs
```

The CLI validates one manifest. The app reports `queryId: "read-ticket"`,
`capabilityId: "support.ticket.get"`, `toolStatus: "success"`, one read, two mocked
ordinary-model turns and zero discovery-provider calls. The ticket is `TCK-100` with
status `open`. No real provider calls occur.

## 4. Try the complete customer request

Run the packaged example from this same project:

```sh
node node_modules/ai-capability-framework/examples/12-capability-discovery-selection/run-customer-mock.mjs
```

It models “Read ticket TCK-100 and prepare a refund for its order.” Application code
searches each ready task once, carries the authorized order ID to its dependent task,
then prepares a preview requiring approval. Expect one mocked planning turn, four
ordinary-model turns, one read, one preparation and zero commits. The customer response
explains that approval is still pending. Dependencies and response assembly belong to
the example application, not a framework workflow engine.

## Connect your model and application

Keep the same task text and invocation context when passing a result-bound router to
your ordinary runner. Do not reconstruct, persist or reuse results across requests.
Permissions, controls, source changes, cancellation and expiry are rechecked before
export and execution. A retrieval score never authorizes an action.

Replace the mock with your configured Responses-compatible client and an explicit model
when using `runOpenAIResponses`; the framework supplies no account, credentials or model
default. Existing configured clients need no additional discovery model. The optional
OpenAI SDK is needed only if your application chooses it. See the
[OpenAI quickstart](openai-quickstart.md) or
[choose another runtime](../providers/choose-a-runtime.md).

For `no_match`, clarify; for `unavailable` or `cancelled`, handle the operational
outcome. Do not execute the first candidate automatically. Lexical/native is
recommended. [Dedicated selection](../discovery.md#optional-dedicated-selection) is
optional; hybrid is experimental with
[qualification limits](../evals/discovery-qualification.md).

The [stable workflow contract](../api/stable-workflow.md) defines compatibility for this
path. Production authentication, resource access checks and durable stores remain
host-owned. [Repository development](../development.md) is separate from package use.
