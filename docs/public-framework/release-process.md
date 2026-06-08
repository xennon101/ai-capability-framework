# Release Process

AICF releases are public npm and GitHub artifacts. Release candidates must pass
the checks in [Release checklist](../release.md).

## Semantic Versioning

AICF uses semantic versioning. Breaking changes require a major version. New
optional fields, isolated subpaths, docs, examples, and warning-only checks are
minor changes. Bug fixes, docs corrections, and compatibility fixes that do not
change public contracts are patch changes.

Core commands:

```bash
npm run check
npm run check:certification
npm run check:release-install
npm pack --dry-run --json
npm publish --dry-run --access public --tag next
```

Use `npm pack` for npm artifact review and `npm run archive:source` for source
review. Do not zip the working directory manually.

npm publishing uses trusted publishing from GitHub Actions for version tags.
Release tags must match the package version exactly. Prereleases publish with
the `next` dist tag; stable releases publish with `latest`.

Use [Final v1 certification](v1-certification.md) before a public stable
release. It is the objective readiness gate for the repository, package,
examples, docs, provider conformance, public artifact hygiene, and mock-based
runtime surfaces.
