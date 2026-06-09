# Release Process

AICF releases are public npm and GitHub artifacts. Release candidates must pass the
checks in [Release checklist](../release.md).

The public packages support Node.js `>=20`. CI must prove the core gate on Node 20.x,
22.x, and 24.x before a release. Optional live/provider/cloud checks remain opt-in and
may run only on the primary release Node unless a workflow explicitly matrices them.

## Semantic Versioning

AICF uses semantic versioning. Breaking changes require a major version. New optional
fields, isolated subpaths, docs, examples, and warning-only checks are minor changes.
Bug fixes, docs corrections, and compatibility fixes that do not change public contracts
are patch changes.

Core commands:

```bash
npm run check
npm run check:certification
npm run check:final-matrix
npm run check:metadata
npm run check:licenses
npm run check:release-tag
npm run check:release-install
npm run skills:ci
npm run skills:check
npm run skills:pack:dry
npm run release:preflight:npm
npm run release:publish:dry
npm pack --dry-run --json
```

`npm run release:publish:dry` runs package publish dry-runs while the target version is
unpublished. After both public packages at the current version are already on npm, it
exits successfully with a skip message. A partial state, where only one package version
is published, remains a failure and must be handled with the documented recovery path.

Use `npm pack` for npm artifact review and `npm run archive:source` for source review.
Do not zip the working directory manually.

Use [Final Certification Matrix](final-certification-matrix.md) to confirm the local
command set, workflows, package contents, source archive rule, and publish dry-run
commands are still aligned.

The Release Dry Run workflow is a manual release-review workflow. Run it from GitHub
Actions when preparing a release candidate or stable tag; ordinary `main` pushes rely on
CI, validation, docs, and security workflows instead.

AICF uses MIT for the v1 public release. The root package, `@aicf/agent-skills`, the
Codex plugin manifest, skill metadata, README, and release docs must agree; see
[License Decision](license-decision.md).

Dependency licenses must pass `npm run check:licenses`. Any exception to the default
permissive allow-list must be documented in
[Dependency License Exceptions](../public/license-exceptions.md) before tagging.

npm publishing uses trusted publishing from GitHub Actions for version tags. Release
tags must match the package version exactly. AICF publishes `ai-capability-framework`
and `@aicf/agent-skills` from the same tag with the same version. Prereleases publish
with the `next` dist tag; stable releases publish with `latest`.

Before the next release tag, run the
[npm release preflight](../public/npm-release-preflight.md), configure npm trusted
publishing for both packages, and verify package ownership with `npm owner ls`. The
scoped package `@aicf/agent-skills` must be owned by AICF maintainers and mapped to
`.github/workflows/publish.yml` just like the root package.

Use [Final v1 certification](v1-certification.md) before a public stable release. It is
the objective readiness gate for the repository, package, examples, docs, provider
conformance, public artifact hygiene, and mock-based runtime surfaces.
