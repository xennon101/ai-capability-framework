# Idempotency And Audit

- Scope idempotency keys by tenant/account/action context.
- Reserve before commit and complete with a safe result ref.
- Return the previous safe result for duplicate keys in the same scope.
- Write audit events for prepare, approval, commit started, commit succeeded, commit
  failed, and denial.
- Do not audit raw tool args when hashes or summaries are enough.
