# Risk Compiler Rules

Infer at least medium risk for tenant-scoped data, external communication, or important
workflow state.

Infer high risk for money movement, permission changes, broad data access, personal
data, destructive operations, or approval-sensitive work.

Infer critical risk for irreversible destructive action, privileged account control,
regulated data exposure, or large-scale cross-tenant impact.

Declared risk lower than inferred risk is a blocker. Missing quality metadata can be a
warning only when it does not affect safety or runtime correctness.
