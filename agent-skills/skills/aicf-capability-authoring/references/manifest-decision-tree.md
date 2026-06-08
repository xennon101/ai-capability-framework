# Manifest Decision Tree

1. If the operation only retrieves data, model it as read/select behavior.
2. If the operation stages a future side effect, model it as prepare and link the host-controlled commit path.
3. If the operation performs a side effect, keep commit host-controlled and require policy, audit, and idempotency.
4. If the operation sends messages, moves money, changes permissions, deletes records, or affects tenants, treat it as high scrutiny.
5. If the operation cannot be described precisely, split it before writing a manifest.
