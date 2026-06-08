# Final Certification Matrix

The final certification matrix is the local release-review gate for AICF v1 readiness.
It is not a legal certification, audit opinion, security guarantee, or npm publish
action. It checks that the public repository, root package, `@aicf/agent-skills`,
workflows, docs, package contents, and release dry-run commands line up.

Run the matrix directly with:

```bash
npm run check:final-matrix
```

It is also part of:

```bash
npm run check:certification
```

## Required Local Commands

Before a release tag, these non-live commands must pass from the repository root:

```bash
npm ci
npm run format:check
npm run build
npm run typecheck
npm test
npm run validate
npm run conformance
npm run check:package
npm run check:package-public
npm run check:workspace-public
npm run check:release-install
npm run check:metadata
npm run check:licenses
npm run check:final-matrix
npm run skills:check
npm run check:certification
```

Agent skills must also pass their package-local checks:

```bash
npm --prefix agent-skills ci
npm --prefix agent-skills run validate
npm --prefix agent-skills run test
npm --prefix agent-skills run pack:dry
npm --prefix agent-skills run check
```

## Required Workflows

The matrix asserts these workflows exist and contain the expected gates:

- CI with Node 20.x, 22.x, and 24.x.
- Validate.
- Security with audit, license, secret, package public, and workspace public checks.
- Docs.
- Release Dry Run.
- Publish.
- Agent skills checks through CI and final certification.

## Package Artifact Rules

Root and agent-skills package dry-runs must not include `.git/`, `node_modules/`,
`_private/`, `.aicf/`, raw prompts, raw traces, raw provider payloads, logs, local
backups, generated docs, source archives, package archives, coverage output, or
unreviewed scratch files.

Create source review archives with the release script:

```bash
npm run archive:source
npm run check:source-archive
```

Do not zip the working directory manually.

## Publish Dry-Run Review

The publish dry-run command computes the npm dist tag from the package version and runs
both package dry-runs with public access:

```bash
npm run release:publish:dry
```

Prereleases such as `1.0.0-rc.5` use `next`. Stable releases use `latest`. This command
does not publish.

## Manual Acceptance

Before stable v1, maintainers should also review README positioning, MIT license
consistency, provider-neutral onboarding, at least one non-OpenAI quickstart, agent
skills install docs, npm ownership, trusted publishing, source archive contents, opt-in
live test boundaries, and root import optional-dependency isolation.
