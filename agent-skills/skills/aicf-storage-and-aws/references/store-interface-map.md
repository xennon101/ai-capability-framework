# Store Interface Map

Map AICF contracts to store operations:

- prepared action store: create, get, update state, list by safe filters.
- approval store: create, get, lookup by prepared action, update decision.
- idempotency store: reserve, complete, fetch existing result.
- audit and ledger stores: put, get, list, update summaries.
- controls store: kill switches, budgets, breaker policies, breaker state.
- control-plane store: read safe snapshots and evidence summaries.
