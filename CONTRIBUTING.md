# Contributing

Thanks for improving AI Capability Framework. This repository is public, so
every tracked change must be safe to publish.

## Public-Safe Contributions

- Use synthetic examples with fake IDs, fake tenants, fake users, and
  `example.com` addresses.
- Do not commit credentials, account IDs, customer records, raw prompts, raw
  traces, provider payloads, private source documents, generated exports, or
  local experiments.
- Keep private notes and drafts in `_private/` or another ignored path.
- Never copy from `_private/` into tracked files verbatim. Distill public
  guidance in new wording.

## Development Workflow

Install dependencies:

```bash
npm ci
```

Common commands:

```bash
npm run generate:types
npm run check:generated
npm run build
npm run docs:build
npm test
npm run validate
npm run check:package
npm run check
```

Run `npm run generate:types` whenever schemas change. Generated public manifest
types under `src/generated/` must stay current.

Use `npm run lint` for repository readiness checks, `npm run conformance` for
descriptor/mock provider conformance, and `npm run gate:examples` for the
deterministic governance gate over public examples.

## Optional Live Integration Tests

Normal tests use mocks, descriptor exports, and synthetic fixtures. Live tests
are opt-in only and require explicit environment variables such as
`RUN_REAL_OPENAI=1`, `RUN_LIVE_ANTHROPIC=1`, `RUN_LIVE_GEMINI=1`, or
`RUN_AWS_INTEGRATION=1`. Do not add credentials, account IDs, tenant IDs, raw
provider payloads, or transcripts to tracked files.

## Documentation Contributions

- Use public-safe fake data and `example.com` only.
- Include commands and expected output excerpts for walkthroughs.
- State when examples make no live provider calls by default.
- Keep generated TypeDoc output in ignored `generated-docs/`; do not commit it.
- Run `npm run docs:build` after changing docs, examples, or public navigation.

For artifacts:

```bash
npm pack
npm run archive:source
npm run check:source-archive
```

Use `npm pack` for npm package review and `npm run archive:source` for public
source review. Do not zip the working directory manually; raw workspace ZIPs can
include `.git/`, dependencies, generated output, private notes, logs, traces,
raw prompts, provider payloads, or Office/PDF exports.

## Pull Requests

Before opening a pull request:

- Run `npm run check`.
- Confirm examples are public-safe and synthetic.
- Confirm `_private/`, traces, prompts, provider payloads, generated local docs,
  packed tarballs, and local-only files are not tracked.
- Use `git status --short --ignored` to confirm private material remains
  ignored.
- Use `git ls-files` to inspect the tracked public surface.

## Changelog And Release Notes

Public behavior, docs, examples, CLI commands, package scripts, schemas, and
exported APIs should update `CHANGELOG.md`. Keep release notes concise and
public-safe. Use `docs/release.md` for the release checklist and
`docs/public-framework/release-process.md` for the public release process.

## Provider Adapters

Provider adapters must stay behind optional subpaths unless maintainers approve
a boundary change. Do not add provider SDKs to root imports. Descriptor exports
and runtime loops must preserve AICF validation, policy, lifecycle, model-safe
envelopes, no raw provider payload retention, and no model-exposed commit tools.

## Security Packs

Security-pack changes must use synthetic public-safe text, update generated or
assigned coverage where relevant, and avoid claims of certification, legal
advice, security guarantees, or compliance attestation.

## Manifest Fields

Add manifest fields only when they are optional or have a migration plan. Schema
changes require generated types, validation updates, examples, docs, and tests.
Required-field additions, removed meanings, and weakened safety semantics are
breaking changes.

## Scope

AICF is not an agent framework. It is a governed capability layer for
AI-accessible application functionality. Models propose; applications validate,
authorize, execute, and audit. Contributions should reinforce that boundary.
