# Provider Runtime Boundaries

Provider runtimes and bridges must:

- expose only routed read/prepare capabilities.
- keep commit host-controlled.
- keep SDK imports optional and subpath isolated.
- avoid raw transport capture by default.
- use mock clients in normal tests.
- fail closed on provider, parse, budget, or loop errors.
