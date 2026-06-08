# Provider Conformance

The canonical F7 conformance guide is now
[docs/providers/conformance.md](providers/conformance.md).

Use the root conformance import for new code:

```ts
import { runConformanceSuite } from "ai-capability-framework/conformance";
```

The older `ai-capability-framework/providers/conformance` import path and
`aicf providers conformance` CLI command remain compatibility aliases.
