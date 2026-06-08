# Installation

The AICF Agent Skills package is an independent nested npm package. Commands run
from `agent-skills/` unless noted otherwise.

## Local package setup

```bash
cd agent-skills
npm install
npm run check
```

Expected successful output includes `Skill validation passed`, `Trigger
coverage passed`, and `Agent skills release readiness passed`.

The root AICF repository can call package checks through root script hooks:

```bash
npm run skills:check
```

## Repo-local skill copy

Copy skills into a repository-local discovery folder:

```bash
node scripts/install-skills.mjs --target ../.agents/skills
```

Use `--force` only when replacing a previous local copy.

## User-level skill copy

Copy skills into a user-level discovery folder:

```bash
node scripts/install-skills.mjs --target $HOME/.agents/skills
```

The install script copies only skill folders. It does not copy package metadata,
tests, plugin metadata, dependency folders, or local artifacts.

## Codex plugin setup

The plugin manifest is `.codex-plugin/plugin.json`. A local plugin marketplace
entry can point at this package:

```json
{
  "name": "aicf-local-plugins",
  "interface": {
    "displayName": "AICF Local Plugins"
  },
  "plugins": [
    {
      "name": "aicf-agent-skills",
      "source": {
        "source": "local",
        "path": "./agent-skills"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Developer Tools"
    }
  ]
}
```

For a public repository sparse install, use the real repository path:

```bash
codex plugin marketplace add xennon101/ai-capability-framework --sparse agent-skills
```

## npm package usage

When the package is published, consumers can install the npm package and use its
CLI:

```bash
npm install @aicf/agent-skills
npx aicf-skills list
```

The npm package does not install hooks or run provider calls. It ships public
skill folders, docs, assets, and validation scripts.
