# Agent Guide

This is a public repository. Treat every tracked file as publishable content for
the AI Capability Framework.

## Workspace Boundary

- Track only public framework material: `README.md`, `AGENTS.md`, `docs/`,
  `schemas/`, `examples/`, `scripts/`, package metadata, and other files that
  are intentionally written for a public audience.
- Keep private drafts, research notes, raw product specs, generated documents,
  transcripts, traces, prompts, local experiments, and user-specific material in
  `_private/` or another ignored path.
- Keep generated docs, exports, local validation artifacts, model traces, raw
  prompts, and provider payloads out of tracked paths.
- Never move material from `_private/` into tracked paths by copying it verbatim.
  Distill it into new public text, remove private context, then validate it
  before staging.
- Before staging broad changes, run `git status --short --ignored` and confirm
  private files remain ignored.
- If a private file appears as tracked or staged, stop and fix the repository
  boundary before continuing.
- Before committing or pushing, run `git ls-files` and verify that tracked files
  exclude `_private/`, draft filenames, generated documents, traces, prompts,
  and local-only material.

## Public Content Rules

- Keep instructions practical and implementation-oriented.
- Avoid publishing credentials, endpoints, account IDs, tenant IDs, customer
  data, raw traces, raw prompts, provider payloads, internal project names, or
  unreleased planning material.
- Use generic examples with synthetic identifiers and `example.com` only.
- Prefer schemas, small examples, and validation scripts over long conceptual
  documents.
- For AI behavior changes, add or update example eval cases alongside schema or
  guidance changes.

## Engineering Workflow

- Preserve unrelated local changes. Do not reset, checkout, remove, or overwrite
  user work unless explicitly asked.
- Use `rg` for discovery and read nearby files before editing.
- Keep edits scoped to the framework contract, examples, or instructions touched
  by the request.
- Run `npm run generate:types` when schemas change, then commit the generated
  public manifest types under `src/generated/`.
- Run `npm run build` and `npm test` when TypeScript core, CLI, or generated
  types change.
- Run `npm run validate` before handoff when schemas, examples, or validation
  scripts change.
- CI must run `npm ci`, generated-type freshness checks, `npm run build`,
  `npm test`, and `npm run validate` for pushes and pull requests.
- If new generated output, local data, or private drafts are created, add ignore
  rules before they can be staged.

## Publishing Workflow

- This package is public on npm. Keep `package.json` publishable with
  `"private": false` and `publishConfig.access: "public"` unless the user
  explicitly changes the release boundary.
- Never commit npm credentials, npm tokens, local `.npmrc` auth lines, or
  one-time passwords. GitHub Actions publishing must use npm Trusted Publishing
  with OIDC, not long-lived `NPM_TOKEN` secrets.
- The trusted publishing workflow is `.github/workflows/publish.yml`. It should
  run only for `v*` tags, request `id-token: write`, run `npm ci`, run
  `npm run check`, and publish with `npm publish --access public`.
- Do not publish from ordinary branch pushes. Publish by tagging a commit that is
  already pushed to `origin/main`.
- Release tags must match the package version exactly, for example package
  version `1.0.0-rc.2` uses tag `v1.0.0-rc.2`.
- npm versions are immutable. Never try to republish an existing version. Bump
  the version first with `npm version <version>` or an equivalent intentional
  package/package-lock update.
- Pre-release versions containing a hyphen, such as `1.0.0-rc.2`, must publish
  with the `next` dist tag. Stable releases, such as `1.0.0`, publish with the
  `latest` dist tag.
- Before any release tag is pushed, run `npm run check`, inspect
  `npm publish --dry-run --tag next --access public` for pre-releases or
  `npm publish --dry-run --tag latest --access public` for stable releases, and
  confirm package contents exclude private/local-only material.
- After publishing, verify npm with `npm view ai-capability-framework version`
  and `npm view ai-capability-framework dist-tags --json`.
- If a pre-release is accidentally tagged as `latest`, correct npm dist tags
  before announcing the release.

## Repository Shape

- `schemas/` contains JSON Schema contracts for framework manifests.
- `examples/` contains synthetic public examples that validate against those
  schemas.
- `docs/` contains concise public guidance for using the framework.
- `_private/` is local-only preserved source material and must stay ignored.
