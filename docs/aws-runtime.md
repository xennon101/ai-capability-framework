# AWS Runtime Reference

AICF AWS support is an optional reference integration for host applications that
already run durable runtime state or approval workflows on AWS.

Import AWS APIs from:

```ts
import {
  DynamoDbPreparedActionStore,
  StepFunctionsApprovalAdapter
} from "ai-capability-framework/aws";
```

The package root, `ai-capability-framework/runtime`, and
`ai-capability-framework/openai` do not import AWS SDK modules.

The AWS subpath itself can be imported in a clean install without AWS SDK
packages. DynamoDB, Step Functions, and EventBridge operations dynamically
require the relevant optional AWS SDK peer only when those operations run.

## DynamoDB Stores

The AWS subpath provides DynamoDB implementations for the R2 runtime store
interfaces:

- `DynamoDbPreparedActionStore`
- `DynamoDbApprovalStore`
- `DynamoDbIdempotencyStore`
- `DynamoDbAuditSink`

Each store accepts a caller-provided DynamoDB document client:

```ts
const preparedActionStore = new DynamoDbPreparedActionStore({
  documentClient,
  tableName: "AicfRuntimeState"
});
```

The reference shape uses one table with `PK` and `SK`, lookup index fields, a
`schemaVersion`, an `entityType`, timestamps, and optional `ttlEpochSeconds`.
Prepared actions are partitioned by tenant and account. Approval and
idempotency records use runtime metadata added by the lifecycle manager so the
existing store interfaces do not need AWS-specific arguments.

Prepared action payloads store redacted args and public runtime summaries, not
raw user prompts, provider payloads, or private traces.

## Step Functions Approval Handoff

`StepFunctionsApprovalAdapter` starts and resumes host-owned approval workflows:

```ts
const approvals = new StepFunctionsApprovalAdapter({
  sfnClient,
  stateMachineArn
});

await approvals.startApproval({
  approvalRequirement,
  preparedAction
});
```

The adapter sends safe prepared-action summaries to Step Functions. It does not
build approval screens, send notifications, own identity, verify approvers, or
decide policy. Host applications remain responsible for approval UI, auth,
workflow definitions, and task-token handling.

## EventBridge Publishing

`EventBridgeRuntimeEventPublisher` publishes sanitized AICF trace or audit
events:

```ts
const publisher = new EventBridgeRuntimeEventPublisher({
  eventBridgeClient,
  eventBusName: "aicf-events"
});

await publisher.publish(event);
```

Trace content is emitted in metadata mode by default. Raw prompts, raw provider
payloads, secrets, tokens, cookies, and payment data should not be included in
runtime events.

## Testing

The AWS subpath exports fake clients for deterministic tests:

- `FakeDynamoDbDocumentClient`
- `FakeStepFunctionsClient`
- `FakeEventBridgeClient`

Default package tests use these fakes only. No AWS credentials, network calls,
CDK, CloudFormation, Terraform, or live AWS resources are required.
