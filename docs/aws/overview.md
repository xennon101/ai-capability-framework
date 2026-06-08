# AWS Overview

AWS support is an optional reference integration under
`ai-capability-framework/aws`. Root, runtime, provider, governance, control, and
evidence imports do not require AWS SDK modules.

Read:

- [AWS runtime](../aws-runtime.md)
- [Production reference](production-reference.md)
- [DynamoDB single-table model](dynamodb-single-table.md)
- [Step Functions approval](step-functions-approval.md)
- [CloudWatch telemetry](cloudwatch-telemetry.md)
- [KMS redaction](kms-redaction.md)

Host applications own AWS credentials, IAM, deployment, table provisioning,
retention, and cleanup.
