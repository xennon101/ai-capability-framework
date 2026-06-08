# AWS Reference Adapter Example

This directory is README-only and credential-free. It shows how a host
application can wire AICF AWS reference adapters without making AWS required for
the package.

```ts
import {
  DynamoDbControlPlaneStore,
  DynamoDbPolicyDecisionStore,
  StepFunctionsApprovalAdapter,
  CloudWatchTelemetryPublisher
} from "ai-capability-framework/aws";

const controlPlaneStore = new DynamoDbControlPlaneStore({
  documentClient,
  tableName: "AicfRuntimeState"
});
```

Use `docs/aws/production-reference.md` for the full guide. Production hosts must
provide credentials, IAM, table provisioning, tenant/account authorization,
approval identity, workflow definitions, retention policy, monitoring, and
cleanup.

Local package tests use fake AWS clients only and do not call AWS.

