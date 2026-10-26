# AWS Overview

AWS support is an optional reference integration under `ai-capability-framework/aws`.
Root, runtime, provider, governance, control, and evidence imports do not require AWS
SDK modules.

Read:

- [AWS runtime](../aws-runtime.md)
- [Production reference](production-reference.md)
- [DynamoDB single-table model](dynamodb-single-table.md)
- [Step Functions approval](step-functions-approval.md)
- [CloudWatch telemetry](cloudwatch-telemetry.md)
- [KMS redaction](kms-redaction.md)

Host applications own AWS credentials, IAM, deployment, table provisioning, retention,
and cleanup.

Offline compatibility checks cover all seven AWS SDK integrations at versions 3.1061.0
and 3.1156.0 using injected transports. When retaining the historical 3.1061.0 clients
with `@aws-sdk/lib-dynamodb`, use the compatible `@aws-sdk/util-dynamodb@3.996.2`
resolution. Newer utility releases raise their DynamoDB client peer minimum; keep strict
peer checks enabled and match the utility to the client version. These checks do not
provision resources or establish production AWS acceptance.
