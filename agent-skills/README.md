# AICF Agent Skills

Reusable Agent Skills for coding agents that build, integrate, test, audit, and release
AI Capability Framework projects.

These are builder skills. They guide Codex or another compatible coding agent while it
edits a repository. They are not AICF runtime capabilities, provider tools,
application-agent tools, or a replacement for AICF validation.

## What Is Included

The package contains 17 public skills:

- capability authoring, governance lifecycle, policy/risk, eval authoring, security
  red-team work, release hygiene, and skill-pack maintenance;
- runtime integration, action lifecycle, trust/redaction/retention,
  observability/replay, and controls/budgets;
- provider conformance, optional storage/AWS guidance, migration, docs/examples, and
  control-plane UI/API guidance.

See [docs/skill-index.md](docs/skill-index.md) for descriptions and trigger examples
generated from the current package.

## Install And Check

Run package commands from this directory:

```bash
cd agent-skills
npm install
npm run check
npm run pack:dry
```

The package is independent from the root AICF package. The repository root does not use
npm workspaces for this package.

## Commands

```bash
npm run validate
npm run check:triggers
npm run index
npm run check:index
npm run test
npm run check:public
npm run check:release
npm run check
npm run pack:dry
node scripts/aicf-skills.mjs list
```

Expected successful output includes messages such as `Skill validation passed`,
`Trigger coverage passed`, `Skill index is current`, and
`Agent skills release readiness passed`.

The root repository exposes equivalent script hooks such as `npm run skills:ci`,
`npm run skills:check`, `npm run skills:pack:dry`, and `npm run skills:publish:dry`.

## Local Skill Copy

Copy the current skills to a local discovery folder:

```bash
node scripts/install-skills.mjs --target ../.agents/skills
node scripts/install-skills.mjs --target $HOME/.agents/skills
```

The install script copies only skill folders. It does not copy package metadata, tests,
plugin metadata, dependencies, or local artifacts. It refuses overwrite unless `--force`
is passed.

## Distribution

The Codex plugin manifest lives at `.codex-plugin/plugin.json` and points to `./skills/`
with relative asset paths. The package is released as `@aicf/agent-skills` and uses the
same version and release tag as the root `ai-capability-framework` package.

Prerelease install example:

```bash
npm install @aicf/agent-skills@next
npx aicf-skills list
```

Before the first real scoped-package publish, the maintainer must configure npm
ownership and Trusted Publishing for `@aicf/agent-skills`.

Reference docs:

- https://developers.openai.com/codex/skills
- https://developers.openai.com/codex/plugins/build
- https://agentskills.io/specification

## Contributing

New or changed skills must keep the required frontmatter, section order, one-level
references/assets, trigger fixtures, and public-safety rules. Run:

```bash
npm run index
npm run check
```

## Public Safety

All skill content must be public-safe. Do not add private specs, local paths, prompt
text captured from a real session, provider payloads, traces, credentials, account IDs,
tenant IDs, or customer data. Use synthetic examples and `example.com` where examples
need URLs.

## License

MIT, matching the root AI Capability Framework v1 license decision.
