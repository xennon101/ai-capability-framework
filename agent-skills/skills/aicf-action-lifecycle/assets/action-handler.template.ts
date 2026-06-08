export type ExamplePreparedAction = {
  preparedActionId: string;
  capabilityId: string;
  commitCapabilityId: string;
  argsHash: string;
};

export async function prepareExampleAction(args: Record<string, unknown>): Promise<ExamplePreparedAction> {
  return {
    preparedActionId: "prepared_example_001",
    capabilityId: "example.action.prepare",
    commitCapabilityId: "example.action.commit",
    argsHash: `hash_${Object.keys(args).sort().join("_")}`
  };
}

export async function commitExampleAction(prepared: ExamplePreparedAction) {
  return {
    committedActionId: `commit_${prepared.preparedActionId}`,
    status: "committed"
  };
}
