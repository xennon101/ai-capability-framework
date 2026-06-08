# Public Release Checklist

Run these checks from `agent-skills/` before releasing or sharing the package:

```bash
npm run index
npm run check
npm run pack:dry
node scripts/install-skills.mjs --target <temp-dir> --force --allow-outside
```

Run these checks from the repository root when available:

```bash
npm run skills:ci
npm run skills:check
npm run skills:pack:dry
npm run skills:publish:dry
npm run check:metadata
npm run check:workspace-public
npm run check:secrets
```

## Release Review

- Confirm `docs/skill-index.md` is current.
- Confirm `npm run check` passes, including `check:index` and `check:release`.
- Inspect `npm run pack:dry` output and confirm it includes docs, assets, scripts,
  plugin metadata, and all 17 skills.
- Confirm tests, trigger coverage, and public-safety scans pass.
- Confirm the plugin manifest at `.codex-plugin/plugin.json` points to `./skills/` and
  uses relative asset paths.
- Confirm `agent-skills/package.json`, `.codex-plugin/plugin.json`, and all real skill
  metadata use the same version as the root package.
- Confirm `agent-skills/package.json`, `.codex-plugin/plugin.json`, and all real skill
  frontmatter use MIT, matching the root package and public license decision.
- Confirm `agent-skills/package.json` is public and sets `publishConfig.access` to
  `public`.
- Confirm root release certification includes `skills:ci`, `skills:check`, and
  `skills:pack:dry`.
- Use `npm run skills:publish:dry` as a quick no-publish package check. For an actual
  release-tag review, run the explicit tagged dry-run from the root release checklist,
  such as `npm publish ./agent-skills --dry-run --access public --tag next`.
- Confirm the install script copies skills to a temporary directory and does not copy
  package metadata, tests, plugin metadata, dependency folders, or local artifacts.
- Confirm the changelog, version consistency, and same-version, same-tag release policy
  before tagging or publishing.
- Confirm source archive check and npm package check behavior in the root repository
  when preparing a full AICF release.
- Confirm npm ownership and Trusted Publishing are configured for `@aicf/agent-skills`
  before the first real scoped-package publish.

## Public-Safety Review

Do not include private specs, prompt text captured from a real session, provider
payloads, traces, logs, credentials, account IDs, tenant IDs, generated docs, archives,
dependency folders, or local-only files.
