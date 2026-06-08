# Migration From 0.1 To 1.0

AICF 1.0 is a clean public contract cut from the pre-release 0.1 work. The validator
intentionally does not support both schema versions side by side.

## Required Changes

- Change every manifest and eval result fixture from `schema_version: "0.1"` to
  `schema_version: "1.0"`.
- Regenerate TypeScript manifest types with `npm run generate:types`.
- Re-run `npm run validate` and `npm run check`.
- Update docs, changelog entries, and release notes that refer to the manifest contract
  version.
- If test tooling imported `runCli` from `ai-capability-framework`, update that import
  to `ai-capability-framework/cli`.

## Compatibility Notes

The 1.0 contract preserves the v0.1 public shape and no-execution boundary. The main
compatibility change is the schema version literal. Treat v0.1 examples as pre-release
material and update them before using the 1.0 validator.

Release-candidate CLI runner imports moved out of the root package before v1. The `aicf`
binary did not change; only programmatic imports should switch to the `./cli` subpath.

Host applications remain responsible for model calls, auth, facts, approvals, side
effects, storage, and durable audit logs.
