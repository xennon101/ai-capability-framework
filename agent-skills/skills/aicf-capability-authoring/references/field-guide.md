# Field Guide

- `id`: stable capability identifier, usually `domain.entity.action`.
- `description`: model-facing summary, written for safe selection.
- `status`: current manifest availability, not governance lifecycle by itself.
- `input_schema`: canonical AICF validation contract for tool arguments.
- `output_schema`: expected handler result shape.
- `risk`: declared risk; never declare lower than inferred side effects require.
- `side_effects`: machine-readable summary of writes, sends, deletes, money movement, or external effects.
- `lifecycle`: read, prepare, commit, verify, or related lifecycle metadata.
- `policy`: requirements the host policy broker must enforce.
- `extensions`: public-safe metadata for governance, security packs, or provider hints.
