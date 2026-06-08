# Validation

Run validation from `agent-skills/`.

```bash
npm run validate
npm run check:triggers
npm run index
npm run check:index
npm run test
npm run check:public
npm run check:release
npm run check
```

Expected output from a healthy package includes:

- `Skill validation passed`
- `Trigger coverage passed`
- `Generated ... docs/skill-index.md`
- `Skill index is current`
- `Agent skills release readiness passed`

## What Each Check Covers

- `validate`: skill folder names, `SKILL.md` frontmatter, MIT license,
  AICF metadata, required sections, one-level references/assets, parseable
  JSON/YAML, and public-safety markers.
- `check:triggers`: every real skill has positive and negative trigger
  examples, and fixture description terms match the skill descriptions.
- `index`: regenerates `docs/skill-index.md` from skill metadata and trigger
  fixtures.
- `check:index`: verifies `docs/skill-index.md` is current without writing
  files.
- `test`: runs deterministic Node tests for validation, trigger coverage,
  package metadata, npm dry-run contents, and install behavior.
- `check:public`: scans npm dry-run contents for forbidden paths, archives,
  generated output, dependency folders, and high-confidence credential markers.
- `check:release`: verifies the final 17-skill inventory, plugin metadata,
  docs, package scripts, relative asset paths, trigger fixtures, npm dry-run
  contents, and public package hygiene.

## Common Failures

- Stale index: run `npm run index`, then `npm run check:index`.
- Missing trigger coverage: update `tests/fixtures/trigger-prompts.json`.
- Broken reference link: link only to one-level `references/`, `assets/`, or
  `scripts/` files inside the skill folder.
- Package public-safety failure: remove the unsafe text or move local/private
  material to an ignored path outside the package.
- Pack content failure: update `package.json` `files`, package docs, or the
  public-safety rules so dry-run contents match the release boundary.
