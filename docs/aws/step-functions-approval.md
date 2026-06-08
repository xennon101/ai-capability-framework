# Step Functions Approval Handoff

`StepFunctionsApprovalAdapter` starts and resumes host-owned approval workflows. It
sends a safe prepared-action summary, not raw args or provider payloads.

```ts
import {
  DynamoDbStepFunctionsApprovalTaskStore,
  StepFunctionsApprovalAdapter
} from "ai-capability-framework/aws";

const taskStore = new DynamoDbStepFunctionsApprovalTaskStore({
  documentClient,
  tableName: "AicfRuntimeState"
});

const approvals = new StepFunctionsApprovalAdapter({
  sfnClient,
  stateMachineArn,
  taskStore,
  taskTokenTtlSeconds: 900
});
```

The adapter can record task correlation metadata, send success for approved decisions,
send failure for rejected decisions, and mark tasks expired or cancelled. It does not
build approval UI, send email, decide policy, verify approvers, or own production auth.

Hosts should store task tokens securely. AICF task records store token hashes, not raw
task tokens.
