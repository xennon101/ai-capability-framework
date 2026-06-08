# Changelog

All notable public changes to the AICF Agent Skills package are documented here.

## 1.0.0-rc.5 - Unreleased

- Aligned the skills package, Codex plugin manifest, and all real skill metadata with
  the AICF `1.0.0-rc.5` release candidate.
- Added public publish metadata for `@aicf/agent-skills` and documented the
  same-version, same-tag release process with the root package.
- Added S6 release hardening: stale index checks, release-readiness assertions, stricter
  package/install tests, and complete public package docs.
- Added five S5 skills for provider conformance, optional storage/AWS adapters,
  migration, docs/examples, and control-plane UI/API work.
- Reached the full 17-skill public package inventory.
- Added five S4 runtime and control skills for runtime integration, action lifecycle,
  trust/redaction/retention, observability/replay, and controls/budgets.
- Expanded trigger fixture coverage and package tests to cover 12 skills.
- Added the first seven core AICF builder skills for capability authoring, governance
  lifecycle, policy/risk, eval authoring, security red-team work, release hygiene, and
  skills package maintenance.
- Added trigger fixture coverage for all S3 skills and regenerated the public skill
  index.
- Added validation scripts, trigger coverage checks, public-safety checks, skill index
  generation, installation tooling, package tests, and CLI dispatch for the skills
  package.
- Added the initial package skeleton, Codex plugin metadata, public docs placeholders,
  and SVG assets.
