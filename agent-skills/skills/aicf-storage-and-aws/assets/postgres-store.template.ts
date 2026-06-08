export type ExampleActionRow = {
  id: string;
  tenant_ref: string;
  state: string;
  args_hash: string;
  created_at: string;
};

export function toExampleActionRow(input: {
  id: string;
  tenantRef: string;
  state: string;
  argsHash: string;
}): ExampleActionRow {
  return {
    id: input.id,
    tenant_ref: input.tenantRef,
    state: input.state,
    args_hash: input.argsHash,
    created_at: new Date(0).toISOString()
  };
}
