# npm Release Preflight

Run this preflight before pushing a release tag. It checks the public npm package
boundary and makes the release operator verify ownership and publishing setup.

## Packages

| Package                   | Expected scope          | Access | Release policy                                                            |
| ------------------------- | ----------------------- | ------ | ------------------------------------------------------------------------- |
| `ai-capability-framework` | unscoped public package | public | Published from the release tag after final certification.                 |
| `@aicf/agent-skills`      | `@aicf` npm scope       | public | Published from the same release tag and version, before the root package. |

Both packages must use the same version. Release tags must match that version exactly:
package version `1.0.0` uses tag `v1.0.0`.

## Ownership

AICF maintainers own release approval. Before tagging, the release operator must verify
npm ownership directly:

```bash
npm whoami
npm owner ls ai-capability-framework
npm owner ls @aicf/agent-skills
```

For the first `@aicf/agent-skills` release, the `@aicf` npm scope and package-level
trusted publishing setup must exist before the tag is pushed.

## Dist Tags

- Prerelease versions with a hyphen, such as `1.0.0-rc.6`, publish with `next`.
- Stable versions, such as `1.0.0`, publish with `latest`.
- Do not move `latest` to a prerelease intentionally. If a prerelease lands on `latest`,
  fix the dist tags before announcing the release.

## Trusted Publishing

GitHub Actions publishing must use npm Trusted Publishing with OIDC. Do not commit npm
tokens, one-time passwords, local `.npmrc` auth lines, or long-lived release
credentials. The publish workflow must keep `id-token: write` and publish only from `v*`
tags that point at `origin/main`.

AICF uses npm Trusted Publishing / GitHub OIDC for both public packages:

- `ai-capability-framework`
- `@aicf/agent-skills`

## Preflight Commands

See [Final Certification Matrix](../public-framework/final-certification-matrix.md) for
the complete local command and workflow gate.

Run the final matrix and local metadata/registry preflight:

```bash
npm run check:final-matrix
```

```bash
npm run check:release-tag
```

```bash
npm run release:preflight:npm
```

For final manual release review, use strict mode:

```bash
node scripts/check-npm-release-preflight.mjs --strict
```

The default command verifies package metadata, target dist tag, package availability,
and whether the target local versions are already published. It warns when npm login or
owner checks cannot be completed. Strict mode fails on missing npm auth, missing owner
verification, or missing scoped package setup.

Run both package publish dry-runs with the computed dist tag:

```bash
npm run release:publish:dry
```

This command does not publish. It runs root and `@aicf/agent-skills` dry-runs with
`--access public`.

## Version Availability

Before tagging, verify the target versions are unpublished:

```bash
VERSION=$(node -p "require('./package.json').version")
npm view "ai-capability-framework@${VERSION}" version
npm view "@aicf/agent-skills@${VERSION}" version
```

If either command returns a version, bump both package versions and refresh lockfiles
before tagging. npm versions are immutable.

## Rollback And Deprecation

Do not delete a published version as a normal rollback strategy. If a release is bad,
publish a fixed version and, when appropriate, deprecate the bad version with a concise
public-safe reason:

```bash
npm deprecate ai-capability-framework@<version> "Use <fixed-version>."
npm deprecate @aicf/agent-skills@<version> "Use <fixed-version>."
```

For dist-tag mistakes, move the tag to the intended version with `npm dist-tag add`.
