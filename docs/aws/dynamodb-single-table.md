# DynamoDB Single-Table Shape

The AWS reference stores use one DynamoDB table with:

- `PK` and `SK` as the table keys;
- `GSI1PK` and `GSI1SK` for direct ID lookups;
- `GSI2PK` and `GSI2SK` for entity-type and relationship lookups;
- `schemaVersion`, `entityType`, timestamps, and optional `ttlEpochSeconds`.

Supported item families include prepared actions, runtime approvals, idempotency
reservations, audit events, canonical ledger records, controls, budget usage, Step
Functions approval tasks, and sanitized replay metadata.

Example CDK-style table shape:

```ts
new dynamodb.Table(this, "AicfRuntimeState", {
  partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
  timeToLiveAttribute: "ttlEpochSeconds"
});
```

Add GSIs named `GSI1` and `GSI2` with string partition and sort keys matching the field
names above.

Use least-privilege IAM scoped to the table and the operations your host actually
enables: `dynamodb:PutItem`, `dynamodb:Query`, `dynamodb:UpdateItem`, and
`dynamodb:DeleteItem`.
