# Compatibility Policy

AICF treats exported TypeScript APIs, schemas, CLI commands, public examples,
and documented subpath imports as public compatibility surfaces.

Breaking changes include manifest schema breaking changes, required input
changes, removed exports, public error-code removals or meaning changes,
lifecycle/risk semantic changes, weakened runtime safety behavior, provider
descriptor changes that alter generated tools, eval-result schema changes,
control-plane API changes, model-exposed commit paths, or package boundary
changes that require optional SDKs from root imports.

Minor changes include new optional manifest fields, new isolated subpaths, new
provider adapters, new eval scorers, new warnings that do not fail by default,
new docs, and new examples.

Patch changes include bug fixes, docs corrections, internal refactors, and
provider compatibility fixes that do not alter public contracts.

When in doubt, add compatibility tests and document migration guidance.
