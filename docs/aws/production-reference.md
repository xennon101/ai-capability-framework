# AWS Production Reference

AICF AWS support is optional. Import it from `ai-capability-framework/aws` when a host
application wants AWS-backed reference adapters for durable runtime state, audit
evidence, approvals, controls, telemetry, and redaction.

The package root, runtime, provider, governance, audit, controls, and control-plane
subpaths do not import AWS SDK packages. AWS clients are provided by the host
application or constructed by host code outside AICF.

## Supported v1 Adapter

DynamoDB is the supported durable database reference adapter for v1. RDS is not
implemented in this phase.

```ts
import {
  DynamoDbControlPlaneStore,
  DynamoDbPolicyDecisionStore,
  DynamoDbControlsStore
} from "ai-capability-framework/aws";
```

These adapters store public-safe evidence: hashes, redacted refs, summaries, states,
reasons, coverage metadata, and sanitized events. They do not store raw prompts, raw
provider payloads, raw transcripts, secrets, stack traces, or unredacted account,
tenant, or user identifiers by default.

## Host Responsibilities

The host application owns AWS credentials, IAM roles, table provisioning, tenant/account
authorization, approval identity, workflow definitions, evidence retention, backups,
monitoring, and cleanup.

Default tests use fake clients only. Live AWS tests are skipped unless
`RUN_AWS_INTEGRATION=1` and the required resource environment variables are set.
