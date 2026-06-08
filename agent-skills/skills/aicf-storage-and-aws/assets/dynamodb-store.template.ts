export type ExampleDynamoDbItem = {
  pk: string;
  skey: string;
  entityType: string;
  schemaVersion: "0.1";
  safeSummary: Record<string, unknown>;
};

export function toExamplePreparedActionItem(input: {
  tenantRef: string;
  preparedActionId: string;
  state: string;
}): ExampleDynamoDbItem {
  return {
    pk: `tenant#${input.tenantRef}`,
    skey: `prepared#${input.preparedActionId}`,
    entityType: "prepared_action",
    schemaVersion: "0.1",
    safeSummary: { state: input.state }
  };
}
