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
npm run skills:check
npm run check:workspace-public
npm run check:secrets
```

## Release Review

- Confirm `docs/skill-index.md` is current.
- Confirm `npm run check` passes, including `check:index` and
  `check:release`.
- Inspect `npm run pack:dry` output and confirm it includes docs, assets,
  scripts, plugin metadata, and all 17 skills.
- Confirm tests, trigger coverage, and public-safety scans pass.
- Confirm the plugin manifest at `.codex-plugin/plugin.json` points to
  `./skills/` and uses relative asset paths.
- Confirm the install script copies skills to a temporary directory and does
  not copy package metadata, tests, plugin metadata, dependency folders, or
  local artifacts.
- Confirm the changelog and version consistency before tagging or publishing.
- Confirm source archive check and npm package check behavior in the root
  repository when preparing a full AICF release.

## Public-Safety Review

Do not include private specs, prompt text captured from a real session, provider
payloads, traces, logs, credentials, account IDs, tenant IDs, generated docs,
archives, dependency folders, or local-only files.
