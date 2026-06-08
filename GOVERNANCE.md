# Project Governance

AI Capability Framework is maintained as a public framework. The maintainers
prioritize safety boundaries, public documentation quality, and deterministic
tests over feature breadth.

## Maintainer Roles

- Release maintainers own npm/GitHub release readiness, tags, changelog checks,
  package contents, and trusted publishing.
- Security maintainers review vulnerability reports, unsafe public artifacts,
  security-pack changes, provider boundary changes, and release mitigations.
- Technical maintainers review API, schema, runtime, provider, governance, and
  example changes for compatibility and test coverage.

One person may hold multiple roles. Role assignment is by maintainer consensus.

## Maintainer Responsibilities

- Keep the public package free of private drafts, credentials, raw traces, raw
  prompts, provider payloads, and local artifacts.
- Preserve the framework boundary: AICF is not an agent framework. It is a
  governed capability layer for AI-accessible application functionality.
- Review changes for public API compatibility, package hygiene, and
  no-model-exposed commit behavior.
- Require tests and docs for public API, schema, CLI, provider, runtime,
  governance, or example changes.

## Decision Process

Public changes should be small enough to review, include tests where behavior
changes, and update docs when they affect user understanding. New integrations
must stay isolated behind optional subpaths unless maintainers explicitly
change the architecture.

Models propose; applications validate, authorize, execute, and audit. Proposed
changes should reinforce that boundary.

Security-sensitive changes require explicit maintainer review before release.
Examples include model-exposed tools, action lifecycle behavior, approval or
idempotency semantics, provider payload handling, MCP server behavior, policy
adapters, controls, audit/evidence records, and public artifact rules.

## Release Approval

Release candidates are gated by the repository checks in
[docs/release.md](docs/release.md), package dry-run inspection, and public
artifact hygiene checks. npm publishing uses trusted publishing from GitHub
Actions for tagged releases only.

Release approval requires a clean public worktree, passing CI, passing package
and source artifact checks, reviewed changelog/release notes, and a version tag
that matches `package.json`.

## Deprecation Process

Deprecated APIs, schemas, commands, docs, examples, or compatibility aliases
should include a replacement path, migration note, and expected removal window
when known. Deprecated behavior remains loadable for at least one minor release
unless a security fix requires immediate denial.
