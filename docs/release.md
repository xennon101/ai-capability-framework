# Release Checklist

This checklist prepares a GitHub-only AICF v0.1 release. It does not publish to
npm and does not remove `private: true` from `package.json`.

## Preflight

- Confirm the release branch contains only public framework material.
- Confirm `CHANGELOG.md` has the target release entry.
- Confirm README, API docs, spec docs, adapter docs, eval docs, and examples are
  internally consistent.
- Confirm no private drafts, raw prompts, raw traces, provider payloads,
  credentials, generated local docs, or packed tarballs are tracked.

## Verification

Run:

```bash
npm run generate:types
npm run check:generated
npm run build
npm test
npm run validate
npm run check:package
npm run check
```

Then inspect:

```bash
git status --short --ignored
git ls-files
```

`_private/`, `dist/`, `node_modules/`, traces, prompts, provider payloads,
generated local docs, and local-only material must remain untracked or ignored.

## GitHub Release

- Use tag `v0.1.0`.
- Use release title `AI Capability Framework v0.1.0`.
- Summarize the framework as schemas, TypeScript core, CLI, deterministic
  control plane, OpenAI Responses adapter, eval runner, docs, and public
  examples.
- State that npm publishing is not part of this release.
- Link to `CHANGELOG.md`, `docs/api.md`, `docs/spec.md`,
  `docs/control-plane.md`, `docs/openai-responses.md`, and
  `docs/eval-runner.md`.

## Post-Release

- Confirm GitHub Actions pass for the release commit or tag.
- Confirm the public repository file list does not expose private material.
- Leave npm publishing disabled unless a future phase explicitly changes that
  boundary.
