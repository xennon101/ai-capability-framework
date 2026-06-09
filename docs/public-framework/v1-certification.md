# Final v1.0 Certification

This checklist defines when AICF can be called v1.0 complete. It is a release readiness
gate, not a compliance certification, audit opinion, legal opinion, or security
guarantee.

## Automated Gate

Run the final local gate:

```bash
npm run check:certification
```

Run the final command/workflow/package matrix directly when reviewing release process
changes:

```bash
npm run check:final-matrix
```

The matrix is described in [Final Certification Matrix](final-certification-matrix.md).

The gate runs generated-type freshness, build, typecheck, repository lint, tests,
example validation, provider conformance, governance gate, docs build, package checks,
public artifact hygiene, runtime/optional/provider mock suites, agent-skills
install/check/dry-run, root package dry-run, and final certification assertions.

Run the metadata gate when reviewing package identity or license changes:

```bash
npm run check:metadata
```

The metadata gate confirms the MIT license decision, package/plugin/skill version
agreement, public package metadata, plugin asset paths, and README identity.

Run the dependency license gate when reviewing dependency or lockfile changes:

```bash
npm run check:licenses
```

The license gate checks the root and `agent-skills` lockfiles against the allowed
license list and the public
[Dependency License Exceptions](../public/license-exceptions.md) register.

Run the public-only safety gate when reviewing artifacts:

```bash
npm run check:public
```

`check:public` runs package public hygiene, workspace public hygiene, and
high-confidence secret scanning.

Run the npm release preflight before pushing a release tag:

```bash
npm run release:preflight:npm
```

Run the local publish dry-run wrapper before a release tag:

```bash
npm run release:publish:dry
```

Run the release tag alignment guard before tagging or reviewing publish workflows:

```bash
npm run check:release-tag
```

For final manual release review, run
`node scripts/check-npm-release-preflight.mjs --strict` after npm ownership and trusted
publishing are configured.

## Required Passing State

AICF is not v1.0 complete until:

- `npm run check:certification` passes locally.
- `npm run check:final-matrix` passes locally.
- CI passes on a clean checkout across the supported Node compatibility matrix: Node
  20.x, 22.x, and 24.x.
- npm package dry-run contains only expected public files.
- `@aicf/agent-skills` package dry-run contains only expected public skill files, docs,
  assets, scripts, and plugin metadata.
- clean consumer smoke test passes.
- root package, agent-skills package, Codex plugin manifest, and real skill metadata use
  the same version.
- npm ownership, scoped package setup, trusted publishing, dist-tag policy, and
  unpublished target versions are checked with
  [npm release preflight](../public/npm-release-preflight.md).
- root and agent-skills publish dry-runs pass through `npm run release:publish:dry`.
- root package, agent-skills package, Codex plugin manifest, README, and release docs
  consistently use MIT as the v1 license.
- dependency licenses pass `npm run check:licenses`, with any exception documented in
  [Dependency License Exceptions](../public/license-exceptions.md).
- root API exports are intentional and documented in
  [Public API Policy](../api/public-api-policy.md).
- `runCli` is available from `ai-capability-framework/cli`, not from the root package.
- docs build passes.
- all examples validate.
- no example requires real secrets by default.
- Live integration tests are opt-in and skipped by normal certification.
- provider conformance matrix passes for supported adapters.
- security pack generation works.
- trace-to-golden works.
- policy/action/audit stores have in-memory tests.
- control-plane reference UI/API has basic tests.
- AWS adapters have mocked tests and clear live-test instructions.
- public docs explain what AICF is and is not.
- public repository files are present.
- `SECURITY.md` exists and gives a private reporting path.
- `CHANGELOG.md` includes v1.0-ready release notes.

## Manual Review Checklist

Before a public v1.0 tag, manually inspect:

- npm package contents.
- `@aicf/agent-skills` package contents.
- README quickstart from a fresh machine or clean container.
- fresh-machine quickstart using the public npm package or a clean checkout.
- GitHub repository About/description says AICF is a provider-agnostic governed AI
  capability framework.
- GitHub topics include at least: ai, agents, tool-calling, evals, governance,
  model-context-protocol, langchain, gemini, anthropic, openai, typescript.
- examples with fake data.
- generated API docs.
- governance/lifecycle docs.
- provider docs.
- security docs.
- no private docs or planning artifacts.
- no raw provider payloads.
- no secrets.
- no personal or private platform assumptions in docs.
- no hardcoded AWS account IDs or provider keys.
- no root import of optional dependencies.
- no root export of CLI internals.
- same-tag release policy for `ai-capability-framework` and `@aicf/agent-skills`.
- npm ownership and trusted-publishing setup using `npm owner ls` and
  `npm run release:preflight:npm`.
- final matrix and publish dry-run review using `npm run check:final-matrix` and
  `npm run release:publish:dry`.
- the MIT license decision is intentional and documented in
  [License Decision](license-decision.md).
- dependency license exceptions, if any, are public, exact, reviewed, and still match
  the current lockfiles.
- npm trusted publishing is configured for both packages before pushing a release tag.

## Source Archive Review

Source archive checks require a clean committed tree:

```bash
npm run archive:source
npm run check:source-archive
```

Do not zip the working directory manually. Workspace archives can include Git metadata,
dependencies, generated output, local logs, traces, prompts, provider payloads, private
notes, or packed artifacts.

## Live Tests

Live integration tests are opt-in. They require explicit environment variables and are
not part of normal v1.0 certification. Normal certification uses mock clients,
deterministic fixtures, descriptor exports, package dry-runs, and public artifact
checks.

Optional live/provider/cloud checks may run only on the primary release Node unless a
workflow explicitly matrices them. The compatibility promise is proven by the non-live
public package gate on Node 20.x, 22.x, and 24.x.
