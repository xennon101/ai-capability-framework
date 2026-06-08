# Skill Authoring Standard

Every AICF skill must be concise, public-safe, and focused on one builder
workflow.

## Folder And Frontmatter

- Each skill folder lives directly under `skills/`.
- The folder name and `SKILL.md` frontmatter `name` must match.
- Names use lowercase letters, digits, and hyphens only.
- Frontmatter must include `description`, `license: MIT`, `compatibility`, and
  the required `metadata.aicf.skill.*` keys.
- `metadata.aicf.skill.version` must match the package version.
- `metadata.aicf.skill.package` must be `@aicf/agent-skills`.
- `allowed-tools` is not permitted.

## Required Sections

Each `SKILL.md` must contain these required sections in order:

1. `Purpose`
2. `Use this skill when`
3. `Do not use this skill when`
4. `Inputs to inspect first`
5. `Workflow`
6. `Required outputs`
7. `Validation`
8. `Hard rules`
9. `Handoff format`

Keep `SKILL.md` under 500 lines. Put detailed checklists, templates, and
examples in one-level resource files.

## References, Assets, And Scripts

- Links from `SKILL.md` may point only to one-level `references/`, `assets/`,
  or `scripts/` files inside that skill folder.
- Empty `references/` and `assets/` directories are not allowed.
- JSON, YAML, and YML files must parse.
- Do not create per-skill README, changelog, install guide, or extra process
  docs.

## Trigger Fixtures

Every production skill needs one trigger fixture in
`tests/fixtures/trigger-prompts.json` with:

- at least one positive example;
- at least one negative example;
- `required_description_terms` that appear in the skill description.

## Public-Safe Content

Skills must not copy private project notes, private planning files, local paths,
real credentials, account identifiers, customer data, prompt text captured from
a real session, provider payloads, traces, logs, generated docs, or archives.
Use synthetic examples and `example.com`.
